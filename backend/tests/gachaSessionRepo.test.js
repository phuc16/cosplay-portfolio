import { describe, it, expect, beforeEach, afterAll } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import prizeRepo from "../shop/gacha/prizeRepo.js"
import sessionRepo from "../shop/gacha/sessionRepo.js"
import orderRepo from "../shop/orders/orderRepo.js"
import { resetTables, closeDb } from "./helpers/db.js"

async function seedGachaProduct(prizes) {
  const cid = await catalog.createCollection({ title: "Festival Gacha", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
  // Temporary shim: catalogRepo.createProduct still coerces every non-digital
  // type to 'physical' and only digital products get a hidden variant. Task 6
  // teaches it about 'gacha'; until then the seed fixes up the row itself so
  // these tests exercise real gacha rows. Redundant no-op once Task 6 lands.
  await db.query("UPDATE products SET type = 'gacha' WHERE id = ?", [pid])
  await catalog.replaceVariants(pid, [{ label: "", stock_qty: null }])
  await prizeRepo.replacePrizes(pid, prizes)
  return pid
}

async function hiddenVariantId(productId) {
  const [[row]] = await db.query("SELECT id FROM product_variants WHERE product_id = ? LIMIT 1", [productId])
  return row.id
}

beforeEach(async () => {
  await resetTables("gacha_draws", "gacha_sessions", "gacha_prizes", "order_items", "orders", "product_variants", "products", "collections")
})

afterAll(closeDb)

describe("startBoothSession", () => {
  it("creates a confirmed cash order and an active session together", async () => {
    const pid = await seedGachaProduct([{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }])
    const { orderId, sessionId } = await sessionRepo.startBoothSession({ productId: pid, buyerName: "Phuc", turnsTotal: 3 })

    const [[order]] = await db.query("SELECT status, payment_method, fulfillment_method FROM orders WHERE id = ?", [orderId])
    expect(order.status).toBe("confirmed")
    expect(order.payment_method).toBe("cash")
    expect(order.fulfillment_method).toBe("booth")

    const session = await sessionRepo.getSessionById(sessionId)
    expect(session.turns_total).toBe(3)
    expect(session.turns_used).toBe(0)
    expect(session.status).toBe("active")
    expect(session.source).toBe("booth_cash")
  })

  it("refuses to start a session larger than the remaining pool", async () => {
    const pid = await seedGachaProduct([{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 2 }])
    await expect(
      sessionRepo.startBoothSession({ productId: pid, buyerName: null, turnsTotal: 3 })
    ).rejects.toThrow(sessionRepo.GachaSoldOutError)
  })
})

describe("drawForSession", () => {
  it("decrements the winning prize, records the draw and an order_items row, and increments turns_used", async () => {
    const pid = await seedGachaProduct([{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 1 }])
    const { orderId, sessionId } = await sessionRepo.startBoothSession({ productId: pid, buyerName: null, turnsTotal: 1 })

    const result = await sessionRepo.drawForSession(sessionId, { drawKey: "tap-1" })

    expect(result.prize.name).toBe("Sticker")
    expect(result.turnsUsed).toBe(1)
    expect(result.sessionCompleted).toBe(true)

    const [[prizeRow]] = await db.query("SELECT quantity_remaining FROM gacha_prizes WHERE product_id = ?", [pid])
    expect(prizeRow.quantity_remaining).toBe(0)

    const [items] = await db.query("SELECT product_name_snapshot, gacha_tier_snapshot FROM order_items WHERE order_id = ?", [orderId])
    expect(items).toHaveLength(1)
    expect(items[0].product_name_snapshot).toBe("Sticker")
    expect(items[0].gacha_tier_snapshot).toBe("common")

    const [[order]] = await db.query("SELECT status FROM orders WHERE id = ?", [orderId])
    expect(order.status).toBe("completed")
  })

  it("is idempotent: replaying the same draw_key returns the original result without drawing again", async () => {
    const pid = await seedGachaProduct([
      { name: "Common", tier: "common", display_price: 1000, quantity_total: 100 },
    ])
    const { sessionId } = await sessionRepo.startBoothSession({ productId: pid, buyerName: null, turnsTotal: 2 })

    const first = await sessionRepo.drawForSession(sessionId, { drawKey: "tap-1" })
    const replay = await sessionRepo.drawForSession(sessionId, { drawKey: "tap-1" })

    expect(replay.prize.id).toBe(first.prize.id)
    expect(replay.turnsUsed).toBe(1)

    const session = await sessionRepo.getSessionById(sessionId)
    expect(session.turns_used).toBe(1)
  })

  it("refuses to draw for a session that does not belong to the supplied order", async () => {
    const pid = await seedGachaProduct([{ name: "Common", tier: "common", display_price: 1000, quantity_total: 100 }])
    const { orderId, sessionId } = await sessionRepo.startBoothSession({ productId: pid, buyerName: null, turnsTotal: 2 })

    await expect(
      sessionRepo.drawForSession(sessionId, { drawKey: "tap-1", ownerOrderId: orderId + 999 })
    ).rejects.toThrow(sessionRepo.GachaSessionNotFoundError)

    const untouched = await sessionRepo.getSessionById(sessionId)
    expect(untouched.turns_used).toBe(0)

    const ok = await sessionRepo.drawForSession(sessionId, { drawKey: "tap-1", ownerOrderId: orderId })
    expect(ok.turnsUsed).toBe(1)
  })

  it("refuses to draw past turns_total", async () => {
    const pid = await seedGachaProduct([{ name: "Common", tier: "common", display_price: 1000, quantity_total: 100 }])
    const { sessionId } = await sessionRepo.startBoothSession({ productId: pid, buyerName: null, turnsTotal: 1 })

    await sessionRepo.drawForSession(sessionId, { drawKey: "tap-1" })
    await expect(sessionRepo.drawForSession(sessionId, { drawKey: "tap-2" })).rejects.toThrow(sessionRepo.GachaSessionCompleteError)
  })

  it("throws a typed GachaSoldOutError when the pool empties mid-session", async () => {
    const pid = await seedGachaProduct([{ name: "Common", tier: "common", display_price: 1000, quantity_total: 5 }])
    const { sessionId } = await sessionRepo.startBoothSession({ productId: pid, buyerName: null, turnsTotal: 3 })

    // The pool is only checked at session-start; simulate it being drained
    // (by other sessions/an admin edit) between start and this draw.
    await db.query("UPDATE gacha_prizes SET quantity_remaining = 0 WHERE product_id = ?", [pid])

    await expect(sessionRepo.drawForSession(sessionId, { drawKey: "tap-1" })).rejects.toThrow(sessionRepo.GachaSoldOutError)

    const session = await sessionRepo.getSessionById(sessionId)
    expect(session.turns_used).toBe(0)
  })

  it("refuses to draw against a cancelled order and leaves stock and draws untouched", async () => {
    const pid = await seedGachaProduct([{ name: "Common", tier: "common", display_price: 1000, quantity_total: 10 }])
    const { orderId, sessionId } = await sessionRepo.startBoothSession({ productId: pid, buyerName: null, turnsTotal: 3 })

    await sessionRepo.drawForSession(sessionId, { drawKey: "tap-1" })
    const cancelled = await orderRepo.transitionOrder(orderId, "cancelled")
    expect(cancelled).toBe(true)

    await expect(
      sessionRepo.drawForSession(sessionId, { drawKey: "tap-2" })
    ).rejects.toThrow(sessionRepo.GachaOrderCancelledError)

    const [[prizeRow]] = await db.query("SELECT quantity_remaining FROM gacha_prizes WHERE product_id = ?", [pid])
    expect(prizeRow.quantity_remaining).toBe(9)
    const [[{ drawCount }]] = await db.query("SELECT COUNT(*) AS drawCount FROM gacha_draws WHERE session_id = ?", [sessionId])
    expect(drawCount).toBe(1)
    const session = await sessionRepo.getSessionById(sessionId)
    expect(session.turns_used).toBe(1)
  })
})

describe("concurrent draws for the last unit of a prize", () => {
  const attempt = (sessionId, drawKey) =>
    sessionRepo.drawForSession(sessionId, { drawKey }).then((r) => ({ ok: true, r })).catch((e) => ({ ok: false, e }))

  // The race drawForSession's `SELECT ... FOR UPDATE` over gacha_prizes is
  // designed to prevent: two independent sessions (two booth buyers on two
  // tablets, or a booth buyer and an online one) drawing from the same
  // product's shared pool at the same instant.
  it("lets only one of two independent sessions win the single remaining unit", async () => {
    const pid = await seedGachaProduct([{ name: "Ancient", tier: "ancient", display_price: 500000, quantity_total: 1 }])
    const a = await sessionRepo.startBoothSession({ productId: pid, buyerName: "A", turnsTotal: 1 })
    // The second session is created before the first draw lands, so both hold
    // a turn against a pool that can only honour one of them - the exact
    // interleaving the start-time pool check cannot rule out.
    const b = await sessionRepo.startBoothSession({ productId: pid, buyerName: "B", turnsTotal: 1 })

    const results = await Promise.all([attempt(a.sessionId, "a-1"), attempt(b.sessionId, "b-1")])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const losers = results.filter((r) => !r.ok)
    expect(losers).toHaveLength(1)
    // quantity_remaining is unsigned, so "never went negative" alone would
    // also hold for an unlocked implementation MySQL happened to reject.
    // Asserting the contracted domain error is what proves the shortage was
    // detected under the row lock (same reasoning as orderConcurrency.test.js).
    expect(losers[0].e).toBeInstanceOf(sessionRepo.GachaSoldOutError)

    const [[prize]] = await db.query("SELECT quantity_remaining FROM gacha_prizes WHERE product_id = ?", [pid])
    expect(prize.quantity_remaining).toBe(0)
    expect(prize.quantity_remaining).toBeGreaterThanOrEqual(0)

    const [[{ drawCount }]] = await db.query(
      "SELECT COUNT(*) AS drawCount FROM gacha_draws d JOIN gacha_prizes p ON p.id = d.gacha_prize_id WHERE p.product_id = ?",
      [pid]
    )
    expect(drawCount).toBe(1)
    const [[{ itemCount }]] = await db.query("SELECT COUNT(*) AS itemCount FROM order_items WHERE gacha_draw_id IS NOT NULL")
    expect(itemCount).toBe(1)
  })

  it("never over-draws a single-unit prize when many sessions race it at once", async () => {
    const pid = await seedGachaProduct([{ name: "Ancient", tier: "ancient", display_price: 500000, quantity_total: 1 }])
    const sessions = []
    for (let i = 0; i < 8; i++) {
      sessions.push(await sessionRepo.startBoothSession({ productId: pid, buyerName: `B${i}`, turnsTotal: 1 }))
    }

    const results = await Promise.all(sessions.map((s, i) => attempt(s.sessionId, `tap-${i}`)))

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok).every((r) => r.e instanceof sessionRepo.GachaSoldOutError)).toBe(true)

    const [[prize]] = await db.query("SELECT quantity_remaining FROM gacha_prizes WHERE product_id = ?", [pid])
    expect(prize.quantity_remaining).toBe(0)
    const [[{ drawCount }]] = await db.query("SELECT COUNT(*) AS drawCount FROM gacha_draws")
    expect(drawCount).toBe(1)
    const [drawn] = await db.query("SELECT turns_used FROM gacha_sessions WHERE product_id = ?", [pid])
    expect(drawn.reduce((sum, s) => sum + s.turns_used, 0)).toBe(1)
  })

  it("consumes only one turn when the same session is double-tapped concurrently with distinct keys", async () => {
    const pid = await seedGachaProduct([{ name: "Ancient", tier: "ancient", display_price: 500000, quantity_total: 2 }])
    const { sessionId } = await sessionRepo.startBoothSession({ productId: pid, buyerName: null, turnsTotal: 2 })
    // startBoothSession refuses to sell more turns than the pool holds, so the
    // pool is drained to its last unit afterwards - the same mid-session drain
    // (another session, or an admin prize edit) the sold-out test above models.
    await db.query("UPDATE gacha_prizes SET quantity_remaining = 1 WHERE product_id = ?", [pid])

    const results = await Promise.all([attempt(sessionId, "tap-1"), attempt(sessionId, "tap-2")])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)[0].e).toBeInstanceOf(sessionRepo.GachaSoldOutError)

    const session = await sessionRepo.getSessionById(sessionId)
    expect(session.turns_used).toBe(1)
    const [[prize]] = await db.query("SELECT quantity_remaining FROM gacha_prizes WHERE product_id = ?", [pid])
    expect(prize.quantity_remaining).toBe(0)
  })
})

describe("practiceDraw", () => {
  it("never touches quantity_remaining or writes a session/draw row", async () => {
    const pid = await seedGachaProduct([{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 5 }])

    for (let i = 0; i < 10; i++) await sessionRepo.practiceDraw(pid)

    const [[prizeRow]] = await db.query("SELECT quantity_remaining FROM gacha_prizes WHERE product_id = ?", [pid])
    expect(prizeRow.quantity_remaining).toBe(5)
    const [[{ count }]] = await db.query("SELECT COUNT(*) AS count FROM gacha_sessions WHERE product_id = ?", [pid])
    expect(count).toBe(0)
    const [[{ drawCount }]] = await db.query(
      "SELECT COUNT(*) AS drawCount FROM gacha_draws d JOIN gacha_prizes p ON p.id = d.gacha_prize_id WHERE p.product_id = ?",
      [pid]
    )
    expect(drawCount).toBe(0)
  })
})

describe("startOnlineSessionIfNeeded", () => {
  it("creates a session from a confirmed order's gacha order_items, and is a no-op if called twice", async () => {
    const pid = await seedGachaProduct([{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 5 }])
    const variantId = await hiddenVariantId(pid)

    const [orderRes] = await db.query(
      `INSERT INTO orders (order_token, buyer_name, phone, email, fulfillment_method, status, payment_method, total, cod_amount, collection_id, access_pin_hash)
       VALUES ('tok123', 'A', '090', 'a@a.com', 'ship', 'confirmed', 'bank', 40000, NULL, NULL, 'x')`
    )
    const orderId = orderRes.insertId
    await db.query(
      `INSERT INTO order_items (order_id, product_variant_id, product_name_snapshot, variant_label_snapshot, unit_price_snapshot, qty, is_gift, stock_reserved)
       VALUES (?, ?, 'Mystery Case', '', 20000, 2, false, false)`,
      [orderId, variantId]
    )

    await sessionRepo.startOnlineSessionIfNeeded(orderId)
    await sessionRepo.startOnlineSessionIfNeeded(orderId)

    const [[{ count }]] = await db.query("SELECT COUNT(*) AS count FROM gacha_sessions WHERE order_id = ?", [orderId])
    expect(count).toBe(1)
    const session = await sessionRepo.getSessionByOrderId(orderId)
    expect(session.turns_total).toBe(2)
    expect(session.source).toBe("online")
  })
})
