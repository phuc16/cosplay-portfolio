import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import app from "../server.js"
import db from "../db.js"
import repo from "../shop/discountCodes.js"

beforeEach(async () => {
  await db.query("DELETE FROM discount_codes")
})

describe("POST /api/shop/discount-preview", () => {
  it("returns valid:true with the computed amount for a matching code", async () => {
    await repo.createCode({ code: "TENOFF", type: "fixed", value: 10000, min_total: 50000 })
    const res = await request(app).post("/api/shop/discount-preview").send({ code: "tenoff", subtotal: 100000 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ valid: true, amount: 10000, type: "fixed", value: 10000 })
  })

  it("returns valid:false with a message for an unknown code", async () => {
    const res = await request(app).post("/api/shop/discount-preview").send({ code: "NOPE", subtotal: 100000 })
    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(false)
    expect(res.body.message).toBeTruthy()
  })

  it("returns valid:false naming the below-minimum reason", async () => {
    await repo.createCode({ code: "BIG", type: "percent", value: 10, min_total: 200000 })
    const res = await request(app).post("/api/shop/discount-preview").send({ code: "BIG", subtotal: 100000 })
    expect(res.body.valid).toBe(false)
    expect(res.body.message).toBe(repo.REASON_MESSAGES.below_minimum)
  })

  it("never increments used_count", async () => {
    const created = await repo.createCode({ code: "ABC", type: "percent", value: 10 })
    await request(app).post("/api/shop/discount-preview").send({ code: "ABC", subtotal: 100000 })
    await request(app).post("/api/shop/discount-preview").send({ code: "abc", subtotal: 100000 })
    const reread = await repo.getCodeById(created.id)
    expect(reread.used_count).toBe(0)
  })

  it("400s on a missing/invalid subtotal", async () => {
    const res = await request(app).post("/api/shop/discount-preview").send({ code: "ABC" })
    expect(res.status).toBe(400)
  })
})
