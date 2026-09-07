import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import db from "../db.js"
import redis from "../redis.js"
import { tick, lease } from "../worker.js"
import { createLease, LEASE_KEY } from "../workerLease.js"
import { resetTables } from "./helpers/db.js"

// worker.js's exported `lease` uses the real default LEASE_KEY, shared (via
// Redis) with any other process/handle using that same key - exactly the
// point of the guard. Always release it and clear the raw key afterwards so
// this file cannot leak lease state into other test files that import
// worker.js in the same run.
afterEach(async () => {
  await lease.release()
  await redis.del(LEASE_KEY)
  vi.restoreAllMocks()
})

async function seedAlbumWithPendingImage() {
  await resetTables("images", "albums")
  const [r] = await db.query("INSERT INTO albums(title, sort_order) VALUES('A', 1)")
  await db.query(
    "INSERT INTO images(album_id, url, thumb_url, sort_order) VALUES(?,?,NULL,1)",
    [r.insertId, "/api/storage/images/x/does-not-matter.jpg"]
  )
  return r.insertId
}

describe("worker.tick() - multi-process singleton guard (Finding 3)", () => {
  it("skips the tick's run() entirely when another instance already holds the lease", async () => {
    await seedAlbumWithPendingImage()
    const other = createLease({ key: LEASE_KEY, ttlMs: 5000 })
    expect(await other.acquire()).toBe(true)

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    await tick()

    expect(lease.isHeld()).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("SINGLETON LEASE HELD BY ANOTHER INSTANCE")
    )

    // The tick must not have run at all - no thumbnail work, no gallery
    // invalidation attempt beyond what already existed.
    const [[img]] = await db.query("SELECT thumb_url FROM images LIMIT 1")
    expect(img.thumb_url).toBeNull()

    await other.release()
  })

  it("acquires and runs once the lease is free, and renews it on the next tick", async () => {
    await seedAlbumWithPendingImage()

    await tick()
    expect(lease.isHeld()).toBe(true)
    const rawAfterFirst = await redis.get(LEASE_KEY)
    expect(rawAfterFirst).toBe(lease.holderId)

    // A competitor must be refused while this instance still holds a live lease.
    const competitor = createLease({ key: LEASE_KEY, ttlMs: 5000 })
    expect(await competitor.acquire()).toBe(false)

    // Second tick renews the same lease rather than losing it.
    await tick()
    expect(lease.isHeld()).toBe(true)
    expect(await redis.get(LEASE_KEY)).toBe(lease.holderId)
  })
})
