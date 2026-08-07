const Redis = require("ioredis")

// REDIS_DB isolates the test suite (db 15) from dev/prod data (db 0), so a
// test calling invalidate() can never flush real cache keys.
module.exports = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT) || 6379,
  db: Number(process.env.REDIS_DB) || 0,
  // Without these, ioredis's defaults (connectTimeout 10s, maxRetriesPerRequest 20,
  // retryStrategy backoff capped at 2s) let a queued command sit behind a
  // stalled/backing-off reconnect attempt for a long time before it ever
  // rejects, so a Redis outage hangs whatever awaited it (e.g. a shop request)
  // instead of failing fast. Bound all three so a command fails quickly and
  // callers (see shop/catalogCache.js) can fall back to the DB:
  //   - connectTimeout: give up on a stalled connection attempt quickly.
  //   - maxRetriesPerRequest: stop retrying an individual command almost
  //     immediately instead of waiting through many reconnect cycles.
  //   - retryStrategy: cap the reconnect backoff itself low, so the one retry
  //     maxRetriesPerRequest allows can't land on a multi-second backoff delay.
  // enableOfflineQueue is intentionally left at its default (true): disabling
  // it makes any command issued before the very first connection completes
  // (e.g. rate-limit-redis's startup script load) reject immediately and
  // crash the server, even when Redis is perfectly healthy.
  connectTimeout: 2000,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 100, 1000),
})
