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

describe("GET /api/shop/address-autocomplete", () => {
  let fetchSpy

  beforeEach(() => {
    process.env.GOONG_API_KEY = "test-goong-key"
    fetchSpy = vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it("proxies to Goong's v2 endpoint with the server-side key, never exposing it to the response", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ predictions: [{ description: "512 Nguyễn Xiển", place_id: "abc" }] }),
    })

    const res = await request(app).get("/api/shop/address-autocomplete").query({ input: "512 Nguyen Xien" })

    expect(res.status).toBe(200)
    expect(res.body.predictions).toHaveLength(1)
    expect(JSON.stringify(res.body)).not.toContain("test-goong-key")

    const calledUrl = fetchSpy.mock.calls[0][0]
    expect(calledUrl.toString()).toContain("rsapi.goong.io/v2/place/autocomplete")
    expect(calledUrl.toString()).toContain("api_key=test-goong-key")
    expect(calledUrl.toString()).toContain("more_compound=true")
    expect(calledUrl.toString()).toContain("limit=5")
  })

  it("does not call Goong at all for an input shorter than 3 characters", async () => {
    const res = await request(app).get("/api/shop/address-autocomplete").query({ input: "12" })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ predictions: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("returns an empty prediction list (not an error) when no key is configured", async () => {
    delete process.env.GOONG_API_KEY

    const res = await request(app).get("/api/shop/address-autocomplete").query({ input: "512 Nguyen Xien" })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ predictions: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("degrades to an empty prediction list, not a 500, when Goong itself errors", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 401 })

    const res = await request(app).get("/api/shop/address-autocomplete").query({ input: "512 Nguyen Xien" })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ predictions: [] })
  })

  it("degrades to an empty prediction list when the fetch itself throws (network error)", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"))

    const res = await request(app).get("/api/shop/address-autocomplete").query({ input: "512 Nguyen Xien" })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ predictions: [] })
  })
})
