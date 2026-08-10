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
  const cid = await catalog.createCollection({
    title: "Drop", status: "active", allow_ship: true, allow_pickup: true,
  })
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

  it("filters by date_from/date_to", async () => {
    const inRange = await seedOrder()
    const outOfRange = await seedOrder()
    await db.query("UPDATE orders SET created_at = '2020-01-01 00:00:00' WHERE id = ?", [outOfRange.id])

    const res = await authed(
      request(app).get("/api/admin/orders?date_from=2025-01-01&date_to=2030-01-01")
    )
    const ids = res.body.map((o) => o.id)
    expect(ids).toContain(inRange.id)
    expect(ids).not.toContain(outOfRange.id)
  })

  it("ignores a malformed date filter instead of erroring", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).get("/api/admin/orders?date_from=garbage"))
    expect(res.status).toBe(200)
    expect(res.body.map((row) => row.id)).toContain(o.id)
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

  it("stores a shipping_fee of 0 as 0, not null (0 || null bug)", async () => {
    const o = await seedOrder()
    await orders.transitionOrder(o.id, "confirmed")

    await authed(request(app).post(`/api/admin/orders/${o.id}/transition`))
      .send({ to: "shipped", shipping_fee: 0 })

    const [[row]] = await db.query("SELECT shipping_fee FROM orders WHERE id = ?", [o.id])
    expect(row.shipping_fee).toBe(0)
  })

  it("404s an unknown order", async () => {
    const res = await authed(request(app).post("/api/admin/orders/99999/transition")).send({ to: "confirmed" })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("not_found")
  })
})

describe("POST /api/admin/orders/bulk-cancel", () => {
  it("requires a token", async () => {
    const res = await request(app).post("/api/admin/orders/bulk-cancel").send({ ids: [1] })
    expect(res.status).toBe(401)
  })

  it("cancels multiple pending orders and releases their stock", async () => {
    const a = await seedOrder()
    const b = await seedOrder()

    const res = await authed(request(app).post("/api/admin/orders/bulk-cancel"))
      .send({ ids: [a.id, b.id] })

    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(2)
    expect(res.body.results.every((r) => r.ok)).toBe(true)

    const [[rowA]] = await db.query("SELECT status FROM orders WHERE id = ?", [a.id])
    const [[rowB]] = await db.query("SELECT status FROM orders WHERE id = ?", [b.id])
    expect(rowA.status).toBe("cancelled")
    expect(rowB.status).toBe("cancelled")

    const [variantRows] = await db.query("SELECT stock_qty FROM product_variants")
    expect(variantRows.every((v) => v.stock_qty === 5)).toBe(true)
  })

  it("isolates a failing order from the others in the same batch", async () => {
    const ok1 = await seedOrder()
    const already = await seedOrder()
    await orders.transitionOrder(already.id, "confirmed")
    await orders.transitionOrder(already.id, "shipped")
    await orders.transitionOrder(already.id, "completed")
    const ok2 = await seedOrder()

    const res = await authed(request(app).post("/api/admin/orders/bulk-cancel"))
      .send({ ids: [ok1.id, already.id, ok2.id, 999999] })

    expect(res.status).toBe(200)
    const byId = Object.fromEntries(res.body.results.map((r) => [r.id, r]))
    expect(byId[ok1.id].ok).toBe(true)
    expect(byId[ok2.id].ok).toBe(true)
    expect(byId[already.id].ok).toBe(false)
    expect(byId[already.id].error).toBe("invalid_transition")
    expect(byId[999999].ok).toBe(false)
    expect(byId[999999].error).toBe("not_found")

    const [[row1]] = await db.query("SELECT status FROM orders WHERE id = ?", [ok1.id])
    const [[row2]] = await db.query("SELECT status FROM orders WHERE id = ?", [ok2.id])
    expect(row1.status).toBe("cancelled")
    expect(row2.status).toBe("cancelled")
  })

  it("rejects a non-array ids payload", async () => {
    const res = await authed(request(app).post("/api/admin/orders/bulk-cancel")).send({ ids: "1,2" })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects an empty ids array", async () => {
    const res = await authed(request(app).post("/api/admin/orders/bulk-cancel")).send({ ids: [] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects a batch larger than the cap", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1)
    const res = await authed(request(app).post("/api/admin/orders/bulk-cancel")).send({ ids })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })
})

describe("POST /api/admin/orders/bulk-complete", () => {
  it("requires a token", async () => {
    const res = await request(app).post("/api/admin/orders/bulk-complete").send({ ids: [1] })
    expect(res.status).toBe(401)
  })

  it("completes multiple confirmed pickup orders", async () => {
    const a = await seedOrder({ fulfillment_method: "pickup" })
    const b = await seedOrder({ fulfillment_method: "pickup" })
    await orders.transitionOrder(a.id, "confirmed")
    await orders.transitionOrder(b.id, "confirmed")

    const res = await authed(request(app).post("/api/admin/orders/bulk-complete"))
      .send({ ids: [a.id, b.id] })

    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(2)
    expect(res.body.results.every((r) => r.ok)).toBe(true)

    const [[rowA]] = await db.query("SELECT status FROM orders WHERE id = ?", [a.id])
    const [[rowB]] = await db.query("SELECT status FROM orders WHERE id = ?", [b.id])
    expect(rowA.status).toBe("completed")
    expect(rowB.status).toBe("completed")
  })

  it("isolates a failing order from the others in the same batch", async () => {
    const ok1 = await seedOrder({ fulfillment_method: "pickup" })
    await orders.transitionOrder(ok1.id, "confirmed")
    const stillPending = await seedOrder({ fulfillment_method: "pickup" })
    const ok2 = await seedOrder({ fulfillment_method: "pickup" })
    await orders.transitionOrder(ok2.id, "confirmed")

    const res = await authed(request(app).post("/api/admin/orders/bulk-complete"))
      .send({ ids: [ok1.id, stillPending.id, ok2.id, 999999] })

    expect(res.status).toBe(200)
    const byId = Object.fromEntries(res.body.results.map((r) => [r.id, r]))
    expect(byId[ok1.id].ok).toBe(true)
    expect(byId[ok2.id].ok).toBe(true)
    expect(byId[stillPending.id].ok).toBe(false)
    expect(byId[stillPending.id].error).toBe("invalid_transition")
    expect(byId[999999].ok).toBe(false)
    expect(byId[999999].error).toBe("not_found")
  })

  it("rejects a non-array ids payload", async () => {
    const res = await authed(request(app).post("/api/admin/orders/bulk-complete")).send({ ids: "1,2" })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects an empty ids array", async () => {
    const res = await authed(request(app).post("/api/admin/orders/bulk-complete")).send({ ids: [] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects a batch larger than the cap", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1)
    const res = await authed(request(app).post("/api/admin/orders/bulk-complete")).send({ ids })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })
})
