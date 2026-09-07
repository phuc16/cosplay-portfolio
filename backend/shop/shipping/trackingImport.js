const MAX_IMPORT_ROWS = 200

// Matches domain.formatOrderCode's shape (YYMMDD + 8-char hash suffix)
const ORDER_CODE_RE = /^\d{6}[0-9A-Z]{8}$/

function parseOrderCode(raw) {
  if (typeof raw !== "string") return null
  const normalized = raw.trim().toUpperCase()
  return ORDER_CODE_RE.test(normalized) ? normalized : null
}

function parsePastedText(text) {
  if (typeof text !== "string") return []
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [orderCode = "", trackingCode = ""] = line.split(/\t|,/).map((p) => p.trim())
      return { order_code: orderCode, tracking_code: trackingCode }
    })
}

/**
 * `rows2D` is a raw 2D array read from an uploaded VTP result sheet - the
 * route layer does the exceljs reading, this function stays pure. Finds the
 * order-code and tracking-code columns by matching header text rather than
 * a fixed position, so a result file with reordered or renamed-but-similar
 * columns still resolves correctly. The header row itself is also found by
 * scanning, not assumed to be row 0 - VTP's own "Danh sách vận đơn" export
 * has several rows of company letterhead/title block above its real header.
 */
function extractPairsFromSheetRows(rows2D) {
  if (!Array.isArray(rows2D)) return []
  const headerRowIndex = rows2D.findIndex((row) => {
    const header = row.map((h) => String(h || "").toLowerCase())
    return header.some((h) => h.includes("đơn hàng") || h.includes("don hang"))
      && header.some((h) => h.includes("vận đơn") || h.includes("van don"))
  })
  if (headerRowIndex === -1) return []

  const header = rows2D[headerRowIndex].map((h) => String(h || "").toLowerCase())
  const orderCodeCol = header.findIndex((h) => h.includes("đơn hàng") || h.includes("don hang"))
  const trackingCol = header.findIndex((h) => h.includes("vận đơn") || h.includes("van don"))

  return rows2D
    .slice(headerRowIndex + 1)
    .filter((row) => (row[orderCodeCol] ?? "") !== "" || (row[trackingCol] ?? "") !== "")
    .map((row) => ({
      order_code: String(row[orderCodeCol] ?? "").trim(),
      tracking_code: String(row[trackingCol] ?? "").trim(),
    }))
}

/**
 * Resolve a batch of {order_code, tracking_code} pairs against already-
 * fetched order rows, WITHOUT writing anything - this is the preview step
 * the spec requires before any order is touched.
 *
 * Four properties this function guarantees, per the spec's Tracking-Code
 * Round Trip section:
 *  - Idempotent: an order already 'shipped'/'completed' is reported
 *    already_shipped and excluded from toApply, so re-running preview after
 *    a successful import (e.g. after a timeout-induced re-upload) yields an
 *    empty toApply and changes nothing.
 *  - Per-row isolation: one bad row (unparsable code, unmatched code,
 *    wrong status) never removes a good row from toApply.
 *  - Never guesses a match: an order code that resolves to no known order
 *    (not_found) or fails to parse (invalid_code) is reported, never
 *    applied to the nearest order.
 *  - Duplicate tracking codes within one file are rejected outright - ALL
 *    rows sharing a duplicated tracking code are skipped, since which one
 *    is correct cannot be determined.
 *  - Duplicate order codes within one file are rejected the same way - ALL
 *    rows sharing a duplicated order code are skipped, since which tracking
 *    code actually belongs to that order cannot be determined (a seller
 *    pasting overlapping ranges, or duplicating a row while editing, must
 *    never result in silent last-wins on a field the buyer gets emailed).
 *  - A pickup order is skipped as not_shippable, never toApply: confirm
 *    would then reject it via canTransition(confirmed, shipped, "pickup")
 *    and report "không còn ở trạng thái confirmed" about an order that IS
 *    confirmed - factually wrong, since the real reason is that it is a
 *    pickup order that was never meant to get a tracking code. `order`
 *    comes from orderRepo.getOrderById()'s `SELECT *`, so fulfillment_method
 *    is already present without any extra plumbing.
 */
function resolvePreview(rows, ordersByCode) {
  const trackingCodeCounts = new Map()
  for (const r of rows) {
    if (!r.tracking_code) continue
    trackingCodeCounts.set(r.tracking_code, (trackingCodeCounts.get(r.tracking_code) || 0) + 1)
  }

  const orderCodeCounts = new Map()
  for (const r of rows) {
    const code = parseOrderCode(r.order_code)
    if (code === null) continue
    orderCodeCounts.set(code, (orderCodeCounts.get(code) || 0) + 1)
  }

  const toApply = []
  const skipped = []

  for (const r of rows) {
    const code = parseOrderCode(r.order_code)
    if (code === null) {
      skipped.push({
        order_code: r.order_code, tracking_code: r.tracking_code,
        reason: "invalid_code", message: `Mã đơn "${r.order_code}" không hợp lệ`,
      })
      continue
    }
    if (!r.tracking_code) {
      skipped.push({
        order_code: r.order_code, tracking_code: r.tracking_code,
        reason: "missing_tracking_code", message: `${r.order_code}: thiếu mã vận đơn`,
      })
      continue
    }
    if (trackingCodeCounts.get(r.tracking_code) > 1) {
      skipped.push({
        order_code: r.order_code, tracking_code: r.tracking_code,
        reason: "duplicate_tracking_code",
        message: `Mã vận đơn "${r.tracking_code}" xuất hiện nhiều lần trong file, không rõ áp dụng cho đơn nào`,
      })
      continue
    }
    if (orderCodeCounts.get(code) > 1) {
      skipped.push({
        order_code: r.order_code, tracking_code: r.tracking_code,
        reason: "duplicate_order_code",
        message: `Đơn ${r.order_code} xuất hiện nhiều lần trong file, không rõ mã vận đơn nào là đúng`,
      })
      continue
    }

    const order = ordersByCode.get(code)
    if (!order) {
      skipped.push({
        order_code: r.order_code, tracking_code: r.tracking_code,
        reason: "not_found", message: `Không tìm thấy đơn ${r.order_code}`,
      })
      continue
    }
    if (order.fulfillment_method !== "ship") {
      skipped.push({
        order_code: r.order_code, tracking_code: r.tracking_code,
        reason: "not_shippable",
        message: `Đơn ${r.order_code} là đơn nhận tại chỗ (pickup), không áp dụng mã vận đơn`,
      })
      continue
    }
    if (order.status === "shipped" || order.status === "completed") {
      skipped.push({
        order_code: r.order_code, tracking_code: r.tracking_code,
        reason: "already_shipped",
        message: `Đơn ${r.order_code} đã ở trạng thái "${order.status}", bỏ qua`,
      })
      continue
    }
    if (order.status !== "confirmed") {
      skipped.push({
        order_code: r.order_code, tracking_code: r.tracking_code,
        reason: "not_confirmed",
        message: `Đơn ${r.order_code} đang ở trạng thái "${order.status}", không thể nhập mã vận đơn`,
      })
      continue
    }

    toApply.push({ order_id: order.id, order_code: r.order_code, tracking_code: r.tracking_code })
  }

  return { toApply, skipped }
}

module.exports = { MAX_IMPORT_ROWS, parseOrderCode, parsePastedText, extractPairsFromSheetRows, resolvePreview }
