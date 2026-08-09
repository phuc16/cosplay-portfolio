const crypto = require("crypto")
const redis = require("./redis")

// Singleton lease for the worker's polling loop. Guards against exactly the
// incident documented in .superpowers/sdd/f14-reinvestigation-report.md: a
// stale `node worker.js` (old build, missing code) running alongside the
// current one, silently double-processing the same rows with no error and
// no crash — because nothing stopped two processes from polling the same
// DB at once. This is a NEW guard against *multiple processes*; it is
// independent of (and does not touch) worker.js's existing in-process
// `running` flag, which only guards against overlapping ticks within one
// process.
//
// Implementation: a single Redis key held via `SET key holder PX ttl NX`,
// renewed on every successful tick with a compare-and-extend Lua script so a
// worker can only ever renew a lease it still actually owns (never someone
// else's, e.g. after its own lease already expired and a new holder took
// over). No graceful release is required or provided as part of normal
// operation — the whole point is protecting against processes that die or
// get orphaned ungracefully, so correctness must not depend on a shutdown
// hook ever running. The key's TTL is the only cleanup mechanism.
const LEASE_KEY = "worker:lease"

// The worker's poll tick is ~5s (see the setInterval at the bottom of
// worker.js). The TTL must comfortably outlive tick-to-tick jitter (a slow
// DB query, a GC pause, a burst of thumbnail work) so a healthy worker can
// never lose its own lease just from normal timing variance, but still
// expire soon enough after a real death that a stale-process incident is
// caught quickly rather than lingering. 6x the tick interval is the chosen
// multiple: a live worker renews on every tick, so it would have to miss six
// consecutive ticks in a row (~30s of total silence) before losing a lease
// it still holds — far beyond ordinary jitter — while a genuinely dead
// process's lease still clears out within half a minute.
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
   * holder (compare-and-extend). Returns false — without throwing — if the
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
