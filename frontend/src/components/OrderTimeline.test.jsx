import { describe, it, expect } from "vitest"
import { buildTimelineSteps } from "./OrderTimeline"

function order(over = {}) {
  return {
    status: "pending",
    fulfillment_method: "ship",
    created_at: "2026-08-01T00:00:00.000Z",
    confirmed_at: null,
    shipped_at: null,
    completed_at: null,
    cancelled_at: null,
    ...over,
  }
}

describe("buildTimelineSteps", () => {
  it("marks only created as reached for a brand-new ship order", () => {
    const steps = buildTimelineSteps(order())
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s.reached]))
    expect(byKey).toEqual({ created: true, confirmed: false, shipped: false, completed: false })
  })

  it("includes shipped for a ship order", () => {
    const steps = buildTimelineSteps(order())
    expect(steps.map((s) => s.key)).toContain("shipped")
  })

  it("omits shipped entirely for a pickup order, not as an unreached step", () => {
    const steps = buildTimelineSteps(order({ fulfillment_method: "pickup" }))
    expect(steps.map((s) => s.key)).not.toContain("shipped")
    expect(steps.map((s) => s.key)).toEqual(["created", "confirmed", "completed"])
  })

  it("marks confirmed, shipped and completed reached once all timestamps are set", () => {
    const steps = buildTimelineSteps(order({
      confirmed_at: "2026-08-02T00:00:00.000Z",
      shipped_at: "2026-08-03T00:00:00.000Z",
      completed_at: "2026-08-04T00:00:00.000Z",
      status: "completed",
    }))
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s.reached]))
    expect(byKey).toEqual({ created: true, confirmed: true, shipped: true, completed: true })
  })

  it("shows a cancelled step instead of completed when the order was cancelled", () => {
    const steps = buildTimelineSteps(order({
      status: "cancelled",
      confirmed_at: "2026-08-02T00:00:00.000Z",
      cancelled_at: "2026-08-03T00:00:00.000Z",
    }))
    expect(steps.map((s) => s.key)).toContain("cancelled")
    expect(steps.map((s) => s.key)).not.toContain("completed")
    expect(steps.find((s) => s.key === "cancelled").reached).toBe(true)
  })

  it("shows cancelled as not-yet-reached only in the impossible case status isn't cancelled but somehow queried mid-transition", () => {
    // Defensive: the branch is driven by status, not presence of cancelled_at,
    // so a non-cancelled order never surfaces a "cancelled" step at all.
    const steps = buildTimelineSteps(order({ status: "confirmed", cancelled_at: null }))
    expect(steps.map((s) => s.key)).not.toContain("cancelled")
  })
})
