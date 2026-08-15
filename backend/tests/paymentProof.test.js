import { describe, it, expect, beforeEach, vi } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import sharp from "sharp"
import db from "../db.js"
import redis from "../redis.js"

const adminToken = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${adminToken}`)

vi.mock("../storage", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, upload: vi.fn(async (key) => key), ensureBucket: vi.fn(async () => {}) }
})

import app from "../server.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import settings from "../shop/payments/settingsRepo.js"
import { MAX_UPLOAD_BYTES } from "../shop/images.js"
import { resetTables } from "./helpers/db.js"

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

const png = () => sharp({ create: { width: 300, height: 300, channels: 3, background: "#fff" } })
  .png().toBuffer().then((b) => b.toString("base64"))

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
  // The order-creation limiter (POST /api/orders/*) shares one Redis key across
  // every test in this file since supertest requests all appear to come from
  // the same loopback address. Without clearing it, later tests would 429.
  const keys = await redis.keys("rl:order:*")
  if (keys.length) await redis.del(...keys)
  const proofKeys = await redis.keys("rl:proof:*")
  if (proofKeys.length) await redis.del(...proofKeys)
  await db.query("DELETE FROM payment_settings")
  await settings.updateSettings({
    bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
    bank_account_number: "1", bank_account_holder: "A",
  })
})

describe("POST /api/orders/:token/proof", () => {
  it("stores a proof image against the order", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).post(`/api/orders/${o.order_token}/proof`)).send({ base64: await png() })

    expect(res.status).toBe(201)
    expect(res.body.url).toContain("/api/storage/")

    const [[row]] = await db.query("SELECT payment_proof_url, payment_proof_uploaded_at FROM orders WHERE id = ?", [o.id])
    expect(row.payment_proof_url).toBeTruthy()
    expect(row.payment_proof_uploaded_at).not.toBeNull()
  })

  it("rejects a missing image", async () => {
    const o = await seedOrder()
    expect((await authed(request(app).post(`/api/orders/${o.order_token}/proof`)).send({})).status).toBe(400)
  })

  it("rejects a non-image payload", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).post(`/api/orders/${o.order_token}/proof`))
      .send({ base64: Buffer.from("not an image at all").toString("base64") })
    expect(res.status).toBe(400)
  })

  it("rejects an oversized proof image, before sharp decode is attempted", async () => {
    const o = await seedOrder()
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0)
    oversized[0] = 0xff
    oversized[1] = 0xd8
    oversized[2] = 0xff // valid jpeg magic bytes — must fail on size, not type

    const res = await authed(request(app).post(`/api/orders/${o.order_token}/proof`))
      .send({ base64: oversized.toString("base64") })

    expect(res.status).toBe(400)
    // The regression that matters: a buyer seeing this needs to know it was
    // too big, not a generic "invalid image" that hides what to actually fix.
    expect(res.body.message).toContain("quá lớn")
  })

  it("404s an unknown token", async () => {
    const res = await authed(request(app).post(`/api/orders/${"a".repeat(32)}/proof`)).send({ base64: await png() })
    expect(res.status).toBe(404)
  })

  it("refuses upload once the order is already confirmed", async () => {
    const o = await seedOrder()
    await orders.transitionOrder(o.id, "confirmed")
    const res = await authed(request(app).post(`/api/orders/${o.order_token}/proof`)).send({ base64: await png() })
    expect(res.status).toBe(409)
  })

  it("allows replacing proof while still pending", async () => {
    const o = await seedOrder()

    // First upload
    const first = await authed(request(app).post(`/api/orders/${o.order_token}/proof`)).send({ base64: await png() })
    expect(first.status).toBe(201)
    const firstUrl = first.body.url
    expect(firstUrl).toBeTruthy()

    // Second upload
    const second = await authed(request(app).post(`/api/orders/${o.order_token}/proof`)).send({ base64: await png() })
    expect(second.status).toBe(201)
    const secondUrl = second.body.url
    expect(secondUrl).toBeTruthy()

    // The two uploads must produce different URLs (mock uses the unique key from storeShopImage)
    expect(secondUrl).not.toBe(firstUrl)

    // Verify the database was updated with the second URL, not the first
    const [[row]] = await db.query("SELECT payment_proof_url FROM orders WHERE id = ?", [o.id])
    expect(row.payment_proof_url).toBe(secondUrl)
  })

  // Proof upload used to share orderLimiter's "rl:order:" bucket with order
  // creation — a buyer retrying a rejected photo could exhaust the 10/hour
  // budget that order creation needs, and vice versa. It now has its own
  // "rl:proof:" bucket, verified here by checking which Redis keys the
  // limiter actually writes to.
  it("rate-limits proof uploads under a separate bucket from order creation", async () => {
    const o = await seedOrder()
    await authed(request(app).post(`/api/orders/${o.order_token}/proof`)).send({ base64: await png() })

    const proofKeys = await redis.keys("rl:proof:*")
    const orderKeys = await redis.keys("rl:order:*")
    expect(proofKeys.length).toBeGreaterThan(0)
    expect(orderKeys.length).toBe(0)
  })
})

describe("GET /api/orders/:token — has_payment_proof", () => {
  it("is false before any proof is uploaded", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).get(`/api/orders/${o.order_token}`))
    expect(res.body.has_payment_proof).toBe(false)
    expect(res.body.payment_proof_url).toBeNull()
  })

  it("is true after a proof is uploaded, surviving what a page refresh would re-fetch", async () => {
    const o = await seedOrder()
    const uploaded = await authed(request(app).post(`/api/orders/${o.order_token}/proof`)).send({ base64: await png() })

    const res = await authed(request(app).get(`/api/orders/${o.order_token}`))
    expect(res.body.has_payment_proof).toBe(true)
    // The buyer sees the same image on every visit, not just the upload
    // session — same URL the upload response returned.
    expect(res.body.payment_proof_url).toBe(uploaded.body.url)
  })
})
