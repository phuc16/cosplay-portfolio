const crypto = require("crypto")
const redis = require("./redis")

// Singleton lease guarding against multiple worker processes (e.g. a stale
// deploy left running) double-processing the same rows - see
// .superpowers/sdd/f14-reinvestigation-report.md. Independent of worker.js's
// `running` flag, which only guards overlapping ticks within one process.
// A Redis key (`SET key holder PX ttl NX`) renewed each tick via a
// compare-and-extend Lua script, so a worker can only renew a lease it still
// owns. No graceful release: correctness must hold even if a process dies
// ungracefully, so the TTL is the only cleanup mechanism.
const LEASE_KEY = "worker:lease"

// TTL = 6x the ~5s poll tick: a live worker renews every tick, so it'd need
// to miss 6 in a row (~30s) before losing its own lease to jitter, while a
// dead process's lease still clears within half a minute.
const TICK_INTERVAL_MS = 5000
const LEASE_TTL_MS = TICK_INTERVAL_MS * 6

const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`

/**
 * Create an independent lease handle. Each worker process should create
 * exactly one at startup (a random holder id per handle is what makes
 * renew/release compare-and-swap safe across independently-started processes,
 * including two instances in the same test file).
 */
function createLease({ key = LEASE_KEY, ttlMs = LEASE_TTL_MS } = {}) {
  const holderId = crypto.randomBytes(16).toString("hex")
  let held = false

  /** Attempt to acquire the lease. Returns true iff this handle now holds it. */
  async function acquire() {
    const res = await redis.set(key, holderId, "PX", ttlMs, "NX")
    held = res === "OK"
    return held
  }

  /**
   * Extend the lease's TTL, but only if this handle is still the current
   * holder (compare-and-extend). Returns false - without throwing - if the
   * lease was lost (expired and/or taken by another holder), so the caller
   * can treat that as "no longer safe to keep polling" rather than an error.
   */
  async function renew() {
    if (!held) return false
    const res = await redis.eval(RENEW_SCRIPT, 1, key, holderId, String(ttlMs))
    held = res === 1
    return held
  }

  /** Best-effort release, only if still the current holder. Not required for correctness. */
  async function release() {
    if (!held) return false
    const res = await redis.eval(RELEASE_SCRIPT, 1, key, holderId)
    held = false
    return res === 1
  }

  return {
    holderId,
    isHeld: () => held,
    acquire,
    renew,
    release,
  }
}

module.exports = { createLease, LEASE_KEY, LEASE_TTL_MS, TICK_INTERVAL_MS }
