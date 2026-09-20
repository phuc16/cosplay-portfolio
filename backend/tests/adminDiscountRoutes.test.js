import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"

const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

beforeEach(async () => {
  await db.query("DELETE FROM discount_codes")
})

describe("admin discount codes", () => {
  it("requires auth for every route", async () => {
    expect((await request(app).get("/api/admin/discount-codes")).status).toBe(401)
    expect((await request(app).post("/api/admin/discount-codes")).status).toBe(401)
    expect((await request(app).put("/api/admin/discount-codes/1")).status).toBe(401)
    expect((await request(app).delete("/api/admin/discount-codes/1")).status).toBe(401)
  })

  it("creates and lists a code", async () => {
    const create = await authed(request(app).post("/api/admin/discount-codes")).send({
      code: "launch10", type: "percent", value: 10, min_total: 50000,
    })
    expect(create.status).toBe(201)
    expect(create.body.code).toBe("LAUNCH10")

    const list = await authed(request(app).get("/api/admin/discount-codes"))
    expect(list.status).toBe(200)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].code).toBe("LAUNCH10")
    expect(list.body[0].used_count).toBe(0)
  })

  it("rejects an invalid payload with 400", async () => {
    const res = await authed(request(app).post("/api/admin/discount-codes")).send({
      code: "BAD", type: "percent", value: 150,
    })
    expect(res.status).toBe(400)
  })

  it("rejects a duplicate code (case-insensitive) with 409", async () => {
    await authed(request(app).post("/api/admin/discount-codes")).send({ code: "ABC123", type: "percent", value: 10 })
    const res = await authed(request(app).post("/api/admin/discount-codes")).send({ code: "abc123", type: "fixed", value: 5000 })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("duplicate_code")
  })

  it("updates an existing code, including toggling enabled", async () => {
    const create = await authed(request(app).post("/api/admin/discount-codes")).send({
      code: "ABC", type: "percent", value: 10,
    })
    const update = await authed(request(app).put(`/api/admin/discount-codes/${create.body.id}`)).send({
      code: "ABC", type: "percent", value: 10, enabled: false,
    })
    expect(update.status).toBe(200)
    expect(update.body.enabled).toBe(false)
  })

  it("404s updating a nonexistent id", async () => {
    const res = await authed(request(app).put("/api/admin/discount-codes/999999")).send({
      code: "ABC", type: "percent", value: 10,
    })
    expect(res.status).toBe(404)
  })

  it("deletes a code with no guard, then 404s a second delete", async () => {
    const create = await authed(request(app).post("/api/admin/discount-codes")).send({
      code: "ABC", type: "percent", value: 10,
    })
    const del1 = await authed(request(app).delete(`/api/admin/discount-codes/${create.body.id}`))
    expect(del1.status).toBe(200)
    const del2 = await authed(request(app).delete(`/api/admin/discount-codes/${create.body.id}`))
    expect(del2.status).toBe(404)
  })
})
