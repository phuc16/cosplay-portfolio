import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import ExcelJS from "exceljs"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { resetTables } from "./helpers/db.js"

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

const buyer = {
  buyer_name: "Lê Thị Hoa", phone: "0909 888 777", email: "hoa@example.com",
  address_street: "10 Điện Biên Phủ", address_ward: "Đa Kao", address_district: "Quận 1",
  address_province: "Hồ Chí Minh", address_raw: null,
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

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("auth", () => {
  it("requires a token on all three export routes", async () => {
    expect((await request(app).get("/api/admin/shipping/export/orders")).status).toBe(401)
    expect((await request(app).patch("/api/admin/shipping/export/orders/1/payer").send({ shipping_payer: "seller" })).status).toBe(401)
    expect((await request(app).post("/api/admin/shipping/export").send({ order_ids: [1], batch: {} })).status).toBe(401)
  })
})

describe("GET /api/admin/shipping/export/orders", () => {
  it("lists a confirmed ship order with no tracking code", async () => {
    const id = await seed()
    const res = await authed(request(app).get("/api/admin/shipping/export/orders"))
    expect(res.status).toBe(200)
    expect(res.body.find((o) => o.id === id)).toBeDefined()
    expect(res.body.find((o) => o.id === id).order_code).toBe(`DH${id}`)
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

  it("does not mutate orders.status", async () => {
    const id = await seed()
    await authed(request(app).patch(`/api/admin/shipping/export/orders/${id}/payer`).send({ shipping_payer: "seller" }))
    const [[row]] = await db.query("SELECT status FROM orders WHERE id = ?", [id])
    expect(row.status).toBe("confirmed")
  })
})

describe("POST /api/admin/shipping/export", () => {
  const batch = { ten_hang_hoa: "Photocard", trong_luong: 50, loai_hang_hoa: "Bưu kiện", thoi_gian_hen_lay: "Cả ngày" }

  it("generates a base64 xlsx containing the requested order", async () => {
    const id = await seed()
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: [id], batch }))
    expect(res.status).toBe(200)
    expect(res.body.exported_count).toBe(1)
    expect(res.body.excluded).toEqual([])

    const buffer = Buffer.from(res.body.file_base64, "base64")
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const row = wb.getWorksheet("Danh sách").getRow(8)
    expect(row.getCell("B").value).toBe(`DH${id}`)
  })

  it("does not leak order_token into the generated file", async () => {
    const id = await seed()
    const [[row]] = await db.query("SELECT order_token FROM orders WHERE id = ?", [id])
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: [id], batch }))
    expect(res.status).toBe(200)
    const buffer = Buffer.from(res.body.file_base64, "base64")
    // A distinctive canary: the raw xlsx bytes (zip of XML parts) must not
    // contain the order_token string anywhere.
    expect(buffer.includes(row.order_token)).toBe(false)
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

  it("silently omits an order_id that is no longer eligible (raced by another admin action)", async () => {
    const id = await seed()
    await orders.transitionOrder(id, "cancelled")
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: [id], batch }))
    expect(res.status).toBe(200)
    expect(res.body.exported_count).toBe(0)
  })

  it("does not mutate orders.status for exported orders", async () => {
    const id = await seed()
    await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: [id], batch }))
    const [[row]] = await db.query("SELECT status, tracking_code FROM orders WHERE id = ?", [id])
    expect(row.status).toBe("confirmed")
    expect(row.tracking_code).toBeFalsy()
  })
})
