import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { processShopImage } from "../shop/images.js"

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
})
