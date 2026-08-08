import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import statsRepo from "../shop/stats/statsRepo.js"
import { resetTables } from "./helpers/db.js"

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seedVariant({ stock = 5, price = 35000 } = {}) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stock }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  return { collectionId: cid, productId: pid, variantId: v.id }
}

async function placeAndConfirm(variantId, qty = 1) {
  const o = await orders.createOrder({
    items: [{ variant_id: variantId, qty }],
    buyer, fulfillment_method: "ship", payment_method: "bank",
  })
  await orders.transitionOrder(o.id, "confirmed")
  return o
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("getRestockStats", () => {
  it("returns an empty list when there are no variants", async () => {
    expect(await statsRepo.getRestockStats()).toEqual([])
  })

  it("gives a variant with zero sales a velocity of exactly 0", async () => {
    const { variantId } = await seedVariant()
    const rows = await statsRepo.getRestockStats()
    const v = rows.find((r) => r.variant_id === variantId)
    expect(v.sold).toBe(0)
    expect(v.velocity).toBe(0)
  })

  it("computes velocity for a sold-out variant using time to its last sale, not now", async () => {
    const { collectionId, variantId } = await seedVariant({ stock: 1 })
    await placeAndConfirm(variantId, 1)
    // Backdate the collection so days-on-sale is a known, exact value.
    await db.query("UPDATE collections SET created_at = ? WHERE id = ?", [
      new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), collectionId,
    ])

    const rows = await statsRepo.getRestockStats()
    const v = rows.find((r) => r.variant_id === variantId)
    expect(v.remaining).toBe(0)
    expect(v.sold).toBe(1)
    // ~2 days on sale (last sale was "now" at placeAndConfirm time) -> velocity ~0.5/day
    expect(v.velocity).toBeGreaterThan(0.4)
    expect(v.velocity).toBeLessThan(0.6)
    expect(v.time_to_sellout_days).not.toBeNull()
  })

  it("computes velocity for a still-available variant using time to now", async () => {
    const { collectionId, variantId } = await seedVariant({ stock: 10 })
    await placeAndConfirm(variantId, 2)
    await db.query("UPDATE collections SET created_at = ? WHERE id = ?", [
      new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), collectionId,
    ])

    const rows = await statsRepo.getRestockStats()
    const v = rows.find((r) => r.variant_id === variantId)
    expect(v.remaining).toBe(8)
    expect(v.velocity).toBeGreaterThan(0.9)
    expect(v.velocity).toBeLessThan(1.1)
    expect(v.time_to_sellout_days).toBeNull()
    expect(v.sell_through).toBeCloseTo(2 / 10)
  })

  it("gives an unlimited variant a velocity but no sell-through", async () => {
    const { variantId } = await seedVariant({ stock: null })
    await placeAndConfirm(variantId, 3)

    const rows = await statsRepo.getRestockStats()
    const v = rows.find((r) => r.variant_id === variantId)
    expect(v.unlimited).toBe(true)
    expect(v.remaining).toBeNull()
    expect(v.sold).toBe(3)
    // With 1-day floor: 3 sales on same-day collection = 3 / 1 = 3 units/day. Pins floor behavior.
    expect(v.velocity).toBe(3)
    expect(v.sell_through).toBeNull()
  })

  it("excludes cancelled-order quantity from sold", async () => {
    const { variantId } = await seedVariant({ stock: 5 })
    const o = await orders.createOrder({
      items: [{ variant_id: variantId, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })
    await orders.transitionOrder(o.id, "cancelled")

    const rows = await statsRepo.getRestockStats()
    expect(rows.find((r) => r.variant_id === variantId).sold).toBe(0)
  })

  it("excludes deleted variants entirely", async () => {
    const { productId, variantId } = await seedVariant({ stock: 3 })
    const o = await placeAndConfirm(variantId, 1)
    await orders.transitionOrder(o.id, "shipped")
    await orders.transitionOrder(o.id, "completed")
    await catalog.replaceVariants(productId, [])

    const rows = await statsRepo.getRestockStats()
    expect(rows.find((r) => r.variant_id === variantId)).toBeUndefined()
  })

  it("sorts by velocity descending", async () => {
    // Velocity is sold ÷ days-on-sale; stock is not part of it. So the two
    // variants must differ in sales-per-day, not in stock level: slow takes
    // 10 days to sell 1 unit (0.1/day), fast sells 5 on a same-day drop
    // (5/day against the 1-day floor).
    const slow = await seedVariant({ stock: 100 })
    await placeAndConfirm(slow.variantId, 1)
    await db.query("UPDATE collections SET created_at = ? WHERE id = ?", [
      new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), slow.collectionId,
    ])
    const fast = await seedVariant({ stock: 10 })
    await placeAndConfirm(fast.variantId, 5)

    const rows = await statsRepo.getRestockStats()
    const fastRow = rows.find((r) => r.variant_id === fast.variantId)
    const slowRow = rows.find((r) => r.variant_id === slow.variantId)
    expect(fastRow.velocity).toBeGreaterThan(slowRow.velocity)
    const fastIndex = rows.findIndex((r) => r.variant_id === fast.variantId)
    const slowIndex = rows.findIndex((r) => r.variant_id === slow.variantId)
    expect(fastIndex).toBeLessThan(slowIndex)
  })
})
