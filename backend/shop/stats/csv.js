/**
 * Escape one CSV field per RFC 4180: wrap in quotes and double any embedded
 * quote whenever the value contains a comma, quote, or newline.
 */
function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCsvRow(values) {
  return values.map(csvEscape).join(",")
}

/**
 * `headers` and `rows` are arrays of arrays. A leading UTF-8 BOM is
 * prepended so Excel on Windows renders Vietnamese diacritics correctly
 * instead of guessing the wrong codepage.
 */
function toCsv(headers, rows) {
  const lines = [toCsvRow(headers), ...rows.map(toCsvRow)]
  return "﻿" + lines.join("\r\n")
}

/**
 * Serialize a bookkeeping-view result (see statsRepo.getBookkeepingStats)
 * into the exact CSV the admin downloads - built server-side, so the export
 * is guaranteed identical to what the screen displayed.
 */
function bookkeepingToCsv(stats) {
  const headers = ["Bộ sưu tập", "Đã nhận", "Chờ thanh toán", "Thu khi giao", "Đã mất", "Đơn COD chưa xác nhận"]
  const rows = stats.by_collection.map((c) => [
    c.collection_title, c.received_total, c.awaiting_payment, c.to_collect, c.lost, c.pending_cod,
  ])
  rows.push([
    "Tổng cộng", stats.received_total, stats.awaiting_payment, stats.to_collect, stats.lost, stats.pending_cod,
  ])
  return toCsv(headers, rows)
}

/**
 * Serialize a single collection's drop-stats view (see
 * statsRepo.getDropStats) into its per-variant CSV - the same table
 * rendered on screen, one row per variant.
 */
function dropStatsToCsv(stats) {
  const headers = ["Sản phẩm", "Phân loại", "Đã bán", "Còn lại", "Tỷ lệ bán hết", "Thời gian bán hết (ngày)"]
  const rows = stats.variants.map((v) => [
    v.product_name,
    v.variant_label,
    v.sold,
    v.deleted ? "" : v.unlimited ? "không giới hạn" : v.remaining,
    v.deleted || v.unlimited ? "" : v.sell_through === null ? "" : Math.round(v.sell_through * 1000) / 10,
    v.time_to_sellout_days === null ? "" : Math.ceil(v.time_to_sellout_days),
  ])
  return toCsv(headers, rows)
}

/**
 * Serialize the restock-stats view (see statsRepo.getRestockStats) into
 * the same velocity-ranked per-variant CSV shown on screen.
 */
function restockStatsToCsv(rows) {
  const headers = [
    "Bộ sưu tập", "Sản phẩm", "Phân loại", "Đã bán", "Còn lại",
    "Vận tốc (đơn vị/ngày)", "Tỷ lệ bán hết", "Thời gian bán hết (ngày)",
  ]
  const csvRows = rows.map((v) => [
    v.collection_title,
    v.product_name,
    v.label,
    v.sold,
    v.unlimited ? "không giới hạn" : v.remaining,
    Math.round(v.velocity * 100) / 100,
    v.unlimited || v.sell_through === null ? "" : Math.round(v.sell_through * 1000) / 10,
    v.time_to_sellout_days === null ? "" : Math.ceil(v.time_to_sellout_days),
  ])
  return toCsv(headers, csvRows)
}

module.exports = { csvEscape, toCsvRow, toCsv, bookkeepingToCsv, dropStatsToCsv, restockStatsToCsv }
