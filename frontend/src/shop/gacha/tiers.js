// Tier labels/colours ported from the approved mockup
// (Concept B - Case Reel.dc.html's TIERS array), mapped onto this repo's
// gacha_prizes.tier enum. Shared by GachaMachine and the booth kiosk chrome.
export const TIER_ORDER = ["common", "rare", "mythical", "legendary", "ancient"]

export const TIERS = {
  common: { label: "THƯỜNG", color: "#E6E6E6" },
  rare: { label: "HIẾM", color: "#3E8BFF" },
  mythical: { label: "SỬ THI", color: "#A855F7" },
  legendary: { label: "HUYỀN THOẠI", color: "#E4383A" },
  ancient: { label: "CỔ VẬT", color: "#E8B62C" },
}

export function tierLabel(tier) {
  return TIERS[tier]?.label || TIERS.common.label
}

export function tierColor(tier) {
  return TIERS[tier]?.color || TIERS.common.color
}

/**
 * Mirrors backend/shop/gacha/domain.js's tierOdds exactly: weight is
 * quantity_remaining, a tier's rate is its share of the whole live pool.
 * Presentational only - the winning prize always comes from the server.
 */
export function tierOdds(prizes) {
  const total = prizes.reduce((sum, p) => sum + (Number(p.quantity_remaining) || 0), 0)
  const byTier = {}
  for (const p of prizes) {
    byTier[p.tier] = (byTier[p.tier] || 0) + (Number(p.quantity_remaining) || 0)
  }
  const rates = {}
  for (const tier of Object.keys(byTier)) {
    rates[tier] = total > 0 ? byTier[tier] / total : 0
  }
  return rates
}

export function formatRate(rate) {
  if (!rate) return "0%"
  const pct = rate * 100
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`
}
