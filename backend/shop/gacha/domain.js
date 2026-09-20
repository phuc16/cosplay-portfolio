const crypto = require("crypto")

/**
 * Groups prizes by tier and sums each tier's live share of the pool - for
 * display only (the "what's in the case" tier badges/percentages). The
 * actual draw never uses this; it always walks individual prizes.
 */
function tierOdds(prizes) {
  const totalWeight = prizes.reduce((sum, p) => sum + p.quantity_remaining, 0)
  const byTier = new Map()
  for (const p of prizes) {
    byTier.set(p.tier, (byTier.get(p.tier) || 0) + p.quantity_remaining)
  }
  return [...byTier.entries()].map(([tier, weight]) => ({
    tier,
    weight,
    rate: totalWeight > 0 ? weight / totalWeight : 0,
  }))
}

/**
 * Picks one prize weighted by remaining quantity, using crypto-quality
 * randomness that is never client-seedable (see the design's Anti-cheat
 * section) - this is the one place in the whole feature that decides a
 * draw's outcome. Callers must run this inside the same row-locked
 * transaction that will decrement the winner's quantity_remaining, so the
 * pool this function sees can't go stale between pick and decrement.
 */
function weightedPick(prizes) {
  const totalWeight = prizes.reduce((sum, p) => sum + p.quantity_remaining, 0)
  if (totalWeight <= 0) throw new Error("Không thể quay: kho quà đã hết")
  let r = crypto.randomInt(0, totalWeight)
  for (const p of prizes) {
    if (r < p.quantity_remaining) return p
    r -= p.quantity_remaining
  }
  return prizes[prizes.length - 1]
}

module.exports = { tierOdds, weightedPick }
