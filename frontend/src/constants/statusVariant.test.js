import { describe, it, expect } from "vitest"
import { variantForStatus, variantForAction } from "./statusVariant"

describe("variantForStatus", () => {
  it("maps pending to warning", () => expect(variantForStatus("pending")).toBe("warning"))
  it("maps confirmed to success", () => expect(variantForStatus("confirmed")).toBe("success"))
  it("maps shipped to success", () => expect(variantForStatus("shipped")).toBe("success"))
  it("maps completed to success", () => expect(variantForStatus("completed")).toBe("success"))
  it("maps cancelled to danger", () => expect(variantForStatus("cancelled")).toBe("danger"))
  it("falls back to neutral for an unknown status, never throwing or returning undefined", () => {
    expect(variantForStatus("some_future_status")).toBe("neutral")
  })
  it("falls back to neutral for null/undefined", () => {
    expect(variantForStatus(null)).toBe("neutral")
    expect(variantForStatus(undefined)).toBe("neutral")
  })
})

describe("variantForAction", () => {
  it("maps the cancel transition to danger", () => expect(variantForAction("cancelled")).toBe("danger"))
  it("maps confirm-type transitions to success", () => {
    expect(variantForAction("confirmed")).toBe("success")
    expect(variantForAction("shipped")).toBe("success")
    expect(variantForAction("completed")).toBe("success")
  })
  it("falls back to neutral for an unrecognized transition target", () => {
    expect(variantForAction("some_future_status")).toBe("neutral")
  })
})
