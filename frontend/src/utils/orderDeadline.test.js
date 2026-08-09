import { describe, it, expect } from "vitest"
import { formatDeadline } from "./orderDeadline"

describe("formatDeadline", () => {
  it("returns null for a null expires_at (COD orders never expire)", () => {
    expect(formatDeadline(null)).toBeNull()
  })

  it("returns null for an undefined expires_at", () => {
    expect(formatDeadline(undefined)).toBeNull()
  })

  it("returns null for an empty string", () => {
    expect(formatDeadline("")).toBeNull()
  })

  it("returns null for an unparsable date string, never Invalid Date", () => {
    const result = formatDeadline("not-a-real-date")
    expect(result).toBeNull()
  })

  it("formats a future deadline as HH:mm dd/MM in Asia/Ho_Chi_Minh", () => {
    // 2026-08-09T13:30:00Z is 20:30 in Asia/Ho_Chi_Minh (UTC+7) on the same day.
    const now = new Date("2026-08-09T10:30:00Z")
    const result = formatDeadline("2026-08-09T13:30:00Z", now)
    expect(result.passed).toBe(false)
    expect(result.absolute).toBe("20:30 09/08")
  })

  it("formats the Asia/Ho_Chi_Minh wall-clock time correctly regardless of the runtime's own timezone", () => {
    // A UTC instant that lands on a different calendar day in Asia/Ho_Chi_Minh
    // than it does in UTC — proves the +7 offset is applied, not passed
    // through as whatever the test runner's local TZ happens to be.
    const now = new Date("2026-08-09T00:00:00Z")
    const result = formatDeadline("2026-08-09T23:00:00Z", now) // 06:00 on 08/10 in UTC+7
    expect(result.absolute).toBe("06:00 10/08")
  })

  it("rounds remaining time up so a deadline minutes away never reads as 0 hours left", () => {
    const now = new Date("2026-08-09T10:00:00Z")
    const result = formatDeadline("2026-08-09T10:20:00Z", now) // 20 minutes away
    expect(result.passed).toBe(false)
    expect(result.remainingHours).toBe(1)
  })

  it("reports exactly 3 hours remaining for a deadline 3 hours away", () => {
    const now = new Date("2026-08-09T10:00:00Z")
    const result = formatDeadline("2026-08-09T13:00:00Z", now)
    expect(result.remainingHours).toBe(3)
  })

  it("SWEEP WINDOW: a deadline in the past reports passed:true and remainingHours:0, never a negative or zero-looking 'time left'", () => {
    const now = new Date("2026-08-09T10:00:05Z") // 5 seconds after the deadline
    const result = formatDeadline("2026-08-09T10:00:00Z", now)
    expect(result.passed).toBe(true)
    expect(result.remainingHours).toBe(0)
  })

  it("SWEEP WINDOW: a deadline exactly equal to now is treated as passed, not as 0 hours of a still-live countdown", () => {
    const now = new Date("2026-08-09T10:00:00Z")
    const result = formatDeadline("2026-08-09T10:00:00Z", now)
    expect(result.passed).toBe(true)
  })

  it("builds the absolute string from formatToParts field values, not from string layout — proven across several known instants", () => {
    // Each case's expectation is derived from the known Asia/Ho_Chi_Minh
    // wall-clock time, not from re-running toLocaleString — this would have
    // caught a flipped date/time order or a non-ASCII separator, since
    // neither can produce the right "HH:mm dd/MM" value by accident.
    const now = new Date("2020-01-01T00:00:00Z")
    expect(formatDeadline("2026-01-01T17:00:00Z", now).absolute).toBe("00:00 02/01") // +7h rolls to next day
    expect(formatDeadline("2026-06-15T05:05:00Z", now).absolute).toBe("12:05 15/06")
    expect(formatDeadline("2026-12-31T17:30:00Z", now).absolute).toBe("00:30 01/01")
  })

  it("defaults now to the current time when not passed explicitly", () => {
    // A far-future deadline is always "not passed" under a real current now.
    const result = formatDeadline("2099-01-01T00:00:00Z")
    expect(result.passed).toBe(false)
  })
})
