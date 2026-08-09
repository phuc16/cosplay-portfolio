import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { resetTables } from "./helpers/db.js"

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)
const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seedConfirmedOrder() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  const o = await orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }], buyer, fulfillment_method: "ship", payment_method: "bank",
  })
  await orders.transitionOrder(o.id, "confirmed")
  return o.id
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("auth", () => {
  it("requires a token on both tracking-import routes", async () => {
    expect((await request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: "DH1\tVTP1" })).status).toBe(401)
    expect((await request(app).post("/api/admin/shipping/tracking-import/confirm").send({ rows: [] })).status).toBe(401)
  })
})

describe("POST /api/admin/shipping/tracking-import/preview", () => {
  it("previews a pasted row for a confirmed order as ready to apply", async () => {
    const id = await seedConfirmedOrder()
    const res = await authed(
      request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: `DH${id}\tVTP-XYZ` })
    )
    expect(res.status).toBe(200)
    expect(res.body.toApply).toEqual([{ order_id: id, order_code: `DH${id}`, tracking_code: "VTP-XYZ" }])
    expect(res.body.skipped).toEqual([])
  })

  it("reports an unmatched order code as skipped, not applied", async () => {
    const res = await authed(
      request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: "DH999999\tVTP-XYZ" })
    )
    expect(res.body.toApply).toEqual([])
    expect(res.body.skipped[0].reason).toBe("not_found")
  })

  it("400s when neither rows_text nor file_base64 is provided, or the result is empty", async () => {
    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/preview").send({}))
    expect(res.status).toBe(400)
  })

  it("400s when the row count exceeds MAX_IMPORT_ROWS", async () => {
    const text = Array.from({ length: 201 }, (_, i) => `DH${i}\tVTP${i}`).join("\n")
    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: text }))
    expect(res.status).toBe(400)
  })

  it("idempotency: previewing the same rows again after a successful import shows nothing to apply", async () => {
    const id = await seedConfirmedOrder()
    await authed(request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: `DH${id}\tVTP-XYZ` }))
    await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({
      rows: [{ order_id: id, order_code: `DH${id}`, tracking_code: "VTP-XYZ" }],
    }))

    const res = await authed(
      request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: `DH${id}\tVTP-XYZ` })
    )
    expect(res.body.toApply).toEqual([])
    expect(res.body.skipped[0].reason).toBe("already_shipped")
  })
})

describe("POST /api/admin/shipping/tracking-import/confirm", () => {
  it("moves a confirmed order to shipped with the tracking code, via transitionOrder's state machine", async () => {
    const id = await seedConfirmedOrder()
    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({
      rows: [{ order_id: id, order_code: `DH${id}`, tracking_code: "VTP-ABC" }],
    }))
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([{ order_id: id, ok: true, message: expect.any(String) }])

    const [[row]] = await db.query("SELECT status, tracking_code FROM orders WHERE id = ?", [id])
    expect(row.status).toBe("shipped")
    expect(row.tracking_code).toBe("VTP-ABC")
  })

  it("per-order isolation: one order that changed status since preview does not block the rest", async () => {
    const good = await seedConfirmedOrder()
    const raced = await seedConfirmedOrder()
    await orders.transitionOrder(raced, "cancelled") // races the import between preview and confirm

    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({
      rows: [
        { order_id: good, order_code: `DH${good}`, tracking_code: "VTP-GOOD" },
        { order_id: raced, order_code: `DH${raced}`, tracking_code: "VTP-RACED" },
      ],
    }))
    expect(res.status).toBe(200)
    const goodResult = res.body.results.find((r) => r.order_id === good)
    const racedResult = res.body.results.find((r) => r.order_id === raced)
    expect(goodResult.ok).toBe(true)
    expect(racedResult.ok).toBe(false)

    const [[goodRow]] = await db.query("SELECT status FROM orders WHERE id = ?", [good])
    expect(goodRow.status).toBe("shipped")
  })

  it("idempotency: confirming the same already-applied row again is a no-op that reports failure, not a duplicate email", async () => {
    const id = await seedConfirmedOrder()
    const row = { order_id: id, order_code: `DH${id}`, tracking_code: "VTP-ABC" }
    await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({ rows: [row] }))

    const secondRes = await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({ rows: [row] }))
    expect(secondRes.body.results[0].ok).toBe(false)

    const [[after]] = await db.query("SELECT tracking_code FROM orders WHERE id = ?", [id])
    expect(after.tracking_code).toBe("VTP-ABC") // unchanged, not overwritten a second time
  })

  it("400s on an empty or oversized rows array", async () => {
    expect((await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({ rows: [] }))).status).toBe(400)
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ order_id: i, order_code: `DH${i}`, tracking_code: `V${i}` }))
    expect((await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({ rows: tooMany }))).status).toBe(400)
  })
})
