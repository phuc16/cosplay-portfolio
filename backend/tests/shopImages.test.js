import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { processShopImage } from "../shop/images.js"
import { applyWatermark } from "../watermark.js"

async function pngFixture(width, height) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 120 } },
  }).png().toBuffer()
}

describe("processShopImage", () => {
  it("re-encodes to webp", async () => {
    const out = await processShopImage(await pngFixture(400, 400))
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe("webp")
  })

  it("downscales images wider than 1920", async () => {
    const out = await processShopImage(await pngFixture(3000, 1000))
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(1920)
  })

  it("leaves smaller images at their original width", async () => {
    const out = await processShopImage(await pngFixture(800, 600))
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(800)
  })

  it("leaves the image untouched when watermark is not requested", async () => {
    const out = await processShopImage(await pngFixture(400, 400))
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    const cornerOffset = (info.height - 5) * info.width * info.channels + (info.width - 5) * info.channels
    // WebP is lossy, so allow the couple-of-levels rounding it introduces -
    // this is checking "no watermark box painted here", not exact color.
    expect(data[cornerOffset]).toBeCloseTo(200, -1)
    expect(data[cornerOffset + 1]).toBeCloseTo(40, -1)
    expect(data[cornerOffset + 2]).toBeCloseTo(120, -1)
  })

  it("stamps a visible mark over the bottom-right corner when watermark is requested", async () => {
    const out = await processShopImage(await pngFixture(400, 400), { watermark: true })
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    const cornerOffset = (info.height - 5) * info.width * info.channels + (info.width - 5) * info.channels
    expect([data[cornerOffset], data[cornerOffset + 1], data[cornerOffset + 2]]).not.toEqual([200, 40, 120])
  })
})

describe("processShopImage watermark delegates to the shared module", () => {
  it("equals applyWatermark(plain output) byte-for-byte", async () => {
    const input = await pngFixture(500, 400)
    const plain = await processShopImage(input)
    const marked = await processShopImage(input, { watermark: true })
    const expected = await applyWatermark(plain, { text: process.env.SHOP_NAME || "Shop" })
    expect(marked.equals(expected)).toBe(true)
  })
})
