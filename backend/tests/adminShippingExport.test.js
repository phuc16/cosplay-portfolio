import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import ExcelJS from "exceljs"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { orderCode } from "../shop/shipping/vtpMapping.js"
import { formatOrderCode } from "../shop/orders/domain.js"
import { resetTables } from "./helpers/db.js"

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

const buyer = {
  buyer_name: "Lê Thị Hoa", phone: "0909 888 777", email: "hoa@example.com",
  address_street: "10 Điện Biên Phủ", address_ward: "Đa Kao", address_district: "Quận 1",
  address_province: "Hồ Chí Minh", address_raw: null,
}

// An .xlsx is a deflated zip of XML parts - cell text never appears as
// plaintext in the raw buffer. A raw buffer scan for a canary can never
// fail, even if the canary was actually written into a cell, so it proves
// nothing. Decoding through exceljs and walking every cell of every
// worksheet is the only scan that actually inspects what a courier's
// spreadsheet software would show.
function cellText(value) {
  if (value == null) return ""
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text).join("")
    if (value.text !== undefined) return String(value.text)
    if (value.result !== undefined) return cellText(value.result)
    if (value instanceof Date) return value.toISOString()
    return JSON.stringify(value)
  }
  return String(value)
}

function workbookText(wb) {
  let all = ""
  wb.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        all += `${cellText(cell.value)}\n`
      })
    })
  })
  return all
}

async function seed() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 120000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  const o = await orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank",
  })
  await orders.transitionOrder(o.id, "confirmed")
  return o.id
}

async function seedInCollection(collectionId) {
  const pid = await catalog.createProduct({ collection_id: collectionId, name: "Card", price: 120000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  const o = await orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank",
  })
  await orders.transitionOrder(o.id, "confirmed")
  return o.id
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("auth", () => {
  it("requires a token on all export routes", async () => {
    expect((await request(app).get("/api/admin/shipping/export/orders")).status).toBe(401)
    expect((await request(app).patch("/api/admin/shipping/export/orders/1/payer").send({ shipping_payer: "seller" })).status).toBe(401)
    expect((await request(app).patch("/api/admin/shipping/export/orders/1/prepared").send({ prepared: true })).status).toBe(401)
    expect((await request(app).post("/api/admin/shipping/export").send({ order_ids: [1], batch: {} })).status).toBe(401)
  })
})

describe("GET /api/admin/shipping/export/orders", () => {
  it("lists a confirmed ship order with no tracking code", async () => {
    const id = await seed()
    const res = await authed(request(app).get("/api/admin/shipping/export/orders"))
    expect(res.status).toBe(200)
    expect(res.body.find((o) => o.id === id)).toBeDefined()
  })

  it("listing's order_code matches the same buyer-facing code shown everywhere else in admin (not the DH/VTP code)", async () => {
    const id = await seed()
    const stored = await orders.getOrderById(id)
    const res = await authed(request(app).get("/api/admin/shipping/export/orders"))
    expect(res.status).toBe(200)
    const order = res.body.find((o) => o.id === id)
    expect(order).toBeDefined()
    expect(order.order_code).toBe(formatOrderCode(id, stored.created_at))
    expect(order.order_code).not.toBe(orderCode(id))
  })

  it("excludes an order that already has a tracking code", async () => {
    const id = await seed()
    await orders.transitionOrder(id, "shipped", { tracking_code: "VTP-ALREADY" })
    const res = await authed(request(app).get("/api/admin/shipping/export/orders"))
    expect(res.body.find((o) => o.id === id)).toBeUndefined()
  })

  it("excludes a pickup order even if confirmed", async () => {
    const cid = await catalog.createCollection({ title: "Drop", status: "active", allow_pickup: true })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 50000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    const o = await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }], buyer, fulfillment_method: "pickup", payment_method: "bank",
    })
    await orders.transitionOrder(o.id, "confirmed")

    const res = await authed(request(app).get("/api/admin/shipping/export/orders"))
    expect(res.body.find((x) => x.id === o.id)).toBeUndefined()
  })

  it("filters to a single collection when collection_id is given, and lists across all when omitted", async () => {
    const cidA = await catalog.createCollection({ title: "Drop A", status: "active" })
    const cidB = await catalog.createCollection({ title: "Drop B", status: "active" })
    const idA = await seedInCollection(cidA)
    const idB = await seedInCollection(cidB)

    const filtered = await authed(request(app).get("/api/admin/shipping/export/orders").query({ collection_id: cidA }))
    expect(filtered.body.map((o) => o.id)).toEqual([idA])

    const all = await authed(request(app).get("/api/admin/shipping/export/orders"))
    const allIds = all.body.map((o) => o.id)
    expect(allIds).toContain(idA)
    expect(allIds).toContain(idB)
  })

  it("never includes order_token in the listing response", async () => {
    const id = await seed()
    const [[row]] = await db.query("SELECT order_token FROM orders WHERE id = ?", [id])
    const res = await authed(request(app).get("/api/admin/shipping/export/orders"))
    const body = JSON.stringify(res.body)
    expect(body).not.toContain(row.order_token)
    expect(res.body.find((o) => o.id === id)).not.toHaveProperty("order_token")
  })
})

describe("PATCH /api/admin/shipping/export/orders/:id/payer", () => {
  it("updates shipping_payer to seller (freeship)", async () => {
    const id = await seed()
    const res = await authed(request(app).patch(`/api/admin/shipping/export/orders/${id}/payer`).send({ shipping_payer: "seller" }))
    expect(res.status).toBe(200)
    const [[row]] = await db.query("SELECT shipping_payer FROM orders WHERE id = ?", [id])
    expect(row.shipping_payer).toBe("seller")
  })

  it("400s on an invalid shipping_payer value", async () => {
    const id = await seed()
    const res = await authed(request(app).patch(`/api/admin/shipping/export/orders/${id}/payer`).send({ shipping_payer: "nobody" }))
    expect(res.status).toBe(400)
  })

  it("400s on a missing shipping_payer value", async () => {
    const id = await seed()
    const res = await authed(request(app).patch(`/api/admin/shipping/export/orders/${id}/payer`).send({}))
    expect(res.status).toBe(400)
  })

  it("404s for an unknown order id", async () => {
    const res = await authed(request(app).patch("/api/admin/shipping/export/orders/999999/payer").send({ shipping_payer: "seller" }))
    expect(res.status).toBe(404)
  })

  it("404s (not 500) for a non-numeric id", async () => {
    const res = await authed(request(app).patch("/api/admin/shipping/export/orders/not-a-number/payer").send({ shipping_payer: "seller" }))
    expect(res.status).toBe(404)
  })

  it("does not mutate orders.status", async () => {
    const id = await seed()
    await authed(request(app).patch(`/api/admin/shipping/export/orders/${id}/payer`).send({ shipping_payer: "seller" }))
    const [[row]] = await db.query("SELECT status FROM orders WHERE id = ?", [id])
    expect(row.status).toBe("confirmed")
  })
})

describe("PATCH /api/admin/shipping/export/orders/:id/prepared", () => {
  it("defaults to not prepared in the listing", async () => {
    const id = await seed()
    const res = await authed(request(app).get("/api/admin/shipping/export/orders"))
    expect(res.body.find((o) => o.id === id).prepared).toBe(false)
  })

  it("marks an order prepared, and reflects it back in the listing", async () => {
    const id = await seed()
    const res = await authed(request(app).patch(`/api/admin/shipping/export/orders/${id}/prepared`).send({ prepared: true }))
    expect(res.status).toBe(200)

    const listing = await authed(request(app).get("/api/admin/shipping/export/orders"))
    expect(listing.body.find((o) => o.id === id).prepared).toBe(true)
  })

  it("unmarks an order back to not prepared", async () => {
    const id = await seed()
    await authed(request(app).patch(`/api/admin/shipping/export/orders/${id}/prepared`).send({ prepared: true }))
    await authed(request(app).patch(`/api/admin/shipping/export/orders/${id}/prepared`).send({ prepared: false }))

    const [[row]] = await db.query("SELECT prepared FROM orders WHERE id = ?", [id])
    expect(Boolean(row.prepared)).toBe(false)
  })

  it("400s on a non-boolean prepared value", async () => {
    const id = await seed()
    const res = await authed(request(app).patch(`/api/admin/shipping/export/orders/${id}/prepared`).send({ prepared: "yes" }))
    expect(res.status).toBe(400)
  })

  it("404s for an unknown order id", async () => {
    const res = await authed(request(app).patch("/api/admin/shipping/export/orders/999999/prepared").send({ prepared: true }))
    expect(res.status).toBe(404)
  })

  it("does not mutate orders.status", async () => {
    const id = await seed()
    await authed(request(app).patch(`/api/admin/shipping/export/orders/${id}/prepared`).send({ prepared: true }))
    const [[row]] = await db.query("SELECT status FROM orders WHERE id = ?", [id])
    expect(row.status).toBe("confirmed")
  })
})

describe("POST /api/admin/shipping/export", () => {
  const batch = { ten_hang_hoa: "Photocard", trong_luong: 50, loai_hang_hoa: "Bưu kiện", thoi_gian_hen_lay: "Cả ngày" }

  it("generates a base64 xlsx containing the requested order", async () => {
    const id = await seed()
    const stored = await orders.getOrderById(id)
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: [id], batch }))
    expect(res.status).toBe(200)
    expect(res.body.exported_count).toBe(1)
    expect(res.body.excluded).toEqual([])

    const buffer = Buffer.from(res.body.file_base64, "base64")
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const row = wb.getWorksheet("Danh sách").getRow(8)
    expect(row.getCell("B").value).toBe(formatOrderCode(id, stored.created_at))
  })

  it("does not leak order_token into the generated file", async () => {
    const id = await seed()
    const [[row]] = await db.query("SELECT order_token FROM orders WHERE id = ?", [id])
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: [id], batch }))
    expect(res.status).toBe(200)
    const buffer = Buffer.from(res.body.file_base64, "base64")
    // Decode the xlsx and walk every cell of every worksheet - a raw byte
    // scan of the compressed zip can never find text that is actually
    // present in a cell, so it would never catch a real leak.
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    expect(workbookText(wb)).not.toContain(row.order_token)
  })

  it("400s on missing order_ids", async () => {
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ batch }))
    expect(res.status).toBe(400)
  })

  it("400s on missing batch fields", async () => {
    const id = await seed()
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: [id], batch: { ten_hang_hoa: "Photocard" } }))
    expect(res.status).toBe(400)
  })

  it("400s on an invalid loai_hang_hoa value", async () => {
    const id = await seed()
    const res = await authed(request(app).post("/api/admin/shipping/export").send({
      order_ids: [id], batch: { ...batch, loai_hang_hoa: "Không hợp lệ" },
    }))
    expect(res.status).toBe(400)
  })

  it("reports an order_id that is no longer eligible (raced by another admin action) in excluded, not silently", async () => {
    const id = await seed()
    const stored = await orders.getOrderById(id)
    await orders.transitionOrder(id, "cancelled")
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: [id], batch }))
    expect(res.status).toBe(200)
    expect(res.body.exported_count).toBe(0)
    expect(res.body.excluded).toEqual([
      { order_id: id, reason: "not_eligible", message: expect.stringContaining(formatOrderCode(id, stored.created_at)) },
    ])
  })

  it("reports an order that already has a tracking_code as excluded with the eligibility reason", async () => {
    const id = await seed()
    await orders.transitionOrder(id, "shipped", { tracking_code: "VTP-ALREADY" })
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: [id], batch }))
    expect(res.status).toBe(200)
    expect(res.body.exported_count).toBe(0)
    expect(res.body.excluded).toHaveLength(1)
    expect(res.body.excluded[0]).toMatchObject({ order_id: id, reason: "not_eligible" })
  })

  it("mixes a good order, a cancelled order, and an unknown id: good exports, others excluded distinctly, count reconciles", async () => {
    const goodId = await seed()
    const cancelledId = await seed()
    await orders.transitionOrder(cancelledId, "cancelled")
    const unknownId = 999999

    const orderIds = [goodId, cancelledId, unknownId]
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: orderIds, batch }))

    expect(res.status).toBe(200)
    expect(res.body.exported_count).toBe(1)
    expect(res.body.excluded).toHaveLength(2)

    const byId = Object.fromEntries(res.body.excluded.map((e) => [e.order_id, e]))
    expect(byId[cancelledId]).toMatchObject({ order_id: cancelledId, reason: "not_eligible" })
    expect(byId[unknownId]).toMatchObject({ order_id: unknownId, reason: "not_found" })
    expect(byId[cancelledId].reason).not.toBe(byId[unknownId].reason)

    expect(res.body.exported_count + res.body.excluded.length).toBe(orderIds.length)
  })

  it("count invariant: exported_count + excluded.length always equals the number of submitted order_ids", async () => {
    const goodId = await seed()
    const cancelledId = await seed()
    await orders.transitionOrder(cancelledId, "cancelled")
    const codMissingId = await seed()
    await db.query("UPDATE orders SET payment_method = 'cod', cod_amount = NULL WHERE id = ?", [codMissingId])
    const unknownId = 888888

    const orderIds = [goodId, cancelledId, codMissingId, unknownId]
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: orderIds, batch }))

    expect(res.status).toBe(200)
    expect(res.body.exported_count + res.body.excluded.length).toBe(orderIds.length)
  })

  it("dedupes a repeated order_id, writing exactly one row in the xlsx for it", async () => {
    const id = await seed()
    const stored = await orders.getOrderById(id)
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: [id, id], batch }))
    expect(res.status).toBe(200)
    expect(res.body.exported_count).toBe(1)
    expect(res.body.excluded).toEqual([
      { order_id: id, reason: "duplicate_order_id", message: expect.stringContaining(`#${id}`) },
    ])
    expect(res.body.exported_count + res.body.excluded.length).toBe(2)

    const buffer = Buffer.from(res.body.file_base64, "base64")
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const sheet = wb.getWorksheet("Danh sách")
    expect(sheet.getRow(8).getCell("B").value).toBe(formatOrderCode(id, stored.created_at))
    expect(sheet.getRow(9).getCell("B").value).toBeNull()
  })

  it("routes a non-integer order_id into excluded instead of silently dropping it, invariant holds", async () => {
    const goodId = await seed()
    const orderIdsSent = [goodId, "abc"]
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: orderIdsSent, batch }))
    expect(res.status).toBe(200)
    expect(res.body.exported_count).toBe(1)
    expect(res.body.excluded).toEqual([
      { order_id: "abc", reason: "invalid_order_id", message: expect.any(String) },
    ])
    expect(res.body.exported_count + res.body.excluded.length).toBe(orderIdsSent.length)
  })

  it("count invariant holds with a mix of duplicate and invalid ids", async () => {
    const goodId = await seed()
    const orderIdsSent = [goodId, goodId, "abc", 0, -5]
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: orderIdsSent, batch }))
    expect(res.status).toBe(200)
    expect(res.body.exported_count).toBe(1)
    expect(res.body.exported_count + res.body.excluded.length).toBe(orderIdsSent.length)
  })

  it("does not mutate orders.status for exported orders", async () => {
    const id = await seed()
    await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: [id], batch }))
    const [[row]] = await db.query("SELECT status, tracking_code FROM orders WHERE id = ?", [id])
    expect(row.status).toBe("confirmed")
    expect(row.tracking_code).toBeFalsy()
  })
})
