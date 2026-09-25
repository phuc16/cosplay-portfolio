import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import express from "express"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import prizeRepo from "../shop/gacha/prizeRepo.js"
import sessionRepo from "../shop/gacha/sessionRepo.js"
import orderRepo from "../shop/orders/orderRepo.js"
import orderRoutes from "../routes/orders.js"
import { issueOrderSessionToken } from "../shop/orders/orderAccess.js"
import paymentSettings from "../shop/payments/settingsRepo.js"
import { resetTables, closeDb } from "./helpers/db.js"

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use("/api/orders", orderRoutes())
  return app
}

const adminToken = () => jwt.sign({ role: "admin" }, process.env.JWT_SECRET, { algorithm: "HS256" })

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "1 X, Q1, TP.HCM" }

async function seedGachaProduct({ prizeQty = 10, name = "Mystery Case" } = {}) {
  const cid = await catalog.createCollection({ title: "Gacha Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name, price: 20000, type: "gacha" })
  await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: prizeQty }])
  const detail = await catalog.getCollectionDetailById(cid)
  const product = detail.products.find((p) => p.id === pid)
  return { collectionId: cid, productId: pid, variantId: product.variant_id }
}

async function seedConfirmedGachaOrder(turns = 2, prizeQty = 10) {
  const { productId, variantId } = await seedGachaProduct({ prizeQty })
  const order = await orderRepo.createOrder({
    items: [{ variant_id: variantId, qty: turns }], buyer, payment_method: "bank", fulfillment_method: "ship",
  })
  await orderRepo.transitionOrder(order.id, "confirmed")
  return { token: order.order_token, orderId: order.id, productId, variantId }
}

beforeEach(async () => {
  await resetTables("gacha_draws", "gacha_sessions", "gacha_prizes", "order_items", "orders", "product_variants", "products", "collections")
})

afterAll(closeDb)

describe("GET /:token/gacha-session", () => {
  it("401s without a PIN/admin session", async () => {
    const { token } = await seedConfirmedGachaOrder()
    const res = await request(makeApp()).get(`/api/orders/${token}/gacha-session`)
    expect(res.status).toBe(401)
  })

  it("returns the buyer's own session and its drops", async () => {
    const { token, orderId } = await seedConfirmedGachaOrder(2)
    const session = await sessionRepo.getSessionByOrderId(orderId)
    await sessionRepo.drawForSession(session.id, { drawKey: "k1" })

    const res = await request(makeApp())
      .get(`/api/orders/${token}/gacha-session`)
      .set("Authorization", `Bearer ${issueOrderSessionToken(token)}`)

    expect(res.status).toBe(200)
    expect(res.body.session.turns_total).toBe(2)
    expect(res.body.session.turns_used).toBe(1)
    expect(res.body.drops).toHaveLength(1)
    expect(res.body.drops[0].name).toBe("Sticker")
  })

  it("returns a null session for a non-gacha order", async () => {
    const cid = await catalog.createCollection({ title: "Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    const order = await orderRepo.createOrder({
      items: [{ variant_id: v.id, qty: 1 }], buyer, payment_method: "bank", fulfillment_method: "ship",
    })

    const res = await request(makeApp())
      .get(`/api/orders/${order.order_token}/gacha-session`)
      .set("Authorization", `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.session).toBe(null)
    expect(res.body.drops).toEqual([])
  })

  // transitionOrder creates the session best-effort after its commit, so a
  // hiccup there leaves a paid, confirmed order with no session and nothing
  // to retry it - this read path heals it.
  it("creates the missing session for a confirmed gacha order whose post-confirm creation failed", async () => {
    const { token, orderId } = await seedConfirmedGachaOrder(2)
    await db.query("DELETE FROM gacha_sessions WHERE order_id = ?", [orderId])

    const res = await request(makeApp())
      .get(`/api/orders/${token}/gacha-session`)
      .set("Authorization", `Bearer ${issueOrderSessionToken(token)}`)

    expect(res.status).toBe(200)
    expect(res.body.session).not.toBe(null)
    expect(res.body.session.turns_total).toBe(2)
    expect(res.body.session.turns_used).toBe(0)
    expect(res.body.session.source).toBe("online")
    expect(res.body.drops).toEqual([])

    const [[{ count }]] = await db.query("SELECT COUNT(*) AS count FROM gacha_sessions WHERE order_id = ?", [orderId])
    expect(count).toBe(1)
  })

  it("does not create a session for a gacha order that is still pending payment", async () => {
    const { productId, variantId } = await seedGachaProduct({})
    expect(productId).toBeTruthy()
    const order = await orderRepo.createOrder({
      items: [{ variant_id: variantId, qty: 1 }], buyer, payment_method: "bank", fulfillment_method: "ship",
    })

    const res = await request(makeApp())
      .get(`/api/orders/${order.order_token}/gacha-session`)
      .set("Authorization", `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.session).toBe(null)
    const [[{ count }]] = await db.query("SELECT COUNT(*) AS count FROM gacha_sessions WHERE order_id = ?", [order.id])
    expect(count).toBe(0)
  })

  it("404s for an unknown order token", async () => {
    const res = await request(makeApp())
      .get("/api/orders/nope/gacha-session")
      .set("Authorization", `Bearer ${adminToken()}`)
    expect(res.status).toBe(404)
  })
})

describe("POST /:token/gacha-session/draw", () => {
  it("401s without a PIN/admin session", async () => {
    const { token } = await seedConfirmedGachaOrder(1)
    const res = await request(makeApp()).post(`/api/orders/${token}/gacha-session/draw`).send({ draw_key: "tap-1" })
    expect(res.status).toBe(401)
  })

  it("draws for the buyer's own confirmed session using the admin bypass", async () => {
    const { token } = await seedConfirmedGachaOrder(1)

    const res = await request(makeApp())
      .post(`/api/orders/${token}/gacha-session/draw`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ draw_key: "tap-1" })
    expect(res.status).toBe(200)
    expect(res.body.prize.name).toBe("Sticker")
    expect(res.body.turns_used).toBe(1)
    expect(res.body.turns_total).toBe(1)
    expect(res.body.session_completed).toBe(true)
  })

  it("draws with the buyer's own order-access session token", async () => {
    const { token } = await seedConfirmedGachaOrder(1)
    const res = await request(makeApp())
      .post(`/api/orders/${token}/gacha-session/draw`)
      .set("Authorization", `Bearer ${issueOrderSessionToken(token)}`)
      .send({ draw_key: "tap-1" })
    expect(res.status).toBe(200)
  })

  it("rejects a missing draw_key", async () => {
    const { token } = await seedConfirmedGachaOrder(1)
    const res = await request(makeApp())
      .post(`/api/orders/${token}/gacha-session/draw`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it("is idempotent per draw_key", async () => {
    const { token } = await seedConfirmedGachaOrder(2)
    const app = makeApp()
    const send = () => request(app)
      .post(`/api/orders/${token}/gacha-session/draw`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ draw_key: "tap-1" })

    const first = await send()
    const second = await send()
    expect(second.status).toBe(200)
    expect(second.body.turns_used).toBe(first.body.turns_used)
    const [[{ c }]] = await db.query("SELECT COUNT(*) AS c FROM gacha_draws")
    expect(c).toBe(1)
  })

  it("409s once the session has no turns left", async () => {
    const { token } = await seedConfirmedGachaOrder(1)
    const app = makeApp()
    await request(app)
      .post(`/api/orders/${token}/gacha-session/draw`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ draw_key: "tap-1" })

    const res = await request(app)
      .post(`/api/orders/${token}/gacha-session/draw`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ draw_key: "tap-2" })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("session_complete")
  })

  it("409s when the order has been cancelled", async () => {
    const { token, orderId } = await seedConfirmedGachaOrder(2)
    await orderRepo.transitionOrder(orderId, "cancelled")

    const res = await request(makeApp())
      .post(`/api/orders/${token}/gacha-session/draw`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ draw_key: "tap-1" })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("order_cancelled")
  })

  it("404s when the order has no gacha session", async () => {
    const { variantId } = await seedGachaProduct()
    const order = await orderRepo.createOrder({
      items: [{ variant_id: variantId, qty: 1 }], buyer, payment_method: "bank", fulfillment_method: "ship",
    })

    const res = await request(makeApp())
      .post(`/api/orders/${order.order_token}/gacha-session/draw`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ draw_key: "tap-1" })
    expect(res.status).toBe(404)
  })

  // The ownership guard: a session id resolved from THIS order's token can
  // never draw against another order's session, even when both are active.
  it("never draws against a session belonging to another order", async () => {
    const mine = await seedConfirmedGachaOrder(1)
    const theirs = await seedConfirmedGachaOrder(1)
    const theirSession = await sessionRepo.getSessionByOrderId(theirs.orderId)

    await request(makeApp())
      .post(`/api/orders/${mine.token}/gacha-session/draw`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ draw_key: "tap-1" })

    const untouched = await sessionRepo.getSessionById(theirSession.id)
    expect(untouched.turns_used).toBe(0)
    await expect(
      sessionRepo.drawForSession(theirSession.id, { drawKey: "x", ownerOrderId: mine.orderId })
    ).rejects.toBeInstanceOf(sessionRepo.GachaSessionNotFoundError)
  })
})

describe("POST / gacha error mapping", () => {
  beforeEach(async () => {
    await db.query("DELETE FROM payment_settings")
    await paymentSettings.updateSettings({
      cod_enabled: true, bank_enabled: true,
      bank_name: "ACB", bank_bin: "970416", bank_account_number: "1", bank_account_holder: "A",
    })
  })

  it("rejects COD on a gacha cart", async () => {
    const { variantId } = await seedGachaProduct()
    const res = await request(makeApp()).post("/api/orders").send({
      items: [{ variant_id: variantId, qty: 1 }], buyer, payment_method: "cod", fulfillment_method: "ship",
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
    expect(res.body.message).toMatch(/COD/)
  })

  it("rejects a cart mixing a gacha item with another product", async () => {
    const { variantId } = await seedGachaProduct()
    const cid = await catalog.createCollection({ title: "Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])

    const res = await request(makeApp()).post("/api/orders").send({
      items: [{ variant_id: variantId, qty: 1 }, { variant_id: v.id, qty: 1 }],
      buyer, payment_method: "bank", fulfillment_method: "ship",
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
    expect(res.body.message).toMatch(/cùng lúc/)
  })

  it("409s when the prize pool cannot cover the requested turns", async () => {
    const { variantId } = await seedGachaProduct({ prizeQty: 1 })
    const res = await request(makeApp()).post("/api/orders").send({
      items: [{ variant_id: variantId, qty: 5 }], buyer, payment_method: "bank", fulfillment_method: "ship",
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("gacha_sold_out")
  })
})
