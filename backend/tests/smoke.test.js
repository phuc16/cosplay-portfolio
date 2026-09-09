import { describe, it, expect, afterAll } from "vitest"
import request from "supertest"
import app from "../server"
import { closeDb } from "./helpers/db"

afterAll(async () => {
  await closeDb()
})

describe("server", () => {
  it("returns the standard error shape for unknown routes", async () => {
    const res = await request(app).get("/api/definitely-not-a-route")
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: "not_found", message: "Không tìm thấy" })
  })
})
