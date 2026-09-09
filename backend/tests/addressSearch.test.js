import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest"
import request from "supertest"
import app from "../server.js"
import redis from "../redis.js"
import { closeDb } from "./helpers/db.js"

const ORIGINAL_KEY = process.env.GOONG_API_KEY

afterAll(async () => {
  process.env.GOONG_API_KEY = ORIGINAL_KEY
  await redis.quit()
  await closeDb()
})

describe("GET /api/shop/address-search", () => {
  let fetchSpy

  beforeEach(() => {
    process.env.GOONG_API_KEY = "test-goong-key"
    fetchSpy = vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it("combines input + ward + province into the query sent to Goong, never exposing the key in the response", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ predictions: [{ description: "66B Nguyễn Sĩ Sách, Tân Sơn, Hồ Chí Minh" }] }),
    })

    const res = await request(app).get("/api/shop/address-search").query({
      input: "66B Nguyen Si Sach", ward: "Long Bình", province: "Hồ Chí Minh",
    })

    expect(res.status).toBe(200)
    expect(res.body.predictions).toHaveLength(1)
    expect(JSON.stringify(res.body)).not.toContain("test-goong-key")

    const calledUrl = fetchSpy.mock.calls[0][0].toString()
    expect(calledUrl).toContain("rsapi.goong.io/v2/place/autocomplete")
    expect(calledUrl).toContain("api_key=test-goong-key")
    // URLSearchParams encodes spaces as "+", not "%20".
    const params = new URL(calledUrl).searchParams
    expect(params.get("input")).toBe("66B Nguyen Si Sach, Long Bình, Hồ Chí Minh")
  })

  it("still searches with just input when ward/province are omitted", async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ predictions: [] }) })

    await request(app).get("/api/shop/address-search").query({ input: "66B Nguyen Si Sach" })

    const params = new URL(fetchSpy.mock.calls[0][0].toString()).searchParams
    expect(params.get("input")).toBe("66B Nguyen Si Sach")
  })

  it("does not call Goong for an input shorter than 3 characters", async () => {
    const res = await request(app).get("/api/shop/address-search").query({ input: "12" })
    expect(res.body).toEqual({ predictions: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("returns an empty prediction list, not an error, when no key is configured", async () => {
    delete process.env.GOONG_API_KEY
    const res = await request(app).get("/api/shop/address-search").query({ input: "66B Nguyen Si Sach" })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ predictions: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("degrades to an empty prediction list, not a 500, when Goong errors", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 401 })
    const res = await request(app).get("/api/shop/address-search").query({ input: "66B Nguyen Si Sach" })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ predictions: [] })
  })

  it("degrades to an empty prediction list when the fetch itself throws", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"))
    const res = await request(app).get("/api/shop/address-search").query({ input: "66B Nguyen Si Sach" })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ predictions: [] })
  })
})
