import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"

const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

beforeEach(async () => {
  await db.query("DELETE FROM shop_display_settings")
})

afterAll(async () => {
  await db.query("DELETE FROM shop_display_settings")
})

describe("admin shop display settings", () => {
  it("requires auth", async () => {
    expect((await request(app).get("/api/admin/shop-display-settings")).status).toBe(401)
  })

  it("returns the default order when nothing is stored", async () => {
    const res = await authed(request(app).get("/api/admin/shop-display-settings"))
    expect(res.body.group_order).toEqual(["gacha", "digital", "physical"])
  })

  it("saves and reads back a custom order", async () => {
    await authed(request(app).put("/api/admin/shop-display-settings")).send({
      group_order: ["physical", "digital", "gacha"],
    })
    const res = await authed(request(app).get("/api/admin/shop-display-settings"))
    expect(res.body.group_order).toEqual(["physical", "digital", "gacha"])
  })

  it("rejects a group_order that isn't a permutation of the three known groups", async () => {
    const res = await authed(request(app).put("/api/admin/shop-display-settings")).send({
      group_order: ["gacha", "digital"],
    })
    expect(res.status).toBe(400)
  })
})

describe("public group-order endpoint", () => {
  it("is reachable without auth and returns the saved order", async () => {
    await authed(request(app).put("/api/admin/shop-display-settings")).send({
      group_order: ["digital", "physical", "gacha"],
    })
    const res = await request(app).get("/api/shop/group-order")
    expect(res.status).toBe(200)
    expect(res.body.group_order).toEqual(["digital", "physical", "gacha"])
  })
})
