const db = require("./../../db")
const domain = require("./domain")
const emailQueue = require("./../email/queue")
const catalogCache = require("./../catalogCache")

const TRANSITION_EMAILS = {
  confirmed: "payment_confirmed",
  shipped: "shipped",
  cancelled: "cancelled",
  // `completed` intentionally sends nothing: the buyer already has the item.
}

class OutOfStockError extends Error {
  constructor(variantLabel) {
    super(`Hết hàng: ${variantLabel}`)
    this.name = "OutOfStockError"
    this.variantLabel = variantLabel
  }
}

/**
 * Distinct from OutOfStockError: a cart line's variant_id matches no row at
 * all (deleted, or never existed) rather than one that exists but is sold
 * out. Reusing OutOfStockError for this used to stuff the placeholder label
 * "không tồn tại" ("doesn't exist") into the buyer-facing quoted-label
 * message, reading as if that literal string were a product name.
 */
class VariantNotFoundError extends Error {
  constructor(missingIds) {
    super("Một sản phẩm trong giỏ hàng không còn tồn tại")
    this.name = "VariantNotFoundError"
    // The route uses this to tell the client exactly which cart lines to
    // drop — the buyer has no way to know which one is stale otherwise,
    // and "refresh the page" alone does nothing: a stale line lives in
    // localStorage, not anything a page reload would clear.
    this.missingVariantIds = missingIds
  }
}

class EmptyCartError extends Error {
  constructor() {
    super("Giỏ hàng trống")
    this.name = "EmptyCartError"
  }
}

class RequestKeyConflictError extends Error {
  constructor() {
    super("Mã yêu cầu đã được dùng cho một đơn khác, vui lòng thử lại")
    this.name = "RequestKeyConflictError"
  }
}

/**
 * The buyer asked for ship/pickup on a collection that never offered it —
 * e.g. "pickup" against a ship-only collection. Distinct from OutOfStockError:
 * this is a request-shape problem the client should not retry unchanged, not
 * a stock race, so the route maps it to 400 rather than 409.
 */
class FulfillmentNotOfferedError extends Error {
  constructor(method) {
    super(
      method === "pickup"
        ? "Bộ sưu tập này không hỗ trợ nhận tại chỗ"
        : "Bộ sưu tập này không hỗ trợ giao hàng"
    )
    this.name = "FulfillmentNotOfferedError"
  }
}

/**
 * Look up a previous submit of this idempotency key.
 *
 * request_key is client-supplied and unique across ALL buyers, so a bare key
 * match is not proof the same person is retrying. The caller must confirm the
 * stored row belongs to the buyer making the current request before treating
 * it as a replay — handing back a stranger's order_token would give them the
 * order page, and with it that buyer's name, phone, email and address.
 */
async function findByRequestKey(conn, requestKey) {
  const [[row]] = await conn.query(
    "SELECT id, order_token, total, email FROM orders WHERE request_key = ? LIMIT 1",
    [requestKey]
  )
  return row || null
}

const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase()

/** Is the stored order the same buyer as the one submitting now? */
function isSameBuyer(row, buyer) {
  const a = normalizeEmail(row.email)
  const b = normalizeEmail(buyer.email)
  return a !== "" && a === b
}

const replayResult = (row) => ({
  id: row.id,
  order_token: row.order_token,
  total: row.total,
  reused: true,
})

/**
 * Create an order and reserve its stock in one transaction.
 *
 * Prices come from the catalog inside the transaction — never from the client,
 * which sends only {variant_id, qty}. Only product_variants rows are locked,
 * and always in ascending id order, so two concurrent orders touching the same
 * variants cannot deadlock by grabbing them in opposite orders.
 */
async function createOrder(input) {
  const items = Array.isArray(input.items) ? input.items : []
  if (!items.length) throw new EmptyCartError()

  const buyer = input.buyer || {}

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    // Idempotency: a retried submit must not reserve stock a second time.
    // Only this buyer's own earlier order counts as a retry. If the key is
    // taken by someone else it is a coincidental collision between two
    // unrelated buyers, and this buyer is still entitled to their order — so
    // fall through and create it. The unique index then rejects the insert and
    // the catch below turns that into a visible RequestKeyConflictError rather
    // than silently returning the other buyer's order.
    if (input.request_key) {
      const existing = await findByRequestKey(conn, input.request_key)
      if (existing && isSameBuyer(existing, buyer)) {
        await conn.commit()
        return replayResult(existing)
      }
    }

    const wanted = new Map()
    for (const item of items) {
      const id = Number(item.variant_id)
      const qty = Number(item.qty)
      wanted.set(id, (wanted.get(id) || 0) + qty)
    }
    // This sort is what makes the locking safe: it produces an ascending id
    // list that drives both the IN (...) below — InnoDB walks the primary key
    // in index order, so it takes the row locks ascending — and the check and
    // decrement loops further down. The SQL ORDER BY only orders the result
    // set; it does not govern lock acquisition.
    const ids = [...wanted.keys()].sort((a, b) => a - b)

    // FOR UPDATE OF v locks only the product_variants rows. A bare FOR UPDATE
    // would also lock the joined products rows, and it would take those locks
    // in variant-id order — an order with no consistent relationship to product
    // ids — so two orders buying from the same two products via differently
    // ordered variants could deadlock on the parent rows. Verified on MySQL
    // 8.4: with OF v, a concurrent SELECT ... FROM products FOR UPDATE does not
    // block, while the same on product_variants does.
    const [rows] = await conn.query(
      `SELECT v.id, v.label, v.stock_qty, p.id AS product_id, p.name AS product_name,
              p.price, p.collection_id, c.allow_ship, c.allow_pickup
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         JOIN collections c ON c.id = p.collection_id
        WHERE v.id IN (${ids.map(() => "?").join(",")})
        ORDER BY v.id ASC
        FOR UPDATE OF v`,
      ids
    )
    if (rows.length !== ids.length) {
      const foundIds = new Set(rows.map((r) => r.id))
      throw new VariantNotFoundError(ids.filter((id) => !foundIds.has(id)))
    }

    // Every line's collection must actually offer the requested fulfillment
    // method. A cart could in principle span collections; check each row's
    // own collection rather than assuming a single one for the whole order.
    for (const row of rows) {
      if (input.fulfillment_method === "ship" && !row.allow_ship) {
        throw new FulfillmentNotOfferedError("ship")
      }
      if (input.fulfillment_method === "pickup" && !row.allow_pickup) {
        throw new FulfillmentNotOfferedError("pickup")
      }
    }

    const byId = new Map(rows.map((r) => [r.id, r]))
    const lines = []

    for (const id of ids) {
      const variant = byId.get(id)
      const qty = wanted.get(id)
      if (!domain.isReservable(variant.stock_qty, qty)) {
        throw new OutOfStockError(variant.label)
      }
      lines.push({
        variant_id: id,
        qty,
        product_name_snapshot: variant.product_name,
        variant_label_snapshot: variant.label,
        unit_price_snapshot: variant.price,
        collection_id: variant.collection_id,
      })
    }

    const total = domain.computeTotal(lines)

    // Decrement only finite stock; NULL means unlimited and stays NULL.
    for (const line of lines) {
      const variant = byId.get(line.variant_id)
      if (variant.stock_qty !== null) {
        await conn.query(
          "UPDATE product_variants SET stock_qty = stock_qty - ? WHERE id = ?",
          [line.qty, line.variant_id]
        )
      }
    }

    const token = domain.generateOrderToken()
    const expiresAt = domain.computeExpiry(input.payment_method)
    const isPickup = input.fulfillment_method === "pickup"
    const pickupCode = isPickup ? domain.generatePickupCode() : null

    const [res] = await conn.query(
      `INSERT INTO orders
         (order_token, request_key, buyer_name, phone, email, fulfillment_method,
          address_street, address_ward, address_district, address_province, address_raw,
          note, status, payment_method, total, cod_amount, collection_id, expires_at, pickup_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      [
        token,
        input.request_key || null,
        buyer.buyer_name,
        buyer.phone,
        buyer.email,
        input.fulfillment_method,
        isPickup ? null : buyer.address_street || null,
        isPickup ? null : buyer.address_ward || null,
        isPickup ? null : buyer.address_district || null,
        isPickup ? null : buyer.address_province || null,
        isPickup ? null : buyer.address_raw || null,
        input.note || null,
        input.payment_method,
        total,
        input.payment_method === "cod" ? total : null,
        lines[0].collection_id,
        expiresAt,
        pickupCode,
      ]
    )

    for (const line of lines) {
      await conn.query(
        `INSERT INTO order_items
           (order_id, product_variant_id, product_name_snapshot,
            variant_label_snapshot, unit_price_snapshot, qty)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [res.insertId, line.variant_id, line.product_name_snapshot,
         line.variant_label_snapshot, line.unit_price_snapshot, line.qty]
      )
    }

    await conn.commit()
    return { id: res.insertId, order_token: token, total, reused: false }
  } catch (err) {
    await conn.rollback()
    if (err.code === "ER_DUP_ENTRY" && input.request_key) {
      const existing = await findByRequestKey(db, input.request_key)
      // A concurrent submit by this same buyer won the unique index: their
      // order is our order, so return it.
      if (existing && isSameBuyer(existing, buyer)) return replayResult(existing)
      // The key belongs to a different buyer. Refusing loudly is the only safe
      // answer: reusing their order would leak their order_token, and we cannot
      // store ours under a key the index already gave away.
      if (existing) throw new RequestKeyConflictError()
    }
    throw err
  } finally {
    conn.release()
  }
}

async function attachItems(order) {
  if (!order) return null
  const [items] = await db.query(
    "SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC",
    [order.id]
  )
  return { ...order, items }
}

async function getOrderByToken(token) {
  // Joined so the public order page can show pickup_location/pickup_note for
  // pickup orders (spec: "shown at checkout and on the order page") without a
  // second round trip. SET NULL on collection deletion means a very old order
  // may have no collection left; the LEFT JOIN degrades to nulls rather than
  // dropping the order.
  const [[row]] = await db.query(
    `SELECT o.*, c.pickup_location, c.pickup_note
       FROM orders o
       LEFT JOIN collections c ON c.id = o.collection_id
      WHERE o.order_token = ? LIMIT 1`,
    [token]
  )
  return attachItems(row)
}

async function getOrderById(id) {
  const [[row]] = await db.query("SELECT * FROM orders WHERE id = ? LIMIT 1", [id])
  return attachItems(row)
}

/**
 * Parse an admin-supplied date filter boundary. Malformed input is ignored
 * (returns null) rather than surfaced as an error, per the route's
 * tolerate-bad-input contract. `date_to` is treated as inclusive: a bare
 * YYYY-MM-DD is widened to the end of that day so "to 2026-01-31" doesn't
 * silently exclude orders created that afternoon.
 */
function parseDateBoundary(value, { endOfDay = false } = {}) {
  if (typeof value !== "string" || value === "") return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999)
  }
  return date
}

async function listOrders(filter = {}) {
  const where = []
  const params = []
  if (filter.status) { where.push("status = ?"); params.push(filter.status) }
  if (filter.collection_id) { where.push("collection_id = ?"); params.push(filter.collection_id) }

  // Filters on created_at (not confirmed_at/etc.) so idx_orders_status_created
  // stays usable when a status filter is also present.
  const from = parseDateBoundary(filter.date_from)
  if (from) { where.push("created_at >= ?"); params.push(from) }
  const to = parseDateBoundary(filter.date_to, { endOfDay: true })
  if (to) { where.push("created_at <= ?"); params.push(to) }

  const [rows] = await db.query(
    `SELECT * FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC, id DESC`,
    params
  )
  return rows
}

/** Return reserved stock. Caller must hold the order row lock. */
async function releaseStock(conn, orderId) {
  const [items] = await conn.query(
    "SELECT product_variant_id, qty FROM order_items WHERE order_id = ?",
    [orderId]
  )
  // Ascending id order, same as reservation, to keep lock ordering consistent.
  const sorted = items
    .filter((i) => i.product_variant_id !== null)
    .sort((a, b) => a.product_variant_id - b.product_variant_id)

  for (const item of sorted) {
    // The NULL guard keeps unlimited variants unlimited.
    await conn.query(
      "UPDATE product_variants SET stock_qty = stock_qty + ? WHERE id = ? AND stock_qty IS NOT NULL",
      [item.qty, item.product_variant_id]
    )
  }
  await conn.query("UPDATE orders SET stock_released_at = NOW() WHERE id = ?", [orderId])
}

/**
 * Move an order to a new status. Cancelling returns reserved stock, guarded by
 * stock_released_at so a double cancel — or a cancel racing the expiry sweep —
 * cannot credit the same stock twice.
 *
 * `extra.expectedFromStatus` and `extra.expiredBefore` let a caller that
 * decided to act on a row it read *outside* this transaction re-assert what it
 * saw, now that the row is locked. Both are checked against the freshly locked
 * row and refuse the transition (return false, change nothing) on a mismatch.
 */
async function transitionOrder(id, toStatus, extra = {}) {
  const conn = await db.getConnection()
  let ok = false
  let notifyEmailType = null
  let notifyAddress = null
  let notifyAdminType = null
  let stockReleased = false
  try {
    await conn.beginTransaction()

    const [[order]] = await conn.query(
      `SELECT id, status, fulfillment_method, stock_released_at, expires_at, email
         FROM orders WHERE id = ? FOR UPDATE`,
      [id]
    )
    if (!order) { await conn.rollback(); return false }

    // canTransition alone is not enough for the expiry sweep: confirmed ->
    // cancelled is a legal admin action, so a sweep that queued behind an
    // admin's confirm would wake up, see 'confirmed', and cancel an order the
    // buyer had just paid for — releasing its stock back to the shop. The
    // sweep therefore states the status it acted on and we verify it here.
    if (extra.expectedFromStatus !== undefined && order.status !== extra.expectedFromStatus) {
      await conn.rollback()
      return false
    }

    // Same class of race on the deadline itself: an order whose expires_at was
    // extended after the sweep's read must not be cancelled as overdue.
    if (extra.expiredBefore !== undefined) {
      const expiresAt = order.expires_at === null ? null : new Date(order.expires_at)
      if (expiresAt === null || expiresAt > new Date(extra.expiredBefore)) {
        await conn.rollback()
        return false
      }
    }

    if (!domain.canTransition(order.status, toStatus, order.fulfillment_method)) {
      await conn.rollback()
      return false
    }

    if (toStatus === "cancelled" && order.stock_released_at === null) {
      await releaseStock(conn, id)
      stockReleased = true
    }

    const sets = ["status = ?"]
    const params = [toStatus]
    if (toStatus === "confirmed") sets.push("confirmed_at = NOW()")
    if (toStatus === "shipped") sets.push("shipped_at = NOW()")
    if (toStatus === "completed") sets.push("completed_at = NOW()")
    if (toStatus === "cancelled") sets.push("cancelled_at = NOW()")
    if (extra.tracking_code !== undefined) { sets.push("tracking_code = ?"); params.push(extra.tracking_code) }
    if (extra.shipping_fee !== undefined) { sets.push("shipping_fee = ?"); params.push(extra.shipping_fee) }
    if (toStatus === "cancelled" && extra.cancel_reason !== undefined) {
      sets.push("cancel_reason = ?"); params.push(extra.cancel_reason)
    }
    params.push(id)

    await conn.query(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`, params)
    await conn.commit()
    ok = true

    // Deliberately outside the transaction: a mail failure must never roll
    // back a status change the seller already performed. The connection is
    // released (see finally) before the email is enqueued below, so this
    // does not hold a pool connection while enqueue() borrows another one.
    const emailType = TRANSITION_EMAILS[toStatus]
    if (emailType && extra.notify !== false && order.email) {
      notifyEmailType = emailType
      notifyAddress = order.email
    }
    // payment_confirmed goes to buyer + admin (spec Notifications section);
    // shipped/cancelled/expired stay buyer-only, so this is confirmed-only.
    if (toStatus === "confirmed" && extra.notify !== false && process.env.ADMIN_EMAIL) {
      notifyAdminType = TRANSITION_EMAILS.confirmed
    }
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  // Both the cache invalidation and the email enqueues below run only after
  // the connection above has been released (see `finally`) — none of them
  // may hold a pool connection while doing follow-up work (see commit
  // 58dad02). Each is independently best-effort: a Redis or mail failure
  // must never fail or roll back a status change the seller already made.
  if (stockReleased) {
    try {
      await catalogCache.invalidate()
    } catch (err) {
      console.error("[ORDERS] Không xoá được cache catalog:", err.message)
    }
  }

  if (notifyEmailType) {
    try {
      await emailQueue.enqueue(id, notifyEmailType, notifyAddress)
    } catch (err) {
      console.error("[ORDERS] Không xếp được email:", err.message)
    }
  }

  if (notifyAdminType) {
    try {
      await emailQueue.enqueue(id, notifyAdminType, process.env.ADMIN_EMAIL)
    } catch (err) {
      console.error("[ORDERS] Không xếp được email cho admin:", err.message)
    }
  }

  return ok
}

/**
 * Cancel pending prepaid orders past their deadline. COD orders have a NULL
 * expires_at and are excluded by the query itself, not by a code path that
 * could be forgotten.
 */
async function releaseExpiredOrders(now = new Date()) {
  const [due] = await db.query(
    "SELECT id FROM orders WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?",
    [now]
  )

  // The rows above were read on the pool with no lock held, so each one may
  // have moved on before we get to it. expectedFromStatus/expiredBefore make
  // the cancel conditional on the row still being what the query selected.
  let released = 0
  for (const row of due) {
    const cancelled = await transitionOrder(row.id, "cancelled", {
      expectedFromStatus: "pending",
      expiredBefore: now,
    })
    if (cancelled) released += 1
  }
  return released
}

module.exports = {
  createOrder,
  getOrderByToken,
  getOrderById,
  listOrders,
  transitionOrder,
  releaseExpiredOrders,
  OutOfStockError,
  VariantNotFoundError,
  EmptyCartError,
  RequestKeyConflictError,
  FulfillmentNotOfferedError,
}
