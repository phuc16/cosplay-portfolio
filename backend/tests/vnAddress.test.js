import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest"
import vnAddress from "../shop/vnAddress.js"
import redis from "../redis.js"

async function clearCache() {
  await redis.del("vn_provinces")
  await redis.del("vn_wards:79")
}

beforeEach(async () => {
  await clearCache()
})

afterAll(async () => {
  await clearCache()
  await redis.quit()
})

describe("getProvinces", () => {
  let fetchSpy

  afterEach(() => {
    fetchSpy?.mockRestore()
  })

  it("fetches from provinces.open-api.vn, strips the 'Thành phố'/'Tỉnh' prefix, and sorts by name", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ([
        { code: 79, name: "Thành phố Hồ Chí Minh" },
        { code: 1, name: "Thành phố Hà Nội" },
      ]),
    })

    const provinces = await vnAddress.getProvinces()

    expect(fetchSpy).toHaveBeenCalledWith("https://provinces.open-api.vn/api/v2/p/")
    expect(provinces).toEqual([
      { code: "1", name: "Hà Nội" },
      { code: "79", name: "Hồ Chí Minh" },
    ])
  })

  it("serves the second call from the Redis cache, without calling fetch again", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ([{ code: 79, name: "Thành phố Hồ Chí Minh" }]),
    })

    await vnAddress.getProvinces()
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    await vnAddress.getProvinces()
    expect(fetchSpy).toHaveBeenCalledTimes(1) // still 1 — second call was cached
  })

  it("throws (surfaces as a 500, not a silent empty list) when the upstream API errors", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 503 })

    await expect(vnAddress.getProvinces()).rejects.toThrow()
  })
})

describe("getWards", () => {
  let fetchSpy

  afterEach(() => {
    fetchSpy?.mockRestore()
  })

  it("fetches wards for the given province code, strips ward-type prefixes", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        name: "Thành phố Hồ Chí Minh",
        wards: [
          { code: 100, name: "Phường Bến Nghé" },
          { code: 101, name: "Xã Bình Chánh" },
        ],
      }),
    })

    const wards = await vnAddress.getWards("79")

    expect(fetchSpy).toHaveBeenCalledWith("https://provinces.open-api.vn/api/v2/p/79?depth=2")
    expect(wards).toEqual([
      { code: "100", name: "Bến Nghé" },
      { code: "101", name: "Bình Chánh" },
    ])
  })

  it("caches per province code — a different province is a cache miss", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ wards: [{ code: 1, name: "Phường A" }] }),
    })

    await vnAddress.getWards("79")
    await vnAddress.getWards("79")
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    await vnAddress.getWards("1")
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    await redis.del("vn_wards:1")
  })
})
