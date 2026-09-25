import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import express from "express"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import adminGachaRoutes from "../routes/adminGacha.js"
import { resetTables, closeDb } from "./helpers/db.js"

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use("/api/admin", adminGachaRoutes())
  return app
}

const adminToken = () => jwt.sign({ role: "admin" }, process.env.JWT_SECRET, { algorithm: "HS256" })

async function seedGachaProduct() {
  const cid = await catalog.createCollection({ title: "Gacha Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
  return pid
}

const savePrizes = (app, pid, prizes) =>
  request(app)
    .put(`/api/admin/gacha-products/${pid}/prizes`)
    .set("Authorization", `Bearer ${adminToken()}`)
    .send({ prizes })

const ONE_PRIZE = [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }]

beforeEach(async () => {
  await resetTables("gacha_draws", "gacha_sessions", "gacha_prizes", "order_items", "orders", "product_variants", "products", "collections")
})

afterAll(closeDb)

describe("PUT /gacha-products/:id/prizes", () => {
  it("saves the prize list", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    const res = await savePrizes(app, pid, ONE_PRIZE)
    expect(res.status).toBe(200)

    const list = await request(app).get(`/api/admin/gacha-products/${pid}/prizes`).set("Authorization", `Bearer ${adminToken()}`)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].name).toBe("Sticker")
  })

  it("rejects a prize with a non-positive quantity_total", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    const res = await savePrizes(app, pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 0 }])
    expect(res.status).toBe(400)
  })

  it("rejects an unknown tier", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    const res = await savePrizes(app, pid, [{ name: "Sticker", tier: "mythic", display_price: 5000, quantity_total: 1 }])
    expect(res.status).toBe(400)
  })

  it("rejects an empty prize list", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    const res = await savePrizes(app, pid, [])
    expect(res.status).toBe(400)
  })

  it("returns 409 when a drawn prize is dropped from the list", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await savePrizes(app, pid, ONE_PRIZE)
    const start = await request(app).post(`/api/admin/gacha-products/${pid}/booth-sessions`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ turns_total: 1 })
    await request(app).post(`/api/admin/gacha-sessions/${start.body.session_id}/draw`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ draw_key: "tap-1" })

    const res = await savePrizes(app, pid, [{ name: "Other", tier: "rare", display_price: 1000, quantity_total: 1 }])
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("gacha_prize_quantity")
  })

  it("returns 404 for a product that exists but isn't a gacha product", async () => {
    const cid = await catalog.createCollection({ title: "Physical Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Poster", price: 35000, type: "physical" })
    const app = makeApp()

    const res = await savePrizes(app, pid, ONE_PRIZE)
    expect(res.status).toBe(404)
  })

  it("returns 404 for an unknown product id", async () => {
    const app = makeApp()
    const res = await savePrizes(app, 999999, ONE_PRIZE)
    expect(res.status).toBe(404)
  })
})

describe("GET /gacha-products/:id/prizes", () => {
  it("returns the saved prize list", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await savePrizes(app, pid, ONE_PRIZE)

    const res = await request(app).get(`/api/admin/gacha-products/${pid}/prizes`).set("Authorization", `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it("returns 404 for a product that exists but isn't a gacha product, instead of an empty list", async () => {
    const cid = await catalog.createCollection({ title: "Physical Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Poster", price: 35000, type: "physical" })
    const app = makeApp()

    const res = await request(app).get(`/api/admin/gacha-products/${pid}/prizes`).set("Authorization", `Bearer ${adminToken()}`)
    expect(res.status).toBe(404)
  })

  it("returns 404 for an unknown product id, instead of an empty list", async () => {
    const app = makeApp()
    const res = await request(app).get("/api/admin/gacha-products/999999/prizes").set("Authorization", `Bearer ${adminToken()}`)
    expect(res.status).toBe(404)
  })
})

describe("POST /gacha-products/:id/booth-sessions", () => {
  it("starts a booth session and returns its order/session ids", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await savePrizes(app, pid, ONE_PRIZE)

    const res = await request(app)
      .post(`/api/admin/gacha-products/${pid}/booth-sessions`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ buyer_name: "Phuc", turns_total: 2 })
    expect(res.status).toBe(201)
    expect(res.body.session_id).toBeTypeOf("number")
    expect(res.body.order_id).toBeTypeOf("number")
    expect(res.body.order_token).toBeTypeOf("string")
  })

  it("rejects a non-positive turns_total", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await savePrizes(app, pid, ONE_PRIZE)

    const res = await request(app)
      .post(`/api/admin/gacha-products/${pid}/booth-sessions`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ turns_total: 0 })
    expect(res.status).toBe(400)
  })

  it("returns 404 for a product that is not a gacha product", async () => {
    const app = makeApp()
    const res = await request(app)
      .post("/api/admin/gacha-products/999999/booth-sessions")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ turns_total: 1 })
    expect(res.status).toBe(404)
  })

  it("returns 409 when the pool cannot cover the requested turns", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await savePrizes(app, pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 1 }])

    const res = await request(app)
      .post(`/api/admin/gacha-products/${pid}/booth-sessions`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ turns_total: 5 })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("gacha_sold_out")
  })
})

describe("GET /gacha-sessions/:id", () => {
  it("returns the session and its drops", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await savePrizes(app, pid, ONE_PRIZE)
    const start = await request(app).post(`/api/admin/gacha-products/${pid}/booth-sessions`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ turns_total: 2 })
    await request(app).post(`/api/admin/gacha-sessions/${start.body.session_id}/draw`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ draw_key: "tap-1" })

    const res = await request(app).get(`/api/admin/gacha-sessions/${start.body.session_id}`)
      .set("Authorization", `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.session.turns_used).toBe(1)
    expect(res.body.drops).toHaveLength(1)
  })

  it("returns 404 for an unknown session", async () => {
    const app = makeApp()
    const res = await request(app).get("/api/admin/gacha-sessions/999999").set("Authorization", `Bearer ${adminToken()}`)
    expect(res.status).toBe(404)
  })

  it("returns 404 for an online buyer's session", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await savePrizes(app, pid, ONE_PRIZE)
    const start = await request(app).post(`/api/admin/gacha-products/${pid}/booth-sessions`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ turns_total: 2 })
    await db.query("UPDATE gacha_sessions SET source = 'online' WHERE id = ?", [start.body.session_id])

    const res = await request(app).get(`/api/admin/gacha-sessions/${start.body.session_id}`)
      .set("Authorization", `Bearer ${adminToken()}`)
    expect(res.status).toBe(404)
  })
})

describe("POST /gacha-sessions/:id/draw", () => {
  it("draws and returns the winning prize", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await savePrizes(app, pid, ONE_PRIZE)
    const start = await request(app).post(`/api/admin/gacha-products/${pid}/booth-sessions`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ turns_total: 1 })

    const draw = await request(app)
      .post(`/api/admin/gacha-sessions/${start.body.session_id}/draw`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ draw_key: "tap-1" })
    expect(draw.status).toBe(200)
    expect(draw.body.prize.name).toBe("Sticker")
    expect(draw.body.turns_used).toBe(1)
    expect(draw.body.turns_total).toBe(1)
    expect(draw.body.session_completed).toBe(true)
  })

  it("requires draw_key", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await savePrizes(app, pid, ONE_PRIZE)
    const start = await request(app).post(`/api/admin/gacha-products/${pid}/booth-sessions`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ turns_total: 1 })

    const res = await request(app)
      .post(`/api/admin/gacha-sessions/${start.body.session_id}/draw`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it("returns 404 for an unknown session", async () => {
    const app = makeApp()
    const res = await request(app).post("/api/admin/gacha-sessions/999999/draw")
      .set("Authorization", `Bearer ${adminToken()}`).send({ draw_key: "tap-1" })
    expect(res.status).toBe(404)
  })

  it("returns 409 once the session has used all its turns", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await savePrizes(app, pid, ONE_PRIZE)
    const start = await request(app).post(`/api/admin/gacha-products/${pid}/booth-sessions`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ turns_total: 1 })
    await request(app).post(`/api/admin/gacha-sessions/${start.body.session_id}/draw`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ draw_key: "tap-1" })

    const res = await request(app).post(`/api/admin/gacha-sessions/${start.body.session_id}/draw`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ draw_key: "tap-2" })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("session_complete")
  })

  it("returns 404 for an online buyer's session instead of drawing", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await savePrizes(app, pid, ONE_PRIZE)
    const start = await request(app).post(`/api/admin/gacha-products/${pid}/booth-sessions`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ turns_total: 2 })
    await db.query("UPDATE gacha_sessions SET source = 'online' WHERE id = ?", [start.body.session_id])

    const res = await request(app).post(`/api/admin/gacha-sessions/${start.body.session_id}/draw`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ draw_key: "tap-1" })
    expect(res.status).toBe(404)
    expect(res.body.prize).toBeUndefined()

    const [[session]] = await db.query("SELECT turns_used FROM gacha_sessions WHERE id = ?", [start.body.session_id])
    expect(session.turns_used).toBe(0)
  })

  it("returns 409 when the session's order has been cancelled", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await savePrizes(app, pid, ONE_PRIZE)
    const start = await request(app).post(`/api/admin/gacha-products/${pid}/booth-sessions`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ turns_total: 2 })
    await db.query("UPDATE orders SET status = 'cancelled' WHERE id = ?", [start.body.order_id])

    const res = await request(app).post(`/api/admin/gacha-sessions/${start.body.session_id}/draw`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ draw_key: "tap-1" })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("order_cancelled")
  })
})
