const path = require("path")
const ExcelJS = require("exceljs")
const { mapOrderToRow } = require("./vtpMapping")

const TEMPLATE_PATH = path.join(__dirname, "templates", "VTP_mau_excel_don_hang_o.xlsx")
const DATA_SHEET_NAME = "Danh sách"
const DATA_START_ROW = 8

async function loadTemplateWorkbook() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(TEMPLATE_PATH)
  return wb
}

/**
 * Fill the bundled VTP template from row 8 with one row per exportable
 * order. Column G (Số lượng) is fixed at 1 — one parcel per order row, not
 * a batch-level input (see this plan's Global Constraints); F, H, K, U are
 * entered once and repeated for every row, matching the seller's existing
 * script's interactive prompts. Data validation on the template's dropdown
 * columns is not preserved by this write path — openpyxl already drops it
 * in the seller's current script and that output imports successfully
 * today, so ViettelPost validates server-side regardless.
 */
async function buildExportWorkbook(orders, batch) {
  const wb = await loadTemplateWorkbook()
  const sheet = wb.getWorksheet(DATA_SHEET_NAME)
  if (!sheet) throw new Error(`Template thiếu sheet "${DATA_SHEET_NAME}"`)

  // The pristine template ships ViettelPost's own example order in row 8
  // (buyer name, phone, address, etc.) AND a pre-filled sequential STT
  // (column A only) running all the way down to the sheet's last used row.
  // A one-order export that clears only row 8 would ship ~1,037 rows
  // carrying nothing but a stray number in column A — unlike the seller's
  // proven-working script, which clears every column of every row from
  // DATA_START_ROW down before filling. Match that behaviour here so we
  // never diverge from what is known to import successfully.
  const lastDataRow = sheet.lastRow ? sheet.lastRow.number : DATA_START_ROW
  const lastDataColumn = sheet.columnCount || 1
  for (let r = DATA_START_ROW; r <= lastDataRow; r += 1) {
    const row = sheet.getRow(r)
    for (let c = 1; c <= lastDataColumn; c += 1) {
      row.getCell(c).value = null
    }
    row.commit()
  }

  const exported = []
  const excluded = []
  let stt = 1
  let rowIdx = DATA_START_ROW

  for (const order of orders) {
    const mapped = mapOrderToRow(order)
    if (!mapped.ok) {
      excluded.push({ order_id: mapped.order_id, reason: mapped.reason, message: mapped.message })
      continue
    }

    const row = sheet.getRow(rowIdx)
    row.getCell("A").value = stt
    row.getCell("B").value = mapped.row.B
    row.getCell("C").value = mapped.row.C
    row.getCell("D").value = mapped.row.D
    row.getCell("E").value = mapped.row.E
    row.getCell("F").value = batch.ten_hang_hoa
    row.getCell("G").value = 1
    row.getCell("H").value = batch.trong_luong
    row.getCell("I").value = mapped.row.I
    row.getCell("J").value = mapped.row.J
    row.getCell("K").value = batch.loai_hang_hoa
    row.getCell("M").value = mapped.row.M
    row.getCell("S").value = mapped.row.S
    row.getCell("U").value = batch.thoi_gian_hen_lay
    row.commit()

    exported.push({ order_id: mapped.order_id, row_index: rowIdx })
    stt += 1
    rowIdx += 1
  }

  const buffer = await wb.xlsx.writeBuffer()
  return { buffer, exported, excluded }
}

module.exports = { TEMPLATE_PATH, DATA_SHEET_NAME, DATA_START_ROW, loadTemplateWorkbook, buildExportWorkbook }
