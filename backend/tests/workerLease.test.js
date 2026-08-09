import { describe, it, expect, afterEach } from "vitest"
import redis from "../redis.js"
import { createLease } from "../workerLease.js"

const TEST_KEY = "worker:lease:test"

afterEach(async () => {
  await redis.del(TEST_KEY)
})

describe("workerLease — multi-process singleton guard", () => {
  it("a second instance cannot acquire the lease while the first holds it (mutual exclusion)", async () => {
    const first = createLease({ key: TEST_KEY, ttlMs: 5000 })
    const second = createLease({ key: TEST_KEY, ttlMs: 5000 })

    const firstAcquired = await first.acquire()
    expect(firstAcquired).toBe(true)
    expect(first.isHeld()).toBe(true)

    const secondAcquired = await second.acquire()
    expect(secondAcquired).toBe(false)
    expect(second.isHeld()).toBe(false)

    // Real mutual exclusion, not just each handle's local belief: the raw
    // Redis value is still the first holder's id.
    const raw = await redis.get(TEST_KEY)
    expect(raw).toBe(first.holderId)
  })

  it("renews the held lease's TTL on each tick rather than only setting it once at startup", async () => {
    const holder = createLease({ key: TEST_KEY, ttlMs: 300 })
    expect(await holder.acquire()).toBe(true)

    // Let the original 300ms TTL run most of the way down.
    await new Promise((r) => setTimeout(r, 200))
    const renewed = await holder.renew()
    expect(renewed).toBe(true)

    // If renew() had not actually refreshed the TTL, the key would have
    // expired by ~300ms after acquire(); confirm it is still alive well
    // past that point, proving the renewal took effect.
    await new Promise((r) => setTimeout(r, 200))
    expect(await redis.get(TEST_KEY)).toBe(holder.holderId)
  })

  it("a died worker's un-renewed lease naturally expires, letting a second instance succeed", async () => {
    const dead = createLease({ key: TEST_KEY, ttlMs: 150 })
    expect(await dead.acquire()).toBe(true)

    const contender = createLease({ key: TEST_KEY, ttlMs: 150 })
    // While the lease is still live, the contender is correctly refused.
    expect(await contender.acquire()).toBe(false)

    // Simulate the dead worker: no renew(), no release() — just wait out the TTL.
    await new Promise((r) => setTimeout(r, 250))

    const revived = await contender.acquire()
    expect(revived).toBe(true)
    expect(await redis.get(TEST_KEY)).toBe(contender.holderId)
  })

  it("renew() fails without throwing once another instance has taken over an expired lease", async () => {
    const dead = createLease({ key: TEST_KEY, ttlMs: 150 })
    expect(await dead.acquire()).toBe(true)

    await new Promise((r) => setTimeout(r, 250))
    const contender = createLease({ key: TEST_KEY, ttlMs: 5000 })
    expect(await contender.acquire()).toBe(true)

    // The original holder's stale handle must not be able to renew (steal
    // back) a lease someone else now legitimately owns.
    const staleRenew = await dead.renew()
    expect(staleRenew).toBe(false)
    expect(await redis.get(TEST_KEY)).toBe(contender.holderId)
  })
})
