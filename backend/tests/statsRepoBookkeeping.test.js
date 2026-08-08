import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import statsRepo from "../shop/stats/statsRepo.js"
import { resetTables } from "./helpers/db.js"

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seedVariant() {
  const cid = await catalog.createCollection({ title: "Drop A", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 50 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  return { collectionId: cid, variantId: v.id }
}

async function placeOrderAt(variantId, createdAt, over = {}) {
  const o = await orders.createOrder({
    items: [{ variant_id: variantId, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank", ...over,
  })
  await db.query("UPDATE orders SET created_at = ? WHERE id = ?", [createdAt, o.id])
  return o
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("parseLocalDateRange / statsRepo.InvalidRangeError", () => {
  it("rejects a missing date", () => {
    expect(() => statsRepo.parseLocalDateRange("", "2026-08-08")).toThrow(statsRepo.InvalidRangeError)
  })

  it("rejects an unparsable date", () => {
    expect(() => statsRepo.parseLocalDateRange("not-a-date", "2026-08-08")).toThrow(statsRepo.InvalidRangeError)
  })

  it("rejects a range where the end is before the start", () => {
    expect(() => statsRepo.parseLocalDateRange("2026-08-08", "2026-08-01")).toThrow(statsRepo.InvalidRangeError)
  })

  it("treats date_to as inclusive of the whole local day", () => {
    const { toExclusive } = statsRepo.parseLocalDateRange("2026-08-01", "2026-08-01")
    // 2026-08-02T00:00:00+07:00 == 2026-08-01T17:00:00Z
    expect(toExclusive.toISOString()).toBe("2026-08-01T17:00:00.000Z")
  })
})

describe("getBookkeepingStats — timezone boundaries", () => {
  it("counts an order placed just after local midnight into that local day", async () => {
    const { variantId } = await seedVariant()
    // 2026-08-01T00:05:00+07:00 == 2026-07-31T17:05:00Z
    await placeOrderAt(variantId, new Date("2026-07-31T17:05:00Z"))

    const inRange = await statsRepo.getBookkeepingStats({ date_from: "2026-08-01", date_to: "2026-08-01" })
    expect(inRange.awaiting_payment).toBe(35000)

    const dayBefore = await statsRepo.getBookkeepingStats({ date_from: "2026-07-31", date_to: "2026-07-31" })
    expect(dayBefore.awaiting_payment).toBe(0)
  })

  it("excludes an order placed just before local midnight from the next local day", async () => {
    const { variantId } = await seedVariant()
    // 2026-07-31T23:55:00+07:00 == 2026-07-31T16:55:00Z
    await placeOrderAt(variantId, new Date("2026-07-31T16:55:00Z"))

    const nextDay = await statsRepo.getBookkeepingStats({ date_from: "2026-08-01", date_to: "2026-08-01" })
    expect(nextDay.awaiting_payment).toBe(0)

    const sameDay = await statsRepo.getBookkeepingStats({ date_from: "2026-07-31", date_to: "2026-07-31" })
    expect(sameDay.awaiting_payment).toBe(35000)
  })
})

describe("getBookkeepingStats — money and buckets", () => {
  it("splits received by payment method", async () => {
    const { variantId } = await seedVariant()
    const today = new Date()
    const a = await placeOrderAt(variantId, today, { payment_method: "bank" })
    await orders.transitionOrder(a.id, "confirmed")
    const b = await placeOrderAt(variantId, today, { payment_method: "momo" })
    await orders.transitionOrder(b.id, "confirmed")

    const dateStr = today.toISOString().slice(0, 10)
    const stats = await statsRepo.getBookkeepingStats({ date_from: dateStr, date_to: dateStr })
    expect(stats.received.bank).toBe(35000)
    expect(stats.received.momo).toBe(35000)
    expect(stats.received_total).toBe(70000)
  })

  it("sums recorded shipping cost as a cost, not income", async () => {
    const { variantId } = await seedVariant()
    const today = new Date()
    const o = await placeOrderAt(variantId, today, { payment_method: "bank" })
    await orders.transitionOrder(o.id, "confirmed")
    await orders.transitionOrder(o.id, "shipped", { shipping_fee: 25000 })

    const dateStr = today.toISOString().slice(0, 10)
    const stats = await statsRepo.getBookkeepingStats({ date_from: dateStr, date_to: dateStr })
    expect(stats.shipping_cost).toBe(25000)
    expect(stats.received_total).toBe(35000) // shipping never inflates income
  })

  it("buckets orders with no collection into an explicit 'no collection' entry", async () => {
    const { variantId } = await seedVariant()
    const today = new Date()
    const o = await placeOrderAt(variantId, today, { payment_method: "bank" })
    await db.query("UPDATE orders SET collection_id = NULL WHERE id = ?", [o.id])

    const dateStr = today.toISOString().slice(0, 10)
    const stats = await statsRepo.getBookkeepingStats({ date_from: dateStr, date_to: dateStr })
    const bucket = stats.by_collection.find((c) => c.collection_id === null)
    expect(bucket).toBeDefined()
    expect(bucket.collection_title).toBe("Không thuộc bộ sưu tập")
    expect(bucket.awaiting_payment).toBe(35000)
  })

  it("returns an explicit zero state for a range with no orders", async () => {
    const stats = await statsRepo.getBookkeepingStats({ date_from: "2000-01-01", date_to: "2000-01-01" })
    expect(stats.received_total).toBe(0)
    expect(stats.by_collection).toEqual([])
  })
})

describe("reconciliation — the highest-value test in this phase", () => {
  it("per-collection sums (plus the no-collection bucket) equal the bookkeeping total for the same range", async () => {
    const today = new Date()
    const dateStr = today.toISOString().slice(0, 10)

    const a = await seedVariant()
    const oa1 = await placeOrderAt(a.variantId, today, { payment_method: "bank" })
    await orders.transitionOrder(oa1.id, "confirmed")
    const oa2 = await placeOrderAt(a.variantId, today, { payment_method: "cod" })
    await orders.transitionOrder(oa2.id, "confirmed")

    const b = await seedVariant()
    const ob1 = await placeOrderAt(b.variantId, today, { payment_method: "paypal" })

    const stats = await statsRepo.getBookkeepingStats({ date_from: dateStr, date_to: dateStr })
    const dropA = await statsRepo.getDropStats(a.collectionId)
    const dropB = await statsRepo.getDropStats(b.collectionId)

    const bucketA = stats.by_collection.find((c) => c.collection_id === a.collectionId)
    const bucketB = stats.by_collection.find((c) => c.collection_id === b.collectionId)

    expect(bucketA.received_total).toBe(dropA.received_total)
    expect(bucketA.to_collect).toBe(dropA.to_collect)
    expect(bucketB.awaiting_payment).toBe(dropB.awaiting_payment)

    const sumReceived = stats.by_collection.reduce((s, c) => s + c.received_total, 0)
    const sumAwaiting = stats.by_collection.reduce((s, c) => s + c.awaiting_payment, 0)
    const sumToCollect = stats.by_collection.reduce((s, c) => s + c.to_collect, 0)
    const sumLost = stats.by_collection.reduce((s, c) => s + c.lost, 0)

    expect(sumReceived).toBe(stats.received_total)
    expect(sumAwaiting).toBe(stats.awaiting_payment)
    expect(sumToCollect).toBe(stats.to_collect)
    expect(sumLost).toBe(stats.lost)
  })
})
