import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import repo from "../shop/orders/orderRepo.js"
import catalog from "../shop/catalogRepo.js"
import { resetTables } from "./helpers/db.js"

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seedVariant(stock) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stock }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return v.id
}

const attempt = (variantId, qty, extra = {}) =>
  repo.createOrder({
    items: [{ variant_id: variantId, qty }],
    buyer,
    fulfillment_method: "ship",
    payment_method: "bank",
    ...extra,
  }).then((r) => ({ ok: true, r })).catch((e) => ({ ok: false, e }))

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("concurrent reservation", () => {
  it("sells exactly one unit when 20 buyers race for the last item", async () => {
    const variantId = await seedVariant(1)

    const results = await Promise.all(Array.from({ length: 20 }, () => attempt(variantId, 1)))

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const losers = results.filter((r) => !r.ok)
    expect(losers).toHaveLength(19)
    // stock_qty is an unsigned column, so "stock never went negative" is also
    // true of an implementation with no locking and no check at all — MySQL
    // would reject the underflowing UPDATE itself. Asserting the *error type*
    // is what proves the application detected the shortage under its own row
    // lock and threw the contracted domain error, rather than letting the
    // write through and being saved by the column constraint.
    expect(losers.every((r) => r.e instanceof repo.OutOfStockError)).toBe(true)

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(0)

    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(1)
  })

  it("never drives stock negative when demand exceeds supply", async () => {
    const variantId = await seedVariant(5)

    const results = await Promise.all(Array.from({ length: 15 }, () => attempt(variantId, 1)))

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(0)
    expect(v.stock_qty).toBeGreaterThanOrEqual(0)
    expect(results.filter((r) => r.ok)).toHaveLength(5)
    // Same reasoning as above: without this, the unsigned column alone keeps
    // the test green even if the row lock or the reservable check is deleted.
    const losers = results.filter((r) => !r.ok)
    expect(losers).toHaveLength(10)
    expect(losers.every((r) => r.e instanceof repo.OutOfStockError)).toBe(true)
  })

  it("keeps reserved plus remaining equal to the original stock", async () => {
    const variantId = await seedVariant(10)

    await Promise.all(Array.from({ length: 12 }, () => attempt(variantId, 2)))

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    const [[sum]] = await db.query(
      "SELECT COALESCE(SUM(qty), 0) AS reserved FROM order_items"
    )
    expect(Number(sum.reserved) + v.stock_qty).toBe(10)
  })

  it("creates one order when the same request_key is submitted concurrently", async () => {
    const variantId = await seedVariant(10)

    await Promise.all([
      attempt(variantId, 1, { request_key: "same-key" }),
      attempt(variantId, 1, { request_key: "same-key" }),
      attempt(variantId, 1, { request_key: "same-key" }),
    ])

    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(1)

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(9) // reserved once
  })

  it("credits stock once when an order is cancelled concurrently", async () => {
    const variantId = await seedVariant(5)
    const { r } = await attempt(variantId, 2)

    const outcomes = await Promise.all([
      repo.transitionOrder(r.id, "cancelled"),
      repo.transitionOrder(r.id, "cancelled"),
      repo.transitionOrder(r.id, "cancelled"),
    ])

    // Exactly one call may report that it performed the cancel; the other two
    // must refuse and say so. Asserting only the final stock leaves the
    // return-value contract — which callers use to decide whether they were
    // the one that acted — completely unchecked.
    expect(outcomes.filter((ok) => ok === true)).toHaveLength(1)
    expect(outcomes.filter((ok) => ok === false)).toHaveLength(2)

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5)

    const [[o]] = await db.query(
      "SELECT status, stock_released_at FROM orders WHERE id = ?", [r.id]
    )
    expect(o.status).toBe("cancelled")
    expect(o.stock_released_at).not.toBeNull()

    // This proves a losing cancel call returns false and writes nothing — not
    // that it defends against a restamp: canTransition already refuses
    // cancelled -> cancelled one layer up, so transitionOrder returning false
    // is why stock_released_at below is unchanged, not evidence of a guard
    // against ever reaching a restamp in the first place.
    const stampedAt = new Date(o.stock_released_at).getTime()
    expect(await repo.transitionOrder(r.id, "cancelled")).toBe(false)
    const [[o2]] = await db.query("SELECT stock_released_at FROM orders WHERE id = ?", [r.id])
    expect(new Date(o2.stock_released_at).getTime()).toBe(stampedAt)
  })

  it("credits stock once when a cancel races the expiry sweep", async () => {
    const variantId = await seedVariant(5)
    const { r } = await attempt(variantId, 2)
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?", [new Date(Date.now() - 1000), r.id])

    await Promise.all([
      repo.transitionOrder(r.id, "cancelled"),
      repo.releaseExpiredOrders(new Date()),
    ])

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5)

    const [[o]] = await db.query("SELECT status FROM orders WHERE id = ?", [r.id])
    expect(o.status).toBe("cancelled")
  })

  // The test above races the sweep against a cancel of a *pending* order, where
  // both paths want the same outcome — so it cannot detect a regression in the
  // expectedFromStatus guard. This one covers the case the guard exists for: an
  // order that is confirmed (paid) after the sweep's unlocked read selected it
  // as overdue. The sweep must re-verify status under the row lock and back off
  // rather than cancel a paid order and hand its stock back to the shop.
  it("does not sweep an order that gets confirmed while the sweep waits for its lock", async () => {
    const variantId = await seedVariant(5)
    const { r } = await attempt(variantId, 2)
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?", [new Date(Date.now() - 1000), r.id])

    // An admin's confirm holds the order row lock, uncommitted, so the sweep's
    // unlocked SELECT still sees 'pending' and picks the row up.
    const admin = await db.getConnection()
    const holdMs = 400
    let sweepElapsedMs
    try {
      await admin.beginTransaction()
      await admin.query("SELECT id FROM orders WHERE id = ? FOR UPDATE", [r.id])
      await admin.query(
        "UPDATE orders SET status = 'confirmed', confirmed_at = NOW() WHERE id = ?", [r.id]
      )

      const sweepStartedAt = Date.now()
      const sweep = repo.releaseExpiredOrders(new Date())
      sweep.catch(() => {})
      await new Promise((res) => setTimeout(res, holdMs))

      await admin.commit()

      expect(await sweep).toBe(0)
      sweepElapsedMs = Date.now() - sweepStartedAt
    } finally {
      admin.release()
    }

    // Prove the sweep actually contended for the row lock rather than
    // observing 'confirmed' already and skipping the row without ever
    // blocking: on a slow/loaded machine that let the commit above finish
    // before the sweep's initial SELECT ran, every assertion here would still
    // pass with nothing exercised. Requiring the sweep call to have taken at
    // least half the artificial hold time makes that silent, coverage-free
    // pass fail instead.
    expect(sweepElapsedMs).toBeGreaterThanOrEqual(holdMs / 2)

    const [[o]] = await db.query(
      "SELECT status, stock_released_at FROM orders WHERE id = ?", [r.id]
    )
    expect(o.status).toBe("confirmed")
    expect(o.stock_released_at).toBeNull()

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(3) // the paid order keeps its reservation
  }, 20000)

  // What this test actually proves: lock acquisition for a multi-variant order
  // stays batched in a single `SELECT ... WHERE v.id IN (...) FOR UPDATE OF v`
  // statement rather than being issued row by row.
  //
  // It is NOT proof that the JS-side ascending sort of variant ids is what
  // averts the deadlock. Mutation testing shows why: reversing that sort, or
  // dropping it entirely, does not make this test fail. One locking statement
  // takes its row locks in InnoDB's own primary-key index order, whatever the
  // literal order of the IN list or of any ORDER BY clause — so opposite-order
  // submissions already converge on the same lock order for free.
  //
  // The property that does matter, and that this test guards, is the batching:
  // restructuring the single statement into a sequential per-row FOR UPDATE
  // loop in caller order (a plausible refactor) makes concurrent forward and
  // reverse orders grab the two variant rows in opposite orders and deadlock,
  // and this test fails.
  it("does not deadlock when two orders touch the same variants in opposite order", async () => {
    const cid = await catalog.createCollection({ title: "Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await catalog.replaceVariants(pid, [
      { label: "A1", stock_qty: 50 },
      { label: "A2", stock_qty: 50 },
    ])
    const [vs] = await db.query("SELECT id, label FROM product_variants ORDER BY label")
    const a1 = vs[0].id
    const a2 = vs[1].id

    const forward = () => repo.createOrder({
      items: [{ variant_id: a1, qty: 1 }, { variant_id: a2, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })
    const reverse = () => repo.createOrder({
      items: [{ variant_id: a2, qty: 1 }, { variant_id: a1, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? forward() : reverse()))
    )
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0)

    // Final state, not just "nothing threw": each fulfilled order took exactly
    // one unit of each variant, so a double decrement on this multi-item path
    // — which zero-rejections alone would never notice — shows up here.
    const fulfilled = results.filter((r) => r.status === "fulfilled").length
    expect(fulfilled).toBe(20)

    const [after] = await db.query(
      "SELECT id, stock_qty FROM product_variants WHERE id IN (?, ?) ORDER BY id", [a1, a2]
    )
    expect(after.map((v) => v.stock_qty)).toEqual([50 - fulfilled, 50 - fulfilled])

    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(fulfilled)

    const [[lines]] = await db.query("SELECT COUNT(*) AS n FROM order_items")
    expect(Number(lines.n)).toBe(fulfilled * 2)
  })
})
