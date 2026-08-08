import { describe, it, expect } from "vitest"
import { csvEscape, toCsvRow, toCsv, bookkeepingToCsv } from "../shop/stats/csv.js"

describe("csvEscape", () => {
  it("leaves a plain value unquoted", () => {
    expect(csvEscape("Photocard")).toBe("Photocard")
    expect(csvEscape(35000)).toBe("35000")
  })

  it("quotes a value containing a comma", () => {
    expect(csvEscape("Card, deluxe")).toBe('"Card, deluxe"')
  })

  it("quotes and doubles an embedded quote", () => {
    expect(csvEscape('Say "hi"')).toBe('"Say ""hi"""')
  })

  it("quotes a value containing a newline", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"')
  })

  it("renders null and undefined as an empty field", () => {
    expect(csvEscape(null)).toBe("")
    expect(csvEscape(undefined)).toBe("")
  })

  it("survives Vietnamese diacritics unescaped when there is nothing else to escape", () => {
    expect(csvEscape("Bộ sưu tập Hè")).toBe("Bộ sưu tập Hè")
  })
})

describe("toCsv", () => {
  it("joins headers and rows with CRLF and a leading BOM", () => {
    const out = toCsv(["Tên", "Giá"], [["Thẻ, ảnh", 35000]])
    expect(out.startsWith("﻿")).toBe(true)
    expect(out).toContain("Tên,Giá\r\n")
    expect(out).toContain('"Thẻ, ảnh",35000')
  })

  it("round-trips a name with a comma, a quote, and diacritics intact", () => {
    const out = toCsv(["Tên"], [['Sản phẩm "đặc biệt", giới hạn']])
    const body = out.replace("﻿", "")
    const [, dataLine] = body.split("\r\n")
    // A naive CSV parse of the quoted field must recover the exact original.
    const unquoted = dataLine.slice(1, -1).replace(/""/g, '"')
    expect(unquoted).toBe('Sản phẩm "đặc biệt", giới hạn')
  })
})

describe("bookkeepingToCsv", () => {
  const stats = {
    received_total: 100000, awaiting_payment: 20000, to_collect: 30000, lost: 5000,
    by_collection: [
      { collection_id: 1, collection_title: "Drop, mùa hè", received_total: 100000, awaiting_payment: 20000, to_collect: 30000, lost: 5000 },
    ],
  }

  it("includes a header row, one row per collection, and a total row", () => {
    const out = bookkeepingToCsv(stats)
    const lines = out.replace("﻿", "").split("\r\n")
    expect(lines[0]).toBe("Bộ sưu tập,Đã nhận,Chờ thanh toán,Thu khi giao,Đã mất")
    expect(lines[1]).toBe('"Drop, mùa hè",100000,20000,30000,5000')
    expect(lines[2]).toBe("Tổng cộng,100000,20000,30000,5000")
  })
})
