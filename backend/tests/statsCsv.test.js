import { describe, it, expect } from "vitest"
import { csvEscape, toCsvRow, toCsv, bookkeepingToCsv, dropStatsToCsv, restockStatsToCsv } from "../shop/stats/csv.js"

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
    received_total: 100000, awaiting_payment: 20000, to_collect: 30000, lost: 5000, pending_cod: 15000,
    by_collection: [
      { collection_id: 1, collection_title: "Drop, mùa hè", received_total: 100000, awaiting_payment: 20000, to_collect: 30000, lost: 5000, pending_cod: 15000 },
    ],
  }

  it("includes a header row, one row per collection, and a total row", () => {
    const out = bookkeepingToCsv(stats)
    const lines = out.replace("﻿", "").split("\r\n")
    expect(lines[0]).toBe("Bộ sưu tập,Đã nhận,Chờ thanh toán,Thu khi giao,Đã mất,Đơn COD chưa xác nhận")
    expect(lines[1]).toBe('"Drop, mùa hè",100000,20000,30000,5000,15000')
    expect(lines[2]).toBe("Tổng cộng,100000,20000,30000,5000,15000")
  })
})

describe("dropStatsToCsv", () => {
  const stats = {
    collection_id: 1,
    collection_title: "Drop",
    variants: [
      { variant_id: 1, product_name: "Card", variant_label: "A1", sold: 3, deleted: false, unlimited: false, remaining: 7, sell_through: 0.3, time_to_sellout_days: null },
      { variant_id: 2, product_name: "Card", variant_label: "A2", sold: 10, deleted: false, unlimited: false, remaining: 0, sell_through: 1, time_to_sellout_days: 2.4 },
      { variant_id: null, product_name: "Card", variant_label: "A3 (đã xóa)", sold: 1, deleted: true, unlimited: false, remaining: null, sell_through: null, time_to_sellout_days: null },
      { variant_id: 4, product_name: "Card", variant_label: "A4", sold: 5, deleted: false, unlimited: true, remaining: null, sell_through: null, time_to_sellout_days: null },
    ],
  }

  it("includes a header row and one row per variant", () => {
    const out = dropStatsToCsv(stats)
    const lines = out.replace("﻿", "").split("\r\n")
    expect(lines[0]).toBe("Sản phẩm,Phân loại,Đã bán,Còn lại,Tỷ lệ bán hết,Thời gian bán hết (ngày)")
    expect(lines[1]).toBe("Card,A1,3,7,30,")
    expect(lines[2]).toBe("Card,A2,10,0,100,3")
  })

  it("leaves remaining/sell-through blank for a deleted variant", () => {
    const out = dropStatsToCsv(stats)
    const lines = out.replace("﻿", "").split("\r\n")
    expect(lines[3]).toBe("Card,A3 (đã xóa),1,,,")
  })

  it("shows 'không giới hạn' remaining and no sell-through for an unlimited variant", () => {
    const out = dropStatsToCsv(stats)
    const lines = out.replace("﻿", "").split("\r\n")
    expect(lines[4]).toBe("Card,A4,5,không giới hạn,,")
  })
})

describe("restockStatsToCsv", () => {
  const rows = [
    { variant_id: 1, collection_title: "Drop, mùa hè", product_name: "Card", label: "A1", sold: 5, unlimited: false, remaining: 5, velocity: 1.23456, sell_through: 0.5, time_to_sellout_days: null },
    { variant_id: 2, collection_title: "Drop 2", product_name: "Poster", label: "B1", sold: 2, unlimited: true, remaining: null, velocity: 2, sell_through: null, time_to_sellout_days: null },
  ]

  it("includes a header row and one row per variant, sorted as given", () => {
    const out = restockStatsToCsv(rows)
    const lines = out.replace("﻿", "").split("\r\n")
    expect(lines[0]).toBe("Bộ sưu tập,Sản phẩm,Phân loại,Đã bán,Còn lại,Vận tốc (đơn vị/ngày),Tỷ lệ bán hết,Thời gian bán hết (ngày)")
    expect(lines[1]).toBe('"Drop, mùa hè",Card,A1,5,5,1.23,50,')
  })

  it("shows 'không giới hạn' and no sell-through for an unlimited variant", () => {
    const out = restockStatsToCsv(rows)
    const lines = out.replace("﻿", "").split("\r\n")
    expect(lines[2]).toBe("Drop 2,Poster,B1,2,không giới hạn,2,,")
  })
})
