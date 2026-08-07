const redis = require("./../redis")
const repo = require("./catalogRepo")

const LIST_KEY = "shop:collections"
const DETAIL_PREFIX = "shop:collection:"
const TTL_SECONDS = 3600 // matches the existing gallery/settings TTL

async function getCollections() {
  const cached = await redis.get(LIST_KEY)
  if (cached) return JSON.parse(cached)

  const data = await repo.listPublicCollections()
  await redis.set(LIST_KEY, JSON.stringify(data), "EX", TTL_SECONDS)
  return data
}

async function getCollection(slug) {
  const key = `${DETAIL_PREFIX}${slug}`
  const cached = await redis.get(key)
  if (cached) return JSON.parse(cached)

  const data = await repo.getPublicCollectionBySlug(slug)
  // Misses are not cached: a slug that does not exist yet may be published
  // moments later, and caching null would hide it for an hour.
  if (!data) return null

  await redis.set(key, JSON.stringify(data), "EX", TTL_SECONDS)
  return data
}

/** Clear the list and every cached detail page. Call after any catalog write. */
async function invalidate() {
  const keys = await redis.keys(`${DETAIL_PREFIX}*`)
  await redis.del(LIST_KEY, ...keys)
}

module.exports = { getCollections, getCollection, invalidate, LIST_KEY, DETAIL_PREFIX }
