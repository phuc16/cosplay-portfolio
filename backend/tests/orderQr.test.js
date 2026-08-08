import { describe, it, expect } from "vitest"
import qr from "../shop/orders/qr.js"

describe("orderUrl", () => {
  it("builds the buyer-facing order URL", () => {
    process.env.SITE_URL = "https://shop.example"
    expect(qr.orderUrl("abc123")).toBe("https://shop.example/order/abc123")
  })
})

describe("qrSvg", () => {
  it("returns an inline SVG", async () => {
    const svg = await qr.qrSvg("https://shop.example/order/abc123")
    expect(svg).toContain("<svg")
    expect(svg).toContain("</svg>")
  })

  it("differs for different tokens", async () => {
    expect(await qr.qrSvg("a")).not.toBe(await qr.qrSvg("b"))
  })
})

describe("qrPngBuffer", () => {
  it("returns a PNG buffer", async () => {
    const buf = await qr.qrPngBuffer("https://shop.example/order/abc123")
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })
})
