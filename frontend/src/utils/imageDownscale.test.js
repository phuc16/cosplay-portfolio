import { describe, it, expect } from "vitest"
import { computeDownscaleDimensions, MAX_DIMENSION } from "./imageDownscale"

describe("computeDownscaleDimensions", () => {
  it("leaves an image already within the cap unchanged", () => {
    expect(computeDownscaleDimensions(800, 600, MAX_DIMENSION)).toEqual({ width: 800, height: 600 })
  })

  it("scales down a wide image to fit the cap on its longer side", () => {
    expect(computeDownscaleDimensions(4000, 3000, 1920)).toEqual({ width: 1920, height: 1440 })
  })

  it("scales down a tall image to fit the cap on its longer side", () => {
    expect(computeDownscaleDimensions(3000, 4000, 1920)).toEqual({ width: 1440, height: 1920 })
  })

  it("never upscales an image smaller than the cap", () => {
    expect(computeDownscaleDimensions(100, 50, 1920)).toEqual({ width: 100, height: 50 })
  })

  it("rounds fractional dimensions to whole pixels", () => {
    expect(computeDownscaleDimensions(4001, 3000, 1920)).toEqual({ width: 1920, height: 1440 })
  })
})
