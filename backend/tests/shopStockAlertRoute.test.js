import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import { resetTables } from "./helpers/db.js"

async function seedVariant(stock_qty) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return v.id
}

beforeEach(async () => {
  await resetTables("stock_alerts", "stock_alert_queue", "product_variants", "products", "collections")
})

describe("POST /api/shop/stock-alerts", () => {
  it("signs up for a sold-out variant", async () => {
    const variantId = await seedVariant(0)
    const res = await request(app).post("/api/shop/stock-alerts").send({ variant_id: variantId, email: "a@example.com" })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it("rejects a variant that is not sold out", async () => {
    const variantId = await seedVariant(5)
    const res = await request(app).post("/api/shop/stock-alerts").send({ variant_id: variantId, email: "a@example.com" })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("variant_not_sold_out")
  })

  it("rejects an unlimited variant the same way", async () => {
    const variantId = await seedVariant(null)
    const res = await request(app).post("/api/shop/stock-alerts").send({ variant_id: variantId, email: "a@example.com" })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("variant_not_sold_out")
  })

  it("404s for an unknown variant", async () => {
    const res = await request(app).post("/api/shop/stock-alerts").send({ variant_id: 999999, email: "a@example.com" })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("variant_not_found")
  })

  it("400s for a malformed email", async () => {
    const variantId = await seedVariant(0)
    const res = await request(app).post("/api/shop/stock-alerts").send({ variant_id: variantId, email: "nope" })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_email")
  })

  it("does not duplicate a row on a second signup", async () => {
    const variantId = await seedVariant(0)
    await request(app).post("/api/shop/stock-alerts").send({ variant_id: variantId, email: "a@example.com" })
    await request(app).post("/api/shop/stock-alerts").send({ variant_id: variantId, email: "a@example.com" })
    const [rows] = await db.query("SELECT id FROM stock_alerts WHERE product_variant_id = ?", [variantId])
    expect(rows).toHaveLength(1)
  })
})
