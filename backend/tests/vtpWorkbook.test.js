import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { buildExportWorkbook, DATA_SHEET_NAME, DATA_START_ROW } from "../shop/shipping/vtpWorkbook.js"
import { formatOrderCode } from "../shop/orders/domain.js"

const CREATED_AT = "2026-08-14T00:00:00Z"

function order(over = {}) {
  return {
    id: 1, created_at: CREATED_AT, buyer_name: "Nguyễn Thị Bích", phone: "0901234567",
    address_street: "12 Lý Tự Trọng", address_ward: "Bến Nghé",
    address_district: "Quận 1", address_province: "Hồ Chí Minh", address_raw: null,
    total: 120000, payment_method: "bank", cod_amount: null,
    shipping_payer: "buyer", order_token: "bearer-token-must-never-leak",
    ...over,
  }
}

const batch = {
  ten_hang_hoa: "Photocard", trong_luong: 50, loai_hang_hoa: "Bưu kiện", thoi_gian_hen_lay: "Cả ngày",
}

// An .xlsx is a deflated zip of XML parts - cell text never appears as
// plaintext in the raw buffer, whether it landed in a cell, a shared
// string, or anywhere else. A raw buffer/string scan for a canary can
// never fail, even if the canary was actually written into a cell, so it
// proves nothing. Decoding through exceljs and walking every cell of every
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

describe("buildExportWorkbook", () => {
  it("produces a buffer that reopens as a valid workbook with the Danh sách sheet", async () => {
    const { buffer } = await buildExportWorkbook([order()], batch)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    expect(wb.getWorksheet(DATA_SHEET_NAME)).toBeDefined()
  })

  it("writes the first order starting at row 8, with STT 1", async () => {
    const { buffer, exported } = await buildExportWorkbook([order()], batch)
    expect(exported).toEqual([{ order_id: 1, row_index: DATA_START_ROW }])

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const sheet = wb.getWorksheet(DATA_SHEET_NAME)
    const row = sheet.getRow(DATA_START_ROW)
    expect(row.getCell("A").value).toBe(1)
    expect(row.getCell("B").value).toBe(formatOrderCode(1, CREATED_AT))
    expect(row.getCell("C").value).toBe("Nguyễn Thị Bích")
  })

  it("fills every mandatory column: C, D, E, F, H, I, K, M for each row", async () => {
    const { buffer } = await buildExportWorkbook([order()], batch)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const row = wb.getWorksheet(DATA_SHEET_NAME).getRow(DATA_START_ROW)
    for (const col of ["C", "D", "E", "F", "H", "I", "K", "M"]) {
      expect(row.getCell(col).value, `column ${col} is empty`).not.toBeNull()
      expect(row.getCell(col).value, `column ${col} is empty`).not.toBe("")
    }
  })

  it("fills batch-level columns F, H, K, U identically for every row, and G as 1 per row", async () => {
    const { buffer } = await buildExportWorkbook([order({ id: 1 }), order({ id: 2 })], batch)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const sheet = wb.getWorksheet(DATA_SHEET_NAME)
    for (const rowIdx of [DATA_START_ROW, DATA_START_ROW + 1]) {
      const row = sheet.getRow(rowIdx)
      expect(row.getCell("F").value).toBe("Photocard")
      expect(row.getCell("H").value).toBe(50)
      expect(row.getCell("K").value).toBe("Bưu kiện")
      expect(row.getCell("U").value).toBe("Cả ngày")
      expect(row.getCell("G").value).toBe(1)
    }
  })

  it("leaves column J blank for a prepaid order and fills it for a COD order", async () => {
    const { buffer } = await buildExportWorkbook(
      [order({ id: 1, payment_method: "bank" }), order({ id: 2, payment_method: "cod", cod_amount: 99000 })],
      batch
    )
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const sheet = wb.getWorksheet(DATA_SHEET_NAME)
    expect(sheet.getRow(DATA_START_ROW).getCell("J").value).toBeNull()
    expect(sheet.getRow(DATA_START_ROW + 1).getCell("J").value).toBe(99000)
  })

  it("excludes an order with no address and reports it, writing nothing for it", async () => {
    const bad = order({
      id: 9, address_street: null, address_ward: null, address_district: null,
      address_province: null, address_raw: null,
    })
    const { buffer, exported, excluded } = await buildExportWorkbook([bad], batch)
    expect(exported).toEqual([])
    expect(excluded).toEqual([{ order_id: 9, reason: "no_address", message: expect.stringContaining(formatOrderCode(9, CREATED_AT)) }])

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const row = wb.getWorksheet(DATA_SHEET_NAME).getRow(DATA_START_ROW)
    expect(row.getCell("B").value).toBeNull()
  })

  it("continues past an excluded order to write the next good one starting at row 8", async () => {
    const bad = order({ id: 9, address_street: null, address_ward: null, address_district: null, address_province: null, address_raw: null })
    const good = order({ id: 10 })
    const { exported, excluded } = await buildExportWorkbook([bad, good], batch)
    expect(excluded).toHaveLength(1)
    expect(exported).toEqual([{ order_id: 10, row_index: DATA_START_ROW }])
  })

  it("survives Vietnamese diacritics in buyer name and address round-tripping through xlsx", async () => {
    const { buffer } = await buildExportWorkbook(
      [order({ buyer_name: "Đặng Thị Ngọc Ánh", address_street: "45 Đường Điện Biên Phủ" })],
      batch
    )
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const row = wb.getWorksheet(DATA_SHEET_NAME).getRow(DATA_START_ROW)
    expect(row.getCell("C").value).toBe("Đặng Thị Ngọc Ánh")
    expect(String(row.getCell("E").value)).toContain("Đường Điện Biên Phủ")
  })

  it("clears the template's pre-filled STT rows below the last written row (row after last write, and row 1045)", async () => {
    const { buffer, exported } = await buildExportWorkbook([order({ id: 1 })], batch)
    expect(exported).toEqual([{ order_id: 1, row_index: DATA_START_ROW }])

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const sheet = wb.getWorksheet(DATA_SHEET_NAME)

    const nextRow = sheet.getRow(DATA_START_ROW + 1)
    nextRow.eachCell({ includeEmpty: true }, (cell) => {
      expect(cell.value, `row ${nextRow.number} col ${cell.col} should be empty`).toBeNull()
    })

    const farRow = sheet.getRow(1045)
    farRow.eachCell({ includeEmpty: true }, (cell) => {
      expect(cell.value, `row ${farRow.number} col ${cell.col} should be empty`).toBeNull()
    })
  })

  it("leaves the header block (rows 1-7) and the reference sheets untouched", async () => {
    const wbBefore = await (async () => {
      const w = new ExcelJS.Workbook()
      await w.xlsx.readFile(new URL("../shop/shipping/templates/VTP_mau_excel_don_hang_o.xlsx", import.meta.url).pathname)
      return w
    })()
    const sheetBefore = wbBefore.getWorksheet(DATA_SHEET_NAME)

    const { buffer } = await buildExportWorkbook([order()], batch)
    const wbAfter = new ExcelJS.Workbook()
    await wbAfter.xlsx.load(buffer)
    const sheetAfter = wbAfter.getWorksheet(DATA_SHEET_NAME)

    for (let r = 1; r <= 7; r += 1) {
      const before = sheetBefore.getRow(r)
      const after = sheetAfter.getRow(r)
      before.eachCell({ includeEmpty: true }, (cell) => {
        expect(after.getCell(cell.col).value).toEqual(cell.value)
      })
    }

    for (const name of ["Dịch vụ", "Loai hang hoa", "Thời gian hẹn lấy", "Tinh chat hang hoa"]) {
      expect(wbAfter.getWorksheet(name), `reference sheet ${name} missing`).toBeDefined()
    }
  })

  it("SECURITY: order_token never appears in any cell of any worksheet", async () => {
    const secretToken = "extremely-unique-bearer-token-xyz987"
    const { buffer } = await buildExportWorkbook([order({ order_token: secretToken })], batch)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    // Decode and walk every cell of every worksheet (data sheet + reference
    // sheets) rather than scanning the raw compressed bytes - see the
    // comment above workbookText().
    expect(workbookText(wb)).not.toContain(secretToken)
  })
})
