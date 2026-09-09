import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import statsRepo from "../shop/stats/statsRepo.js"
import { resetTables } from "./helpers/db.js"

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seed({ collectionTitle = "Drop", price = 35000, stock = 5 } = {}) {
  const cid = await catalog.createCollection({ title: collectionTitle, status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stock }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  return { collectionId: cid, productId: pid, variantId: v.id }
}

async function placeOrder(variantId, over = {}) {
  return orders.createOrder({
    items: [{ variant_id: variantId, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank", ...over,
  })
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("getDropStats", () => {
  it("returns null for an unknown collection", async () => {
    expect(await statsRepo.getDropStats(999999)).toBeNull()
  })

  it("returns a zero state for a collection with no orders", async () => {
    const { collectionId } = await seed()
    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.received_total).toBe(0)
    expect(stats.order_counts).toEqual({ pending: 0, confirmed: 0, shipped: 0, completed: 0, cancelled: 0 })
    expect(stats.units_sold).toBe(0)
    expect(stats.expiry_rate).toBeNull()
    expect(stats.variants).toEqual([])
  })

  it("buckets a confirmed bank order as received, split by method", async () => {
    const { collectionId, variantId } = await seed()
    const o = await placeOrder(variantId, { payment_method: "bank" })
    await orders.transitionOrder(o.id, "confirmed")

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.received.bank).toBe(35000)
    expect(stats.received.momo).toBe(0)
    expect(stats.received_total).toBe(35000)
    expect(stats.order_counts.confirmed).toBe(1)
  })

  it("buckets a pending bank order as awaiting_payment, not received", async () => {
    const { collectionId, variantId } = await seed()
    await placeOrder(variantId, { payment_method: "bank" })

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.awaiting_payment).toBe(35000)
    expect(stats.received_total).toBe(0)
  })

  it("buckets a confirmed COD order as to_collect, and a completed one as received", async () => {
    const { collectionId, variantId } = await seed({ stock: 5 })
    const a = await placeOrder(variantId, { payment_method: "cod" })
    await orders.transitionOrder(a.id, "confirmed")

    const b = await placeOrder(variantId, { payment_method: "cod" })
    await orders.transitionOrder(b.id, "confirmed")
    await orders.transitionOrder(b.id, "shipped")
    await orders.transitionOrder(b.id, "completed")

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.to_collect).toBe(35000)
    expect(stats.received.cod).toBe(35000)
  })

  it("buckets a pending COD order as pending_cod, excluded from received_total and every other bucket", async () => {
    const { collectionId, variantId } = await seed()
    await placeOrder(variantId, { payment_method: "cod" }) // stays pending

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.pending_cod).toBe(35000)
    expect(stats.received_total).toBe(0)
    expect(stats.received.cod).toBe(0)
    expect(stats.awaiting_payment).toBe(0)
    expect(stats.to_collect).toBe(0)
    expect(stats.lost).toBe(0)
    expect(stats.order_counts.pending).toBe(1)
  })

  it("buckets a cancelled order as lost, excluded from received/outstanding", async () => {
    const { collectionId, variantId } = await seed()
    const o = await placeOrder(variantId, { payment_method: "bank" })
    await orders.transitionOrder(o.id, "cancelled")

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.lost).toBe(35000)
    expect(stats.received_total).toBe(0)
    expect(stats.awaiting_payment).toBe(0)
  })

  it("excludes cancelled orders from units_sold", async () => {
    const { collectionId, variantId } = await seed({ stock: 5 })
    const kept = await placeOrder(variantId)
    await orders.transitionOrder(kept.id, "confirmed")
    const cancelled = await placeOrder(variantId)
    await orders.transitionOrder(cancelled.id, "cancelled")

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.units_sold).toBe(1)
  })

  it("computes expiry_rate over prepaid orders only, excluding COD from both sides", async () => {
    const { collectionId, variantId } = await seed({ stock: 5 })
    const expired = await placeOrder(variantId, { payment_method: "bank" })
    await db.query(
      "UPDATE orders SET expires_at = ?, cancelled_at = ?, status = 'cancelled' WHERE id = ?",
      [new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:01Z"), expired.id]
    )
    await placeOrder(variantId, { payment_method: "bank" }) // still pending, not expired
    await placeOrder(variantId, { payment_method: "cod" })  // excluded entirely

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.prepaid_order_count).toBe(2)
    expect(stats.expired_order_count).toBe(1)
    expect(stats.expiry_rate).toBe(0.5)
  })

  it("reports ship vs pickup mix", async () => {
    const { collectionId, variantId } = await seed({ stock: 5 })
    await placeOrder(variantId, { fulfillment_method: "ship" })
    await catalog.updateCollection(collectionId, { title: "Drop", status: "active", allow_pickup: true })
    await placeOrder(variantId, { fulfillment_method: "pickup" })

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.fulfillment_counts).toEqual({ ship: 1, pickup: 1, digital: 0 })
  })

  it("counts a digital order under fulfillment_counts.digital, not NaN", async () => {
    const cid = await catalog.createCollection({ title: "Drop", status: "active" })
    const pid = await catalog.createProduct({
      collection_id: cid, name: "Digital Album", price: 99000, type: "digital", stock_qty: 5,
      delivery_link: "https://drive.google.com/x",
    })
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }], buyer, payment_method: "bank",
    })

    const stats = await statsRepo.getDropStats(cid)
    expect(stats.fulfillment_counts.digital).toBe(1)
    expect(Number.isNaN(stats.fulfillment_counts.digital)).toBe(false)
  })

  it("shows an unlimited variant as such, never a 0% or null sell-through", async () => {
    const { collectionId, variantId } = await seed({ stock: null })
    const o = await placeOrder(variantId)
    await orders.transitionOrder(o.id, "confirmed")

    const stats = await statsRepo.getDropStats(collectionId)
    const v = stats.variants.find((x) => x.variant_id === variantId)
    expect(v.unlimited).toBe(true)
    expect(v.remaining).toBeNull()
    expect(v.sell_through).toBeNull()
  })

  it("shows a deleted variant's revenue via order_items snapshots, remaining as null (displayed '-')", async () => {
    const { collectionId, productId, variantId } = await seed({ stock: 3 })
    const o = await placeOrder(variantId)
    await orders.transitionOrder(o.id, "confirmed")
    await orders.transitionOrder(o.id, "shipped")
    await orders.transitionOrder(o.id, "completed")
    await catalog.replaceVariants(productId, []) // deletes the now-safe-to-remove variant

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.variants).toHaveLength(1)
    const v = stats.variants[0]
    expect(v.variant_id).toBeNull()
    expect(v.deleted).toBe(true)
    expect(v.product_name).toBe("Card")
    expect(v.sold).toBe(1)
    expect(v.remaining).toBeNull()
    expect(v.sell_through).toBeNull()
  })

  it("shows time-to-sellout only once remaining reaches 0", async () => {
    const { collectionId, variantId } = await seed({ stock: 1 })
    const o = await placeOrder(variantId)
    await orders.transitionOrder(o.id, "confirmed")

    const stats = await statsRepo.getDropStats(collectionId)
    const v = stats.variants.find((x) => x.variant_id === variantId)
    expect(v.remaining).toBe(0)
    expect(v.time_to_sellout_days).not.toBeNull()
    expect(v.time_to_sellout_days).toBeGreaterThanOrEqual(0)
  })

  it("attributes only this collection's own item revenue from a mixed-collection order, not the whole order total", async () => {
    const a = await seed({ collectionTitle: "Drop A", price: 35000 })
    const b = await seed({ collectionTitle: "Drop B", price: 20000 })
    const o = await orders.createOrder({
      items: [{ variant_id: a.variantId, qty: 1 }, { variant_id: b.variantId, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })
    await orders.transitionOrder(o.id, "confirmed")
    await orders.transitionOrder(o.id, "completed")

    const statsA = await statsRepo.getDropStats(a.collectionId)
    const statsB = await statsRepo.getDropStats(b.collectionId)
    expect(statsA.received_total).toBe(35000)
    expect(statsB.received_total).toBe(20000)
    // The order itself is counted once in each collection's own tally, not
    // split or dropped from either.
    expect(statsA.order_counts.completed).toBe(1)
    expect(statsB.order_counts.completed).toBe(1)
    expect(statsA.units_sold).toBe(1)
    expect(statsB.units_sold).toBe(1)
  })
})
