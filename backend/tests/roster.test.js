import { describe, it, expect } from "vitest"
import { buildRoster } from "../shop/shipping/roster.js"
import { formatOrderCode } from "../shop/orders/domain.js"

function order(over = {}) {
  return {
    id: 1, buyer_name: "Nguyễn An", phone: "0901111111",
    payment_method: "bank", cod_amount: null, created_at: "2026-01-01T00:00:00.000Z",
    items: [{ product_name_snapshot: "Photocard", variant_label_snapshot: "A1", qty: 2 }],
    ...over,
  }
}

describe("buildRoster - completed orders never show money owing", () => {
  // A completed pickup order was handed over at the booth, and for COD that
  // means the buyer already paid then. Printing it as owing money would have
  // the seller charge them a second time. The route also filters to
  // confirmed, but this guard is what makes the printed page safe on its own.
  it("treats a completed COD order as paid with nothing to collect", () => {
    const { rows } = buildRoster([order({ payment_method: "cod", cod_amount: 50000, status: "completed" })])
    expect(rows[0].paid).toBe(true)
    expect(rows[0].amount_due).toBe(0)
  })

  it("still shows the amount to collect for a confirmed COD order", () => {
    const { rows } = buildRoster([order({ payment_method: "cod", cod_amount: 50000, status: "confirmed" })])
    expect(rows[0].paid).toBe(false)
    expect(rows[0].amount_due).toBe(50000)
  })

  it("leaves prepaid orders paid at both confirmed and completed", () => {
    for (const status of ["confirmed", "completed"]) {
      const { rows } = buildRoster([order({ payment_method: "bank", status })])
      expect(rows[0].paid).toBe(true)
      expect(rows[0].amount_due).toBe(0)
    }
  })

  it("stops excluding a completed COD order whose cod_amount is null, since nothing is left to collect", () => {
    const { rows, excluded } = buildRoster([order({ id: 9, payment_method: "cod", cod_amount: null, status: "completed" })])
    expect(excluded).toEqual([])
    expect(rows[0].paid).toBe(true)
    expect(rows[0].amount_due).toBe(0)
  })
})

describe("buildRoster - paid vs collect-at-handover", () => {
  it("marks a prepaid order as paid with amount_due 0", () => {
    const { rows } = buildRoster([order({ payment_method: "momo" })])
    expect(rows[0].paid).toBe(true)
    expect(rows[0].amount_due).toBe(0)
  })

  it("marks a COD order as not paid with amount_due equal to cod_amount", () => {
    const { rows } = buildRoster([order({ payment_method: "cod", cod_amount: 75000 })])
    expect(rows[0].paid).toBe(false)
    expect(rows[0].amount_due).toBe(75000)
  })

  it("excludes a COD order with a null cod_amount, never showing 'collect ₫0'", () => {
    const { rows, excluded } = buildRoster([order({ id: 7, payment_method: "cod", cod_amount: null })])
    expect(rows).toEqual([])
    expect(excluded).toEqual([{
      order_id: 7, reason: "cod_missing_amount",
      message: expect.stringContaining(formatOrderCode(7, "2026-01-01T00:00:00.000Z")),
    }])
  })
})

describe("buildRoster - items", () => {
  it("maps each order's item snapshots to product_name/variant_label/qty/image_url/delivery_link", () => {
    const { rows } = buildRoster([order({
      items: [
        { product_name_snapshot: "Photocard", variant_label_snapshot: "A1", qty: 2, image_url: "/api/storage/shop/a.webp" },
        { product_name_snapshot: "Poster", variant_label_snapshot: "Std", qty: 1 },
      ],
    })])
    expect(rows[0].items).toEqual([
      { product_name: "Photocard", variant_label: "A1", qty: 2, image_url: "/api/storage/shop/a.webp", delivery_link: null },
      { product_name: "Poster", variant_label: "Std", qty: 1, image_url: null, delivery_link: null },
    ])
  })

  it("surfaces a digital item's delivery_link, so it isn't invisible on a mostly-physical pickup order", () => {
    const { rows } = buildRoster([order({
      items: [
        { product_name_snapshot: "Digital Bonus", variant_label_snapshot: "", qty: 1, delivery_link_snapshot: "https://drive.google.com/x" },
      ],
    })])
    expect(rows[0].items[0].delivery_link).toBe("https://drive.google.com/x")
  })

  it("flags has_digital_item on the row when any item has a delivery link, same cue the export queue and orders list show", () => {
    const withDigital = buildRoster([order({
      items: [
        { product_name_snapshot: "Card", variant_label_snapshot: "A1", qty: 1 },
        { product_name_snapshot: "Digital Bonus", variant_label_snapshot: "", qty: 1, delivery_link_snapshot: "https://drive.google.com/x" },
      ],
    })])
    expect(withDigital.rows[0].has_digital_item).toBe(true)

    const withoutDigital = buildRoster([order({
      items: [{ product_name_snapshot: "Card", variant_label_snapshot: "A1", qty: 1 }],
    })])
    expect(withoutDigital.rows[0].has_digital_item).toBe(false)
  })

  it("gives every row the same buyer-facing order_code shown elsewhere in admin", () => {
    const { rows } = buildRoster([order({ id: 42, created_at: "2026-02-03T00:00:00.000Z" })])
    expect(rows[0].order_code).toBe(formatOrderCode(42, "2026-02-03T00:00:00.000Z"))
  })
})

describe("buildRoster - sorting", () => {
  it("sorts rows by buyer_name ascending, Vietnamese-locale aware", () => {
    const { rows } = buildRoster([
      order({ id: 1, buyer_name: "Trần Văn B" }),
      order({ id: 2, buyer_name: "Ánh Dương" }),
      order({ id: 3, buyer_name: "Bùi Thị C" }),
    ])
    expect(rows.map((r) => r.buyer_name)).toEqual(["Ánh Dương", "Bùi Thị C", "Trần Văn B"])
  })
})

describe("buildRoster - pickup_code", () => {
  it("includes pickup_code on every row", () => {
    const { rows } = buildRoster([order({ pickup_code: "482913" })])
    expect(rows[0].pickup_code).toBe("482913")
  })
})

describe("buildRoster - prepared", () => {
  it("includes prepared, coerced to a boolean, on every row", () => {
    const { rows } = buildRoster([order({ id: 1, prepared: 1 }), order({ id: 2, prepared: 0 })])
    expect(rows.map((r) => r.prepared)).toEqual([true, false])
  })

  it("defaults prepared to false when the column is absent", () => {
    const { rows } = buildRoster([order()])
    expect(rows[0].prepared).toBe(false)
  })
})

describe("buildRoster - empty input", () => {
  it("returns empty rows and excluded for no orders", () => {
    expect(buildRoster([])).toEqual({ rows: [], excluded: [] })
  })
})
