import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import express from "express"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import prizeRepo from "../shop/gacha/prizeRepo.js"
import shopRoutes from "../routes/shop.js"
import { resetTables, closeDb } from "./helpers/db.js"

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use("/api/shop", shopRoutes())
  return app
}

beforeEach(async () => {
  await resetTables("gacha_draws", "gacha_sessions", "gacha_prizes", "order_items", "orders", "product_variants", "products", "collections")
})

afterAll(closeDb)

describe("GET /gacha/:productId/practice", () => {
  it("returns the prize list and live tier odds with no auth", async () => {
    const cid = await catalog.createCollection({ title: "Gacha Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
    await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }])

    const res = await request(makeApp()).get(`/api/shop/gacha/${pid}/practice`)
    expect(res.status).toBe(200)
    expect(res.body.prizes).toHaveLength(1)
    expect(res.body.tier_odds[0].rate).toBe(1)
  })

  it("hides the prize lineup of a product whose collection is still a draft", async () => {
    const cid = await catalog.createCollection({ title: "Unannounced Drop", status: "draft" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
    await prizeRepo.replacePrizes(pid, [{ name: "Secret Figure", tier: "legendary", display_price: 500000, quantity_total: 2 }])

    const res = await request(makeApp()).get(`/api/shop/gacha/${pid}/practice`)
    expect(res.status).toBe(404)
    expect(JSON.stringify(res.body)).not.toContain("Secret Figure")
  })

  it("serves a started collection normally", async () => {
    const cid = await catalog.createCollection({
      title: "Live Drop", status: "active",
      start_at: new Date(Date.now() - 86400000).toISOString(),
    })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
    await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }])

    const res = await request(makeApp()).get(`/api/shop/gacha/${pid}/practice`)
    expect(res.status).toBe(200)
    expect(res.body.prizes[0].name).toBe("Sticker")
  })
})

describe("POST /gacha/:productId/practice-draw", () => {
  it("draws without touching quantity_remaining", async () => {
    const cid = await catalog.createCollection({ title: "Gacha Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
    await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }])

    const res = await request(makeApp()).post(`/api/shop/gacha/${pid}/practice-draw`)
    expect(res.status).toBe(200)
    expect(res.body.prize.name).toBe("Sticker")

    const rows = await prizeRepo.listPrizes(pid)
    expect(rows[0].quantity_remaining).toBe(10)
  })

  it("refuses to spin a draft collection's product", async () => {
    const cid = await catalog.createCollection({ title: "Unannounced Drop", status: "draft" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
    await prizeRepo.replacePrizes(pid, [{ name: "Secret Figure", tier: "legendary", display_price: 500000, quantity_total: 2 }])

    const res = await request(makeApp()).post(`/api/shop/gacha/${pid}/practice-draw`)
    expect(res.status).toBe(404)
    expect(JSON.stringify(res.body)).not.toContain("Secret Figure")
  })

  it("returns 409 gacha_sold_out instead of a 500 once the product's pool is fully drawn out", async () => {
    const cid = await catalog.createCollection({ title: "Gacha Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
    await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 1 }])
    await db.query("UPDATE gacha_prizes SET quantity_remaining = 0 WHERE product_id = ?", [pid])

    const res = await request(makeApp()).post(`/api/shop/gacha/${pid}/practice-draw`)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("gacha_sold_out")
  })
})
