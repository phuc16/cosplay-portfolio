import { describe, it, expect } from "vitest"
import d from "../shop/orders/domain.js"

describe("generateOrderToken", () => {
  it("is 32 hex characters (128 bits)", () => {
    expect(d.generateOrderToken()).toMatch(/^[0-9a-f]{32}$/)
  })

  it("does not repeat across many generations", () => {
    const tokens = new Set(Array.from({ length: 5000 }, () => d.generateOrderToken()))
    expect(tokens.size).toBe(5000)
  })
})

describe("computeTotal", () => {
  it("sums price times quantity", () => {
    expect(d.computeTotal([
      { unit_price_snapshot: 35000, qty: 3 },
      { unit_price_snapshot: 90000, qty: 1 },
    ])).toBe(195000)
  })

  it("is 0 for an empty cart", () => {
    expect(d.computeTotal([])).toBe(0)
  })

  it("stays an exact integer at large quantities", () => {
    expect(d.computeTotal([{ unit_price_snapshot: 999999, qty: 999 }])).toBe(998999001)
    expect(Number.isInteger(d.computeTotal([{ unit_price_snapshot: 35000, qty: 7 }]))).toBe(true)
  })

  it("throws on a non-integer price rather than silently rounding", () => {
    expect(() => d.computeTotal([{ unit_price_snapshot: 35000.5, qty: 1 }])).toThrow()
  })

  it("throws on a negative quantity", () => {
    expect(() => d.computeTotal([{ unit_price_snapshot: 35000, qty: -1 }])).toThrow()
  })
})

describe("isReservable", () => {
  it("always allows unlimited stock", () => {
    expect(d.isReservable(null, 1)).toBe(true)
    expect(d.isReservable(null, 9999)).toBe(true)
  })

  it("allows exactly the remaining quantity", () => {
    expect(d.isReservable(3, 3)).toBe(true)
  })

  it("refuses more than remains", () => {
    expect(d.isReservable(3, 4)).toBe(false)
  })

  it("refuses anything when sold out", () => {
    expect(d.isReservable(0, 1)).toBe(false)
  })

  it("refuses a zero or negative request", () => {
    expect(d.isReservable(5, 0)).toBe(false)
    expect(d.isReservable(5, -1)).toBe(false)
  })
})

describe("computeExpiry", () => {
  const now = new Date("2026-08-07T10:00:00Z")

  it("gives prepaid orders a deadline", () => {
    expect(d.computeExpiry("bank", now, 48)).toEqual(new Date("2026-08-09T10:00:00Z"))
    expect(d.computeExpiry("momo", now, 48)).not.toBeNull()
    expect(d.computeExpiry("paypal", now, 48)).not.toBeNull()
  })

  it("never expires COD, which has no payment to wait for", () => {
    expect(d.computeExpiry("cod", now, 48)).toBeNull()
  })
})

describe("canTransition", () => {
  it("allows the prepaid ship path", () => {
    expect(d.canTransition("pending", "confirmed", "ship")).toBe(true)
    expect(d.canTransition("confirmed", "shipped", "ship")).toBe(true)
    expect(d.canTransition("shipped", "completed", "ship")).toBe(true)
  })

  it("lets pickup orders skip shipped", () => {
    expect(d.canTransition("confirmed", "completed", "pickup")).toBe(true)
  })

  it("refuses shipping a pickup order", () => {
    expect(d.canTransition("confirmed", "shipped", "pickup")).toBe(false)
  })

  it("refuses skipping confirmation", () => {
    expect(d.canTransition("pending", "shipped", "ship")).toBe(false)
    expect(d.canTransition("pending", "completed", "ship")).toBe(false)
  })

  it("allows cancelling anything not already terminal", () => {
    expect(d.canTransition("pending", "cancelled", "ship")).toBe(true)
    expect(d.canTransition("confirmed", "cancelled", "ship")).toBe(true)
    expect(d.canTransition("shipped", "cancelled", "ship")).toBe(true)
  })

  it("treats completed and cancelled as terminal", () => {
    for (const to of ["pending", "confirmed", "shipped", "completed", "cancelled"]) {
      expect(d.canTransition("completed", to, "ship")).toBe(false)
      expect(d.canTransition("cancelled", to, "ship")).toBe(false)
    }
  })

  it("refuses going backwards", () => {
    expect(d.canTransition("confirmed", "pending", "ship")).toBe(false)
    expect(d.canTransition("shipped", "confirmed", "ship")).toBe(false)
  })
})
