import { describe, it, expect } from "vitest"
import path from "path"
import ExcelJS from "exceljs"

const TEMPLATE_PATH = path.join(
  process.cwd(), "shop", "shipping", "templates", "VTP_mau_excel_don_hang_o.xlsx"
)

describe("the bundled VTP template", () => {
  it("loads without error from its repo path", async () => {
    const wb = new ExcelJS.Workbook()
    await expect(wb.xlsx.readFile(TEMPLATE_PATH)).resolves.not.toThrow()
  })

  it("has the 'Danh sách' data sheet", async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(TEMPLATE_PATH)
    expect(wb.getWorksheet("Danh sách")).toBeDefined()
  })

  it("has the expected header row 7 and mandatory-column headers", async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(TEMPLATE_PATH)
    const sheet = wb.getWorksheet("Danh sách")
    const header = sheet.getRow(7)

    const extractText = (cell) => {
      const val = cell.value
      if (val?.richText) {
        return val.richText.map(rt => rt.text).join("")
      }
      return String(val)
    }

    expect(extractText(header.getCell("C"))).toContain("Tên người nhận")
    expect(extractText(header.getCell("D"))).toContain("Số ĐT")
    expect(extractText(header.getCell("E"))).toContain("Địa chỉ nhận")
    expect(extractText(header.getCell("M"))).toContain("Dịch vụ")
  })

  it("has the four reference sheets the spec names", async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(TEMPLATE_PATH)
    for (const name of ["Dịch vụ", "Loai hang hoa", "Thời gian hẹn lấy", "Tinh chat hang hoa"]) {
      expect(wb.getWorksheet(name), `missing sheet "${name}"`).toBeDefined()
    }
  })
})
