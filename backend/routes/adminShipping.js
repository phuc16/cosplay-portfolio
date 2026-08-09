const express = require("express")
const ExcelJS = require("exceljs")
const db = require("../db")
const orders = require("../shop/orders/orderRepo")
const { LOAI_HANG_HOA_VALUES, orderCode } = require("../shop/shipping/vtpMapping")
const { buildExportWorkbook } = require("../shop/shipping/vtpWorkbook")
const trackingImport = require("../shop/shipping/trackingImport")

// exceljs cell.value can be a rich-text object ({richText: [...]}), a
// formula-result object ({result: ...}), a hyperlink object ({text/hyperlink}),
// or a Date/number/plain string. extractPairsFromSheetRows expects plain
// strings for header matching and cell text, so normalise here.
function cellToText(value) {
  if (value == null) return ""
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text).join("")
    if (value.text !== undefined) return String(value.text)
    if (value.result !== undefined) return cellToText(value.result)
    if (value instanceof Date) return value.toISOString()
    return ""
  }
  return String(value)
}

async function sheetToRows2D(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const sheet = wb.worksheets[0]
  if (!sheet) return []
  const rows = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values.slice(1).map(cellToText)
    rows.push(values)
  })
  return rows
}

module.exports = function adminShippingRoutes() {
  const router = express.Router()

  const oops = (res, err, where) => {
    console.error(`[ADMIN/SHIPPING] ${where}:`, err)
    res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
  }

  // Ship orders ready to book: confirmed, ship fulfillment, no tracking code yet.
  router.get("/shipping/export/orders", async (req, res) => {
    try {
      const rows = await orders.listOrders({ status: "confirmed" })
      const eligible = rows.filter((o) => o.fulfillment_method === "ship" && !o.tracking_code)
      res.json(eligible.map((o) => ({
        id: o.id,
        order_code: orderCode(o.id),
        buyer_name: o.buyer_name,
        phone: o.phone,
        address_province: o.address_province,
        total: o.total,
        cod_amount: o.cod_amount,
        payment_method: o.payment_method,
        shipping_payer: o.shipping_payer,
      })))
    } catch (err) { oops(res, err, "Lỗi liệt kê đơn cần xuất") }
  })

  router.patch("/shipping/export/orders/:id/payer", async (req, res) => {
    try {
      const { shipping_payer: shippingPayer } = req.body
      if (!["buyer", "seller"].includes(shippingPayer)) {
        return res.status(400).json({ error: "invalid_input", message: "shipping_payer phải là 'buyer' hoặc 'seller'" })
      }
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      }
      const [result] = await db.query(
        "UPDATE orders SET shipping_payer = ? WHERE id = ?", [shippingPayer, id]
      )
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      }
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi cập nhật người trả cước") }
  })

  router.post("/shipping/export", async (req, res) => {
    try {
      const { order_ids: orderIds, batch } = req.body
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: "invalid_input", message: "order_ids phải là mảng khác rỗng" })
      }
      if (!batch || !batch.ten_hang_hoa || !batch.trong_luong || !batch.loai_hang_hoa || !batch.thoi_gian_hen_lay) {
        return res.status(400).json({
          error: "invalid_input",
          message: "Thiếu thông tin lô hàng (tên hàng hóa, trọng lượng, loại hàng hóa, thời gian hẹn lấy)",
        })
      }
      if (!LOAI_HANG_HOA_VALUES.includes(batch.loai_hang_hoa)) {
        return res.status(400).json({ error: "invalid_input", message: "Loại hàng hóa không hợp lệ" })
      }

      // Re-fetch and re-check eligibility server-side rather than trusting
      // the client's snapshot — an order may have been cancelled or already
      // exported by another admin action between listing and generating.
      // Rejects here are attributed into the same `excluded` array as
      // mapOrderToRow's rejects (never dropped silently) — a seller who
      // submits 30 order_ids must always be able to reconcile
      // exported_count + excluded.length back to 30, or a raced/unknown
      // order vanishes with only a smaller count as the only clue, and a
      // buyer never gets a parcel.
      const ids = orderIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      const eligible = []
      const preExcluded = []
      for (const id of ids) {
        const order = await orders.getOrderById(id)
        if (!order) {
          preExcluded.push({ order_id: id, reason: "not_found", message: `${orderCode(id)}: không tìm thấy đơn hàng` })
          continue
        }
        if (order.status === "confirmed" && order.fulfillment_method === "ship" && !order.tracking_code) {
          eligible.push(order)
        } else {
          preExcluded.push({
            order_id: order.id,
            reason: "not_eligible",
            message: `${orderCode(order.id)}: đơn không còn đủ điều kiện xuất (đã hủy, đổi trạng thái, hoặc đã có mã vận đơn)`,
          })
        }
      }

      const { buffer, exported, excluded } = await buildExportWorkbook(eligible, batch)
      res.json({
        file_base64: buffer.toString("base64"),
        filename: `vtp-xuat-don-${new Date().toISOString().slice(0, 10)}.xlsx`,
        exported_count: exported.length,
        excluded: [...preExcluded, ...excluded],
      })
    } catch (err) { oops(res, err, "Lỗi xuất file ViettelPost") }
  })

  router.post("/shipping/tracking-import/preview", async (req, res) => {
    try {
      const { rows_text: rowsText, file_base64: fileBase64 } = req.body
      const hasRowsText = typeof rowsText === "string"
      const hasFileBase64 = typeof fileBase64 === "string"
      if (hasRowsText === hasFileBase64) {
        return res.status(400).json({
          error: "invalid_input",
          message: "Phải cung cấp đúng một trong hai: rows_text hoặc file_base64",
        })
      }

      let rows
      if (hasRowsText) {
        rows = trackingImport.parsePastedText(rowsText)
      } else {
        let rows2D
        try {
          const buffer = Buffer.from(fileBase64, "base64")
          rows2D = await sheetToRows2D(buffer)
        } catch (err) {
          return res.status(400).json({ error: "invalid_input", message: "Không đọc được file, vui lòng kiểm tra định dạng" })
        }
        rows = trackingImport.extractPairsFromSheetRows(rows2D)
      }

      if (rows.length === 0) {
        return res.status(400).json({ error: "invalid_input", message: "Không có dòng dữ liệu nào để xử lý" })
      }
      if (rows.length > trackingImport.MAX_IMPORT_ROWS) {
        return res.status(400).json({
          error: "invalid_input",
          message: `Chỉ có thể nhập tối đa ${trackingImport.MAX_IMPORT_ROWS} dòng mỗi lần`,
        })
      }

      const orderIds = [...new Set(
        rows.map((r) => trackingImport.parseOrderCode(r.order_code)).filter((id) => id !== null)
      )]
      const ordersById = new Map()
      for (const id of orderIds) {
        const order = await orders.getOrderById(id)
        if (order) ordersById.set(id, order)
      }

      res.json(trackingImport.resolvePreview(rows, ordersById))
    } catch (err) { oops(res, err, "Lỗi xem trước nhập mã vận đơn") }
  })

  router.post("/shipping/tracking-import/confirm", async (req, res) => {
    try {
      const { rows } = req.body
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: "invalid_input", message: "rows phải là mảng khác rỗng" })
      }
      if (rows.length > trackingImport.MAX_IMPORT_ROWS) {
        return res.status(400).json({
          error: "invalid_input",
          message: `Chỉ có thể nhập tối đa ${trackingImport.MAX_IMPORT_ROWS} dòng mỗi lần`,
        })
      }

      // Each row goes through transitionOrder() individually — the order
      // state machine's guards (confirmed -> shipped only), the shipped-
      // email dispatch, and the confirmed status check (expectedFromStatus)
      // all stay in force. One order's failure never stops the rest.
      //
      // A repeated order_id within one request is deduped up front, keeping
      // only the first occurrence, so each order appears EXACTLY ONCE in
      // `results` — otherwise the second row's no-op (correctly rejected by
      // expectedFromStatus) would show up as ok:false alongside the first
      // row's ok:true for the SAME order_id, and a UI keyed by order_id
      // could display the failure and hide the success, telling the seller
      // an order failed when it actually shipped. Dropped duplicates are not
      // added to `results` (that would re-violate "exactly once"); they are
      // logged server-side under the "duplicate_in_request" reason so it is
      // never confused with a genuine "not_confirmed".
      const seenOrderIds = new Set()
      const dedupedRows = []
      for (const r of rows) {
        const orderId = Number(r.order_id)
        if (Number.isInteger(orderId) && seenOrderIds.has(orderId)) {
          console.warn(
            `[ADMIN/SHIPPING] duplicate_in_request: ${orderCode(orderId)} xuất hiện nhiều lần trong yêu cầu nhập mã vận đơn, chỉ xử lý lần đầu`
          )
          continue
        }
        if (Number.isInteger(orderId)) seenOrderIds.add(orderId)
        dedupedRows.push(r)
      }

      const results = []
      for (const r of dedupedRows) {
        const orderId = Number(r.order_id)
        try {
          const ok = await orders.transitionOrder(orderId, "shipped", {
            tracking_code: r.tracking_code,
            expectedFromStatus: "confirmed",
          })
          results.push(ok
            ? { order_id: orderId, ok: true, message: `Đã cập nhật mã vận đơn cho ${orderCode(orderId)}` }
            : {
                order_id: orderId, ok: false, reason: "not_confirmed",
                message: `${orderCode(orderId)} không còn ở trạng thái "confirmed" (đã xử lý trước đó hoặc bị thay đổi)`,
              })
        } catch (err) {
          console.error(`[ADMIN/SHIPPING] Lỗi cập nhật mã vận đơn cho đơn ${orderId}:`, err)
          results.push({ order_id: orderId, ok: false, reason: "server_error", message: "Lỗi server. Thử lại sau." })
        }
      }
      res.json({ results })
    } catch (err) { oops(res, err, "Lỗi xác nhận nhập mã vận đơn") }
  })

  return router
}
