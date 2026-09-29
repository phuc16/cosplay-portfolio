import { describe, it, expect, afterAll } from "vitest"
import sharp from "sharp"
import { PDFParse } from "pdf-parse"
import storage from "../storage.js"
import { buildRosterPdf } from "../shop/shipping/rosterPdf.js"

// Real MinIO, like every other storage-backed test in this repo hits real
// MySQL/Redis rather than mocking them - a nested require() inside a CJS
// module (rosterPdf.js requires storage.js) isn't reliably interceptable by
// vi.mock anyway, so this is also the only approach that actually exercises
// the real code path.
const TEST_PREFIX = `test-roster-pdf/${Date.now()}`
const uploadedKeys = []

async function uploadFakeImage(name) {
  const buffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 40, b: 80 } } })
    .webp()
    .toBuffer()
  const key = `${TEST_PREFIX}/${name}.webp`
  await storage.upload(key, buffer, "image/webp")
  uploadedKeys.push(key)
  return storage.proxyUrl(key)
}

afterAll(async () => {
  await Promise.all(uploadedKeys.map((key) => storage.remove(key).catch(() => {})))
})

async function extractText(buffer) {
  const parser = new PDFParse({ data: buffer })
  const result = await parser.getText()
  return result.text
}

function row(over = {}) {
  return {
    order_id: 1, order_code: "DH1", pickup_code: "482913", buyer_name: "Ánh Dương", phone: "0900000001",
    queue_number: 1, paid: true, amount_due: 0, note: null,
    items: [{ product_name: "Photocard", variant_label: "A1", qty: 2, is_gift: false, delivery_link: null, image_url: null }],
    ...over,
  }
}

describe("buildRosterPdf", () => {
  it("produces a valid PDF (starts with the %PDF magic bytes)", async () => {
    const buffer = await buildRosterPdf([row()])
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-")
  })

  it("does not throw on an empty roster", async () => {
    const buffer = await buildRosterPdf([])
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-")
  })

  // The whole point of bundling fonts/DejaVuSans.ttf: pdfkit's built-in
  // standard fonts (Helvetica etc.) only support WinAnsi encoding, which has
  // no Vietnamese diacritics at all - every character below would otherwise
  // render as a wrong glyph or drop silently.
  it("renders Vietnamese diacritics correctly, not garbled/dropped", async () => {
    const buffer = await buildRosterPdf([row({
      buyer_name: "Trương Hoàng Phúc", note: "Nhờ shop ký lên card giúp em",
    })])
    const text = await extractText(buffer)
    expect(text).toContain("Danh sách nhận hàng")
    expect(text).toContain("Trương Hoàng Phúc")
    expect(text).toContain("Đã thanh toán")
    expect(text).toContain("Nhờ shop ký lên card giúp em")
  })

  it("shows the real STT (queue_number), pickup_code, and collect-at-handover amount", async () => {
    const buffer = await buildRosterPdf([row({
      queue_number: 7, pickup_code: "PICKUP-7X2K", paid: false, amount_due: 75000,
    })])
    const text = await extractText(buffer)
    expect(text).toContain("STT 7")
    expect(text).toContain("PICKUP-7X2K")
    expect(text).toContain("Thu khi giao: 75.000₫")
  })

  it("lists every item with product, variant, and quantity - not collapsed", async () => {
    const buffer = await buildRosterPdf([row({
      items: [
        { product_name: "Photocard", variant_label: "A1", qty: 2, is_gift: false, delivery_link: null, image_url: null },
        { product_name: "Keychain", variant_label: "B2", qty: 3, is_gift: false, delivery_link: null, image_url: null },
      ],
    })])
    const text = await extractText(buffer)
    expect(text).toContain("Photocard · A1 × 2")
    expect(text).toContain("Keychain · B2 × 3")
  })

  it("marks a gift item and a digital item distinctly", async () => {
    const buffer = await buildRosterPdf([row({
      items: [
        { product_name: "Postcard", variant_label: "", qty: 1, is_gift: true, delivery_link: null, image_url: null },
        { product_name: "Digital Bonus", variant_label: "", qty: 1, is_gift: false, delivery_link: "https://drive.google.com/x", image_url: null },
      ],
    })])
    const text = await extractText(buffer)
    expect(text).toContain("Postcard × 1 (Quà tặng)")
    expect(text).toContain("Digital Bonus × 1 (Sản phẩm số)")
  })

  it("keeps each order in its own section - both orders' content present and in order", async () => {
    const buffer = await buildRosterPdf([
      row({ order_id: 1, order_code: "DH1", buyer_name: "Trần Văn B", queue_number: 2 }),
      row({ order_id: 2, order_code: "DH2", buyer_name: "Ánh Dương", queue_number: 1 }),
    ])
    const text = await extractText(buffer)
    expect(text.indexOf("DH1")).toBeLessThan(text.indexOf("DH2"))
    expect(text).toContain("Trần Văn B")
    expect(text).toContain("Ánh Dương")
  })

  it("ignores an image_url that isn't a local storage proxy path (never attempts to fetch it)", async () => {
    const buffer = await buildRosterPdf([row({
      items: [{ product_name: "Card", variant_label: "", qty: 1, is_gift: false, delivery_link: null, image_url: "https://external.example/x.jpg" }],
    })])
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-")
  })

  it("fetches and embeds a real uploaded storage image without throwing", async () => {
    const imageUrl = await uploadFakeImage("real")
    const buffer = await buildRosterPdf([row({
      items: [{ product_name: "Card", variant_label: "A1", qty: 1, is_gift: false, delivery_link: null, image_url: imageUrl }],
    })])
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-")
    // The embedded JPEG re-encoding shows up as real image data, not just the
    // placeholder path - a meaningfully larger document than the no-image case.
    const withoutImage = await buildRosterPdf([row({
      items: [{ product_name: "Card", variant_label: "A1", qty: 1, is_gift: false, delivery_link: null, image_url: null }],
    })])
    expect(buffer.length).toBeGreaterThan(withoutImage.length)
  })

  it("falls back to a placeholder (does not throw) for a key that was never uploaded", async () => {
    const buffer = await buildRosterPdf([row({
      items: [{ product_name: "Card", variant_label: "A1", qty: 1, is_gift: false, delivery_link: null, image_url: `/api/storage/${TEST_PREFIX}/never-uploaded.webp` }],
    })])
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-")
  })

  it("falls back to a placeholder when the stored bytes aren't a decodable image", async () => {
    const key = `${TEST_PREFIX}/corrupt.webp`
    await storage.upload(key, Buffer.from("not an image"), "image/webp")
    uploadedKeys.push(key)

    const buffer = await buildRosterPdf([row({
      items: [{ product_name: "Card", variant_label: "A1", qty: 1, is_gift: false, delivery_link: null, image_url: storage.proxyUrl(key) }],
    })])
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-")
  })

  it("handles an order with many items across a page break without throwing, keeping every item's text", async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      product_name: `Item ${i}`, variant_label: "", qty: 1, is_gift: false, delivery_link: null, image_url: null,
    }))
    const buffer = await buildRosterPdf([row({ items })])
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-")

    const parser = new PDFParse({ data: buffer })
    const info = await parser.getInfo()
    expect(info.total).toBeGreaterThan(1)

    const text = await extractText(buffer)
    expect(text).toContain("Item 0")
    expect(text).toContain("Item 29")
  })
})
