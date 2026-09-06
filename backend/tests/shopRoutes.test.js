import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import app from "../server.js"
import repo from "../shop/catalogRepo.js"
import cache from "../shop/catalogCache.js"
import redis from "../redis.js"
import { resetTables, closeDb } from "./helpers/db.js"

beforeEach(async () => {
  await resetTables("product_variants", "products", "collections")
  await cache.invalidate()
})

afterAll(async () => {
  await cache.invalidate()
  await redis.quit()
  await closeDb()
})

describe("GET /api/shop/collections", () => {
  it("returns only publicly visible collections", async () => {
    await repo.createCollection({ title: "Draft", status: "draft" })
    await repo.createCollection({ title: "Live", status: "active" })

    const res = await request(app).get("/api/shop/collections")
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe("Live")
    expect(res.body[0].allow_ship).toBe(true)
  })
})

describe("GET /api/shop/collections/:slug", () => {
  it("returns the collection with nested products and variants", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 2 }])

    const res = await request(app).get("/api/shop/collections/drop")
    expect(res.status).toBe(200)
    expect(res.body.products[0].variants[0].label).toBe("A1")
  })

  it("never exposes delivery_link for a digital product", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    await repo.createProduct({
      collection_id: cid, name: "Digital Album", price: 99000, type: "digital",
      stock_qty: 10, delivery_link: "https://drive.google.com/secret",
    })

    const res = await request(app).get("/api/shop/collections/drop")
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain("delivery_link")
    expect(res.body.products[0].stock_qty).toBe(10)
  })

  it("404s for a draft collection", async () => {
    await repo.createCollection({ title: "Secret", status: "draft" })
    const res = await request(app).get("/api/shop/collections/secret")
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("not_found")
    expect(res.body.message).toBe("Không tìm thấy bộ sưu tập")
  })
})
