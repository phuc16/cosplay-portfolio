import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import redis from "../redis.js"
import { resetTables } from "./helpers/db.js"

async function seed(stock = 5) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stock }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return v.id
}

const body = (variantId, over = {}) => ({
  items: [{ variant_id: variantId, qty: 1 }],
  buyer: {
    buyer_name: "Nguyễn Văn A",
    phone: "0900000000",
    email: "a@example.com",
    address_raw: "1 ABC, Q1, TP.HCM",
  },
  fulfillment_method: "ship",
  payment_method: "bank",
  ...over,
})

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
  // The order-creation limiter (10/hour/IP) shares one Redis key across every
  // test in this file since supertest requests all appear to come from the
  // same loopback address. Without clearing it, later tests in this file
  // would 429 instead of exercising the behavior under test, even though each
  // test is well under the limit on its own.
  const keys = await redis.keys("rl:order:*")
  if (keys.length) await redis.del(...keys)
})

describe("POST /api/orders", () => {
  it("creates an order and returns its token and total", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders").send(body(v))

    expect(res.status).toBe(201)
    expect(res.body.order_token).toMatch(/^[0-9a-f]{32}$/)
    expect(res.body.total).toBe(35000)
  })

  it("ignores a client-supplied total", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders").send(body(v, { total: 1 }))
    expect(res.body.total).toBe(35000)
  })

  it("rejects a missing email", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders")
      .send(body(v, { buyer: { buyer_name: "A", phone: "0900000000", address_raw: "x" } }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects a malformed email", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders")
      .send(body(v, { buyer: { buyer_name: "A", phone: "0900000000", email: "nope", address_raw: "x" } }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("requires an address for ship but not for pickup", async () => {
    const v = await seed()

    const noAddr = { buyer_name: "A", phone: "0900000000", email: "a@example.com" }
    const ship = await request(app).post("/api/orders").send(body(v, { buyer: noAddr }))
    expect(ship.status).toBe(400)
    expect(ship.body.error).toBe("invalid_input")

    const pickup = await request(app).post("/api/orders")
      .send(body(v, { buyer: noAddr, fulfillment_method: "pickup" }))
    expect(pickup.status).toBe(201)
  })

  it("rejects an empty cart", async () => {
    const res = await request(app).post("/api/orders").send(body(1, { items: [] }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects an unknown payment method", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders").send(body(v, { payment_method: "bitcoin" }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects a zero or negative quantity", async () => {
    const v = await seed()
    for (const qty of [0, -1, 1.5]) {
      const res = await request(app).post("/api/orders")
        .send(body(v, { items: [{ variant_id: v, qty }] }))
      expect(res.status).toBe(400)
      expect(res.body.error).toBe("invalid_input")
    }
  })

  it("returns 409 when stock is insufficient", async () => {
    const v = await seed(1)
    const res = await request(app).post("/api/orders")
      .send(body(v, { items: [{ variant_id: v, qty: 2 }] }))
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("out_of_stock")
  })
})

describe("GET /api/orders/:token", () => {
  it("returns the order with its items", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))

    const res = await request(app).get(`/api/orders/${created.body.order_token}`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(35000)
    expect(res.body.items[0].variant_label_snapshot).toBe("A1")
  })

  it("is marked noindex so a shared link never reaches search results", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))

    const res = await request(app).get(`/api/orders/${created.body.order_token}`)
    expect(String(res.headers["x-robots-tag"])).toContain("noindex")
  })

  it("404s an unknown token", async () => {
    const res = await request(app).get(`/api/orders/${"a".repeat(32)}`)
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("not_found")
    expect(String(res.headers["x-robots-tag"])).toContain("noindex")
  })
})
