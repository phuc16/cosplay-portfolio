import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import ExcelJS from "exceljs"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { resetTables } from "./helpers/db.js"

async function buildXlsxBase64(headerRow, dataRows) {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet("Sheet1")
  sheet.addRow(headerRow)
  for (const row of dataRows) sheet.addRow(row)
  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer).toString("base64")
}

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
  await resetTables("email_queue", "order_items", "orders", "product_variants", "products", "collections")
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

  it("400s when both rows_text and file_base64 are provided", async () => {
    const b64 = await buildXlsxBase64(["Mã đơn hàng", "Mã vận đơn"], [["DH1", "VTP1"]])
    const res = await authed(
      request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: "DH1\tVTP1", file_base64: b64 })
    )
    expect(res.status).toBe(400)
  })

  it("400s when the row count exceeds MAX_IMPORT_ROWS", async () => {
    const text = Array.from({ length: 201 }, (_, i) => `DH${i}\tVTP${i}`).join("\n")
    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: text }))
    expect(res.status).toBe(400)
  })

  it("400s when the uploaded file_base64 row count exceeds MAX_IMPORT_ROWS", async () => {
    const rows = Array.from({ length: 201 }, (_, i) => [`DH${i}`, `VTP${i}`])
    const b64 = await buildXlsxBase64(["Mã đơn hàng", "Mã vận đơn"], rows)
    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/preview").send({ file_base64: b64 }))
    expect(res.status).toBe(400)
  })

  it("400s on a file_base64 payload that isn't a readable spreadsheet", async () => {
    const notXlsx = Buffer.from("this is not an xlsx file, just plain bytes").toString("base64")
    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/preview").send({ file_base64: notXlsx }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("resolves an uploaded VTP result file (file_base64) the same way as an equivalent paste", async () => {
    const id = await seedConfirmedOrder()
    const b64 = await buildXlsxBase64(
      ["STT", "Mã đơn hàng", "Mã vận đơn"],
      [[1, `DH${id}`, "VTP-XYZ"]]
    )
    const fileRes = await authed(
      request(app).post("/api/admin/shipping/tracking-import/preview").send({ file_base64: b64 })
    )
    const pasteRes = await authed(
      request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: `DH${id}\tVTP-XYZ` })
    )
    expect(fileRes.status).toBe(200)
    expect(fileRes.body.toApply).toEqual([{ order_id: id, order_code: `DH${id}`, tracking_code: "VTP-XYZ" }])
    expect(fileRes.body).toEqual(pasteRes.body)
  })

  it("normalises a rich-text cell value from the uploaded sheet to plain text", async () => {
    const id = await seedConfirmedOrder()
    const wb = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet("Sheet1")
    sheet.addRow(["Mã đơn hàng", "Mã vận đơn"])
    const dataRow = sheet.addRow([])
    dataRow.getCell(1).value = { richText: [{ text: `DH${id}` }] }
    dataRow.getCell(2).value = { richText: [{ text: "VTP-" }, { text: "RICH" }] }
    dataRow.commit()
    const buffer = await wb.xlsx.writeBuffer()
    const b64 = Buffer.from(buffer).toString("base64")

    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/preview").send({ file_base64: b64 }))
    expect(res.status).toBe(200)
    expect(res.body.toApply).toEqual([{ order_id: id, order_code: `DH${id}`, tracking_code: "VTP-RICH" }])
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

    const [[{ count: beforeCount }]] = await db.query(
      "SELECT COUNT(*) AS count FROM email_queue WHERE order_id = ?", [id]
    )
    expect(beforeCount).toBeGreaterThan(0) // the first, legitimate confirm did queue a shipped email

    const secondRes = await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({ rows: [row] }))
    expect(secondRes.body.results[0].ok).toBe(false)

    const [[after]] = await db.query("SELECT tracking_code FROM orders WHERE id = ?", [id])
    expect(after.tracking_code).toBe("VTP-ABC") // unchanged, not overwritten a second time

    const [[{ count: afterCount }]] = await db.query(
      "SELECT COUNT(*) AS count FROM email_queue WHERE order_id = ?", [id]
    )
    expect(afterCount).toBe(beforeCount) // the no-op re-import must never queue a second buyer email
  })

  it("dedupes a repeated order_id within one confirm request, keeping exactly one entry per order", async () => {
    const id = await seedConfirmedOrder()
    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({
      rows: [
        { order_id: id, order_code: `DH${id}`, tracking_code: "VTP-FIRST" },
        { order_id: id, order_code: `DH${id}`, tracking_code: "VTP-SECOND" },
      ],
    }))
    expect(res.status).toBe(200)
    const forOrder = res.body.results.filter((r) => r.order_id === id)
    expect(forOrder).toHaveLength(1)
    expect(forOrder[0].ok).toBe(true)

    const [[row]] = await db.query("SELECT status, tracking_code FROM orders WHERE id = ?", [id])
    expect(row.status).toBe("shipped")
    expect(row.tracking_code).toBe("VTP-FIRST")
  })

  it("400s on an empty or oversized rows array", async () => {
    expect((await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({ rows: [] }))).status).toBe(400)
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ order_id: i, order_code: `DH${i}`, tracking_code: `V${i}` }))
    expect((await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({ rows: tooMany }))).status).toBe(400)
  })

  it("rejects a row with a blank tracking_code per-order: order stays confirmed, no shipped email queued", async () => {
    const id = await seedConfirmedOrder()
    const [[{ count: beforeCount }]] = await db.query(
      "SELECT COUNT(*) AS count FROM email_queue WHERE order_id = ?", [id]
    )

    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({
      rows: [{ order_id: id, order_code: `DH${id}`, tracking_code: "   " }],
    }))
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([
      { order_id: id, ok: false, reason: "missing_tracking_code", message: expect.any(String) },
    ])

    const [[row]] = await db.query("SELECT status, tracking_code FROM orders WHERE id = ?", [id])
    expect(row.status).toBe("confirmed")
    expect(row.tracking_code).toBeFalsy()

    const [[{ count: afterCount }]] = await db.query(
      "SELECT COUNT(*) AS count FROM email_queue WHERE order_id = ?", [id]
    )
    expect(afterCount).toBe(beforeCount)
  })

  it("rejects a row with a non-integer order_id without aborting the rest of the batch", async () => {
    const good = await seedConfirmedOrder()
    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({
      rows: [
        { order_id: "not-a-number", order_code: "DHx", tracking_code: "VTP-BAD" },
        { order_id: good, order_code: `DH${good}`, tracking_code: "VTP-GOOD" },
      ],
    }))
    expect(res.status).toBe(200)
    expect(res.body.results.find((r) => r.order_id === "not-a-number")).toMatchObject({ ok: false, reason: "invalid_order_id" })
    expect(res.body.results.find((r) => r.order_id === good)).toMatchObject({ ok: true })

    const [[row]] = await db.query("SELECT status FROM orders WHERE id = ?", [good])
    expect(row.status).toBe("shipped")
  })
})

describe("pickup orders in tracking import", () => {
  async function seedConfirmedPickupOrder() {
    const cid = await catalog.createCollection({ title: "Drop", status: "active", allow_pickup: true })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    const o = await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }], buyer, fulfillment_method: "pickup", payment_method: "bank",
    })
    await orders.transitionOrder(o.id, "confirmed")
    return o.id
  }

  it("skips a confirmed pickup order in preview with an honest not_shippable reason, not not_confirmed", async () => {
    const id = await seedConfirmedPickupOrder()
    const res = await authed(
      request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: `DH${id}\tVTP-XYZ` })
    )
    expect(res.status).toBe(200)
    expect(res.body.toApply).toEqual([])
    expect(res.body.skipped).toEqual([
      { order_code: `DH${id}`, tracking_code: "VTP-XYZ", reason: "not_shippable", message: expect.any(String) },
    ])
  })
})
