import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import { resetTables, closeDb } from "./helpers/db.js"

const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

beforeEach(async () => {
  await resetTables("images", "albums")
})

afterAll(async () => {
  await closeDb()
})

async function seedAlbumWithImages(count) {
  const [albumRes] = await db.query("INSERT INTO albums (title) VALUES ('Cosplay progress')")
  const albumId = albumRes.insertId
  const ids = []
  for (let i = 0; i < count; i++) {
    const [res] = await db.query(
      "INSERT INTO images (album_id, url, sort_order) VALUES (?, ?, ?)",
      [albumId, `https://x/${i}.jpg`, i]
    )
    ids.push(res.insertId)
  }
  return { albumId, ids }
}

describe("PUT /api/images/:id/pair", () => {
  it("sets symmetric before/after pairing on both images", async () => {
    const { ids } = await seedAlbumWithImages(2)
    const res = await authed(request(app).put(`/api/images/${ids[0]}/pair`)).send({ pairedImageId: ids[1] })
    expect(res.status).toBe(200)

    const [[before]] = await db.query("SELECT pair_role, pair_image_id FROM images WHERE id=?", [ids[0]])
    const [[after]] = await db.query("SELECT pair_role, pair_image_id FROM images WHERE id=?", [ids[1]])
    expect(before).toEqual({ pair_role: "before", pair_image_id: ids[1] })
    expect(after).toEqual({ pair_role: "after", pair_image_id: ids[0] })
  })

  it("rejects pairing two images from different albums", async () => {
    const a = await seedAlbumWithImages(1)
    const b = await seedAlbumWithImages(1)
    const res = await authed(request(app).put(`/api/images/${a.ids[0]}/pair`)).send({ pairedImageId: b.ids[0] })
    expect(res.status).toBe(400)
  })

  it("rejects pairing an image with itself", async () => {
    const { ids } = await seedAlbumWithImages(1)
    const res = await authed(request(app).put(`/api/images/${ids[0]}/pair`)).send({ pairedImageId: ids[0] })
    expect(res.status).toBe(400)
  })

  it("404s when either image id doesn't exist", async () => {
    const { ids } = await seedAlbumWithImages(1)
    const res = await authed(request(app).put(`/api/images/${ids[0]}/pair`)).send({ pairedImageId: 999999 })
    expect(res.status).toBe(404)
  })

  it("clears both sides of an existing pairing when pairedImageId is null", async () => {
    const { ids } = await seedAlbumWithImages(2)
    await authed(request(app).put(`/api/images/${ids[0]}/pair`)).send({ pairedImageId: ids[1] })

    const res = await authed(request(app).put(`/api/images/${ids[0]}/pair`)).send({ pairedImageId: null })
    expect(res.status).toBe(200)

    const [[before]] = await db.query("SELECT pair_role, pair_image_id FROM images WHERE id=?", [ids[0]])
    const [[after]] = await db.query("SELECT pair_role, pair_image_id FROM images WHERE id=?", [ids[1]])
    expect(before).toEqual({ pair_role: null, pair_image_id: null })
    expect(after).toEqual({ pair_role: null, pair_image_id: null })
  })

  // Re-pairing an already-paired image must not leave its old partner
  // dangling with a one-sided "after" pointing at a "before" that has since
  // moved on to someone else.
  it("clears the old partner's pairing when an image is re-paired to a new partner", async () => {
    const { ids } = await seedAlbumWithImages(3)
    await authed(request(app).put(`/api/images/${ids[0]}/pair`)).send({ pairedImageId: ids[1] })
    await authed(request(app).put(`/api/images/${ids[0]}/pair`)).send({ pairedImageId: ids[2] })

    const [[oldPartner]] = await db.query("SELECT pair_role, pair_image_id FROM images WHERE id=?", [ids[1]])
    const [[before]] = await db.query("SELECT pair_role, pair_image_id FROM images WHERE id=?", [ids[0]])
    const [[newPartner]] = await db.query("SELECT pair_role, pair_image_id FROM images WHERE id=?", [ids[2]])
    expect(oldPartner).toEqual({ pair_role: null, pair_image_id: null })
    expect(before).toEqual({ pair_role: "before", pair_image_id: ids[2] })
    expect(newPartner).toEqual({ pair_role: "after", pair_image_id: ids[0] })
  })
})

describe("GET /api/gallery - pairing fields", () => {
  it("includes pairRole/pairImageId on every item", async () => {
    const { ids } = await seedAlbumWithImages(2)
    await authed(request(app).put(`/api/images/${ids[0]}/pair`)).send({ pairedImageId: ids[1] })

    const gallery = await request(app).get("/api/gallery")
    const album = gallery.body[0]
    const before = album.items.find((it) => it.id === ids[0])
    const after = album.items.find((it) => it.id === ids[1])
    expect(before.pairRole).toBe("before")
    expect(before.pairImageId).toBe(ids[1])
    expect(after.pairRole).toBe("after")
    expect(after.pairImageId).toBe(ids[0])
  })
})
