import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import app from "../server.js"
import db from "../db.js"
import repo from "../shop/coupons/couponRepo.js"

beforeEach(async () => {
  await db.query("DELETE FROM coupons")
})

describe("POST /api/shop/coupons/validate", () => {
  it("returns a discount preview for a valid code", async () => {
    await repo.createCoupon({ code: "SAVE10", type: "percent", value: 10, min_total: 50000 })
    const res = await request(app).post("/api/shop/coupons/validate").send({ code: "save10", subtotal: 100000 })
    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(true)
    expect(res.body.discount_amount).toBe(10000)
  })

  it("returns not_found for an unknown code", async () => {
    const res = await request(app).post("/api/shop/coupons/validate").send({ code: "NOPE", subtotal: 100000 })
    expect(res.body).toEqual({ valid: false, reason: "not_found" })
  })

  it("returns min_total_not_met when the subtotal is too low", async () => {
    await repo.createCoupon({ code: "BIG", type: "fixed", value: 20000, min_total: 200000 })
    const res = await request(app).post("/api/shop/coupons/validate").send({ code: "BIG", subtotal: 100000 })
    expect(res.body).toEqual({ valid: false, reason: "min_total_not_met" })
  })

  it("returns inactive for a deactivated code", async () => {
    const id = await repo.createCoupon({ code: "OFF", type: "fixed", value: 1000 })
    await repo.updateCoupon(id, { active: false })
    const res = await request(app).post("/api/shop/coupons/validate").send({ code: "OFF", subtotal: 100000 })
    expect(res.body).toEqual({ valid: false, reason: "inactive" })
  })

  it("never mutates times_used - this is a read-only preview", async () => {
    const id = await repo.createCoupon({ code: "X", type: "fixed", value: 1000 })
    await request(app).post("/api/shop/coupons/validate").send({ code: "X", subtotal: 100000 })
    await request(app).post("/api/shop/coupons/validate").send({ code: "X", subtotal: 100000 })
    const [[row]] = await db.query("SELECT times_used FROM coupons WHERE id = ?", [id])
    expect(row.times_used).toBe(0)
  })

  it("rejects a malformed subtotal", async () => {
    const res = await request(app).post("/api/shop/coupons/validate").send({ code: "X", subtotal: "abc" })
    expect(res.status).toBe(400)
  })
})
