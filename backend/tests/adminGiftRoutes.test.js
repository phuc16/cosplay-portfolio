import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"

const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

beforeEach(async () => {
  await db.query("DELETE FROM gift_settings")
})

// createOrder (backend/shop/orders/orderRepo.js) now reads gift_settings
// directly, so a row left behind by this file's last test would otherwise
// leak into whichever test file runs next and calls createOrder.
afterAll(async () => {
  await db.query("DELETE FROM gift_settings")
})

describe("admin gift settings", () => {
  it("requires auth", async () => {
    expect((await request(app).get("/api/admin/gift-settings")).status).toBe(401)
  })

  it("saves and reads back", async () => {
    await authed(request(app).put("/api/admin/gift-settings")).send({
      enabled: true, name: "Postcard", min_total: 200000,
    })
    const res = await authed(request(app).get("/api/admin/gift-settings"))
    expect(res.body.name).toBe("Postcard")
    expect(res.body.min_total).toBe(200000)
  })

  it("rejects enabling without a name", async () => {
    const res = await authed(request(app).put("/api/admin/gift-settings")).send({ enabled: true, min_total: 0 })
    expect(res.status).toBe(400)
  })

  it("rejects a negative min_total when enabled", async () => {
    const res = await authed(request(app).put("/api/admin/gift-settings")).send({
      enabled: true, name: "Postcard", min_total: -1,
    })
    expect(res.status).toBe(400)
  })

  it("allows disabling with no name/min_total set", async () => {
    const res = await authed(request(app).put("/api/admin/gift-settings")).send({ enabled: false })
    expect(res.status).toBe(200)
  })
})
