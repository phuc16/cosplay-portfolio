const redis = require("./../redis")

// Free, no-key-required public API - reflects Vietnam's post-July-2025
// administrative restructuring (34 provinces, no district level). See
// https://provinces.open-api.vn/. Proxied through our own backend (rather
// than fetched directly from the browser) so every visitor shares one
// cached copy instead of each hitting the third party individually, and so
// this can be swapped out later without a frontend change.
const BASE_URL = "https://provinces.open-api.vn/api/v2"

// Administrative boundaries change rarely (the 2025 merger was a once-in-
// decades event) - 30 days balances staleness risk against load on a free
// third-party service.
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60

async function getProvinces() {
  const cacheKey = "vn_provinces"
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)

  const res = await fetch(`${BASE_URL}/p/`)
  if (!res.ok) throw new Error(`provinces.open-api.vn trả về ${res.status}`)
  const data = await res.json()
  const provinces = data
    .map((p) => ({ code: String(p.code), name: p.name.replace(/^(Thành phố|Tỉnh)\s+/, "") }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"))

  await redis.set(cacheKey, JSON.stringify(provinces), "EX", CACHE_TTL_SECONDS)
  return provinces
}

async function getWards(provinceCode) {
  const cacheKey = `vn_wards:${provinceCode}`
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)

  const res = await fetch(`${BASE_URL}/p/${provinceCode}?depth=2`)
  if (!res.ok) throw new Error(`provinces.open-api.vn trả về ${res.status}`)
  const data = await res.json()
  const wards = (data.wards || [])
    .map((w) => ({ code: String(w.code), name: w.name.replace(/^(Phường|Xã|Thị trấn|Đặc khu)\s+/, "") }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"))

  await redis.set(cacheKey, JSON.stringify(wards), "EX", CACHE_TTL_SECONDS)
  return wards
}

module.exports = { getProvinces, getWards }
