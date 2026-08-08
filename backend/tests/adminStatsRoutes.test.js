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

async function seed() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  await orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank",
  })
  return cid
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("auth", () => {
  it("requires a token on every stats route", async () => {
    expect((await request(app).get("/api/admin/stats/drop/1")).status).toBe(401)
    expect((await request(app).get("/api/admin/stats/restock")).status).toBe(401)
    expect((await request(app).get("/api/admin/stats/bookkeeping?date_from=2026-01-01&date_to=2026-01-01")).status).toBe(401)
    expect((await request(app).get("/api/admin/stats/bookkeeping/export.csv?date_from=2026-01-01&date_to=2026-01-01")).status).toBe(401)
  })

  it("rejects a bad token", async () => {
    const res = await request(app).get("/api/admin/stats/restock").set("Authorization", "Bearer nope")
    expect(res.status).toBe(403)
  })
})

describe("GET /api/admin/stats/drop/:collectionId", () => {
  it("returns drop stats for a real collection", async () => {
    const cid = await seed()
    const res = await authed(request(app).get(`/api/admin/stats/drop/${cid}`))
    expect(res.status).toBe(200)
    expect(res.body.collection_id).toBe(cid)
    expect(res.body.awaiting_payment).toBe(35000)
  })

  it("404s an unknown collection", async () => {
    const res = await authed(request(app).get("/api/admin/stats/drop/999999"))
    expect(res.status).toBe(404)
  })
})

describe("GET /api/admin/stats/restock", () => {
  it("returns an array", async () => {
    await seed()
    const res = await authed(request(app).get("/api/admin/stats/restock"))
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
  })
})

describe("GET /api/admin/stats/bookkeeping", () => {
  it("returns bookkeeping stats for a valid range", async () => {
    await seed()
    const today = new Date().toISOString().slice(0, 10)
    const res = await authed(request(app).get(`/api/admin/stats/bookkeeping?date_from=${today}&date_to=${today}`))
    expect(res.status).toBe(200)
    expect(res.body.awaiting_payment).toBe(35000)
  })

  it("400s on a missing date_to", async () => {
    const res = await authed(request(app).get("/api/admin/stats/bookkeeping?date_from=2026-01-01"))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("400s on a backwards range", async () => {
    const res = await authed(
      request(app).get("/api/admin/stats/bookkeeping?date_from=2026-08-08&date_to=2026-01-01")
    )
    expect(res.status).toBe(400)
  })
})

describe("GET /api/admin/stats/bookkeeping/export.csv", () => {
  it("returns a CSV attachment matching the JSON view", async () => {
    await seed()
    const today = new Date().toISOString().slice(0, 10)
    const res = await authed(
      request(app).get(`/api/admin/stats/bookkeeping/export.csv?date_from=${today}&date_to=${today}`)
    )
    expect(res.status).toBe(200)
    expect(res.headers["content-type"]).toContain("text/csv")
    expect(res.headers["content-disposition"]).toContain("attachment")
    expect(res.text).toContain("Bộ sưu tập,Đã nhận,Chờ thanh toán,Thu khi giao,Đã mất")
    expect(res.text).toContain("35000")
  })

  it("400s on an invalid range the same way the JSON endpoint does", async () => {
    const res = await authed(request(app).get("/api/admin/stats/bookkeeping/export.csv?date_from=x&date_to=y"))
    expect(res.status).toBe(400)
  })
})
