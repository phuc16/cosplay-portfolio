import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { resetTables } from "./helpers/db.js"

const adminToken = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${adminToken}`)

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seedOrder() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active", allow_ship: true })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank",
  })
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

afterEach(() => {
  vi.restoreAllMocks()
})

function lastLoggedRequestLine(logSpy) {
  const line = logSpy.mock.calls
    .map((c) => c[0])
    .reverse()
    .find((s) => typeof s === "string" && s.includes('"msg":"request"'))
  return line ? JSON.parse(line) : null
}

describe("request logger - order_token redaction", () => {
  it("redacts the 32-hex-char order_token from a buyer order-page request's logged path", async () => {
    const created = await seedOrder()
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    await request(app).get(`/api/orders/${created.order_token}`)

    const logged = lastLoggedRequestLine(logSpy)
    expect(logged).not.toBeNull()
    expect(logged.path).not.toContain(created.order_token)
    expect(logged.path).toBe("/api/orders/[token]")

    logSpy.mockRestore()
  })

  it("does not redact a numeric order id on an admin route (the match is specific, not broad)", async () => {
    const created = await seedOrder()
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    await authed(request(app).get(`/api/admin/orders/${created.id}`))

    const logged = lastLoggedRequestLine(logSpy)
    expect(logged).not.toBeNull()
    expect(logged.path).toBe(`/api/admin/orders/${created.id}`)
    expect(logged.path).not.toContain("[token]")

    logSpy.mockRestore()
  })
})
