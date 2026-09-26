import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import app from "../server.js"
import repo from "../shop/catalogRepo.js"
import redis from "../redis.js"
import { resetTables, closeDb } from "./helpers/db.js"

beforeEach(async () => {
  await resetTables("product_variants", "products", "collections")
})

afterAll(async () => {
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

  it("behaves exactly as before for a collection with neither start_at nor end_at set", async () => {
    await repo.createCollection({ title: "Ordinary", status: "active" })

    const res = await request(app).get("/api/shop/collections")
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe("Ordinary")
    expect(res.body[0].status).toBe("active")
  })

  it("includes a collection whose start_at is in the future, flagged not_started_yet", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000)
    await repo.createCollection({ title: "Not Yet", status: "active", start_at: future })

    const res = await request(app).get("/api/shop/collections")
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe("Not Yet")
    expect(res.body[0].not_started_yet).toBe(true)
  })

  it("includes a collection whose end_at is in the past, with status closed in the response body", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    await repo.createCollection({ title: "Ended", status: "active", end_at: past })

    const res = await request(app).get("/api/shop/collections")
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe("Ended")
    expect(res.body[0].status).toBe("closed")
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

  it("exposes character_tag on a public product", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    await repo.createProduct({ collection_id: cid, name: "Card", price: 1000, character_tag: "Raiden Shogun" })

    const res = await request(app).get("/api/shop/collections/drop")
    expect(res.status).toBe(200)
    expect(res.body.products[0].character_tag).toBe("Raiden Shogun")
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

  it("returns a collection whose start_at is in the future, flagged not_started_yet, instead of 404", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000)
    await repo.createCollection({ title: "Not Yet", status: "active", start_at: future })

    const res = await request(app).get("/api/shop/collections/not-yet")
    expect(res.status).toBe(200)
    expect(res.body.not_started_yet).toBe(true)
  })

  it("returns a collection whose end_at is in the past, with status closed in the response body", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    await repo.createCollection({ title: "Ended", status: "active", end_at: past })

    const res = await request(app).get("/api/shop/collections/ended")
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("closed")
  })
})
