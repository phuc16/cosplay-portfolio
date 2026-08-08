import { describe, it, expect } from "vitest"
import t from "../shop/email/templates.js"

const order = {
  id: 12, order_token: "abcd1234efgh", buyer_name: "Nguyễn Văn A", total: 105000,
  status: "pending", payment_method: "bank", fulfillment_method: "ship",
  tracking_code: null,
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
    expect(out.subject).toBe("Đơn 12")
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
})
