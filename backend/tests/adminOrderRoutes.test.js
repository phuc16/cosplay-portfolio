import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { resetTables } from "./helpers/db.js"

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seedOrder(over = {}) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank", ...over,
  })
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("auth", () => {
  it("requires a token", async () => {
    expect((await request(app).get("/api/admin/orders")).status).toBe(401)
  })

  it("rejects a bad token", async () => {
    const res = await request(app).get("/api/admin/orders").set("Authorization", "Bearer nope")
    expect(res.status).toBe(403)
  })
})

describe("GET /api/admin/orders", () => {
  it("lists orders", async () => {
    await seedOrder()
    const res = await authed(request(app).get("/api/admin/orders"))
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it("filters by status", async () => {
    const o = await seedOrder()
    await orders.transitionOrder(o.id, "confirmed")
    await seedOrder()

    const res = await authed(request(app).get("/api/admin/orders?status=confirmed"))
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe(o.id)
  })
})

describe("allowed_transitions", () => {
  it("lists confirmed/cancelled for a pending ship order", async () => {
    await seedOrder({ fulfillment_method: "ship" })
    const res = await authed(request(app).get("/api/admin/orders"))
    expect(res.body[0].allowed_transitions.sort()).toEqual(["cancelled", "confirmed"])
  })

  it("lists confirmed/cancelled for a pending pickup order", async () => {
    await seedOrder({ fulfillment_method: "pickup" })
    const res = await authed(request(app).get("/api/admin/orders"))
    expect(res.body[0].allowed_transitions.sort()).toEqual(["cancelled", "confirmed"])
  })

  it("includes shipped for a confirmed ship order", async () => {
    const o = await seedOrder({ fulfillment_method: "ship" })
    await orders.transitionOrder(o.id, "confirmed")
    const res = await authed(request(app).get("/api/admin/orders"))
    expect(res.body[0].allowed_transitions.sort()).toEqual(["cancelled", "completed", "shipped"])
  })

  it("excludes shipped but includes completed for a confirmed pickup order", async () => {
    const o = await seedOrder({ fulfillment_method: "pickup" })
    await orders.transitionOrder(o.id, "confirmed")
    const res = await authed(request(app).get("/api/admin/orders"))
    expect(res.body[0].allowed_transitions).not.toContain("shipped")
    expect(res.body[0].allowed_transitions).toContain("completed")
  })

  it("is present on the single-order detail endpoint too", async () => {
    const o = await seedOrder({ fulfillment_method: "ship" })
    const res = await authed(request(app).get(`/api/admin/orders/${o.id}`))
    expect(res.body.allowed_transitions.sort()).toEqual(["cancelled", "confirmed"])
  })
})

describe("POST /api/admin/orders/:id/transition", () => {
  it("confirms a pending order", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).post(`/api/admin/orders/${o.id}/transition`))
      .send({ to: "confirmed" })

    expect(res.status).toBe(200)
    const [[row]] = await db.query("SELECT status, confirmed_at FROM orders WHERE id = ?", [o.id])
    expect(row.status).toBe("confirmed")
    expect(row.confirmed_at).not.toBeNull()
  })

  it("stores a tracking code when shipping", async () => {
    const o = await seedOrder()
    await orders.transitionOrder(o.id, "confirmed")

    await authed(request(app).post(`/api/admin/orders/${o.id}/transition`))
      .send({ to: "shipped", tracking_code: "VTP123" })

    const [[row]] = await db.query("SELECT tracking_code FROM orders WHERE id = ?", [o.id])
    expect(row.tracking_code).toBe("VTP123")
  })

  it("rejects an illegal transition with 409", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).post(`/api/admin/orders/${o.id}/transition`))
      .send({ to: "shipped" })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("invalid_transition")
    expect(res.body.message).toContain("pending")
    expect(res.body.message).toContain("shipped")
  })

  it("rejects an unknown target status", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).post(`/api/admin/orders/${o.id}/transition`))
      .send({ to: "refunded" })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("returns reserved stock when cancelled", async () => {
    const o = await seedOrder()
    await authed(request(app).post(`/api/admin/orders/${o.id}/transition`)).send({ to: "cancelled" })

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants LIMIT 1")
    expect(v.stock_qty).toBe(5)
  })

  it("404s an unknown order", async () => {
    const res = await authed(request(app).post("/api/admin/orders/99999/transition")).send({ to: "confirmed" })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("not_found")
  })
})
