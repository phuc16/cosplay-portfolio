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
    expect(results.filter((r) => !r.ok)).toHaveLength(19)

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

    await Promise.all([
      repo.transitionOrder(r.id, "cancelled"),
      repo.transitionOrder(r.id, "cancelled"),
      repo.transitionOrder(r.id, "cancelled"),
    ])

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5)
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

  // Locking now uses `FOR UPDATE OF v`, so only product_variants rows are
  // locked (the old bare FOR UPDATE also locked the joined products rows,
  // which is what could actually deadlock two orders that touched the same
  // products via differently-ordered variants). The ids-sorted-ascending
  // lock order was already in place and is what this test exercises now:
  // two orders that want the same two variants, submitted in opposite item
  // order, must still take their variant-row locks in the same (ascending
  // id) order and never deadlock each other. That remains a real property
  // worth proving even though the specific product-lock deadlock this test
  // was originally written against is now structurally impossible.
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
  })
})
