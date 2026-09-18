import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"

const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

beforeEach(async () => {
  await db.query("DELETE FROM coupons")
})

describe("admin coupons", () => {
  it("requires auth", async () => {
    expect((await request(app).get("/api/admin/coupons")).status).toBe(401)
    expect((await request(app).post("/api/admin/coupons")).status).toBe(401)
  })

  it("creates and lists a coupon", async () => {
    const create = await authed(request(app).post("/api/admin/coupons")).send({
      code: "save10", type: "percent", value: 10, min_total: 50000,
    })
    expect(create.status).toBe(201)
    expect(create.body.id).toBeTruthy()

    const list = await authed(request(app).get("/api/admin/coupons"))
    expect(list.status).toBe(200)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].code).toBe("SAVE10")
  })

  it("rejects an invalid create with 400, not 500", async () => {
    const res = await authed(request(app).post("/api/admin/coupons")).send({ code: "X", type: "bogus", value: 10 })
    expect(res.status).toBe(400)
  })

  it("rejects a duplicate code with 400", async () => {
    await authed(request(app).post("/api/admin/coupons")).send({ code: "X", type: "fixed", value: 1000 })
    const res = await authed(request(app).post("/api/admin/coupons")).send({ code: "X", type: "fixed", value: 2000 })
    expect(res.status).toBe(400)
  })

  it("updates a coupon, e.g. deactivating it", async () => {
    const create = await authed(request(app).post("/api/admin/coupons")).send({ code: "X", type: "fixed", value: 1000 })
    const res = await authed(request(app).put(`/api/admin/coupons/${create.body.id}`)).send({ active: false })
    expect(res.status).toBe(200)

    const [[row]] = await db.query("SELECT active FROM coupons WHERE id = ?", [create.body.id])
    expect(row.active).toBe(0)
  })
})
