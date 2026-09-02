import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import redis from "../redis.js"
import settings from "../shop/payments/settingsRepo.js"
import { formatOrderCode } from "../shop/orders/domain.js"
import { resetTables } from "./helpers/db.js"

// GET /api/orders/:token now requires either an admin session or a
// PIN-verified order-access session (see shop/orders/orderAccess.js) — the
// admin JWT is the simplest bypass for tests that don't care about the PIN
// flow itself (that's covered separately in orderAccess.test.js).
const adminToken = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${adminToken}`)

async function seed(stock = 5, collectionOver = {}) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active", ...collectionOver })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stock }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return v.id
}

const body = (variantId, over = {}) => ({
  items: [{ variant_id: variantId, qty: 1 }],
  buyer: {
    buyer_name: "Nguyễn Văn A",
    phone: "0900000000",
    email: "a@example.com",
    address_raw: "1 ABC, Q1, TP.HCM",
  },
  fulfillment_method: "ship",
  payment_method: "bank",
  ...over,
})

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
  // The order-creation limiter (10/hour/IP) shares one Redis key across every
  // test in this file since supertest requests all appear to come from the
  // same loopback address. Without clearing it, later tests in this file
  // would 429 instead of exercising the behavior under test, even though each
  // test is well under the limit on its own.
  const keys = await redis.keys("rl:order:*")
  if (keys.length) await redis.del(...keys)
  // These tests place orders using "bank" by default; the seller must have
  // it enabled or checkout now (correctly) rejects it.
  await settings.updateSettings({
    bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
    bank_account_number: "123456789", bank_account_holder: "NGUYEN VAN A",
    // The new COD expires_at test below places a "cod" order; COD must be
    // enabled or checkout (correctly) rejects it before expires_at is ever
    // reached.
    cod_enabled: true,
  })
})

describe("POST /api/orders", () => {
  it("creates an order and returns its token and total", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders").send(body(v))

    expect(res.status).toBe(201)
    expect(res.body.order_token).toMatch(/^[0-9a-f]{32}$/)
    expect(res.body.total).toBe(35000)
  })

  // The buyer's own browser skips the PIN gate for the order page it's about
  // to load, exactly once, right after checkout — see orderAccess.js's
  // issueOrderSessionToken.
  it("also returns an access_token that unlocks this order's own page, immediately", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))
    expect(typeof created.body.access_token).toBe("string")

    const res = await request(app).get(`/api/orders/${created.body.order_token}`)
      .set("Authorization", `Bearer ${created.body.access_token}`)
    expect(res.status).toBe(200)
  })

  it("the access_token is scoped to THIS order — it does not unlock a different one", async () => {
    const v1 = await seed()
    const v2 = await seed()
    const first = await request(app).post("/api/orders").send(body(v1))
    const second = await request(app).post("/api/orders").send(body(v2))

    const res = await request(app).get(`/api/orders/${second.body.order_token}`)
      .set("Authorization", `Bearer ${first.body.access_token}`)
    expect(res.status).toBe(401)
  })

  it("ignores a client-supplied total", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders").send(body(v, { total: 1 }))
    expect(res.body.total).toBe(35000)
  })

  it("rejects a missing email", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders")
      .send(body(v, { buyer: { buyer_name: "A", phone: "0900000000", address_raw: "x" } }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects a malformed email", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders")
      .send(body(v, { buyer: { buyer_name: "A", phone: "0900000000", email: "nope", address_raw: "x" } }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("requires an address for ship but not for pickup", async () => {
    const v = await seed(5, { allow_ship: true, allow_pickup: true })

    const noAddr = { buyer_name: "A", phone: "0900000000", email: "a@example.com" }
    const ship = await request(app).post("/api/orders").send(body(v, { buyer: noAddr }))
    expect(ship.status).toBe(400)
    expect(ship.body.error).toBe("invalid_input")

    const pickup = await request(app).post("/api/orders")
      .send(body(v, { buyer: noAddr, fulfillment_method: "pickup" }))
    expect(pickup.status).toBe(201)
  })

  it("rejects a pickup order for a ship-only collection", async () => {
    const v = await seed(5, { allow_ship: true, allow_pickup: false })
    const res = await request(app).post("/api/orders")
      .send(body(v, { fulfillment_method: "pickup" }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects a ship order for a pickup-only collection", async () => {
    const v = await seed(5, { allow_ship: false, allow_pickup: true })
    const res = await request(app).post("/api/orders").send(body(v))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("still allows pickup for a collection that offers both ship and pickup", async () => {
    const v = await seed(5, { allow_ship: true, allow_pickup: true })
    const res = await request(app).post("/api/orders")
      .send(body(v, { fulfillment_method: "pickup" }))
    expect(res.status).toBe(201)
  })

  it("rejects an empty cart", async () => {
    const res = await request(app).post("/api/orders").send(body(1, { items: [] }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects an unknown payment method", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders").send(body(v, { payment_method: "bitcoin" }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects a zero or negative quantity", async () => {
    const v = await seed()
    for (const qty of [0, -1, 1.5]) {
      const res = await request(app).post("/api/orders")
        .send(body(v, { items: [{ variant_id: v, qty }] }))
      expect(res.status).toBe(400)
      expect(res.body.error).toBe("invalid_input")
    }
  })

  it("returns 409 when stock is insufficient", async () => {
    const v = await seed(1)
    const res = await request(app).post("/api/orders")
      .send(body(v, { items: [{ variant_id: v, qty: 2 }] }))
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("out_of_stock")
  })

  // A stale cart (e.g. the admin deleted the variant after it was added)
  // used to reuse out_of_stock's quoted-label message with the literal
  // placeholder "không tồn tại" standing in as a fake product name.
  it("returns a distinct variant_not_found error (not out_of_stock) for a nonexistent variant_id", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders")
      .send(body(v, { items: [{ variant_id: 999999, qty: 1 }] }))
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("variant_not_found")
    // The old bug quoted the literal placeholder as if it were a product
    // label: `Rất tiếc, "không tồn tại" vừa hết hàng.`
    expect(res.body.message).not.toContain('"không tồn tại"')
    expect(res.body.message).not.toContain("vừa hết hàng")
    // The client needs this to actually remove the stale line from the
    // cart itself — "refresh the page" alone does nothing for a bad id
    // sitting in localStorage.
    expect(res.body.variant_ids).toEqual([999999])
  })

  // This exact path guards a cross-buyer PII leak: a request_key shared by
  // two different buyers must be refused, not silently treated as a retry
  // that hands buyer B buyer A's order_token.
  it("409s with request_key_conflict when the same request_key is reused by a different buyer", async () => {
    const v = await seed(5)
    const first = await request(app).post("/api/orders")
      .send(body(v, { request_key: "some-key" }))
    expect(first.status).toBe(201)

    const second = await request(app).post("/api/orders")
      .send(body(v, { request_key: "some-key", buyer: { ...body(v).buyer, email: "b@example.com" } }))

    expect(second.status).toBe(409)
    expect(second.body.error).toBe("request_key_conflict")
    expect(JSON.stringify(second.body)).not.toContain(first.body.order_token)
  })

  it("rejects COD for a pickup order", async () => {
    await settings.updateSettings({ cod_enabled: true, bank_enabled: true, bank_name: "ACB", bank_bin: "970416", bank_account_number: "1", bank_account_holder: "A" })
    const v = await seed(5, { allow_ship: true, allow_pickup: true })
    const res = await request(app).post("/api/orders")
      .send(body(v, { fulfillment_method: "pickup", payment_method: "cod", buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com" } }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("still allows COD for a ship order", async () => {
    await settings.updateSettings({ cod_enabled: true, bank_enabled: true, bank_name: "ACB", bank_bin: "970416", bank_account_number: "1", bank_account_holder: "A" })
    const v = await seed(5, { allow_ship: true, allow_pickup: true })
    const res = await request(app).post("/api/orders")
      .send(body(v, { payment_method: "cod" }))
    expect(res.status).toBe(201)
  })
})

describe("POST /api/orders — rate limiting", () => {
  it("blocks the 11th request within an hour with a readable, actionable message", async () => {
    // Any POST to /api/orders counts against the limiter before the route
    // handler runs, so a body that 400s still consumes budget — no need to
    // seed a real variant or place 10 real orders.
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app).post("/api/orders").send({})
    }
    const res = await request(app).post("/api/orders").send({})

    expect(res.status).toBe(429)
    expect(res.body.error).toBe("too_many_requests")
    // The old message was just "Quá nhiều đơn. Thử lại sau." — no count, no
    // wait time, nothing actionable.
    expect(res.body.message).toContain("10 đơn")
    expect(res.body.message).toMatch(/\d+ phút/)
  })
})

describe("GET /api/orders/:token", () => {
  it("returns the order with its items", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))

    const res = await authed(request(app).get(`/api/orders/${created.body.order_token}`))
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(35000)
    expect(res.body.items[0].variant_label_snapshot).toBe("A1")
  })

  it("is marked noindex so a shared link never reaches search results", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))

    const res = await authed(request(app).get(`/api/orders/${created.body.order_token}`))
    expect(String(res.headers["x-robots-tag"])).toContain("noindex")
  })

  it("does not echo internal fields (request_key, stock_released_at)", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders")
      .send(body(v, { request_key: "internal-fields-test" }))

    const res = await authed(request(app).get(`/api/orders/${created.body.order_token}`))
    expect(res.body).not.toHaveProperty("request_key")
    expect(res.body).not.toHaveProperty("stock_released_at")
    // Sanity: the fields the order page actually uses are still there.
    expect(res.body).toMatchObject({
      status: "pending",
      fulfillment_method: "ship",
      total: 35000,
    })
    expect(res.body.items).toHaveLength(1)
  })

  it("includes expires_at for a prepaid (non-COD) order", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))

    const res = await authed(request(app).get(`/api/orders/${created.body.order_token}`))
    expect(res.body).toHaveProperty("expires_at")
    expect(res.body.expires_at).not.toBeNull()
  })

  it("returns a null expires_at for a COD order, which never expires", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v, { payment_method: "cod" }))

    const res = await authed(request(app).get(`/api/orders/${created.body.order_token}`))
    expect(res.body).toHaveProperty("expires_at")
    expect(res.body.expires_at).toBeNull()
  })

  it("allowlist regression: expires_at, buyer_name, phone, address_raw are present; order_token stays as before; request_key/stock_released_at/note/email still never appear", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))

    const res = await authed(request(app).get(`/api/orders/${created.body.order_token}`))
    expect(res.body).toHaveProperty("expires_at")
    // order_token IS present on this response by design (the buyer already
    // holds it — it's in the URL they just requested).
    // buyer_name/phone/address_raw were deliberately kept off this response
    // by an earlier privacy default; showing a "Thông tin nhận hàng" block
    // (matching Shopee's order confirmation) is a later, explicit decision
    // to trade some of that safety for letting a buyer catch a typo'd
    // address/phone — this is not a regression.
    expect(res.body.buyer_name).toBe("Nguyễn Văn A")
    expect(res.body.phone).toBe("0900000000")
    expect(res.body.address_raw).toBe("1 ABC, Q1, TP.HCM")
    // email is still never exposed here — the buyer already has it (they
    // typed it at checkout), so there's nothing for this page to confirm,
    // only more PII to leak if the link is ever forwarded.
    expect(res.body).not.toHaveProperty("request_key")
    expect(res.body).not.toHaveProperty("stock_released_at")
    expect(res.body).not.toHaveProperty("note")
    expect(res.body).not.toHaveProperty("email")
  })

  it("includes the human-readable order_code shown everywhere else (admin, emails)", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))

    const res = await authed(request(app).get(`/api/orders/${created.body.order_token}`))
    const stored = await orders.getOrderById(res.body.id)
    expect(res.body.order_code).toBe(formatOrderCode(stored.id, stored.created_at))
  })

  it("returns a null address_raw for a pickup order (no shipping address to show)", async () => {
    const v = await seed(5, { allow_pickup: true })
    const created = await request(app).post("/api/orders")
      .send(body(v, { fulfillment_method: "pickup", payment_method: "bank" }))
    expect(created.status).toBe(201)

    const res = await authed(request(app).get(`/api/orders/${created.body.order_token}`))
    expect(res.body.address_raw).toBeNull()
  })

  it("404s an unknown token", async () => {
    const res = await authed(request(app).get(`/api/orders/${"a".repeat(32)}`))
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("not_found")
    expect(String(res.headers["x-robots-tag"])).toContain("noindex")
  })

  it("surfaces the collection's pickup location/note on a pickup order", async () => {
    const v = await seed(5, {
      allow_ship: false, allow_pickup: true,
      pickup_location: "Comic Fest, Booth 12", pickup_note: "9am-6pm, both days",
    })
    const created = await request(app).post("/api/orders")
      .send(body(v, { fulfillment_method: "pickup", buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com" } }))

    const res = await authed(request(app).get(`/api/orders/${created.body.order_token}`))
    expect(res.status).toBe(200)
    expect(res.body.pickup_location).toBe("Comic Fest, Booth 12")
    expect(res.body.pickup_note).toBe("9am-6pm, both days")
  })

  it("omits pickup location/note (null) for a ship order", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))

    const res = await authed(request(app).get(`/api/orders/${created.body.order_token}`))
    expect(res.body.pickup_location).toBeNull()
    expect(res.body.pickup_note).toBeNull()
  })

  it("hides pickup_code while the order is still pending (unpaid)", async () => {
    const v = await seed(5, { allow_ship: true, allow_pickup: true })
    const pickup = await request(app).post("/api/orders")
      .send(body(v, { fulfillment_method: "pickup", buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com" } }))

    const pickupGet = await authed(request(app).get(`/api/orders/${pickup.body.order_token}`))
    expect(pickupGet.body.pickup_code).toBeNull()

    const v2 = await seed(5)
    const ship = await request(app).post("/api/orders").send(body(v2))
    const shipGet = await authed(request(app).get(`/api/orders/${ship.body.order_token}`))
    expect(shipGet.body.pickup_code).toBeNull()
  })

  it("reveals pickup_code once the order is confirmed (paid)", async () => {
    const v = await seed(5, { allow_ship: true, allow_pickup: true })
    const pickup = await request(app).post("/api/orders")
      .send(body(v, { fulfillment_method: "pickup", buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com" } }))

    const [[pRow]] = await db.query("SELECT id FROM orders WHERE order_token = ?", [pickup.body.order_token])
    await orders.transitionOrder(pRow.id, "confirmed")

    const res = await authed(request(app).get(`/api/orders/${pickup.body.order_token}`))
    expect(res.body.pickup_code).toMatch(/^\d{6}$/)
  })

  it("hides pickup_code again once a confirmed order is cancelled", async () => {
    const v = await seed(5, { allow_ship: true, allow_pickup: true })
    const pickup = await request(app).post("/api/orders")
      .send(body(v, { fulfillment_method: "pickup", buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com" } }))

    const [[pRow1]] = await db.query("SELECT id FROM orders WHERE order_token = ?", [pickup.body.order_token])
    await orders.transitionOrder(pRow1.id, "confirmed")
    await orders.transitionOrder(pRow1.id, "cancelled")

    const res = await authed(request(app).get(`/api/orders/${pickup.body.order_token}`))
    expect(res.body.pickup_code).toBeNull()
  })

  it("keeps pickup_code visible once the order is completed", async () => {
    const v = await seed(5, { allow_ship: true, allow_pickup: true })
    const pickup = await request(app).post("/api/orders")
      .send(body(v, { fulfillment_method: "pickup", buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com" } }))

    const [[pRow2]] = await db.query("SELECT id FROM orders WHERE order_token = ?", [pickup.body.order_token])
    await orders.transitionOrder(pRow2.id, "confirmed")
    await orders.transitionOrder(pRow2.id, "completed")

    const res = await authed(request(app).get(`/api/orders/${pickup.body.order_token}`))
    expect(res.body.pickup_code).toMatch(/^\d{6}$/)
  })
})
