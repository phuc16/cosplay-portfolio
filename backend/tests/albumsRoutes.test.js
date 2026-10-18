import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import redis from "../redis.js"
import { resetTables, closeDb } from "./helpers/db.js"

const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)
const createAlbum = (body) => authed(request(app).post("/api/albums")).send(body)
const row = async (id) => (await db.query("SELECT * FROM albums WHERE id=?", [id]))[0][0]

beforeEach(async () => { await resetTables("images", "albums") })
afterAll(async () => { await redis.quit(); await closeDb() })

describe("POST /api/albums with parent_id", () => {
  it("creates top-level albums with NULL parent and increasing sort_order", async () => {
    const a = (await createAlbum({ title: "A" })).body.id
    const b = (await createAlbum({ title: "B" })).body.id
    expect((await row(a)).parent_id).toBeNull()
    expect([(await row(a)).sort_order, (await row(b)).sort_order]).toEqual([1, 2])
  })

  it("creates a sub-album with sibling-scoped sort_order", async () => {
    const parent = (await createAlbum({ title: "P" })).body.id
    await createAlbum({ title: "Other top" })
    const s1 = (await createAlbum({ title: "S1", parent_id: parent })).body.id
    const s2 = (await createAlbum({ title: "S2", parent_id: parent })).body.id
    expect((await row(s1)).parent_id).toBe(parent)
    expect([(await row(s1)).sort_order, (await row(s2)).sort_order]).toEqual([1, 2])
  })

  it("rejects a parent that does not exist", async () => {
    const res = await createAlbum({ title: "X", parent_id: 99999 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects nesting a sub-album under a sub-album", async () => {
    const parent = (await createAlbum({ title: "P" })).body.id
    const sub = (await createAlbum({ title: "S", parent_id: parent })).body.id
    const res = await createAlbum({ title: "SS", parent_id: sub })
    expect(res.status).toBe(400)
  })

  it.each(["abc", -1, 0, 1.5, "1; DROP TABLE albums"])("rejects malformed parent_id %j", async (bad) => {
    const res = await createAlbum({ title: "X", parent_id: bad })
    expect(res.status).toBe(400)
  })

  it("treats null and empty-string parent_id as top-level", async () => {
    for (const p of [null, ""]) {
      const id = (await createAlbum({ title: "T", parent_id: p })).body.id
      expect((await row(id)).parent_id).toBeNull()
    }
  })
})

describe("PUT /api/albums/:id", () => {
  it("never changes parent_id", async () => {
    const p1 = (await createAlbum({ title: "P1" })).body.id
    const p2 = (await createAlbum({ title: "P2" })).body.id
    const sub = (await createAlbum({ title: "S", parent_id: p1 })).body.id
    const res = await authed(request(app).put(`/api/albums/${sub}`)).send({ title: "S2", description: "d", parent_id: p2 })
    expect(res.status).toBe(200)
    const r = await row(sub)
    expect([r.title, r.parent_id]).toEqual(["S2", p1])
  })
})

const insertImage = (albumId, n = 1) =>
  db.query("INSERT INTO images(album_id, url, sort_order) VALUES(?,?,?)", [albumId, `/api/storage/images/${albumId}/${n}.webp`, n])

describe("PUT /api/albums/reorder", () => {
  it("reorders siblings", async () => {
    const p = (await createAlbum({ title: "P" })).body.id
    const s1 = (await createAlbum({ title: "S1", parent_id: p })).body.id
    const s2 = (await createAlbum({ title: "S2", parent_id: p })).body.id
    const res = await authed(request(app).put("/api/albums/reorder")).send({ albumIds: [s2, s1] })
    expect(res.status).toBe(200)
    expect([(await row(s2)).sort_order, (await row(s1)).sort_order]).toEqual([0, 1])
  })

  it("rejects ids from different parents", async () => {
    const a = (await createAlbum({ title: "A" })).body.id
    const sub = (await createAlbum({ title: "S", parent_id: a })).body.id
    const res = await authed(request(app).put("/api/albums/reorder")).send({ albumIds: [a, sub] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })
})

describe("PUT /api/albums/reorder id validation", () => {
  const reorder = (albumIds) => authed(request(app).put("/api/albums/reorder")).send({ albumIds })

  it("rejects ids that do not exist", async () => {
    const a = (await createAlbum({ title: "A" })).body.id
    const res = await reorder([a, 99999])
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects duplicate ids", async () => {
    const a = (await createAlbum({ title: "A" })).body.id
    const b = (await createAlbum({ title: "B" })).body.id
    expect((await reorder([a, b, a])).status).toBe(400)
  })

  it("accepts the full top-level sibling set", async () => {
    const a = (await createAlbum({ title: "A" })).body.id
    const b = (await createAlbum({ title: "B" })).body.id
    const c = (await createAlbum({ title: "C" })).body.id
    expect((await reorder([c, a, b])).status).toBe(200)
    expect([(await row(c)).sort_order, (await row(a)).sort_order, (await row(b)).sort_order]).toEqual([0, 1, 2])
  })
})

describe("DELETE /api/albums/:id", () => {
  it("cascades to sub-albums and every image under them", async () => {
    const p = (await createAlbum({ title: "P" })).body.id
    const s = (await createAlbum({ title: "S", parent_id: p })).body.id
    await insertImage(p)
    await insertImage(s)
    const keep = (await createAlbum({ title: "Keep" })).body.id
    await insertImage(keep)
    expect((await authed(request(app).delete(`/api/albums/${p}`))).status).toBe(200)
    expect(await row(s)).toBeUndefined()
    const [imgs] = await db.query("SELECT album_id FROM images")
    expect(imgs.map((i) => i.album_id)).toEqual([keep])
  })

  it("deleting only a sub-album leaves the parent and its photos", async () => {
    const p = (await createAlbum({ title: "P" })).body.id
    const s = (await createAlbum({ title: "S", parent_id: p })).body.id
    await insertImage(p)
    await insertImage(s)
    await authed(request(app).delete(`/api/albums/${s}`))
    expect(await row(p)).toBeDefined()
    expect((await db.query("SELECT id FROM images"))[0]).toHaveLength(1)
  })
})

describe("PUT /api/image/:id (move)", () => {
  it("moves a photo into a sub-album", async () => {
    const p = (await createAlbum({ title: "P" })).body.id
    const s = (await createAlbum({ title: "S", parent_id: p })).body.id
    await insertImage(p)
    const [[img]] = await db.query("SELECT id FROM images")
    expect((await authed(request(app).put(`/api/image/${img.id}`)).send({ album_id: s })).status).toBe(200)
    expect((await db.query("SELECT album_id FROM images WHERE id=?", [img.id]))[0][0].album_id).toBe(s)
  })

  it("400s when the target album does not exist", async () => {
    const p = (await createAlbum({ title: "P" })).body.id
    await insertImage(p)
    const [[img]] = await db.query("SELECT id FROM images")
    const res = await authed(request(app).put(`/api/image/${img.id}`)).send({ album_id: 99999 })
    expect(res.status).toBe(400)
  })
})
