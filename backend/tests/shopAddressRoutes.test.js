import { describe, it, expect, afterEach, afterAll, vi } from "vitest"
import request from "supertest"
import app from "../server.js"
import redis from "../redis.js"
import { closeDb } from "./helpers/db.js"

afterAll(async () => {
  await redis.del("vn_provinces")
  await redis.del("vn_wards:79")
  await redis.quit()
  await closeDb()
})

describe("GET /api/shop/provinces", () => {
  let fetchSpy

  afterEach(async () => {
    fetchSpy?.mockRestore()
    await redis.del("vn_provinces")
  })

  it("returns the province list", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ([{ code: 79, name: "Thành phố Hồ Chí Minh" }]),
    })

    const res = await request(app).get("/api/shop/provinces")
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ code: "79", name: "Hồ Chí Minh" }])
  })

  it("500s (not a silent empty list) when the upstream API fails, so the frontend's own .catch() degrades visibly in dev", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"))

    const res = await request(app).get("/api/shop/provinces")
    expect(res.status).toBe(500)
  })
})

describe("GET /api/shop/wards/:provinceCode", () => {
  let fetchSpy

  afterEach(async () => {
    fetchSpy?.mockRestore()
    await redis.del("vn_wards:79")
  })

  it("returns the wards for the given province code", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ wards: [{ code: 100, name: "Phường Bến Nghé" }] }),
    })

    const res = await request(app).get("/api/shop/wards/79")
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ code: "100", name: "Bến Nghé" }])
    expect(fetchSpy).toHaveBeenCalledWith("https://provinces.open-api.vn/api/v2/p/79?depth=2")
  })

  it("400s on a non-numeric provinceCode instead of reaching fetch/cache-key logic", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch")

    const res = await request(app).get("/api/shop/wards/abc")
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("400s on an over-length numeric provinceCode", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch")

    const res = await request(app).get("/api/shop/wards/99999")
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
