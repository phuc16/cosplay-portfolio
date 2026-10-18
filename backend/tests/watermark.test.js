import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { applyWatermark, watermarkSvg, escapeXml } from "../watermark.js"

async function solidWebp(width, height, { alpha = false } = {}) {
  return sharp({
    create: {
      width, height, channels: alpha ? 4 : 3,
      background: alpha ? { r: 200, g: 40, b: 120, alpha: 0 } : { r: 200, g: 40, b: 120 },
    },
  }).webp({ quality: 82 }).toBuffer()
}

async function maxGreenDeviation(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let max = 0
  for (let i = 1; i < data.length; i += info.channels) max = Math.max(max, Math.abs(data[i] - 40))
  return max
}

describe("applyWatermark", () => {
  it("returns webp with the same dimensions", async () => {
    const out = await applyWatermark(await solidWebp(400, 300), { text: "Kami" })
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe("webp")
    expect([meta.width, meta.height]).toEqual([400, 300])
  })

  it("visibly changes the pixels", async () => {
    const src = await solidWebp(400, 400)
    expect(await maxGreenDeviation(src)).toBeLessThan(8)
    const out = await applyWatermark(src, { text: "Kami" })
    expect(await maxGreenDeviation(out)).toBeGreaterThan(20)
  })

  it("uses SHOP_NAME when no text is given and falls back to Shop", async () => {
    const prev = process.env.SHOP_NAME
    try {
      process.env.SHOP_NAME = "Alpha"
      const a = await applyWatermark(await solidWebp(400, 400))
      process.env.SHOP_NAME = "Omega Omega"
      const b = await applyWatermark(await solidWebp(400, 400))
      expect(a.equals(b)).toBe(false)
      delete process.env.SHOP_NAME
      const c = await applyWatermark(await solidWebp(400, 400))
      const d = await applyWatermark(await solidWebp(400, 400), { text: "Shop" })
      expect(c.equals(d)).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.SHOP_NAME
      else process.env.SHOP_NAME = prev
    }
  })

  it("keeps the alpha channel", async () => {
    const out = await applyWatermark(await solidWebp(300, 300, { alpha: true }), { text: "Kami" })
    expect((await sharp(out).metadata()).hasAlpha).toBe(true)
  })

  it("does not throw on tiny images", async () => {
    const out = await applyWatermark(await solidWebp(8, 8), { text: "Kami" })
    expect((await sharp(out).metadata()).width).toBe(8)
  })
})

describe("escapeXml / watermarkSvg", () => {
  it("escapes markup characters", () => {
    expect(escapeXml(`<a&"b'>`)).toBe("&lt;a&amp;&quot;b&apos;&gt;")
  })

  it("never lets shop-name markup into the svg", () => {
    expect(watermarkSvg("<script>", 400, 400).toString()).not.toContain("<script>")
  })
})

describe("applyWatermark edge cases", () => {
  it("handles very wide and very tall images", async () => {
    for (const [w, h] of [[1920, 200], [200, 1920]]) {
      const out = await applyWatermark(await solidWebp(w, h), { text: "Kami" })
      const meta = await sharp(out).metadata()
      expect([meta.width, meta.height]).toEqual([w, h])
    }
  })

  it("handles long and non-ASCII names", async () => {
    const out = await applyWatermark(await solidWebp(600, 600), { text: "Kamidayhehe Ảnh Cosplay <3 & co" })
    expect((await sharp(out).metadata()).format).toBe("webp")
  })

  it("is not idempotent-safe by design: stamping twice changes pixels again", async () => {
    const once = await applyWatermark(await solidWebp(400, 400), { text: "Kami" })
    const twice = await applyWatermark(once, { text: "Kami" })
    expect(twice.equals(once)).toBe(false)
  })
})
