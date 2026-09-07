import { describe, it, expect, afterAll } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import { closeDb } from "./helpers/db.js"

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

afterAll(async () => {
  await closeDb()
})

// processImage now runs the same validateImageBuffer magic-byte/size check as
// the shop's upload routes (backend/shop/images.js), so a non-image buffer
// must be rejected with 400 here too, not handed straight to sharp.
const notAnImage = Buffer.from("this is plain text, not an image at all").toString("base64")

describe("portfolio image uploads reject non-image input", () => {
  it("POST /api/upload/hero 400s on a non-image buffer", async () => {
    const res = await authed(request(app).post("/api/upload/hero")).send({ base64: notAnImage })
    expect(res.status).toBe(400)
  })

  it("POST /api/upload/thumbnail 400s on a non-image buffer", async () => {
    const res = await authed(request(app).post("/api/upload/thumbnail")).send({ base64: notAnImage })
    expect(res.status).toBe(400)
  })

  it("POST /api/upload/event-image 400s on a non-image buffer", async () => {
    const res = await authed(request(app).post("/api/upload/event-image")).send({ base64: notAnImage })
    expect(res.status).toBe(400)
  })

  it("POST /api/image 400s on a non-image buffer", async () => {
    const res = await authed(request(app).post("/api/image")).send({ album_id: 1, base64: notAnImage })
    expect(res.status).toBe(400)
  })
})
