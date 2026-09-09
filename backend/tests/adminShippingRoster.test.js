import { describe, it, expect, beforeEach, vi } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import { createRequire } from "module"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { resetTables } from "./helpers/db.js"

// The route file (`../routes/adminShipping.js`) is CommonJS and does
// `require("../db")` - grab the exact same cached CJS module.exports object
// here (rather than the ESM-interop `db` import above) so spying on `.query`
// actually observes the route's real calls.
const cjsDb = createRequire(import.meta.url)("../db.js")

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)
const buyer = { buyer_name: "Phạm Thu Trang", phone: "0912345678", email: "trang@example.com", address_raw: "x" }

async function seedPickupOrder(over = {}) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active", allow_pickup: true })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 40000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  const o = await orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }], buyer, fulfillment_method: "pickup", payment_method: "bank", ...over,
  })
  await orders.transitionOrder(o.id, "confirmed")
  return { collectionId: cid, orderId: o.id }
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("auth", () => {
  it("requires a token", async () => {
    expect((await request(app).get("/api/admin/shipping/roster/1")).status).toBe(401)
  })
})

describe("GET /api/admin/shipping/roster/:collectionId", () => {
  it("returns the confirmed pickup order with its items", async () => {
    const { collectionId, orderId } = await seedPickupOrder()
    const res = await authed(request(app).get(`/api/admin/shipping/roster/${collectionId}`))
    expect(res.status).toBe(200)
    expect(res.body.rows).toHaveLength(1)
    expect(res.body.rows[0].order_id).toBe(orderId)
    expect(res.body.rows[0].items[0].product_name).toBe("Card")
  })

  it("excludes a shipped-fulfillment order from a pickup roster", async () => {
    const cid = await catalog.createCollection({ title: "Drop2", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 40000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    const shipOrder = await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }], buyer, fulfillment_method: "ship", payment_method: "bank",
    })
    await orders.transitionOrder(shipOrder.id, "confirmed")

    const res = await authed(request(app).get(`/api/admin/shipping/roster/${cid}`))
    expect(res.body.rows).toEqual([])
  })

  it("excludes a non-confirmed pickup order", async () => {
    const { collectionId } = await seedPickupOrder()
    const cid2 = await catalog.createCollection({ title: "Drop3", status: "active", allow_pickup: true })
    const pid = await catalog.createProduct({ collection_id: cid2, name: "Card2", price: 40000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }], buyer, fulfillment_method: "pickup", payment_method: "bank",
    }) // stays pending

    const res = await authed(request(app).get(`/api/admin/shipping/roster/${cid2}`))
    expect(res.body.rows).toEqual([])
    expect(collectionId).toBeDefined() // sanity: earlier collection unaffected
  })

  it("reports a COD pickup order with a missing cod_amount as excluded, not a ₫0 row", async () => {
    const { collectionId, orderId } = await seedPickupOrder({ payment_method: "cod" })
    // createOrder() defaults cod_amount to the order total for payment_method
    // 'cod' - force the missing-amount case this test is actually named for.
    await db.query("UPDATE orders SET cod_amount = NULL WHERE id = ?", [orderId])
    const res = await authed(request(app).get(`/api/admin/shipping/roster/${collectionId}`))
    expect(res.body.rows).toEqual([])
    expect(res.body.excluded[0].reason).toBe("cod_missing_amount")
  })

  it("400s on a non-numeric collectionId", async () => {
    const res = await authed(request(app).get("/api/admin/shipping/roster/abc"))
    expect(res.status).toBe(400)
  })

  it("returns an empty roster (not an error) for a collection with no pickup orders", async () => {
    const cid = await catalog.createCollection({ title: "Empty", status: "active" })
    const res = await authed(request(app).get(`/api/admin/shipping/roster/${cid}`))
    expect(res.status).toBe(200)
    expect(res.body.rows).toEqual([])
  })

  // --- status must genuinely reach buildRoster ---
  // The route's WHERE clause already limits results to status='confirmed', so
  // a COD order that had somehow already been marked 'completed' can only show
  // up here still carrying 'confirmed'-shaped data in the DB - this test
  // instead proves the *plumbing*: if the route stopped selecting/passing
  // `status`, buildRoster would see `order.status === undefined`, which is
  // never "completed", so the `paid` guard would fall through to
  // PREPAID_METHODS only. For a bank-paid order that happens to match either
  // way, so we assert the row actually carries paid:true and amount_due:0 for
  // a prepaid method AND that a COD order's due amount is untouched - the
  // combination is only meaningful once we also directly unit-test that the
  // route's SQL selects `status`.
  it("a COD pickup order with a real cod_amount is collected, and a prepaid one shows paid, not collect", async () => {
    const { collectionId: prepaidCid, orderId: prepaidOrderId } = await seedPickupOrder({ payment_method: "bank" })
    const cid2 = await catalog.createCollection({ title: "CodDrop", status: "active", allow_pickup: true })
    const pid = await catalog.createProduct({ collection_id: cid2, name: "Badge", price: 25000 })
    await catalog.replaceVariants(pid, [{ label: "B1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    const codOrder = await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }], buyer, fulfillment_method: "pickup", payment_method: "cod",
    })
    await orders.transitionOrder(codOrder.id, "confirmed")
    await db.query("UPDATE orders SET cod_amount = ? WHERE id = ?", [25000, codOrder.id])

    const prepaidRes = await authed(request(app).get(`/api/admin/shipping/roster/${prepaidCid}`))
    const codRes = await authed(request(app).get(`/api/admin/shipping/roster/${cid2}`))

    const prepaidRow = prepaidRes.body.rows.find((r) => r.order_id === prepaidOrderId)
    expect(prepaidRow.paid).toBe(true)
    expect(prepaidRow.amount_due).toBe(0)

    const codRow = codRes.body.rows.find((r) => r.order_id === codOrder.id)
    expect(codRow.paid).toBe(false)
    expect(codRow.amount_due).toBe(25000)
  })

  it("the roster SQL selects status so the route's rows carry it (guard plumbing)", async () => {
    const querySpy = vi.spyOn(cjsDb, "query")
    const { collectionId } = await seedPickupOrder()
    querySpy.mockClear()
    await authed(request(app).get(`/api/admin/shipping/roster/${collectionId}`))

    const ordersCall = querySpy.mock.calls.find(
      ([sql]) => typeof sql === "string" && sql.includes("FROM orders") && sql.includes("collection_id")
    )
    querySpy.mockRestore()

    expect(ordersCall).toBeDefined()
    // Check the SELECT column list specifically, not just anywhere in the
    // query text - the WHERE clause's `status = 'confirmed'` also contains
    // the word "status", so a naive whole-string match would stay green even
    // if `status` were dropped from the SELECT list.
    const selectClause = ordersCall[0].slice(0, ordersCall[0].indexOf("FROM orders"))
    const selectedColumns = selectClause.replace(/^\s*SELECT\s+/i, "").split(",").map((c) => c.trim())
    expect(selectedColumns).toContain("status")
  })

  it("multi-item order: every item is attached and rendered", async () => {
    const cid = await catalog.createCollection({ title: "MultiDrop", status: "active", allow_pickup: true })
    const p1 = await catalog.createProduct({ collection_id: cid, name: "Poster", price: 30000 })
    await catalog.replaceVariants(p1, [{ label: "L1", stock_qty: 5 }])
    const p2 = await catalog.createProduct({ collection_id: cid, name: "Keychain", price: 15000 })
    await catalog.replaceVariants(p2, [{ label: "K1", stock_qty: 5 }])
    const [[v1]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [p1])
    const [[v2]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [p2])
    const o = await orders.createOrder({
      items: [{ variant_id: v1.id, qty: 2 }, { variant_id: v2.id, qty: 3 }],
      buyer, fulfillment_method: "pickup", payment_method: "bank",
    })
    await orders.transitionOrder(o.id, "confirmed")

    const res = await authed(request(app).get(`/api/admin/shipping/roster/${cid}`))
    const row = res.body.rows.find((r) => r.order_id === o.id)
    expect(row.items).toHaveLength(2)
    const names = row.items.map((i) => i.product_name).sort()
    expect(names).toEqual(["Keychain", "Poster"])
    const poster = row.items.find((i) => i.product_name === "Poster")
    expect(poster.variant_label).toBe("L1")
    expect(poster.qty).toBe(2)
  })

  it("defaults prepared to false, and reflects the shared prepared toggle used by the shipping queue", async () => {
    const { collectionId, orderId } = await seedPickupOrder()
    const before = await authed(request(app).get(`/api/admin/shipping/roster/${collectionId}`))
    expect(before.body.rows.find((r) => r.order_id === orderId).prepared).toBe(false)

    await authed(request(app).patch(`/api/admin/shipping/export/orders/${orderId}/prepared`).send({ prepared: true }))

    const after = await authed(request(app).get(`/api/admin/shipping/roster/${collectionId}`))
    expect(after.body.rows.find((r) => r.order_id === orderId).prepared).toBe(true)
  })

  it("includes each item's variant photo, falling back to the product's photo when the variant has none", async () => {
    const cid = await catalog.createCollection({ title: "Photo Drop", status: "active", allow_pickup: true })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 40000, images: ["/api/storage/shop/products/p1.webp"] })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5, image_url: "/api/storage/shop/variants/a1.webp" }, { label: "B1", stock_qty: 5 }])
    const [variants] = await db.query("SELECT id, label FROM product_variants WHERE product_id = ? ORDER BY label", [pid])
    const vA1 = variants.find((v) => v.label === "A1")
    const vB1 = variants.find((v) => v.label === "B1")
    const o = await orders.createOrder({
      items: [{ variant_id: vA1.id, qty: 1 }, { variant_id: vB1.id, qty: 1 }],
      buyer, fulfillment_method: "pickup", payment_method: "bank",
    })
    await orders.transitionOrder(o.id, "confirmed")

    const res = await authed(request(app).get(`/api/admin/shipping/roster/${cid}`))
    const row = res.body.rows.find((r) => r.order_id === o.id)
    const itemA1 = row.items.find((i) => i.variant_label === "A1")
    const itemB1 = row.items.find((i) => i.variant_label === "B1")
    expect(itemA1.image_url).toBe("/api/storage/shop/variants/a1.webp")
    expect(itemB1.image_url).toBe("/api/storage/shop/products/p1.webp")
  })

  it("keeps an item's photo on the roster even after its variant is deleted", async () => {
    const cid = await catalog.createCollection({ title: "Photo Drop", status: "active", allow_pickup: true })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 40000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5, image_url: "/api/storage/shop/variants/a1.webp" }])
    const [[variant]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    const o = await orders.createOrder({
      items: [{ variant_id: variant.id, qty: 1 }],
      buyer, fulfillment_method: "pickup", payment_method: "bank",
    })
    await orders.transitionOrder(o.id, "confirmed")
    await db.query("DELETE FROM product_variants WHERE id = ?", [variant.id])

    const res = await authed(request(app).get(`/api/admin/shipping/roster/${cid}`))
    const row = res.body.rows.find((r) => r.order_id === o.id)
    expect(row.items[0].image_url).toBe("/api/storage/shop/variants/a1.webp")
  })

  it("shows an order with items from two pickup collections on BOTH collections' rosters", async () => {
    const cidA = await catalog.createCollection({ title: "Drop A", status: "active", allow_pickup: true })
    const cidB = await catalog.createCollection({ title: "Drop B", status: "active", allow_pickup: true })
    const pidA = await catalog.createProduct({ collection_id: cidA, name: "Card A", price: 40000 })
    const pidB = await catalog.createProduct({ collection_id: cidB, name: "Card B", price: 40000 })
    await catalog.replaceVariants(pidA, [{ label: "A1", stock_qty: 5 }])
    await catalog.replaceVariants(pidB, [{ label: "A1", stock_qty: 5 }])
    const [[vA]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pidA])
    const [[vB]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pidB])
    const o = await orders.createOrder({
      items: [{ variant_id: vA.id, qty: 1 }, { variant_id: vB.id, qty: 1 }],
      buyer, fulfillment_method: "pickup", payment_method: "bank",
    })
    await orders.transitionOrder(o.id, "confirmed")

    const resA = await authed(request(app).get(`/api/admin/shipping/roster/${cidA}`))
    const resB = await authed(request(app).get(`/api/admin/shipping/roster/${cidB}`))
    expect(resA.body.rows.map((r) => r.order_id)).toContain(o.id)
    expect(resB.body.rows.map((r) => r.order_id)).toContain(o.id)
  })

  it("includes pickup_code in the roster row", async () => {
    const { collectionId, orderId } = await seedPickupOrder()
    const res = await authed(request(app).get(`/api/admin/shipping/roster/${collectionId}`))
    const row = res.body.rows.find((r) => r.order_id === orderId)
    expect(row.pickup_code).toMatch(/^\d{6}$/)
  })

  // --- order_token must never leak into this printed/carried document ---
  it("never includes order_token in the response, even as a canary value", async () => {
    const { collectionId, orderId } = await seedPickupOrder()
    await db.query("UPDATE orders SET order_token = ? WHERE id = ?", ["CANARY-TOKEN-DO-NOT-LEAK", orderId])
    const res = await authed(request(app).get(`/api/admin/shipping/roster/${collectionId}`))
    const body = JSON.stringify(res.body)
    expect(body).not.toContain("CANARY-TOKEN-DO-NOT-LEAK")
    expect(body).not.toContain("order_token")
  })
})
