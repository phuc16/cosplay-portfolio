import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import sharp from "sharp"
import app from "../server.js"
import repo from "../shop/catalogRepo.js"
import redis from "../redis.js"
import { MAX_UPLOAD_BYTES } from "../shop/images.js"
import { resetTables, closeDb } from "./helpers/db.js"

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET || "change-me-in-production")
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

beforeEach(async () => {
  await resetTables("product_variants", "products", "collections")
})

afterAll(async () => {
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

describe("GET /api/admin/collections", () => {
  it("returns draft collections too, unlike the public route", async () => {
    await repo.createCollection({ title: "Bí mật", status: "draft" })
    await repo.createCollection({ title: "Live", status: "active" })

    const res = await authed(request(app).get("/api/admin/collections"))
    expect(res.status).toBe(200)
    expect(res.body.map((c) => c.title).sort()).toEqual(["Bí mật", "Live"])
    expect(res.body.find((c) => c.title === "Bí mật").status).toBe("draft")
  })
})

describe("GET /api/admin/collections/:id", () => {
  it("rejects unauthenticated access", async () => {
    const cid = await repo.createCollection({ title: "Vault", status: "archived" })
    const res = await request(app).get(`/api/admin/collections/${cid}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe("unauthorized")
  })

  it("returns full nested detail for an archived collection", async () => {
    const cid = await repo.createCollection({ title: "Vault", status: "archived" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Photocard", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 3 }, { label: "A2", stock_qty: null }])

    const res = await authed(request(app).get(`/api/admin/collections/${cid}`))
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("archived")
    expect(res.body.products).toHaveLength(1)
    expect(res.body.products[0].name).toBe("Photocard")
    expect(res.body.products[0].variants.map((v) => v.label)).toEqual(["A1", "A2"])
  })

  it("returns 404 for a nonexistent collection", async () => {
    const res = await authed(request(app).get("/api/admin/collections/999999"))
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("not_found")
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

  // The title column is varchar(255), but every title also generates
  // collections.slug (varchar(191)) via a length-preserving slugify() for
  // plain-ASCII input, so 191 (not 255) is the effective, crash-safe limit.
  it("accepts a title at exactly the 191-char effective limit", async () => {
    const title = "a".repeat(191)
    const res = await authed(request(app).post("/api/admin/collections"))
      .send({ title, status: "active" })
    expect(res.status).toBe(201)
  })

  it("rejects a title one character over the 191-char effective limit with 400, not 500", async () => {
    const title = "a".repeat(192)
    const res = await authed(request(app).post("/api/admin/collections"))
      .send({ title, status: "active" })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("makes a newly created collection immediately visible on the public list", async () => {
    await request(app).get("/api/shop/collections")
    await authed(request(app).post("/api/admin/collections")).send({ title: "New", status: "active" })

    const res = await request(app).get("/api/shop/collections")
    expect(res.body).toHaveLength(1)
  })

  it("stores a custom payment_deadline_hours", async () => {
    const res = await authed(request(app).post("/api/admin/collections"))
      .send({ title: "Fes", status: "active", payment_deadline_hours: 12 })
    expect(res.status).toBe(201)

    const detail = await repo.getCollectionDetailById(res.body.id)
    expect(detail.payment_deadline_hours).toBe(12)
  })

  it("rejects a zero or negative payment_deadline_hours", async () => {
    const res = await authed(request(app).post("/api/admin/collections"))
      .send({ title: "Fes", status: "active", payment_deadline_hours: 0 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects a non-integer payment_deadline_hours", async () => {
    const res = await authed(request(app).post("/api/admin/collections"))
      .send({ title: "Fes", status: "active", payment_deadline_hours: 6.5 })
    expect(res.status).toBe(400)
  })
})

describe("PUT /api/admin/collections/:id", () => {
  it("updates a collection and persists the change", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "draft" })

    const res = await authed(request(app).put(`/api/admin/collections/${cid}`))
      .send({ title: "Drop", status: "active", allow_pickup: true })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const [c] = await repo.listAllCollections()
    expect(c.status).toBe("active")
  })

  it("returns 404 for a nonexistent collection", async () => {
    const res = await authed(request(app).put("/api/admin/collections/999999"))
      .send({ title: "X", status: "active" })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe("not_found")
  })

  it("re-derives the slug when the title changes", async () => {
    const cid = await repo.createCollection({ title: "Fes HH2026", status: "draft" })

    await authed(request(app).put(`/api/admin/collections/${cid}`))
      .send({ title: "Fes HH2027", status: "draft" })

    const [c] = await repo.listAllCollections()
    expect(c.slug).toBe("fes-hh2027")
  })
})

describe("POST /api/admin/collections/:id/copy", () => {
  it("rejects unauthenticated access", async () => {
    const cid = await repo.createCollection({ title: "Fes HH2026", status: "active" })
    const res = await request(app).post(`/api/admin/collections/${cid}/copy`)
    expect(res.status).toBe(401)
  })

  it("creates a draft copy with products/variants and returns its id", async () => {
    const cid = await repo.createCollection({ title: "Fes HH2026", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Photocard", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])

    const res = await authed(request(app).post(`/api/admin/collections/${cid}/copy`))
    expect(res.status).toBe(201)
    expect(res.body.id).toBeGreaterThan(0)

    const copy = await repo.getCollectionDetailById(res.body.id)
    expect(copy.title).toBe("Fes HH2026 (Copy)")
    expect(copy.status).toBe("draft")
    expect(copy.products[0].variants[0].label).toBe("A1")
  })

  it("returns 404 for a nonexistent collection", async () => {
    const res = await authed(request(app).post("/api/admin/collections/999999/copy"))
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("not_found")
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

  it("rejects an invalid product type", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Album", price: 99000, type: "cd" })
    expect(res.status).toBe(400)
  })

  it("creates a digital product with stock_qty and delivery_link", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Digital Album", price: 99000, type: "digital", stock_qty: 20, delivery_link: "https://drive.google.com/x" })
    expect(res.status).toBe(201)

    const detail = await repo.getCollectionDetailById(cid)
    const product = detail.products.find((p) => p.id === res.body.id)
    expect(product.type).toBe("digital")
    expect(product.stock_qty).toBe(20)
    expect(product.delivery_link).toBe("https://drive.google.com/x")
  })

  it("rejects a negative stock_qty on a digital product", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Digital Album", price: 99000, type: "digital", stock_qty: -1 })
    expect(res.status).toBe(400)
  })

  it("rejects a digital product with no delivery_link", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Digital Album", price: 99000, type: "digital", stock_qty: 20 })
    expect(res.status).toBe(400)
  })

  it("rejects a digital product with a blank delivery_link", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Digital Album", price: 99000, type: "digital", stock_qty: 20, delivery_link: "   " })
    expect(res.status).toBe(400)
  })

  it("rejects a digital product with a non-http(s) delivery_link scheme", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Digital Album", price: 99000, type: "digital", stock_qty: 20, delivery_link: "javascript:alert(1)" })
    expect(res.status).toBe(400)
  })

  it("accepts a product name at exactly the 255-char column limit", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const name = "a".repeat(255)
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name, price: 1000 })
    expect(res.status).toBe(201)
  })

  it("rejects a product name one character over the 255-char column limit with 400, not 500", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const name = "a".repeat(256)
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name, price: 1000 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
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

  it("accepts a variant label at exactly the 191-char column limit", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    const label = "a".repeat(191)
    const res = await authed(request(app).put(`/api/admin/products/${pid}/variants`))
      .send({ variants: [{ label }] })
    expect(res.status).toBe(200)
  })

  it("rejects a variant label one character over the 191-char column limit with 400, not 500", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    const label = "a".repeat(192)
    const res = await authed(request(app).put(`/api/admin/products/${pid}/variants`))
      .send({ variants: [{ label }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("deletes a collection and its products", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })

    const res = await authed(request(app).delete(`/api/admin/collections/${cid}`))
    expect(res.status).toBe(200)
    expect(await repo.listAllCollections()).toHaveLength(0)
  })
})

describe("PUT /api/admin/collections/:id/products/reorder", () => {
  it("persists the new product order", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const p1 = await repo.createProduct({ collection_id: cid, name: "A", price: 1000 })
    const p2 = await repo.createProduct({ collection_id: cid, name: "B", price: 1000 })
    const p3 = await repo.createProduct({ collection_id: cid, name: "C", price: 1000 })

    const res = await authed(request(app).put(`/api/admin/collections/${cid}/products/reorder`))
      .send({ product_ids: [p3, p1, p2] })

    expect(res.status).toBe(200)
    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.products.map((p) => p.id)).toEqual([p3, p1, p2])
  })

  it("does not let a reorder request touch another collection's products", async () => {
    const cid1 = await repo.createCollection({ title: "Drop 1", status: "active" })
    const cid2 = await repo.createCollection({ title: "Drop 2", status: "active" })
    const p1 = await repo.createProduct({ collection_id: cid1, name: "A", price: 1000 })
    const foreign = await repo.createProduct({ collection_id: cid2, name: "Foreign", price: 1000 })

    const res = await authed(request(app).put(`/api/admin/collections/${cid1}/products/reorder`))
      .send({ product_ids: [foreign, p1] })

    expect(res.status).toBe(200)
    const detail2 = await repo.getCollectionDetailById(cid2)
    expect(detail2.products.map((p) => p.id)).toEqual([foreign])
  })

  it("400s on a missing or empty product_ids", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const res = await authed(request(app).put(`/api/admin/collections/${cid}/products/reorder`)).send({})
    expect(res.status).toBe(400)
  })

  it("400s on a non-integer id in product_ids", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const res = await authed(request(app).put(`/api/admin/collections/${cid}/products/reorder`))
      .send({ product_ids: ["not-a-number"] })
    expect(res.status).toBe(400)
  })
})

describe("PUT /api/admin/products/:id", () => {
  it("updates a product and persists the change", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })

    const res = await authed(request(app).put(`/api/admin/products/${pid}`))
      .send({ name: "Card Deluxe", price: 50000 })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const detail = await repo.getPublicCollectionBySlug("drop")
    expect(detail.products[0].name).toBe("Card Deluxe")
    expect(detail.products[0].price).toBe(50000)
  })

  it("returns 404 for a nonexistent product", async () => {
    const res = await authed(request(app).put("/api/admin/products/999999"))
      .send({ name: "X", price: 1000 })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe("not_found")
  })
})

describe("DELETE /api/admin/products/:id", () => {
  it("deletes a product", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })

    const res = await authed(request(app).delete(`/api/admin/products/${pid}`))
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const detail = await repo.getPublicCollectionBySlug("drop")
    expect(detail.products).toHaveLength(0)
  })

  it("returns 404 for a nonexistent product", async () => {
    const res = await authed(request(app).delete("/api/admin/products/999999"))
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("not_found")
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

  it("returns 400 invalid_input for an oversized image, rejected before sharp decode", async () => {
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0)
    oversized[0] = 0xff
    oversized[1] = 0xd8
    oversized[2] = 0xff // valid jpeg magic bytes — this must fail on size, not type

    const res = await authed(request(app).post("/api/admin/shop/image"))
      .send({ base64: oversized.toString("base64"), folder: "misc" })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
    // The regression that matters: an admin seeing this needs to know it was
    // too big, not a generic "invalid image" that hides what to actually fix.
    expect(res.body.message).toContain("quá lớn")
  })

  it("still accepts a real, correctly-sized image", async () => {
    const real = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 128, b: 255 } },
    }).png().toBuffer()

    const res = await authed(request(app).post("/api/admin/shop/image"))
      .send({ base64: real.toString("base64"), folder: "misc" })

    expect(res.status).toBe(201)
    expect(res.body.url).toBeTruthy()
  })
})
