import { describe, it, expect } from "vitest"
import { weightedPick, tierOdds } from "../shop/gacha/domain.js"

describe("weightedPick", () => {
  it("always returns the only prize with remaining stock", () => {
    const prizes = [
      { id: 1, quantity_remaining: 0 },
      { id: 2, quantity_remaining: 5 },
      { id: 3, quantity_remaining: 0 },
    ]
    for (let i = 0; i < 50; i++) {
      expect(weightedPick(prizes).id).toBe(2)
    }
  })

  it("throws when the whole pool is empty", () => {
    const prizes = [{ id: 1, quantity_remaining: 0 }, { id: 2, quantity_remaining: 0 }]
    expect(() => weightedPick(prizes)).toThrow()
  })

  it("distributes roughly proportional to remaining quantity over many draws", () => {
    const prizes = [{ id: 1, quantity_remaining: 90 }, { id: 2, quantity_remaining: 10 }]
    const counts = { 1: 0, 2: 0 }
    for (let i = 0; i < 5000; i++) counts[weightedPick(prizes).id]++
    const rate1 = counts[1] / 5000
    expect(rate1).toBeGreaterThan(0.8)
    expect(rate1).toBeLessThan(0.98)
  })
})

describe("tierOdds", () => {
  it("sums remaining quantity per tier and computes a live rate", () => {
    const prizes = [
      { tier: "common", quantity_remaining: 80 },
      { tier: "common", quantity_remaining: 10 },
      { tier: "legendary", quantity_remaining: 10 },
    ]
    const odds = tierOdds(prizes)
    const common = odds.find((o) => o.tier === "common")
    const legendary = odds.find((o) => o.tier === "legendary")
    expect(common.weight).toBe(90)
    expect(common.rate).toBeCloseTo(0.9, 5)
    expect(legendary.rate).toBeCloseTo(0.1, 5)
  })

  it("returns rate 0 for every tier when the pool is empty, without dividing by zero", () => {
    const odds = tierOdds([{ tier: "common", quantity_remaining: 0 }])
    expect(odds[0].rate).toBe(0)
  })
})
