import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import redis from "../redis.js"
import { buildGallery } from "../albums.js"
import { resetTables, closeDb } from "./helpers/db.js"

const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)

async function album(title, parentId = null, order = 1) {
  const [r] = await db.query("INSERT INTO albums(title, sort_order, parent_id) VALUES(?,?,?)", [title, order, parentId])
  return r.insertId
}
async function image(albumId, url, order = 1, thumb = null) {
  await db.query("INSERT INTO images(album_id, url, thumb_url, width, height, sort_order) VALUES(?,?,?,?,?,?)", [albumId, url, thumb, 100, 200, order])
}

beforeEach(async () => {
  await resetTables("images", "albums")
  await redis.del("gallery")
})
afterAll(async () => { await redis.quit(); await closeDb() })

describe("GET /api/gallery nesting", () => {
  it("returns only top-level albums, each with subAlbums", async () => {
    const p = await album("Cosplay")
    const s = await album("Nino", p)
    await image(p, "/api/storage/p.webp")
    await image(s, "/api/storage/s1.webp", 1, "/api/storage/s1-t.webp")
    await image(s, "/api/storage/s2.webp", 2)
    const body = (await request(app).get("/api/gallery")).body
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ id: p, group: "Cosplay" })
    expect(body[0].items.map((i) => i.fullSrc)).toEqual(["/api/storage/p.webp"])
    expect(body[0].subAlbums).toHaveLength(1)
    const sub = body[0].subAlbums[0]
    expect(sub).toMatchObject({ id: s, title: "Nino", count: 2, cover: "/api/storage/s1-t.webp" })
    expect(sub.items.map((i) => i.id)).toHaveLength(2)
    expect(sub.items[0]).toEqual({ id: expect.any(Number), src: "/api/storage/s1-t.webp", fullSrc: "/api/storage/s1.webp", width: 100, height: 200 })
  })

  it("legacy albums have an empty subAlbums array", async () => {
    const a = await album("Old")
    await image(a, "/api/storage/o.webp")
    const body = (await request(app).get("/api/gallery")).body
    expect(body[0].subAlbums).toEqual([])
    expect(body[0].items).toHaveLength(1)
  })

  it("keeps empty sub-albums with cover null", async () => {
    const p = await album("P")
    await album("Empty", p)
    const sub = (await request(app).get("/api/gallery")).body[0].subAlbums[0]
    expect(sub).toMatchObject({ title: "Empty", count: 0, cover: null, items: [] })
  })

  it("orders sub-albums by sort_order and skips images without a url", async () => {
    const p = await album("P")
    await album("Second", p, 2)
    const first = await album("First", p, 1)
    await db.query("INSERT INTO images(album_id, url, sort_order) VALUES(?, '', 1)", [first])
    const subs = (await request(app).get("/api/gallery")).body[0].subAlbums
    expect(subs.map((s) => s.title)).toEqual(["First", "Second"])
    expect(subs[0].count).toBe(0)
  })

  it("is invalidated when a sub-album is created", async () => {
    const p = await album("P")
    await request(app).get("/api/gallery")
    await request(app).post("/api/albums").set("Authorization", `Bearer ${token}`).send({ title: "New sub", parent_id: p })
    const body = (await request(app).get("/api/gallery")).body
    expect(body[0].subAlbums.map((s) => s.title)).toEqual(["New sub"])
  })
})

describe("buildGallery", () => {
  it("ignores orphaned sub-album rows whose parent is missing", () => {
    expect(buildGallery([{ id: 5, title: "x", description: null, parent_id: 99 }], [])).toEqual([])
  })
})
