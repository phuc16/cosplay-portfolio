import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"

const adminToken = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${adminToken}`)

beforeEach(async () => {
  await db.query("DELETE FROM payment_settings")
})

describe("PUT /api/admin/payment-settings", () => {
  it("rejects a momo_qr_image without an http(s):// scheme", async () => {
    const res = await authed(request(app).put("/api/admin/payment-settings")).send({
      momo_enabled: true, momo_qr_image: "javascript:alert(1)",
    })
    expect(res.status).toBe(400)
  })

  it("accepts a valid http(s):// momo_qr_image", async () => {
    const res = await authed(request(app).put("/api/admin/payment-settings")).send({
      momo_enabled: true, momo_qr_image: "https://example.com/qr.png",
    })
    expect(res.status).toBe(200)
  })

  it("accepts a momo_qr_image from this app's own storage proxy (what adminUploadImage always returns)", async () => {
    const res = await authed(request(app).put("/api/admin/payment-settings")).send({
      momo_enabled: true, momo_qr_image: "/api/storage/shop/payments/abc123.webp",
    })
    expect(res.status).toBe(200)
  })
})
