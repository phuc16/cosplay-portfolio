import { describe, it, expect, beforeEach, afterAll } from "vitest"
import db from "../db.js"
import repo from "../shop/orders/orderRepo.js"
import catalog from "../shop/catalogRepo.js"
import { resetTables, closeDb } from "./helpers/db.js"

const buyer = {
  buyer_name: "Nguyễn Văn A",
  phone: "0900000000",
  email: "a@example.com",
  address_raw: "1 Đường ABC, Q1, TP.HCM",
}

async function seedVariant(collectionOver = {}) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active", allow_pickup: true, ...collectionOver })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Photocard", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 20 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ? LIMIT 1", [pid])
  return { collectionId: cid, variantId: v.id }
}

const pickupOrder = (variantId, over = {}) => ({
  items: [{ variant_id: variantId, qty: 1 }],
  buyer, fulfillment_method: "pickup", payment_method: "bank",
  ...over,
})

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

afterAll(closeDb)

describe("createOrder - queue number is never assigned at creation time", () => {
  // payment_method: "cod" + fulfillment_method: "pickup" is rejected by
  // routes/orders.js's own request validation before createOrder is ever
  // called - a pickup order is always prepaid in practice, so createOrder
  // itself has no COD-at-creation path to test.
  it("does not assign a queue number for a prepaid pickup order at creation time", async () => {
    const { variantId } = await seedVariant()
    const res = await repo.createOrder(pickupOrder(variantId, { payment_method: "bank" }))

    const order = await repo.getOrderById(res.id)
    expect(order.queue_number).toBeNull()
  })

  it("does not assign a queue number for a ship order either, at creation time", async () => {
    const { variantId } = await seedVariant()
    const res = await repo.createOrder({
      items: [{ variant_id: variantId, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    const order = await repo.getOrderById(res.id)
    expect(order.queue_number).toBeNull()
  })
})

describe("savePaymentProof - queue number for prepaid pickup", () => {
  it("assigns a queue number once the buyer uploads proof", async () => {
    const { variantId } = await seedVariant()
    const res = await repo.createOrder(pickupOrder(variantId, { payment_method: "bank" }))

    await repo.savePaymentProof(res.id, "https://x/proof.png")

    const order = await repo.getOrderById(res.id)
    expect(order.queue_number).toBe(1)
  })

  it("increments per collection - a second order in the same collection gets the next number", async () => {
    const { variantId } = await seedVariant()
    const first = await repo.createOrder(pickupOrder(variantId, { payment_method: "bank" }))
    const second = await repo.createOrder(pickupOrder(variantId, { payment_method: "bank" }))
    await repo.savePaymentProof(first.id, "https://x/proof1.png")
    await repo.savePaymentProof(second.id, "https://x/proof2.png")

    const orderA = await repo.getOrderById(first.id)
    const orderB = await repo.getOrderById(second.id)
    expect(orderA.queue_number).toBe(1)
    expect(orderB.queue_number).toBe(2)
  })

  it("numbers a different collection independently, starting back at 1", async () => {
    const a = await seedVariant({ title: "Drop A" })
    const b = await seedVariant({ title: "Drop B" })
    const first = await repo.createOrder(pickupOrder(a.variantId, { payment_method: "bank" }))
    const otherCollection = await repo.createOrder(pickupOrder(b.variantId, { payment_method: "bank" }))
    await repo.savePaymentProof(first.id, "https://x/proof1.png")
    await repo.savePaymentProof(otherCollection.id, "https://x/proof2.png")

    const orderA = await repo.getOrderById(first.id)
    const orderB1 = await repo.getOrderById(otherCollection.id)
    expect(orderA.queue_number).toBe(1)
    expect(orderB1.queue_number).toBe(1)
  })

  it("also assigns a queue number to a ship order once the buyer uploads proof (staff packing sequence)", async () => {
    const { variantId } = await seedVariant()
    const res = await repo.createOrder({
      items: [{ variant_id: variantId, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    await repo.savePaymentProof(res.id, "https://x/proof.png")

    const order = await repo.getOrderById(res.id)
    expect(order.queue_number).toBe(1)
  })

  it("keeps pickup and ship sequences independent within the same collection", async () => {
    const { variantId } = await seedVariant({ allow_ship: true })
    const pickup = await repo.createOrder(pickupOrder(variantId, { payment_method: "bank" }))
    const ship = await repo.createOrder({
      items: [{ variant_id: variantId, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    await repo.savePaymentProof(pickup.id, "https://x/proof1.png")
    await repo.savePaymentProof(ship.id, "https://x/proof2.png")

    const pickupOrderRow = await repo.getOrderById(pickup.id)
    const shipOrderRow = await repo.getOrderById(ship.id)
    // Both start their own sequence at 1 - a ship order confirmed alongside
    // pickup orders must never "use up" a pickup number or vice versa.
    expect(pickupOrderRow.queue_number).toBe(1)
    expect(shipOrderRow.queue_number).toBe(1)
  })

  it("never double-assigns on a second proof upload", async () => {
    const { variantId } = await seedVariant()
    const res = await repo.createOrder(pickupOrder(variantId, { payment_method: "bank" }))

    await repo.savePaymentProof(res.id, "https://x/proof1.png")
    // Second upload is rejected by savePaymentProof's own not-pending guard in
    // real usage, but assignQueueNumberIfNeeded itself must also be a safe
    // no-op if ever called twice for the same order.
    await repo.assignQueueNumberIfNeeded(res.id)

    const order = await repo.getOrderById(res.id)
    expect(order.queue_number).toBe(1)
  })
})

describe("transitionOrder - queue number fallback on admin confirm without proof", () => {
  it("assigns a queue number when an admin confirms a pickup order directly, without any proof upload", async () => {
    const { variantId } = await seedVariant()
    const res = await repo.createOrder(pickupOrder(variantId, { payment_method: "bank" }))

    const ok = await repo.transitionOrder(res.id, "confirmed")

    expect(ok).toBe(true)
    const order = await repo.getOrderById(res.id)
    expect(order.queue_number).toBe(1)
  })

  it("also assigns one for a ship order confirmed directly, without any proof upload", async () => {
    const { variantId } = await seedVariant()
    const res = await repo.createOrder({
      items: [{ variant_id: variantId, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    await repo.transitionOrder(res.id, "confirmed")

    const order = await repo.getOrderById(res.id)
    expect(order.queue_number).toBe(1)
  })

  it("does not reassign or bump the number for an order that already has one from proof upload", async () => {
    const { variantId } = await seedVariant()
    const res = await repo.createOrder(pickupOrder(variantId, { payment_method: "bank" }))
    await repo.savePaymentProof(res.id, "https://x/proof.png")

    await repo.transitionOrder(res.id, "confirmed")

    const order = await repo.getOrderById(res.id)
    expect(order.queue_number).toBe(1)
  })

  it("keeps numbering consistent per collection whether assigned via proof upload or the confirm fallback", async () => {
    const { variantId } = await seedVariant()
    const viaProof = await repo.createOrder(pickupOrder(variantId, { payment_method: "bank" }))
    await repo.savePaymentProof(viaProof.id, "https://x/proof.png")
    await repo.transitionOrder(viaProof.id, "confirmed")

    const viaFallback = await repo.createOrder(pickupOrder(variantId, { payment_method: "bank" }))
    await repo.transitionOrder(viaFallback.id, "confirmed")

    const first = await repo.getOrderById(viaProof.id)
    const second = await repo.getOrderById(viaFallback.id)
    expect(first.queue_number).toBe(1)
    expect(second.queue_number).toBe(2)
  })
})

describe("assignQueueNumberIfNeeded", () => {
  it("is a no-op for a cancelled order that already has a number (numbers are never reused)", async () => {
    const { variantId } = await seedVariant()
    const res = await repo.createOrder(pickupOrder(variantId, { payment_method: "bank" }))
    await repo.savePaymentProof(res.id, "https://x/proof.png")
    await repo.transitionOrder(res.id, "cancelled")

    const second = await repo.createOrder(pickupOrder(variantId, { payment_method: "bank" }))
    await repo.savePaymentProof(second.id, "https://x/proof2.png")

    const cancelled = await repo.getOrderById(res.id)
    const active = await repo.getOrderById(second.id)
    expect(cancelled.queue_number).toBe(1)
    expect(active.queue_number).toBe(2) // no gap-filling/reuse of #1
  })

  it("retries under a concurrent race instead of throwing or double-assigning", async () => {
    const { variantId } = await seedVariant()
    // Both orders start queue_number: NULL (bank pays, so createOrder itself
    // doesn't auto-assign) and race assignQueueNumberIfNeeded concurrently.
    const a = await repo.createOrder(pickupOrder(variantId, { payment_method: "bank" }))
    const b = await repo.createOrder(pickupOrder(variantId, { payment_method: "bank" }))

    await Promise.all([
      repo.assignQueueNumberIfNeeded(a.id),
      repo.assignQueueNumberIfNeeded(b.id),
    ])

    const orderA = await repo.getOrderById(a.id)
    const orderB = await repo.getOrderById(b.id)
    const numbers = [orderA.queue_number, orderB.queue_number].sort()
    expect(numbers).toEqual([1, 2])
  })
})
