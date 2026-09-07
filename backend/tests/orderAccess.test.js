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

async function seedOrder() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer: { buyer_name: "A", phone: "09", email: "a@example.com", address_raw: "x" },
    fulfillment_method: "ship", payment_method: "bank",
  })
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
  const keys = await redis.keys("pin_*")
  if (keys.length) await redis.del(...keys)
  // verify-pin is a POST under /api/orders/*, so it shares orderLimiter's
  // "rl:order:" IP bucket with order creation (same reasoning as
  // orderRoutes.test.js/paymentProof.test.js) — without clearing it, a test
  // making several verify-pin calls exhausts the 10/hour budget for the
  // next test in this file, even though each is well under the limit alone.
  const orderLimiterKeys = await redis.keys("rl:order:*")
  if (orderLimiterKeys.length) await redis.del(...orderLimiterKeys)
})

describe("GET /api/orders/:token — gated by orderAccess", () => {
  it("401s with pin_required when no Authorization header is sent", async () => {
    const o = await seedOrder()
    const res = await request(app).get(`/api/orders/${o.order_token}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe("pin_required")
  })

  it("401s for a garbage/invalid bearer token", async () => {
    const o = await seedOrder()
    const res = await request(app).get(`/api/orders/${o.order_token}`).set("Authorization", "Bearer not-a-jwt")
    expect(res.status).toBe(401)
  })

  it("succeeds with a valid admin JWT — no PIN required for admin", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).get(`/api/orders/${o.order_token}`))
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(35000)
  })

  it("succeeds with a session token earned from the correct PIN", async () => {
    const o = await seedOrder()
    const verify = await request(app).post(`/api/orders/${o.order_token}/verify-pin`).send({ pin: o.access_pin })
    expect(verify.status).toBe(200)

    const res = await request(app).get(`/api/orders/${o.order_token}`)
      .set("Authorization", `Bearer ${verify.body.access_token}`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(35000)
  })

  it("rejects a session token scoped to a DIFFERENT order (no cross-order reuse)", async () => {
    const a = await seedOrder()
    const b = await seedOrder()
    const verifyA = await request(app).post(`/api/orders/${a.order_token}/verify-pin`).send({ pin: a.access_pin })

    const res = await request(app).get(`/api/orders/${b.order_token}`)
      .set("Authorization", `Bearer ${verifyA.body.access_token}`)
    expect(res.status).toBe(401)
  })
})

describe("POST /api/orders/:token/verify-pin", () => {
  it("issues an access_token for the correct PIN", async () => {
    const o = await seedOrder()
    const res = await request(app).post(`/api/orders/${o.order_token}/verify-pin`).send({ pin: o.access_pin })
    expect(res.status).toBe(200)
    expect(typeof res.body.access_token).toBe("string")
  })

  it("401s for a wrong PIN", async () => {
    const o = await seedOrder()
    const wrongPin = o.access_pin === "000000" ? "111111" : "000000"
    const res = await request(app).post(`/api/orders/${o.order_token}/verify-pin`).send({ pin: wrongPin })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe("invalid_pin")
  })

  it("400s on a malformed PIN (not 6 digits)", async () => {
    const o = await seedOrder()
    const res = await request(app).post(`/api/orders/${o.order_token}/verify-pin`).send({ pin: "12" })
    expect(res.status).toBe(400)
  })

  it("404s for an unknown token", async () => {
    const res = await request(app).post(`/api/orders/${"a".repeat(32)}/verify-pin`).send({ pin: "123456" })
    expect(res.status).toBe(404)
  })

  it("locks the order after 5 wrong attempts, independent of IP", async () => {
    const o = await seedOrder()
    const wrongPin = o.access_pin === "000000" ? "111111" : "000000"
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app).post(`/api/orders/${o.order_token}/verify-pin`).send({ pin: wrongPin })
    }
    const res = await request(app).post(`/api/orders/${o.order_token}/verify-pin`).send({ pin: o.access_pin })
    expect(res.status).toBe(429)
    // Structured so the frontend can build its own localized message
    // instead of displaying this response's Vietnamese-only `message` field
    // verbatim on an English-language page.
    expect(res.body.retry_after_seconds).toBeGreaterThan(0)
  })

  it("does not lock a DIFFERENT order after failures on this one", async () => {
    const a = await seedOrder()
    const b = await seedOrder()
    const wrongPin = a.access_pin === "000000" ? "111111" : "000000"
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app).post(`/api/orders/${a.order_token}/verify-pin`).send({ pin: wrongPin })
    }
    const res = await request(app).post(`/api/orders/${b.order_token}/verify-pin`).send({ pin: b.access_pin })
    expect(res.status).toBe(200)
  })
})

describe("the other buyer-order routes are gated the same way", () => {
  it("GET /:token/payment 401s without auth", async () => {
    const o = await seedOrder()
    const res = await request(app).get(`/api/orders/${o.order_token}/payment`)
    expect(res.status).toBe(401)
  })

  it("GET /:token/qr.svg 401s without auth", async () => {
    const o = await seedOrder()
    const res = await request(app).get(`/api/orders/${o.order_token}/qr.svg`)
    expect(res.status).toBe(401)
  })

  it("POST /:token/proof 401s without auth", async () => {
    const o = await seedOrder()
    const res = await request(app).post(`/api/orders/${o.order_token}/proof`).send({ base64: "x" })
    expect(res.status).toBe(401)
  })
})
