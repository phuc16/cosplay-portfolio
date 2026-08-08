import { describe, it, expect } from "vitest"
import {
  parseOrderCode, parsePastedText, extractPairsFromSheetRows, resolvePreview, MAX_IMPORT_ROWS,
} from "../shop/shipping/trackingImport.js"

describe("parseOrderCode", () => {
  it("parses a well-formed DH-prefixed code", () => {
    expect(parseOrderCode("DH482")).toBe(482)
  })

  it("is case-insensitive on the prefix", () => {
    expect(parseOrderCode("dh482")).toBe(482)
  })

  it("tolerates surrounding whitespace", () => {
    expect(parseOrderCode("  DH482  ")).toBe(482)
  })

  it("returns null for a code with no DH prefix, extra text, or non-numeric id", () => {
    expect(parseOrderCode("482")).toBeNull()
    expect(parseOrderCode("DH482x")).toBeNull()
    expect(parseOrderCode("COD 1")).toBeNull()
    expect(parseOrderCode("")).toBeNull()
    expect(parseOrderCode(null)).toBeNull()
  })
})

describe("parsePastedText", () => {
  it("splits tab-separated lines into order_code/tracking_code pairs", () => {
    const rows = parsePastedText("DH1\tVTP123\nDH2\tVTP456")
    expect(rows).toEqual([
      { order_code: "DH1", tracking_code: "VTP123" },
      { order_code: "DH2", tracking_code: "VTP456" },
    ])
  })

  it("also accepts comma-separated lines", () => {
    expect(parsePastedText("DH1,VTP123")).toEqual([{ order_code: "DH1", tracking_code: "VTP123" }])
  })

  it("skips blank lines", () => {
    expect(parsePastedText("DH1\tVTP123\n\n\nDH2\tVTP456\n")).toHaveLength(2)
  })

  it("returns an empty array for empty or non-string input", () => {
    expect(parsePastedText("")).toEqual([])
    expect(parsePastedText(null)).toEqual([])
    expect(parsePastedText(undefined)).toEqual([])
  })
})

describe("extractPairsFromSheetRows", () => {
  it("finds the order-code and tracking-code columns by header text, regardless of position", () => {
    const rows2D = [
      ["STT", "Mã vận đơn", "Ghi chú", "Mã đơn hàng"],
      [1, "VTP001", "", "DH5"],
      [2, "VTP002", "", "DH6"],
    ]
    expect(extractPairsFromSheetRows(rows2D)).toEqual([
      { order_code: "DH5", tracking_code: "VTP001" },
      { order_code: "DH6", tracking_code: "VTP002" },
    ])
  })

  it("returns an empty array when it cannot find both expected header columns", () => {
    expect(extractPairsFromSheetRows([["A", "B"], [1, 2]])).toEqual([])
  })

  it("returns an empty array for fewer than 2 rows (header only, or empty sheet)", () => {
    expect(extractPairsFromSheetRows([["Mã đơn hàng", "Mã vận đơn"]])).toEqual([])
    expect(extractPairsFromSheetRows([])).toEqual([])
  })

  it("skips a fully blank data row", () => {
    const rows2D = [["Mã đơn hàng", "Mã vận đơn"], [null, null], ["DH1", "VTP1"]]
    expect(extractPairsFromSheetRows(rows2D)).toEqual([{ order_code: "DH1", tracking_code: "VTP1" }])
  })
})

describe("resolvePreview", () => {
  const confirmedOrder = { id: 1, status: "confirmed" }
  const shippedOrder = { id: 2, status: "shipped" }
  const completedOrder = { id: 3, status: "completed" }
  const pendingOrder = { id: 4, status: "pending" }
  const cancelledOrder = { id: 5, status: "cancelled" }

  function byId(...orders) {
    return new Map(orders.map((o) => [o.id, o]))
  }

  it("applies a well-formed row for a confirmed order", () => {
    const { toApply, skipped } = resolvePreview(
      [{ order_code: "DH1", tracking_code: "VTP001" }], byId(confirmedOrder)
    )
    expect(toApply).toEqual([{ order_id: 1, order_code: "DH1", tracking_code: "VTP001" }])
    expect(skipped).toEqual([])
  })

  it("skips an unparsable order code, never guessing a nearby order", () => {
    const { toApply, skipped } = resolvePreview(
      [{ order_code: "not-a-code", tracking_code: "VTP001" }], byId(confirmedOrder)
    )
    expect(toApply).toEqual([])
    expect(skipped).toEqual([{ order_code: "not-a-code", tracking_code: "VTP001", reason: "invalid_code", message: expect.any(String) }])
  })

  it("skips a row with no tracking code", () => {
    const { skipped } = resolvePreview([{ order_code: "DH1", tracking_code: "" }], byId(confirmedOrder))
    expect(skipped[0].reason).toBe("missing_tracking_code")
  })

  it("skips an order code matching no order, never applying it to a nearby order", () => {
    const { toApply, skipped } = resolvePreview(
      [{ order_code: "DH999", tracking_code: "VTP001" }], byId(confirmedOrder)
    )
    expect(toApply).toEqual([])
    expect(skipped[0].reason).toBe("not_found")
  })

  it("skips an already-shipped order distinctly from other non-confirmed statuses", () => {
    const { skipped } = resolvePreview(
      [
        { order_code: "DH2", tracking_code: "VTP001" },
        { order_code: "DH3", tracking_code: "VTP002" },
      ],
      byId(shippedOrder, completedOrder)
    )
    expect(skipped[0].reason).toBe("already_shipped")
    expect(skipped[1].reason).toBe("already_shipped")
  })

  it("skips a pending or cancelled order as not_confirmed", () => {
    const { skipped } = resolvePreview(
      [
        { order_code: "DH4", tracking_code: "VTP001" },
        { order_code: "DH5", tracking_code: "VTP002" },
      ],
      byId(pendingOrder, cancelledOrder)
    )
    expect(skipped[0].reason).toBe("not_confirmed")
    expect(skipped[1].reason).toBe("not_confirmed")
  })

  it("rejects duplicate tracking codes within the same file — neither row is applied", () => {
    const { toApply, skipped } = resolvePreview(
      [
        { order_code: "DH1", tracking_code: "SAME" },
        { order_code: "DH2", tracking_code: "SAME" },
      ],
      byId(confirmedOrder, { id: 2, status: "confirmed" })
    )
    expect(toApply).toEqual([])
    expect(skipped).toHaveLength(2)
    expect(skipped.every((s) => s.reason === "duplicate_tracking_code")).toBe(true)
  })

  it("idempotency: re-running preview against orders already moved to shipped changes nothing", () => {
    // Simulates re-uploading the same file after a successful import: every
    // order is now 'shipped', so every row is skipped as already_shipped,
    // and toApply is empty — a second confirm would send no new emails.
    const rows = [{ order_code: "DH2", tracking_code: "VTP001" }]
    const { toApply, skipped } = resolvePreview(rows, byId(shippedOrder))
    expect(toApply).toEqual([])
    expect(skipped[0].reason).toBe("already_shipped")
  })

  it("processes multiple valid rows independently — one bad row does not affect a good one", () => {
    const { toApply, skipped } = resolvePreview(
      [
        { order_code: "DH1", tracking_code: "VTP001" },
        { order_code: "DHnope", tracking_code: "VTP002" },
      ],
      byId(confirmedOrder)
    )
    expect(toApply).toEqual([{ order_id: 1, order_code: "DH1", tracking_code: "VTP001" }])
    expect(skipped).toHaveLength(1)
  })
})

describe("MAX_IMPORT_ROWS", () => {
  it("is a sane positive bound the route layer enforces", () => {
    expect(MAX_IMPORT_ROWS).toBeGreaterThan(0)
  })
})
