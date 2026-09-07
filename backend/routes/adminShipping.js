const express = require("express")
const ExcelJS = require("exceljs")
const db = require("../db")
const orders = require("../shop/orders/orderRepo")
const domain = require("../shop/orders/domain")
const { LOAI_HANG_HOA_VALUES, orderCode } = require("../shop/shipping/vtpMapping")
const { buildExportWorkbook } = require("../shop/shipping/vtpWorkbook")
const trackingImport = require("../shop/shipping/trackingImport")
const { buildRoster } = require("../shop/shipping/roster")

// The admin-recognisable code everywhere else in the app (AdminOrders, the
// buyer's own order page/emails) is domain.formatOrderCode — never the "DH"
// + id code, which exists only as the literal Column B value VTP's own
// import/export files round-trip on (see vtpMapping.js). Screens the admin
// reads before/after that round-trip should show the code they actually
// recognise; only text that has to match a real VTP file's contents keeps
// the DH-format. Falls back to "#id" when there's no order row to hash
// (id not found, or not yet fetched at this point in the request).
function displayCode(id, createdAt) {
  return createdAt ? domain.formatOrderCode(id, createdAt) : `#${id}`
}

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

/** products.images is a JSON column; mysql2 may hand back a string or an array. */
function firstImage(value) {
  const arr = Array.isArray(value) ? value : (typeof value === "string" && value.trim() ? JSON.parse(value) : [])
  return Array.isArray(arr) ? arr[0] || null : null
}

async function sheetToRows2D(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const sheet = wb.worksheets[0]
  if (!sheet) return []
  const rows = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    // row.values can be sparse (holes, not undefined) at empty cells; Array.from densifies before .map, since .map skips holes
    const values = Array.from(row.values).slice(1).map(cellToText)
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
  // collection_id is optional — omitted, this still lists every eligible ship
  // order across collections, same as before this filter existed.
  router.get("/shipping/export/orders", async (req, res) => {
    try {
      const collectionId = Number(req.query.collection_id)
      const filter = { status: "confirmed" }
      if (Number.isInteger(collectionId) && collectionId > 0) filter.collection_id = collectionId
      const rows = await orders.listOrders(filter)
      const eligible = rows.filter((o) => o.fulfillment_method === "ship" && !o.tracking_code)
      res.json(eligible.map((o) => ({
        id: o.id,
        order_code: domain.formatOrderCode(o.id, o.created_at),
        buyer_name: o.buyer_name,
        phone: o.phone,
        address_province: o.address_province,
        total: o.total,
        cod_amount: o.cod_amount,
        payment_method: o.payment_method,
        shipping_payer: o.shipping_payer,
        prepared: Boolean(o.prepared),
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

  // Purely informational "have I packed this" checkbox — never gates export/tracking.
  router.patch("/shipping/export/orders/:id/prepared", async (req, res) => {
    try {
      const { prepared } = req.body
      if (typeof prepared !== "boolean") {
        return res.status(400).json({ error: "invalid_input", message: "prepared phải là boolean" })
      }
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      }
      const [result] = await db.query(
        "UPDATE orders SET prepared = ? WHERE id = ?", [prepared, id]
      )
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      }
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi cập nhật trạng thái chuẩn bị hàng") }
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
      //
      // Non-integer ids are routed into preExcluded here rather than being
      // silently `.filter()`ed out, and a repeated id is deduped (first
      // occurrence kept, later ones reported as duplicate_order_id) —
      // otherwise the same order would be written into the xlsx twice,
      // booking two parcels for one buyer when only one tracking code can
      // ever come back to match against it. Both cases still count toward
      // the exported_count + excluded.length === order_ids.length invariant.
      const seenIds = new Set()
      const ids = []
      const preExcluded = []
      for (const raw of orderIds) {
        const id = Number(raw)
        if (!Number.isInteger(id) || id <= 0) {
          preExcluded.push({ order_id: raw, reason: "invalid_order_id", message: `order_id không hợp lệ: ${JSON.stringify(raw)}` })
          continue
        }
        if (seenIds.has(id)) {
          preExcluded.push({
            order_id: id, reason: "duplicate_order_id",
            message: `${displayCode(id)}: trùng lặp trong yêu cầu, chỉ xuất một lần`,
          })
          continue
        }
        seenIds.add(id)
        ids.push(id)
      }
      const eligible = []
      for (const id of ids) {
        const order = await orders.getOrderById(id)
        if (!order) {
          preExcluded.push({ order_id: id, reason: "not_found", message: `${displayCode(id)}: không tìm thấy đơn hàng` })
          continue
        }
        if (order.status === "confirmed" && order.fulfillment_method === "ship" && !order.tracking_code) {
          eligible.push(order)
        } else {
          preExcluded.push({
            order_id: order.id,
            reason: "not_eligible",
            message: `${displayCode(order.id, order.created_at)}: đơn không còn đủ điều kiện xuất (đã hủy, đổi trạng thái, hoặc đã có mã vận đơn)`,
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

      // order_code's suffix is a one-way hash, so resolve by fetching orders near the embedded date and computing+comparing, not by parsing an id
      const codes = [...new Set(
        rows.map((r) => trackingImport.parseOrderCode(r.order_code)).filter((c) => c !== null)
      )]
      const ordersByCode = new Map()
      if (codes.length > 0) {
        const codeDates = codes.map((c) => domain.parseOrderCodeDate(c)).filter(Boolean)
          .map((d) => Date.UTC(d.year, d.month - 1, d.day))
        const minDate = new Date(Math.min(...codeDates) - 24 * 60 * 60 * 1000)
        const maxDate = new Date(Math.max(...codeDates) + 24 * 60 * 60 * 1000)
        const candidates = await orders.listOrders({
          date_from: minDate.toISOString().slice(0, 10),
          date_to: maxDate.toISOString().slice(0, 10),
        })
        for (const order of candidates) {
          ordersByCode.set(domain.formatOrderCode(order.id, order.created_at), order)
        }
      }

      res.json(trackingImport.resolvePreview(rows, ordersByCode))
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
      //
      // A row with an invalid order_id or a blank tracking_code is rejected
      // here, before it ever reaches transitionOrder — the preview step
      // (resolvePreview) already rejects exactly this shape of row as
      // missing_tracking_code, and confirm must not silently accept what
      // preview refused. Without this, an order with no tracking code would
      // still transition to "shipped" and still queue the buyer's shipped
      // email with a blank "Mã vận đơn:". Rejected rows are still deduped by
      // order_id first, so each valid order_id gets exactly one entry in
      // `results` (either this rejection, or the transitionOrder outcome).
      const seenOrderIds = new Set()
      const dedupedRows = []
      const results = []
      for (const r of rows) {
        const orderId = Number(r.order_id)
        // Falls back to orderCode(id) if the caller omitted order_code, so a direct/malformed API call still gets a readable message
        const code = typeof r.order_code === "string" && r.order_code ? r.order_code : orderCode(orderId)
        if (!Number.isInteger(orderId) || orderId <= 0) {
          console.warn(`[ADMIN/SHIPPING] invalid_order_id trong yêu cầu nhập mã vận đơn: ${JSON.stringify(r.order_id)}`)
          results.push({ order_id: r.order_id, ok: false, reason: "invalid_order_id", message: "order_id không hợp lệ" })
          continue
        }
        if (seenOrderIds.has(orderId)) {
          console.warn(
            `[ADMIN/SHIPPING] duplicate_in_request: ${code} xuất hiện nhiều lần trong yêu cầu nhập mã vận đơn, chỉ xử lý lần đầu`
          )
          continue
        }
        seenOrderIds.add(orderId)

        const trackingCode = typeof r.tracking_code === "string" ? r.tracking_code.trim() : ""
        if (!trackingCode) {
          results.push({
            order_id: orderId, ok: false, reason: "missing_tracking_code",
            message: `${code}: thiếu mã vận đơn`,
          })
          continue
        }
        dedupedRows.push({ order_id: orderId, order_code: code, tracking_code: trackingCode })
      }

      for (const r of dedupedRows) {
        const orderId = Number(r.order_id)
        try {
          const ok = await orders.transitionOrder(orderId, "shipped", {
            tracking_code: r.tracking_code,
            expectedFromStatus: "confirmed",
          })
          results.push(ok
            ? { order_id: orderId, ok: true, message: `Đã cập nhật mã vận đơn cho ${r.order_code}` }
            : {
                order_id: orderId, ok: false, reason: "not_confirmed",
                message: `${r.order_code} không còn ở trạng thái "confirmed" (đã xử lý trước đó hoặc bị thay đổi)`,
              })
        } catch (err) {
          console.error(`[ADMIN/SHIPPING] Lỗi cập nhật mã vận đơn cho đơn ${orderId}:`, err)
          results.push({ order_id: orderId, ok: false, reason: "server_error", message: "Lỗi server. Thử lại sau." })
        }
      }
      res.json({ results })
    } catch (err) { oops(res, err, "Lỗi xác nhận nhập mã vận đơn") }
  })

  // Pickup roster: confirmed pickup orders for one collection, shaped by
  // buildRoster() into the paid-vs-collect-at-handover printable list. The
  // WHERE clause below is the primary filter, but `status` is still selected
  // and passed through to buildRoster() — its internal completed-order guard
  // is defense in depth and silently no-ops without a real status value, so
  // this query must never drop that column (see roster.js for why).
  // order_token is deliberately never selected: this document gets printed
  // and carried around a public event.
  router.get("/shipping/roster/:collectionId", async (req, res) => {
    try {
      const collectionId = Number(req.params.collectionId)
      if (!Number.isInteger(collectionId) || collectionId <= 0) {
        return res.status(400).json({ error: "invalid_input", message: "collectionId không hợp lệ" })
      }

      const [orderRows] = await db.query(
        `SELECT id, buyer_name, phone, status, payment_method, cod_amount, pickup_code, created_at, prepared
           FROM orders
          WHERE collection_id = ? AND status = 'confirmed' AND fulfillment_method = 'pickup'`,
        [collectionId]
      )

      let itemRows = []
      if (orderRows.length > 0) {
        // Same variant-thumbnail-with-fallback join as orderRepo.attachItems
        // — staff packing at the roster need to see the item, not just its name.
        [itemRows] = await db.query(
          `SELECT oi.order_id, oi.product_name_snapshot, oi.variant_label_snapshot, oi.qty, oi.image_url_snapshot,
                  pv.thumbnail_image AS variant_thumbnail, pv.image_url AS variant_image_url, p.images AS product_images
             FROM order_items oi
             LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
             LEFT JOIN products p ON p.id = pv.product_id
            WHERE oi.order_id IN (?)`,
          [orderRows.map((o) => o.id)]
        )
      }

      const itemsByOrder = new Map()
      for (const { image_url_snapshot, variant_thumbnail, variant_image_url, product_images, ...item } of itemRows) {
        const withImage = { ...item, image_url: image_url_snapshot || variant_thumbnail || variant_image_url || firstImage(product_images) }
        if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, [])
        itemsByOrder.get(item.order_id).push(withImage)
      }
      const withItems = orderRows.map((o) => ({ ...o, items: itemsByOrder.get(o.id) || [] }))

      res.json(buildRoster(withItems))
    } catch (err) { oops(res, err, "Lỗi tạo danh sách nhận hàng") }
  })

  return router
}
