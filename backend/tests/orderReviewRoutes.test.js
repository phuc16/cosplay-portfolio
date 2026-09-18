import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import redis from "../redis.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { resetTables } from "./helpers/db.js"

const adminToken = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${adminToken}`)

const buyer = { buyer_name: "Nguyễn Văn A", phone: "09", email: "a@example.com", address_raw: "x" }

async function seedProduct() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ? LIMIT 1", [pid])
  return { pid, variantId: v.id }
}

async function seedOrder(variantId, { complete = false } = {}) {
  const res = await orders.createOrder({
    items: [{ variant_id: variantId, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank",
  })
  if (complete) {
    await orders.transitionOrder(res.id, "confirmed")
    await orders.transitionOrder(res.id, "completed")
  }
  return res
}

beforeEach(async () => {
  await resetTables("reviews", "email_queue", "order_items", "orders", "product_variants", "products", "collections")
  // The order-creation limiter (POST /api/orders/*) shares one Redis key
  // across every test in this file since supertest requests all appear to
  // come from the same loopback address - same gotcha paymentProof.test.js
  // already documents.
  const keys = await redis.keys("rl:order:*")
  if (keys.length) await redis.del(...keys)
})

describe("POST /api/orders/:token/reviews", () => {
  it("requires auth (PIN/admin)", async () => {
    const { variantId } = await seedProduct()
    const o = await seedOrder(variantId, { complete: true })
    const res = await request(app).post(`/api/orders/${o.order_token}/reviews`).send({ variant_id: variantId, rating: 5 })
    expect(res.status).toBe(401)
  })

  it("creates a review for a completed order and snapshots buyer_name", async () => {
    const { pid, variantId } = await seedProduct()
    const o = await seedOrder(variantId, { complete: true })
    const res = await authed(request(app).post(`/api/orders/${o.order_token}/reviews`))
      .send({ variant_id: variantId, rating: 5, comment: "Great!" })

    expect(res.status).toBe(201)
    const [[row]] = await db.query("SELECT * FROM reviews WHERE product_id = ?", [pid])
    expect(row.rating).toBe(5)
    expect(row.buyer_name).toBe("Nguyễn Văn A")
  })

  it("rejects a review for a pending (not yet completed) order", async () => {
    const { variantId } = await seedProduct()
    const o = await seedOrder(variantId)
    const res = await authed(request(app).post(`/api/orders/${o.order_token}/reviews`))
      .send({ variant_id: variantId, rating: 5 })
    expect(res.status).toBe(400)
  })

  it("rejects a variant_id that does not belong to this order", async () => {
    const { variantId } = await seedProduct()
    const o = await seedOrder(variantId, { complete: true })
    const { variantId: otherVariantId } = await seedProduct()
    const res = await authed(request(app).post(`/api/orders/${o.order_token}/reviews`))
      .send({ variant_id: otherVariantId, rating: 5 })
    expect(res.status).toBe(400)
  })

  it("rejects a second review for the same order+product", async () => {
    const { variantId } = await seedProduct()
    const o = await seedOrder(variantId, { complete: true })
    await authed(request(app).post(`/api/orders/${o.order_token}/reviews`)).send({ variant_id: variantId, rating: 5 })
    const res = await authed(request(app).post(`/api/orders/${o.order_token}/reviews`)).send({ variant_id: variantId, rating: 3 })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("already_reviewed")
  })

  it("rejects an invalid rating", async () => {
    const { variantId } = await seedProduct()
    const o = await seedOrder(variantId, { complete: true })
    const res = await authed(request(app).post(`/api/orders/${o.order_token}/reviews`)).send({ variant_id: variantId, rating: 9 })
    expect(res.status).toBe(400)
  })

  // Not directly reachable through this route within a single request:
  // order_items.product_variant_id is ON DELETE SET NULL, so once a
  // variant is actually deleted, order.items no longer carries that
  // variant_id at all and the "boughtHere" check above rejects it first
  // with the ordinary "not part of your order" message. The
  // product_unavailable branch in the route only guards the narrow race
  // between reading order.items and re-reading product_variants - left in
  // place as defense in depth, not exercised by a dedicated test here.
  it("rejects the same variant a second time even after the underlying product is deleted (falls back to the ordinary not-part-of-order rejection)", async () => {
    const { pid, variantId } = await seedProduct()
    const o = await seedOrder(variantId, { complete: true })
    await catalog.deleteProduct(pid) // completed order, no live restriction blocks this delete
    const res = await authed(request(app).post(`/api/orders/${o.order_token}/reviews`)).send({ variant_id: variantId, rating: 5 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })
})
