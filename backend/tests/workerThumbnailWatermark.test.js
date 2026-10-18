import { describe, it, expect, afterEach, afterAll, vi } from "vitest"
import sharp from "sharp"
import { createRequire } from "node:module"
import { applyWatermark } from "../watermark.js"
import { processImage } from "../worker.js"
import { closeDb } from "./helpers/db.js"
import redis from "../redis.js"

const storage = createRequire(import.meta.url)("../storage.js")

afterEach(() => vi.restoreAllMocks())
afterAll(async () => { await redis.quit(); await closeDb() })

async function greenDeviation(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let max = 0
  for (let i = 1; i < data.length; i += info.channels) max = Math.max(max, Math.abs(data[i] - 40))
  return max
}

async function thumbnailOf(source) {
  let uploaded
  vi.spyOn(storage, "getBuffer").mockResolvedValue(source)
  vi.spyOn(storage, "upload").mockImplementation(async (_key, buf) => { uploaded = buf })
  await processImage({ id: 999999, album_id: 1, url: "/api/storage/images/1/x.webp" })
  return uploaded
}

describe("worker thumbnail of a watermarked album image", () => {
  it("still carries the watermark", async () => {
    const plain = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: { r: 200, g: 40, b: 120 } } }).webp().toBuffer()
    const stamped = await applyWatermark(plain, { text: "Kamidayhehe" })
    expect(await greenDeviation(await thumbnailOf(stamped))).toBeGreaterThan(10)
  })
})
