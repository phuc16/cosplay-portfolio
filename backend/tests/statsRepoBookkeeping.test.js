import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import statsRepo from "../shop/stats/statsRepo.js"
import { resetTables } from "./helpers/db.js"

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

/**
 * The Asia/Ho_Chi_Minh calendar date for `date`, used to build range bounds
 * for `parseLocalDateRange` (which interprets YYYY-MM-DD strings as local
 * days). `date.toISOString().slice(0, 10)` would give the *UTC* date instead,
 * which is a different day than the local one for part of the day (UTC
 * 17:00-23:59 is the next local day) and made these tests flaky depending on
 * wall-clock time.
 */
function vnDateStr(date) {
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

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

  it("rejects a calendar-invalid day-of-month (Feb 30)", () => {
    expect(() => statsRepo.parseLocalDateRange("2026-02-30", "2026-02-30")).toThrow(statsRepo.InvalidRangeError)
  })

  it("rejects a calendar-invalid day-of-month (Apr 31)", () => {
    expect(() => statsRepo.parseLocalDateRange("2026-04-31", "2026-04-31")).toThrow(statsRepo.InvalidRangeError)
  })

  it("rejects Feb 29 in a non-leap year", () => {
    expect(() => statsRepo.parseLocalDateRange("2025-02-29", "2025-02-29")).toThrow(statsRepo.InvalidRangeError)
  })

  it("still accepts Feb 29 in a genuine leap year", () => {
    expect(() => statsRepo.parseLocalDateRange("2024-02-29", "2024-02-29")).not.toThrow()
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

    const dateStr = vnDateStr(today)
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

    const dateStr = vnDateStr(today)
    const stats = await statsRepo.getBookkeepingStats({ date_from: dateStr, date_to: dateStr })
    expect(stats.shipping_cost).toBe(25000)
    expect(stats.received_total).toBe(35000) // shipping never inflates income
  })

  it("buckets orders with no collection into an explicit 'no collection' entry", async () => {
    const { variantId } = await seedVariant()
    const today = new Date()
    const o = await placeOrderAt(variantId, today, { payment_method: "bank" })
    await db.query("UPDATE orders SET collection_id = NULL WHERE id = ?", [o.id])

    const dateStr = vnDateStr(today)
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

  it("puts a cancelled order's total into the lost bucket", async () => {
    const { variantId } = await seedVariant()
    const today = new Date()
    const o = await placeOrderAt(variantId, today, { payment_method: "bank" })
    await orders.transitionOrder(o.id, "cancelled")

    const dateStr = vnDateStr(today)
    const stats = await statsRepo.getBookkeepingStats({ date_from: dateStr, date_to: dateStr })
    expect(stats.lost).toBe(35000)
    expect(stats.received_total).toBe(0)
  })

  it("counts a completed COD order as received.cod", async () => {
    const { variantId } = await seedVariant()
    const today = new Date()
    const o = await placeOrderAt(variantId, today, { payment_method: "cod" })
    await orders.transitionOrder(o.id, "confirmed")
    await orders.transitionOrder(o.id, "completed")

    const dateStr = vnDateStr(today)
    const stats = await statsRepo.getBookkeepingStats({ date_from: dateStr, date_to: dateStr })
    expect(stats.received.cod).toBe(35000)
    expect(stats.received_total).toBe(35000)
    expect(stats.to_collect).toBe(0)
  })

  it("keeps a confirmed/shipped COD order in to_collect, not received.cod, until it completes", async () => {
    const { variantId } = await seedVariant()
    const today = new Date()
    const oConfirmed = await placeOrderAt(variantId, today, { payment_method: "cod" })
    await orders.transitionOrder(oConfirmed.id, "confirmed")

    const oShipped = await placeOrderAt(variantId, today, { payment_method: "cod" })
    await orders.transitionOrder(oShipped.id, "confirmed")
    await orders.transitionOrder(oShipped.id, "shipped")

    const dateStr = vnDateStr(today)
    const stats = await statsRepo.getBookkeepingStats({ date_from: dateStr, date_to: dateStr })
    expect(stats.to_collect).toBe(70000)
    expect(stats.received.cod).toBe(0)
    expect(stats.received_total).toBe(0)
  })
})

describe("reconciliation — the highest-value test in this phase", () => {
  it("per-collection sums (plus the no-collection bucket) equal the bookkeeping total for the same range", async () => {
    const today = new Date()
    const dateStr = vnDateStr(today)

    const a = await seedVariant()
    const oa1 = await placeOrderAt(a.variantId, today, { payment_method: "bank" })
    await orders.transitionOrder(oa1.id, "confirmed")
    const oa2 = await placeOrderAt(a.variantId, today, { payment_method: "cod" })
    await orders.transitionOrder(oa2.id, "confirmed")
    const oa3 = await placeOrderAt(a.variantId, today, { payment_method: "bank" })
    await orders.transitionOrder(oa3.id, "cancelled")

    const b = await seedVariant()
    const ob1 = await placeOrderAt(b.variantId, today, { payment_method: "paypal" })

    const stats = await statsRepo.getBookkeepingStats({ date_from: dateStr, date_to: dateStr })
    const dropA = await statsRepo.getDropStats(a.collectionId)
    const dropB = await statsRepo.getDropStats(b.collectionId)

    const bucketA = stats.by_collection.find((c) => c.collection_id === a.collectionId)
    const bucketB = stats.by_collection.find((c) => c.collection_id === b.collectionId)

    expect(bucketA.received_total).toBe(dropA.received_total)
    expect(bucketA.to_collect).toBe(dropA.to_collect)
    expect(bucketA.lost).toBe(dropA.lost)
    expect(bucketA.lost).toBe(35000)
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
