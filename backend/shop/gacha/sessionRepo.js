const db = require("./../../db")
const orderDomain = require("./../orders/domain")
const gachaDomain = require("./domain")

class GachaSoldOutError extends Error {
  constructor() {
    super("Kho quà không đủ cho số lượt yêu cầu")
    this.name = "GachaSoldOutError"
  }
}
class GachaProductNotFoundError extends Error {
  constructor() {
    super("Không tìm thấy sản phẩm gacha")
    this.name = "GachaProductNotFoundError"
  }
}
class GachaSessionNotFoundError extends Error {
  constructor() {
    super("Không tìm thấy phiên quay")
    this.name = "GachaSessionNotFoundError"
  }
}
class GachaSessionCompleteError extends Error {
  constructor() {
    super("Phiên quay đã hết lượt")
    this.name = "GachaSessionCompleteError"
  }
}
class GachaOrderCancelledError extends Error {
  constructor() {
    super("Đơn hàng đã bị hủy, không thể tiếp tục quay")
    this.name = "GachaOrderCancelledError"
  }
}

async function getPoolRemaining(productId) {
  const [[row]] = await db.query(
    "SELECT COALESCE(SUM(quantity_remaining), 0) AS total FROM gacha_prizes WHERE product_id = ?",
    [productId]
  )
  return Number(row.total)
}

async function getSessionByOrderId(orderId) {
  const [[row]] = await db.query("SELECT * FROM gacha_sessions WHERE order_id = ?", [orderId])
  return row || null
}

async function getSessionById(id) {
  const [[row]] = await db.query("SELECT * FROM gacha_sessions WHERE id = ?", [id])
  return row || null
}

async function getDropsForSession(sessionId) {
  const [rows] = await db.query(
    `SELECT d.id, d.drawn_at, p.name, p.tier, p.display_price, p.image_url
       FROM gacha_draws d
       JOIN gacha_prizes p ON p.id = d.gacha_prize_id
      WHERE d.session_id = ?
      ORDER BY d.id ASC`,
    [sessionId]
  )
  return rows
}

/**
 * Called from orderRepo.transitionOrder right after an order reaches
 * 'confirmed'. Sums the qty of every gacha order_item on this order into a
 * single session - createOrder (see Task 5) already refuses to mix a gacha
 * item with any other product or a second gacha product in one cart, so
 * this sum is always against exactly one gacha product. Idempotent via the
 * unique index on gacha_sessions.order_id - a re-entrant call (there should
 * never be one, since an order can't be confirmed twice, but this mirrors
 * the codebase's existing defense-in-depth style) is a silent no-op.
 */
async function startOnlineSessionIfNeeded(orderId) {
  const [items] = await db.query(
    `SELECT oi.qty, p.id AS product_id, p.type AS product_type
       FROM order_items oi
       JOIN product_variants v ON v.id = oi.product_variant_id
       JOIN products p ON p.id = v.product_id
      WHERE oi.order_id = ?`,
    [orderId]
  )
  const gachaItems = items.filter((i) => i.product_type === "gacha")
  if (!gachaItems.length) return

  const productId = gachaItems[0].product_id
  const turnsTotal = gachaItems.reduce((sum, i) => sum + i.qty, 0)
  try {
    await db.query(
      `INSERT INTO gacha_sessions (product_id, order_id, turns_total, turns_used, status, source)
       VALUES (?, ?, ?, 0, 'active', 'online')`,
      [productId, orderId, turnsTotal]
    )
  } catch (err) {
    if (err.code !== "ER_DUP_ENTRY") throw err
  }
}

/** Staff Panel's "Start session" - creates the cash order and its session together, in one transaction. */
async function startBoothSession({ productId, buyerName, turnsTotal }) {
  if (!Number.isInteger(turnsTotal) || turnsTotal <= 0) {
    throw new Error("Số lượt quay không hợp lệ")
  }
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [[product]] = await conn.query(
      "SELECT id, price, collection_id FROM products WHERE id = ? AND type = 'gacha' FOR UPDATE",
      [productId]
    )
    if (!product) throw new GachaProductNotFoundError()

    const [[pool]] = await conn.query(
      "SELECT COALESCE(SUM(quantity_remaining), 0) AS total FROM gacha_prizes WHERE product_id = ? FOR UPDATE",
      [productId]
    )
    if (Number(pool.total) < turnsTotal) throw new GachaSoldOutError()

    const token = orderDomain.generateOrderToken()
    const total = product.price * turnsTotal
    const [orderRes] = await conn.query(
      `INSERT INTO orders
         (order_token, buyer_name, phone, email, fulfillment_method, status, payment_method, total, cod_amount, collection_id, confirmed_at)
       VALUES (?, ?, '', '', 'booth', 'confirmed', 'cash', ?, NULL, ?, NOW())`,
      [token, buyerName || "Khách tại quầy", total, product.collection_id]
    )
    const orderId = orderRes.insertId

    const [sessionRes] = await conn.query(
      `INSERT INTO gacha_sessions (product_id, order_id, buyer_name, turns_total, turns_used, status, source)
       VALUES (?, ?, ?, ?, 0, 'active', 'booth_cash')`,
      [productId, orderId, buyerName || null, turnsTotal]
    )

    await conn.commit()
    return { orderId, sessionId: sessionRes.insertId, orderToken: token }
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/**
 * The one function that decides a real draw's outcome. Runs entirely
 * inside one transaction: row-locks the product's prizes, picks the
 * winner server-side, decrements it, records the draw + its order_items
 * row, advances turns_used, and completes the session/order if this was
 * the last turn. drawKey makes a retried/double-tapped request idempotent:
 * if it matches the session's last_draw_key, the original result is
 * returned without drawing again.
 *
 * ownerOrderId, when supplied by a buyer-facing caller, is the second half
 * of authorization: the route proves which order the caller holds, and this
 * asserts the session actually belongs to it. Checked before the
 * idempotency replay so a guessed session id can't even read someone
 * else's prize, and reported as "not found" so ids stay non-enumerable.
 *
 * requireSource is the equivalent constraint for the admin/kiosk caller: the
 * booth tablet is a physically-exposed admin credential, so its reach is
 * pinned to the booth-cash sessions it is there to run, never an online
 * buyer's. Same "not found" reporting, for the same reason.
 */
async function drawForSession(sessionId, { drawKey, ownerOrderId, requireSource }) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [[session]] = await conn.query("SELECT * FROM gacha_sessions WHERE id = ? FOR UPDATE", [sessionId])
    if (!session) throw new GachaSessionNotFoundError()
    if (ownerOrderId != null && Number(session.order_id) !== Number(ownerOrderId)) {
      throw new GachaSessionNotFoundError()
    }
    if (requireSource && session.source !== requireSource) {
      throw new GachaSessionNotFoundError()
    }

    // An admin can cancel a booth-cash or online order mid-session
    // (confirmed -> cancelled is a legal transition) without touching the
    // session row, so without this the session stays 'active' and further
    // draws would burn real quantity_remaining onto a dead order. Locked
    // here, in the same transaction, so a cancel racing a draw resolves one
    // way or the other rather than both. gacha_sessions -> orders is the
    // lock order this function already used in its completion branch; taking
    // it for every draw just widens an edge that was already there.
    const [[owner]] = await conn.query("SELECT status FROM orders WHERE id = ? FOR UPDATE", [session.order_id])
    if (owner && owner.status === "cancelled") throw new GachaOrderCancelledError()

    if (drawKey && session.last_draw_key === drawKey && session.last_draw_id) {
      const [[replay]] = await conn.query(
        `SELECT p.* FROM gacha_draws d JOIN gacha_prizes p ON p.id = d.gacha_prize_id WHERE d.id = ?`,
        [session.last_draw_id]
      )
      await conn.commit()
      return {
        prize: replay,
        turnsUsed: session.turns_used,
        turnsTotal: session.turns_total,
        sessionCompleted: session.status === "completed",
        orderId: session.order_id,
      }
    }

    if (session.status === "completed" || session.turns_used >= session.turns_total) {
      throw new GachaSessionCompleteError()
    }

    const [prizes] = await conn.query(
      "SELECT * FROM gacha_prizes WHERE product_id = ? ORDER BY id ASC FOR UPDATE",
      [session.product_id]
    )
    const poolRemaining = prizes.reduce((sum, p) => sum + p.quantity_remaining, 0)
    if (poolRemaining <= 0) throw new GachaSoldOutError()
    const winner = gachaDomain.weightedPick(prizes)

    await conn.query("UPDATE gacha_prizes SET quantity_remaining = quantity_remaining - 1 WHERE id = ?", [winner.id])

    const [drawRes] = await conn.query(
      "INSERT INTO gacha_draws (session_id, gacha_prize_id) VALUES (?, ?)",
      [sessionId, winner.id]
    )

    await conn.query(
      `INSERT INTO order_items
         (order_id, product_variant_id, product_name_snapshot, variant_label_snapshot, unit_price_snapshot, qty,
          image_url_snapshot, is_gift, stock_reserved, gacha_draw_id, gacha_tier_snapshot)
       VALUES (?, NULL, ?, '', ?, 1, ?, false, false, ?, ?)`,
      [session.order_id, winner.name, winner.display_price, winner.image_url, drawRes.insertId, winner.tier]
    )

    const turnsUsed = session.turns_used + 1
    const sessionCompleted = turnsUsed >= session.turns_total
    await conn.query(
      `UPDATE gacha_sessions
         SET turns_used = ?, status = ?, completed_at = ?, last_draw_key = ?, last_draw_id = ?
       WHERE id = ?`,
      [turnsUsed, sessionCompleted ? "completed" : "active", sessionCompleted ? new Date() : null,
        drawKey || null, drawRes.insertId, sessionId]
    )

    if (sessionCompleted) {
      const [[order]] = await conn.query("SELECT status, fulfillment_method FROM orders WHERE id = ? FOR UPDATE", [session.order_id])
      // Booth-cash: handed over on the spot, nothing to ship - completes
      // immediately. Online: stays confirmed so the normal
      // confirmed -> shipped -> completed admin pipeline packs/ships
      // whatever ended up drawn, unchanged from any physical order.
      if (order.fulfillment_method === "booth" && order.status === "confirmed") {
        await conn.query("UPDATE orders SET status = 'completed', completed_at = NOW() WHERE id = ?", [session.order_id])
      }
    }

    await conn.commit()
    return { prize: winner, turnsUsed, turnsTotal: session.turns_total, sessionCompleted, orderId: session.order_id }
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/**
 * Structurally separate from drawForSession, on purpose: this function has
 * no write transaction at all, so it is provably incapable of touching
 * quantity_remaining or writing a gacha_draws/order_items row, rather than
 * relying on every future edit to remember to check a "is this practice"
 * flag deep inside the real draw path.
 */
async function practiceDraw(productId) {
  const [prizes] = await db.query("SELECT * FROM gacha_prizes WHERE product_id = ?", [productId])
  const winner = gachaDomain.weightedPick(prizes)
  return { prize: winner }
}

module.exports = {
  getPoolRemaining,
  startOnlineSessionIfNeeded,
  startBoothSession,
  getSessionByOrderId,
  getSessionById,
  getDropsForSession,
  drawForSession,
  practiceDraw,
  GachaSoldOutError,
  GachaProductNotFoundError,
  GachaSessionNotFoundError,
  GachaSessionCompleteError,
  GachaOrderCancelledError,
}
