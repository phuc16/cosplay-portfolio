import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import redis from "../redis.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import settings from "../shop/payments/settingsRepo.js"
import { resetTables } from "./helpers/db.js"

const adminToken = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${adminToken}`)

async function seedOrder(method = "bank") {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer: { buyer_name: "A", phone: "09", email: "a@example.com", address_raw: "x" },
    fulfillment_method: "ship", payment_method: method,
  })
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
  const keys = await redis.keys("rl:order:*")
  if (keys.length) await redis.del(...keys)
  await db.query("DELETE FROM payment_settings")
})

describe("GET /api/orders/:token/payment/qr.svg", () => {
  it("returns an inline SVG when the bank is configured", async () => {
    await settings.updateSettings({
      bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
      bank_account_number: "123456789", bank_account_holder: "NGUYEN VAN A",
    })
    const o = await seedOrder("bank")

    const res = await authed(request(app).get(`/api/orders/${o.order_token}/payment/qr.svg`))
    expect(res.status).toBe(200)
    expect(res.type).toBe("image/svg+xml")
    expect(res.body.toString("utf-8")).toContain("<svg")
  })

  it("404s instead of a blank image when the bank is misconfigured", async () => {
    await settings.updateSettings({ bank_enabled: true })
    const o = await seedOrder("bank")

    const res = await authed(request(app).get(`/api/orders/${o.order_token}/payment/qr.svg`))
    expect(res.status).toBe(404)
  })

  it("404s for a non-bank order (no VietQR to build)", async () => {
    await settings.updateSettings({ cod_enabled: true })
    const o = await seedOrder("cod")

    const res = await authed(request(app).get(`/api/orders/${o.order_token}/payment/qr.svg`))
    expect(res.status).toBe(404)
  })

  it("404s for an unknown token", async () => {
    const res = await authed(request(app).get("/api/orders/doesnotexist/payment/qr.svg"))
    expect(res.status).toBe(404)
  })
})
