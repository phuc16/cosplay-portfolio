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

describe("generatePickupCode", () => {
  it("is a 6-digit numeric string", () => {
    expect(d.generatePickupCode()).toMatch(/^\d{6}$/)
  })

  it("varies across many generations (not a constant)", () => {
    const codes = new Set(Array.from({ length: 200 }, () => d.generatePickupCode()))
    expect(codes.size).toBeGreaterThan(1)
  })
})

describe("generateAccessPin", () => {
  it("is a 6-digit numeric string", () => {
    expect(d.generateAccessPin()).toMatch(/^\d{6}$/)
  })

  it("varies across many generations (not a constant)", () => {
    const pins = new Set(Array.from({ length: 200 }, () => d.generateAccessPin()))
    expect(pins.size).toBeGreaterThan(1)
  })
})

describe("hashAccessPin / verifyAccessPin", () => {
  it("hashes to a 64-char hex SHA-256 digest, never the plaintext PIN", () => {
    const hash = d.hashAccessPin("123456")
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain("123456")
  })

  it("verifies the correct PIN against its own hash", () => {
    const hash = d.hashAccessPin("482913")
    expect(d.verifyAccessPin("482913", hash)).toBe(true)
  })

  it("rejects an incorrect PIN", () => {
    const hash = d.hashAccessPin("482913")
    expect(d.verifyAccessPin("000000", hash)).toBe(false)
  })

  it("rejects (rather than throws) against a missing/null stored hash", () => {
    expect(d.verifyAccessPin("123456", null)).toBe(false)
    expect(d.verifyAccessPin("123456", undefined)).toBe(false)
  })
})

describe("formatOrderCode", () => {
  it("is a YYMMDD date prefix plus an 8-character alphanumeric suffix (14 chars total)", () => {
    const code = d.formatOrderCode(12, "2026-08-14T12:00:00Z")
    expect(code).toMatch(/^\d{6}[0-9A-Z]{8}$/)
    expect(code).toHaveLength(14)
    expect(code.slice(0, 6)).toBe("260814")
  })

  it("is deterministic for the same id and date (no randomness, no storage needed)", () => {
    expect(d.formatOrderCode(12, "2026-08-14T12:00:00Z")).toBe(d.formatOrderCode(12, "2026-08-14T12:00:00Z"))
  })

  it("differs between different ids on the same date", () => {
    expect(d.formatOrderCode(1, "2026-08-14T12:00:00Z")).not.toBe(d.formatOrderCode(2, "2026-08-14T12:00:00Z"))
  })

  it("differs between the same id on different dates (date prefix changes)", () => {
    expect(d.formatOrderCode(12, "2026-08-14T12:00:00Z")).not.toBe(d.formatOrderCode(12, "2026-08-15T12:00:00Z"))
  })

  it("does not read as an obviously zero-padded small number", () => {
    // A naive base-36 encode of a small id (e.g. "000C") would be an
    // instant giveaway of low order volume; the hash-based suffix should
    // not collapse to a short run of leading zeros for small ids.
    expect(d.formatOrderCode(1, "2026-08-14T12:00:00Z").slice(6)).not.toMatch(/^0+/)
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

  it("never lets a digital order reach 'shipped' - there is nothing to ship", () => {
    expect(d.canTransition("confirmed", "shipped", "digital")).toBe(false)
    expect(d.canTransition("confirmed", "completed", "digital")).toBe(true)
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
