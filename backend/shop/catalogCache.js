const redis = require("./../redis")
const repo = require("./catalogRepo")

const LIST_KEY = "shop:collections"
const DETAIL_PREFIX = "shop:collection:"
const TTL_SECONDS = 3600 // matches the existing gallery/settings TTL

// Logged once per process, not per request, so a sustained Redis outage
// doesn't spam the logs on every shop request.
let writeFailureLogged = false
function warnWriteFailure(err) {
  if (writeFailureLogged) return
  writeFailureLogged = true
  console.error("[SHOP/CACHE] Redis write failed, serving uncached:", err.message)
}

/** A Redis read failure is treated as a cache miss so the caller falls through to the repo. */
async function safeGet(key) {
  try {
    return await redis.get(key)
  } catch (err) {
    return null
  }
}

/** A Redis write failure is logged (once) and swallowed — the response was already computed. */
async function safeSet(key, value) {
  try {
    await redis.set(key, value, "EX", TTL_SECONDS)
  } catch (err) {
    warnWriteFailure(err)
  }
}

async function getCollections() {
  const cached = await safeGet(LIST_KEY)
  if (cached) return JSON.parse(cached)

  const data = await repo.listPublicCollections()
  await safeSet(LIST_KEY, JSON.stringify(data))
  return data
}

async function getCollection(slug) {
  const key = `${DETAIL_PREFIX}${slug}`
  const cached = await safeGet(key)
  if (cached) return JSON.parse(cached)

  const data = await repo.getPublicCollectionBySlug(slug)
  // Misses are not cached: a slug that does not exist yet may be published
  // moments later, and caching null would hide it for an hour.
  if (!data) return null

  await safeSet(key, JSON.stringify(data))
  return data
}

/** Clear the list and every cached detail page. Call after any catalog write. */
async function invalidate() {
  const keys = await redis.keys(`${DETAIL_PREFIX}*`)
  await redis.del(LIST_KEY, ...keys)
}

module.exports = { getCollections, getCollection, invalidate, LIST_KEY, DETAIL_PREFIX }
