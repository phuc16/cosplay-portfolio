import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import templates from "../shop/email/templates.js"

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

beforeEach(async () => {
  await db.query("DELETE FROM email_templates")
})

describe("GET /api/admin/email-templates", () => {
  it("requires auth", async () => {
    expect((await request(app).get("/api/admin/email-templates")).status).toBe(401)
  })

  it("lists every lifecycle template, falling back to defaults", async () => {
    const res = await authed(request(app).get("/api/admin/email-templates"))
    expect(res.status).toBe(200)
    const types = res.body.map((t) => t.type).sort()
    expect(types).toEqual(["cancelled", "order_placed", "payment_confirmed", "shipped"])
    expect(res.body.find((t) => t.type === "order_placed").subject)
      .toBe(templates.DEFAULT_TEMPLATES.order_placed.subject)
  })

  it("reflects a saved override", async () => {
    await templates.upsertTemplate("shipped", { subject: "Custom", body_html: "<p>hi</p>" })
    const res = await authed(request(app).get("/api/admin/email-templates"))
    expect(res.body.find((t) => t.type === "shipped").subject).toBe("Custom")
  })

  it("still exposes the shipped default alongside a saved override, for restore-default", async () => {
    await templates.upsertTemplate("shipped", { subject: "Custom", body_html: "<p>hi</p>" })
    const res = await authed(request(app).get("/api/admin/email-templates"))
    const row = res.body.find((t) => t.type === "shipped")
    expect(row.default_subject).toBe(templates.DEFAULT_TEMPLATES.shipped.subject)
    expect(row.default_body_html).toBe(templates.DEFAULT_TEMPLATES.shipped.body_html)
  })
})

describe("PUT /api/admin/email-templates/:type", () => {
  it("requires auth", async () => {
    expect((await request(app).put("/api/admin/email-templates/shipped")).status).toBe(401)
  })

  it("rejects an unknown template type", async () => {
    const res = await authed(request(app).put("/api/admin/email-templates/nope"))
      .send({ subject: "x", body_html: "y" })
    expect(res.status).toBe(400)
  })

  it("rejects a bad placeholder naming the offending token", async () => {
    const res = await authed(request(app).put("/api/admin/email-templates/shipped"))
      .send({ subject: "Đơn {{order_id}}", body_html: "{{oder_id}}" })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain("oder_id")
  })

  it("saves and reads back a valid template", async () => {
    await authed(request(app).put("/api/admin/email-templates/shipped"))
      .send({ subject: "Đơn {{order_id}} đã gửi", body_html: "<p>{{buyer_name}}</p>" })

    const res = await authed(request(app).get("/api/admin/email-templates"))
    const shipped = res.body.find((t) => t.type === "shipped")
    expect(shipped.subject).toBe("Đơn {{order_id}} đã gửi")
    expect(shipped.body_html).toBe("<p>{{buyer_name}}</p>")
  })
})
