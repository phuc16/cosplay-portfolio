import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import request from "supertest"
import { createRequire } from "module"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import redis from "../redis.js"
import settings from "../shop/payments/settingsRepo.js"
import { resetTables } from "./helpers/db.js"

// routes/orders.js is CommonJS and does `require("../shop/orders/orderRepo")`
// - grab the exact same cached CJS module.exports object here (rather than
// the ESM-interop import) so spying on `.createOrder` actually intercepts
// the route's real call, same gotcha documented in adminShippingRoster.test.js.
const cjsRepo = createRequire(import.meta.url)("../shop/orders/orderRepo.js")

async function seed(stock = 5) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stock }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return v.id
}

const PII_NAME = "Nguyễn Văn Bí Mật"
const PII_PHONE = "0987654321"
const PII_ADDRESS = "999 Đường Riêng Tư, Q1, TP.HCM"
const PII_EMAIL = "bimat@example.com"

const body = (variantId) => ({
  items: [{ variant_id: variantId, qty: 1 }],
  buyer: {
    buyer_name: PII_NAME,
    phone: PII_PHONE,
    email: PII_EMAIL,
    address_raw: PII_ADDRESS,
  },
  fulfillment_method: "ship",
  payment_method: "bank",
})

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
  const keys = await redis.keys("rl:order:*")
  if (keys.length) await redis.del(...keys)
  await settings.updateSettings({
    bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
    bank_account_number: "123456789", bank_account_holder: "NGUYEN VAN A",
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("POST /api/orders - failure logging never leaks PII or the order_token", () => {
  it("logs only a safe message/code, never the raw error object (with its embedded SQL/params) or any buyer field", async () => {
    const variantId = await seed()

    // Simulate a real mysql2-style failure the way it actually shows up:
    // err.message is a generic DB message, but err.sql/err.sqlMessage carry
    // the fully interpolated statement - including every bound buyer field
    // and the generated order_token - exactly like the real driver embeds it
    // on a query failure (over-length field, lock timeout, etc).
    const fakeOrderToken = "deadbeefcafebabe0123456789abcdef"
    const dbError = new Error("Data too long for column 'address_raw' at row 1")
    dbError.code = "ER_DATA_TOO_LONG"
    dbError.sql =
      `INSERT INTO orders (order_token, buyer_name, phone, email, address_raw) VALUES ` +
      `('${fakeOrderToken}', '${PII_NAME}', '${PII_PHONE}', '${PII_EMAIL}', '${PII_ADDRESS}')`
    dbError.sqlMessage = dbError.message

    const spy = vi.spyOn(cjsRepo, "createOrder").mockRejectedValueOnce(dbError)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await request(app).post("/api/orders").send(body(variantId))

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: "server_error", message: "Lỗi server. Thử lại sau." })

    const loggedText = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n")
    expect(loggedText).not.toContain(PII_NAME)
    expect(loggedText).not.toContain(PII_PHONE)
    expect(loggedText).not.toContain(PII_ADDRESS)
    expect(loggedText).not.toContain(PII_EMAIL)
    expect(loggedText).not.toContain(fakeOrderToken)
    expect(loggedText).not.toContain(dbError.sql)
    expect(loggedText).toContain(dbError.message)
    expect(loggedText).toContain("ER_DATA_TOO_LONG")

    spy.mockRestore()
    errorSpy.mockRestore()
  })
})
