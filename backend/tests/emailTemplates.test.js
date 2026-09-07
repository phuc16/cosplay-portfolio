import { describe, it, expect } from "vitest"
import t from "../shop/email/templates.js"

const order = {
  id: 12, order_token: "abcd1234efgh", buyer_name: "Nguyễn Văn A", total: 105000,
  status: "pending", payment_method: "bank", fulfillment_method: "ship",
  tracking_code: null, created_at: "2026-08-14T12:00:00Z",
  items: [
    { product_name_snapshot: "Photocard", variant_label_snapshot: "A1", qty: 2, unit_price_snapshot: 35000 },
    { product_name_snapshot: "Poster", variant_label_snapshot: "Std", qty: 1, unit_price_snapshot: 35000 },
  ],
}

describe("renderTemplate", () => {
  it("substitutes placeholders", () => {
    const out = t.renderTemplate(
      { subject: "Đơn {{order_id}}", body_html: "<p>Chào {{buyer_name}}</p>" },
      t.buildVars(order)
    )
    // Date fixed at 2026-08-14 regardless of local TZ; suffix is a fixed hash of id 12.
    expect(out.subject).toBe("Đơn 2608145VR0F1LR")
    expect(out.html).toContain("Nguyễn Văn A")
  })

  it("formats the total as VND", () => {
    const out = t.renderTemplate({ subject: "x", body_html: "{{total}}" }, t.buildVars(order))
    expect(out.html).toContain("105.000")
  })

  it("renders the item list", () => {
    const out = t.renderTemplate({ subject: "x", body_html: "{{items}}" }, t.buildVars(order))
    expect(out.html).toContain("Photocard")
    expect(out.html).toContain("A1")
    expect(out.html).toContain("Poster")
  })

  it("renders a variant photo for an item that has one", () => {
    const withImage = { ...order, items: [{ ...order.items[0], image_url: "/api/storage/shop/products/1/a.webp" }] }
    const out = t.renderTemplate({ subject: "x", body_html: "{{items}}" }, t.buildVars(withImage))
    expect(out.html).toContain("/api/storage/shop/products/1/a.webp")
  })

  it("omits the image cell's <img> for an item with no photo", () => {
    const noImage = { ...order, items: [{ ...order.items[0], image_url: null }] }
    const out = t.renderTemplate({ subject: "x", body_html: "{{items}}" }, t.buildVars(noImage))
    expect(out.html).not.toContain("<img")
  })

  it("leaves an unknown placeholder empty rather than printing braces", () => {
    const out = t.renderTemplate({ subject: "x", body_html: "[{{nope}}]" }, t.buildVars(order))
    expect(out.html).toBe("[]")
  })

  it("escapes HTML in buyer-controlled values", () => {
    const evil = { ...order, buyer_name: "<script>alert(1)</script>" }
    const out = t.renderTemplate({ subject: "x", body_html: "{{buyer_name}}" }, t.buildVars(evil))
    expect(out.html).not.toContain("<script>")
    expect(out.html).toContain("&lt;script&gt;")
  })

  it("escapes buyer-controlled values in the subject too", () => {
    const evil = { ...order, buyer_name: "<b>x</b>" }
    const out = t.renderTemplate({ subject: "{{buyer_name}}", body_html: "x" }, t.buildVars(evil))
    expect(out.subject).not.toContain("<b>")
  })
})

describe("shipping_fee_note", () => {
  it("shows the shipper-fee note in order_placed for a ship order", () => {
    const out = t.renderTemplate(t.DEFAULT_TEMPLATES.order_placed, t.buildVars(order))
    expect(out.html).toContain("Phí ship trả cho shipper khi nhận hàng")
  })

  it("omits the shipper-fee note in order_placed for a pickup order — there is no shipper to pay", () => {
    const pickupOrder = { ...order, fulfillment_method: "pickup" }
    const out = t.renderTemplate(t.DEFAULT_TEMPLATES.order_placed, t.buildVars(pickupOrder))
    expect(out.html).not.toContain("Phí ship trả cho shipper khi nhận hàng")
  })
})

describe("payment_note", () => {
  it("does not appear in order_placed — the transfer instructions/QR already carry it, a second copy in the pending-payment email read strangely out of context", () => {
    const orderWithNote = { ...order, payment_note: "chuc be Tai hay an mau lon" }
    const out = t.renderTemplate(t.DEFAULT_TEMPLATES.order_placed, t.buildVars(orderWithNote))
    expect(out.html).not.toContain("chuc be Tai hay an mau lon")
  })

  it("is still computed by buildVars, for a custom admin-edited template to opt back in", () => {
    const orderWithNote = { ...order, payment_note: "chuc be Tai hay an mau lon" }
    expect(t.buildVars(orderWithNote).payment_note).toBe("chuc be Tai hay an mau lon")
  })
})

describe("prep_note", () => {
  it("says the item will be shipped for a ship order", () => {
    const out = t.renderTemplate(t.DEFAULT_TEMPLATES.payment_confirmed, t.buildVars(order))
    expect(out.html).toContain("gửi hàng")
  })

  it("points at the pickup code/QR instead of shipping for a pickup order", () => {
    const pickupOrder = { ...order, fulfillment_method: "pickup" }
    const out = t.renderTemplate(t.DEFAULT_TEMPLATES.payment_confirmed, t.buildVars(pickupOrder))
    expect(out.html).not.toContain("gửi hàng")
    expect(out.html).toContain("mã QR")
  })
})

describe("digital delivery link", () => {
  const digitalOrder = (overrides = {}) => ({
    id: 1, order_token: "tok", buyer_name: "A", total: 99000, status: "confirmed",
    fulfillment_method: "digital", created_at: new Date(),
    items: [{ product_name_snapshot: "Digital Album", variant_label_snapshot: "", qty: 1, unit_price_snapshot: 99000, delivery_link_snapshot: "https://drive.google.com/x" }],
    ...overrides,
  })

  it("renders the download link in the items block once confirmed", () => {
    const vars = t.buildVars(digitalOrder())
    expect(vars.items).toContain("https://drive.google.com/x")
  })

  it("never renders the link while pending", () => {
    const vars = t.buildVars(digitalOrder({ status: "pending" }))
    expect(vars.items).not.toContain("https://drive.google.com/x")
  })

  it("never renders the link once cancelled", () => {
    const vars = t.buildVars(digitalOrder({ status: "cancelled" }))
    expect(vars.items).not.toContain("https://drive.google.com/x")
  })

  it("mentions the digital link in prep_note for an all-digital order", () => {
    const vars = t.buildVars(digitalOrder())
    expect(vars.prep_note).toContain("tải")
  })

  it("still mentions the digital link in prep_note for a mixed ship+digital order", () => {
    const vars = t.buildVars(digitalOrder({
      fulfillment_method: "ship",
      items: [
        ...digitalOrder().items,
        { product_name_snapshot: "Card", variant_label_snapshot: "A1", qty: 1, unit_price_snapshot: 35000, delivery_link_snapshot: null },
      ],
    }))
    expect(vars.prep_note).toContain("tải")
  })

  it("never mentions the digital link in prep_note once cancelled", () => {
    const vars = t.buildVars(digitalOrder({ status: "cancelled" }))
    expect(vars.prep_note).not.toContain("tải")
  })

  it("prep_note is never empty for a digital order with no delivery_link on its items", () => {
    const vars = t.buildVars(digitalOrder({
      items: [{ product_name_snapshot: "Digital Album", variant_label_snapshot: "", qty: 1, unit_price_snapshot: 99000, delivery_link_snapshot: null }],
    }))
    expect(vars.prep_note).not.toBe("")
    expect(vars.prep_note.length).toBeGreaterThan(0)
  })
})

describe("validatePlaceholders", () => {
  it("accepts known placeholders", () => {
    expect(t.validatePlaceholders("{{order_id}} {{buyer_name}} {{total}}")).toEqual([])
  })

  it("reports unknown placeholders so a typo cannot ship silently", () => {
    expect(t.validatePlaceholders("{{oder_id}}")).toEqual(["oder_id"])
  })

  it("reports every unknown placeholder, not just the first", () => {
    expect(t.validatePlaceholders("{{a}} {{b}}").sort()).toEqual(["a", "b"])
  })
})

describe("DEFAULT_TEMPLATES", () => {
  it("covers every lifecycle email", () => {
    expect(Object.keys(t.DEFAULT_TEMPLATES).sort())
      .toEqual(["cancelled", "order_placed", "payment_confirmed", "shipped"])
  })

  it("uses only valid placeholders", () => {
    for (const [type, tpl] of Object.entries(t.DEFAULT_TEMPLATES)) {
      expect(t.validatePlaceholders(tpl.subject + tpl.body_html), type).toEqual([])
    }
  })

  it("is written in Vietnamese", () => {
    expect(t.DEFAULT_TEMPLATES.order_placed.subject).toMatch(/[ăâđêôơư]/i)
  })

  it("renders every default without throwing", () => {
    const vars = t.buildVars(order)
    for (const tpl of Object.values(t.DEFAULT_TEMPLATES)) {
      expect(() => t.renderTemplate(tpl, vars)).not.toThrow()
    }
  })

  it("shows the order code in the body of every lifecycle email, not just order_placed", () => {
    const vars = t.buildVars(order)
    for (const [type, tpl] of Object.entries(t.DEFAULT_TEMPLATES)) {
      const out = t.renderTemplate(tpl, vars)
      expect(out.html, type).toContain("Mã đơn hàng")
      expect(out.html, type).toContain("2608145VR0F1LR")
    }
  })
})
