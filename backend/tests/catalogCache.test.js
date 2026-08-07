import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import cache from "../shop/catalogCache.js"
import repo from "../shop/catalogRepo.js"
import redis from "../redis.js"
import { resetTables, closeDb } from "./helpers/db.js"

beforeEach(async () => {
  await resetTables("product_variants", "products", "collections")
  await cache.invalidate()
})

afterAll(async () => {
  await cache.invalidate()
  await redis.quit()
  await closeDb()
})

describe("getCollections", () => {
  it("serves the second call from cache", async () => {
    await repo.createCollection({ title: "Drop one", status: "active" })

    const first = await cache.getCollections()
    expect(first).toHaveLength(1)

    // Write directly to the DB, bypassing invalidation.
    await repo.createCollection({ title: "Drop two", status: "active" })

    const second = await cache.getCollections()
    expect(second).toHaveLength(1) // still the cached copy
  })

  it("reflects new data after invalidate", async () => {
    await repo.createCollection({ title: "Drop one", status: "active" })
    await cache.getCollections()

    await repo.createCollection({ title: "Drop two", status: "active" })
    await cache.invalidate()

    expect(await cache.getCollections()).toHaveLength(2)
  })
})

describe("getCollection", () => {
  it("caches a detail page and clears it on invalidate", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })

    const first = await cache.getCollection("drop")
    expect(first.products).toHaveLength(1)

    await repo.createProduct({ collection_id: cid, name: "Poster", price: 90000 })
    expect((await cache.getCollection("drop")).products).toHaveLength(1)

    await cache.invalidate()
    expect((await cache.getCollection("drop")).products).toHaveLength(2)
  })

  it("returns null for an unknown slug without caching a bogus entry", async () => {
    expect(await cache.getCollection("nope")).toBeNull()
    expect(await redis.get("shop:collection:nope")).toBeNull()
  })
})

describe("resilience to a Redis outage", () => {
  it("getCollections still resolves by falling through to the repo when redis.get/set reject", async () => {
    await repo.createCollection({ title: "Drop one", status: "active" })

    const getSpy = vi.spyOn(redis, "get").mockRejectedValue(new Error("ECONNREFUSED"))
    const setSpy = vi.spyOn(redis, "set").mockRejectedValue(new Error("ECONNREFUSED"))

    const data = await cache.getCollections()
    expect(data).toHaveLength(1)

    getSpy.mockRestore()
    setSpy.mockRestore()
  })

  it("getCollection still resolves by falling through to the repo when redis.get/set reject", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })

    const getSpy = vi.spyOn(redis, "get").mockRejectedValue(new Error("ECONNREFUSED"))
    const setSpy = vi.spyOn(redis, "set").mockRejectedValue(new Error("ECONNREFUSED"))

    const data = await cache.getCollection("drop")
    expect(data.products).toHaveLength(1)

    getSpy.mockRestore()
    setSpy.mockRestore()
  })
})
