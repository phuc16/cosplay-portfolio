import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import { resetTables } from "./helpers/db.js"

async function seedVariant(stockQty) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active", allow_ship: true })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Postcard", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stockQty }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  return v.id
}

beforeEach(async () => {
  await resetTables("stock_notify_requests", "product_variants", "products", "collections")
})

describe("POST /api/shop/variants/:id/notify-me", () => {
  it("400s on an invalid email", async () => {
    const variantId = await seedVariant(0)
    const res = await request(app).post(`/api/shop/variants/${variantId}/notify-me`).send({ email: "nope" })
    expect(res.status).toBe(400)
  })

  it("404s on a non-existent variant", async () => {
    const res = await request(app).post("/api/shop/variants/999999/notify-me").send({ email: "a@example.com" })
    expect(res.status).toBe(404)
  })

  it("409s when the variant is not sold out", async () => {
    const variantId = await seedVariant(5)
    const res = await request(app).post(`/api/shop/variants/${variantId}/notify-me`).send({ email: "a@example.com" })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("not_sold_out")
  })

  it("200s and stores the request for a sold-out variant", async () => {
    const variantId = await seedVariant(0)
    const res = await request(app).post(`/api/shop/variants/${variantId}/notify-me`).send({ email: "a@example.com" })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const [rows] = await db.query("SELECT * FROM stock_notify_requests WHERE product_variant_id = ?", [variantId])
    expect(rows).toHaveLength(1)
  })

  it("is idempotent on a repeat sign-up", async () => {
    const variantId = await seedVariant(0)
    await request(app).post(`/api/shop/variants/${variantId}/notify-me`).send({ email: "a@example.com" })
    const res = await request(app).post(`/api/shop/variants/${variantId}/notify-me`).send({ email: "a@example.com" })
    expect(res.status).toBe(200)

    const [rows] = await db.query("SELECT * FROM stock_notify_requests WHERE product_variant_id = ?", [variantId])
    expect(rows).toHaveLength(1)
  })
})
