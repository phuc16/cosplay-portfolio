import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import sharp from "sharp"
import { createRequire } from "node:module"
import app from "../server.js"
import db from "../db.js"
import redis from "../redis.js"
import { resetTables, closeDb } from "./helpers/db.js"

const storage = createRequire(import.meta.url)("../storage.js")

const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)
let uploads

async function fixture() {
  return sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 40, b: 120 } } }).png().toBuffer()
}

async function greenDeviation(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let max = 0
  for (let i = 1; i < data.length; i += info.channels) max = Math.max(max, Math.abs(data[i] - 40))
  return max
}

beforeEach(async () => {
  await resetTables("images", "albums")
  uploads = []
  vi.spyOn(storage, "upload").mockImplementation(async (key, buf) => { uploads.push({ key, buf }) })
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => { await redis.quit(); await closeDb() })

describe("album photo upload watermark", () => {
  it("stamps POST /api/image output in an album and a sub-album", async () => {
    const [p] = await db.query("INSERT INTO albums(title, sort_order) VALUES('P',1)")
    const [s] = await db.query("INSERT INTO albums(title, sort_order, parent_id) VALUES('S',1,?)", [p.insertId])
    for (const albumId of [p.insertId, s.insertId]) {
      uploads.length = 0
      const res = await authed(request(app).post("/api/image")).field("album_id", String(albumId)).attach("file", await fixture(), "a.png")
      expect(res.status).toBe(200)
      expect(uploads).toHaveLength(1)
      expect(await greenDeviation(uploads[0].buf)).toBeGreaterThan(20)
    }
  })

  it.each([["99999"], ["abc"], ["1.5"], ["-3"]])("400s without uploading for album_id %s", async (bad) => {
    const res = await authed(request(app).post("/api/image")).field("album_id", bad).attach("file", await fixture(), "a.png")
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
    expect(uploads).toHaveLength(0)
  })

  it.each(["/api/upload/hero", "/api/upload/thumbnail", "/api/upload/event-image"])("does not stamp %s", async (path) => {
    const res = await authed(request(app).post(path)).attach("file", await fixture(), "a.png")
    expect(res.status).toBe(200)
    expect(await greenDeviation(uploads[0].buf)).toBeLessThan(8)
  })
})
