import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import sharp from "sharp"
import app from "../server.js"
import repo from "../shop/catalogRepo.js"
import cache from "../shop/catalogCache.js"
import redis from "../redis.js"
import { resetTables, closeDb } from "./helpers/db.js"

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET || "change-me-in-production")
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

beforeEach(async () => {
  await resetTables("product_variants", "products", "collections")
  await cache.invalidate()
})

afterAll(async () => {
  await cache.invalidate()
  await redis.quit()
  await closeDb()
})

describe("auth", () => {
  it("rejects unauthenticated access", async () => {
    const res = await request(app).get("/api/admin/collections")
    expect(res.status).toBe(401)
    expect(res.body.error).toBe("unauthorized")
  })
})

describe("POST /api/admin/collections", () => {
  it("creates a collection and returns its id", async () => {
    const res = await authed(request(app).post("/api/admin/collections"))
      .send({ title: "Bộ sưu tập Hè", status: "active", allow_pickup: true })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeGreaterThan(0)

    const [c] = await repo.listAllCollections()
    expect(c.slug).toBe("bo-suu-tap-he")
    expect(c.allow_pickup).toBe(true)
  })

  it("rejects a missing title", async () => {
    const res = await authed(request(app).post("/api/admin/collections")).send({ status: "active" })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects an unknown status", async () => {
    const res = await authed(request(app).post("/api/admin/collections"))
      .send({ title: "X", status: "published" })
    expect(res.status).toBe(400)
  })

  it("invalidates the public cache", async () => {
    await request(app).get("/api/shop/collections") // warm the cache
    await authed(request(app).post("/api/admin/collections")).send({ title: "New", status: "active" })

    const res = await request(app).get("/api/shop/collections")
    expect(res.body).toHaveLength(1)
  })
})

describe("products and variants", () => {
  it("creates a product under a collection", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Photocard", price: 35000, description: "6x9cm" })

    expect(res.status).toBe(201)
    const detail = await repo.getPublicCollectionBySlug("drop")
    expect(detail.products[0].name).toBe("Photocard")
    expect(detail.products[0].price).toBe(35000)
  })

  it("rejects a negative price", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Bad", price: -1 })
    expect(res.status).toBe(400)
  })

  it("bulk replaces variants, preserving null stock as unlimited", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })

    const res = await authed(request(app).put(`/api/admin/products/${pid}/variants`))
      .send({ variants: [{ label: "A1", stock_qty: 3 }, { label: "A2", stock_qty: null }] })

    expect(res.status).toBe(200)
    const detail = await repo.getPublicCollectionBySlug("drop")
    const v = detail.products[0].variants
    expect(v.map((x) => x.label)).toEqual(["A1", "A2"])
    expect(v[1].stock_qty).toBeNull()
  })

  it("rejects a variant without a label", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    const res = await authed(request(app).put(`/api/admin/products/${pid}/variants`))
      .send({ variants: [{ stock_qty: 1 }] })
    expect(res.status).toBe(400)
  })

  it("deletes a collection and its products", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })

    const res = await authed(request(app).delete(`/api/admin/collections/${cid}`))
    expect(res.status).toBe(200)
    expect(await repo.listAllCollections()).toHaveLength(0)
  })
})

describe("POST /api/admin/shop/image", () => {
  it("returns 400 invalid_input for a buffer that isn't an image at all", async () => {
    const garbage = Buffer.from("not a real image, just garbage bytes that are not valid webp/jpeg/png data")
    const base64 = garbage.toString("base64")

    const res = await authed(request(app).post("/api/admin/shop/image"))
      .send({ base64, folder: "misc" })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("returns 400 invalid_input for a truncated/corrupted image buffer (not a 500)", async () => {
    // A genuine JPEG with a valid-looking header, truncated mid-body — this is what a
    // partial upload / network truncation actually produces, and sharp reports it as
    // "Input buffer has corrupt header: ..." rather than "unsupported image format".
    const realJpeg = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).jpeg().toBuffer()
    const truncated = realJpeg.subarray(0, 20)
    const base64 = truncated.toString("base64")

    const res = await authed(request(app).post("/api/admin/shop/image"))
      .send({ base64, folder: "misc" })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })
})
