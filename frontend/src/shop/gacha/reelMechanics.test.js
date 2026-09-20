import { describe, it, expect } from "vitest"
import { cardWidthFor, spinProfile, stopFraction, spinProgress } from "./reelMechanics"

describe("cardWidthFor", () => {
  it("uses the narrow card width under 640px, the wide one at/above it", () => {
    expect(cardWidthFor(400)).toBe(150)
    expect(cardWidthFor(639)).toBe(150)
    expect(cardWidthFor(640)).toBe(240)
    expect(cardWidthFor(1200)).toBe(240)
  })
})

describe("spinProgress", () => {
  it("is 0 at p=0 and 1 at p=1 regardless of friction", () => {
    expect(spinProgress(0, 2.7)).toBe(0)
    expect(spinProgress(1, 2.7)).toBeCloseTo(1, 10)
  })

  it("clamps p to [0,1]", () => {
    expect(spinProgress(-1, 2.7)).toBe(0)
    expect(spinProgress(2, 2.7)).toBeCloseTo(1, 10)
  })
})

describe("spinProfile", () => {
  it("stays inside the ported mockup's ranges", () => {
    for (let i = 0; i < 200; i++) {
      const p = spinProfile()
      expect(p.durationMs).toBeGreaterThanOrEqual(7500)
      expect(p.durationMs).toBeLessThanOrEqual(9500)
      expect(Number.isInteger(p.durationMs)).toBe(true)
      expect(p.tiles).toBeGreaterThanOrEqual(30)
      expect(p.tiles).toBeLessThanOrEqual(40)
      expect(Number.isInteger(p.tiles)).toBe(true)
      expect(p.friction).toBeGreaterThanOrEqual(2.7)
      expect(p.friction).toBeLessThan(3.3)
    }
  })
})

describe("stopFraction", () => {
  it("stays within the 0.10-0.90 landing window", () => {
    for (let i = 0; i < 200; i++) {
      const f = stopFraction()
      expect(f).toBeGreaterThanOrEqual(0.1)
      expect(f).toBeLessThanOrEqual(0.9)
    }
  })
})
