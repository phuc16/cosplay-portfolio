const Redis = require("ioredis")

// REDIS_DB isolates the test suite (db 15) from dev/prod data (db 0), so a
// test calling invalidate() can never flush real cache keys.
module.exports = new Redis({
  host: process.env.REDIS_HOST,
  db: Number(process.env.REDIS_DB) || 0,
})
