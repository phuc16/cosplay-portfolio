import { describe, it, expect } from "vitest"
import { isPrepaid, classify, isExpired } from "../shop/stats/money.js"

describe("isPrepaid", () => {
  it("is true for bank, momo, and paypal", () => {
    expect(isPrepaid("bank")).toBe(true)
    expect(isPrepaid("momo")).toBe(true)
    expect(isPrepaid("paypal")).toBe(true)
  })

  it("is false for cod and cash", () => {
    expect(isPrepaid("cod")).toBe(false)
    expect(isPrepaid("cash")).toBe(false)
  })
})

// The full (status × payment_method) matrix per the spec's Money Definitions:
//
//              pending            confirmed/shipped   completed   cancelled
// prepaid   awaiting_payment      received            received    lost
// cod       other                 to_collect          received    lost
// cash      other                 received            received    lost
//
// cash is booth-counter money: staff take it at the point of sale, so a
// booth-cash order exists as `confirmed` from birth with the money already in
// the till - there is no transfer to verify (unlike prepaid) and no future
// handover to wait on (unlike COD).
//
// Every one of the 25 combinations is asserted explicitly - this is the
// highest-value test in the whole phase, per the spec's Testing section.
const PREPAID_METHODS = ["bank", "momo", "paypal"]
const CASES = []
for (const method of [...PREPAID_METHODS, "cod", "cash"]) {
  const prepaid = !["cod", "cash"].includes(method)
  const inHand = method === "cash"
  CASES.push([method, "pending", prepaid ? "awaiting_payment" : "other"])
  CASES.push([method, "confirmed", prepaid || inHand ? "received" : "to_collect"])
  CASES.push([method, "shipped", prepaid || inHand ? "received" : "to_collect"])
  CASES.push([method, "completed", "received"])
  CASES.push([method, "cancelled", "lost"])
}

describe("classify", () => {
  for (const [payment_method, status, expected] of CASES) {
    it(`${payment_method}/${status} -> ${expected}`, () => {
      expect(classify({ status, payment_method })).toBe(expected)
    })
  }

  it("covers exactly 25 combinations, so no case can silently go unwritten", () => {
    expect(CASES).toHaveLength(25)
  })
})

describe("isExpired", () => {
  it("is true when cancelled_at is at or after expires_at", () => {
    const expiresAt = new Date("2026-01-01T00:00:00Z")
    expect(isExpired({
      status: "cancelled", expires_at: expiresAt, cancelled_at: expiresAt,
    })).toBe(true)
    expect(isExpired({
      status: "cancelled", expires_at: expiresAt,
      cancelled_at: new Date("2026-01-01T00:00:01Z"),
    })).toBe(true)
  })

  it("is false when cancelled before the deadline (a genuine manual cancel)", () => {
    expect(isExpired({
      status: "cancelled",
      expires_at: new Date("2026-01-01T00:00:00Z"),
      cancelled_at: new Date("2025-12-31T23:59:59Z"),
    })).toBe(false)
  })

  it("is false for any non-cancelled status, even with overdue timestamps", () => {
    expect(isExpired({
      status: "confirmed",
      expires_at: new Date("2020-01-01T00:00:00Z"),
      cancelled_at: new Date("2026-01-01T00:00:00Z"),
    })).toBe(false)
  })

  it("is false for a cancelled COD order (expires_at is always NULL)", () => {
    expect(isExpired({ status: "cancelled", expires_at: null, cancelled_at: new Date() })).toBe(false)
  })

  it("is false when cancelled_at is missing", () => {
    expect(isExpired({
      status: "cancelled", expires_at: new Date("2026-01-01T00:00:00Z"), cancelled_at: null,
    })).toBe(false)
  })
})
