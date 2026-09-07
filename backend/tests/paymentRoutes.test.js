import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import settings from "../shop/payments/settingsRepo.js"
import catalog from "../shop/catalogRepo.js"
import { resetTables } from "./helpers/db.js"

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
  await db.query("DELETE FROM payment_settings")
})

describe("GET /api/shop/payment-methods", () => {
  it("lists only enabled methods", async () => {
    await settings.updateSettings({ bank_enabled: true, cod_enabled: true })
    const res = await request(app).get("/api/shop/payment-methods")
    expect(res.status).toBe(200)
    expect(res.body.methods).toEqual(["bank", "cod"])
  })

  it("does not leak the account number to the public list endpoint", async () => {
    await settings.updateSettings({ bank_enabled: true, bank_account_number: "999888777" })
    const res = await request(app).get("/api/shop/payment-methods")
    expect(JSON.stringify(res.body)).not.toContain("999888777")
  })
})

describe("admin payment settings", () => {
  it("requires auth", async () => {
    expect((await request(app).get("/api/admin/payment-settings")).status).toBe(401)
  })

  it("saves and reads back", async () => {
    await authed(request(app).put("/api/admin/payment-settings")).send({
      bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
      bank_account_number: "123456789", bank_account_holder: "NGUYEN VAN A",
    })
    const res = await authed(request(app).get("/api/admin/payment-settings"))
    expect(res.body.bank_name).toBe("ACB")
  })

  it("rejects enabling bank without the details needed to pay it", async () => {
    const res = await authed(request(app).put("/api/admin/payment-settings"))
      .send({ bank_enabled: true })
    expect(res.status).toBe(400)
  })

  it("rejects enabling momo with neither phone nor QR image", async () => {
    const res = await authed(request(app).put("/api/admin/payment-settings"))
      .send({ momo_enabled: true })
    expect(res.status).toBe(400)
  })

  it("rejects a non-numeric bank BIN", async () => {
    const res = await authed(request(app).put("/api/admin/payment-settings")).send({
      bank_enabled: true, bank_name: "ACB", bank_bin: "abc",
      bank_account_number: "1", bank_account_holder: "A",
    })
    expect(res.status).toBe(400)
  })
})

describe("checkout respects enabled methods", () => {
  async function seed() {
    const cid = await catalog.createCollection({ title: "Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
    return v.id
  }

  const body = (v, method) => ({
    items: [{ variant_id: v, qty: 1 }],
    buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" },
    fulfillment_method: "ship", payment_method: method,
  })

  it("rejects a method the seller has not enabled", async () => {
    const v = await seed()
    await settings.updateSettings({ bank_enabled: true })

    const res = await request(app).post("/api/orders").send(body(v, "paypal"))
    expect(res.status).toBe(400)

    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(0)
  })

  it("accepts an enabled method", async () => {
    const v = await seed()
    await settings.updateSettings({
      bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
      bank_account_number: "1", bank_account_holder: "A",
    })
    expect((await request(app).post("/api/orders").send(body(v, "bank"))).status).toBe(201)
  })
})
