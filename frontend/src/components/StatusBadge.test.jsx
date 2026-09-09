import { describe, it, expect } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: StatusBadge } = await import("./StatusBadge")

async function render(props) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<StatusBadge {...props} />) })
  return container
}

describe("StatusBadge", () => {
  it("renders the label verbatim", async () => {
    const el = await render({ label: "Đã xác nhận", variant: "success" })
    expect(el.textContent).toBe("Đã xác nhận")
  })

  it("uses only the four semantic token names for the success variant", async () => {
    const el = await render({ label: "x", variant: "success" })
    const span = el.querySelector("span")
    expect(span.className).toContain("var(--surface-success)")
    expect(span.className).toContain("var(--border-success)")
    expect(span.className).toContain("var(--text-success)")
  })

  it("uses the danger tokens for the danger variant", async () => {
    const el = await render({ label: "x", variant: "danger" })
    const span = el.querySelector("span")
    expect(span.className).toContain("var(--surface-danger)")
    expect(span.className).toContain("var(--border-danger)")
    expect(span.className).toContain("var(--text-danger)")
  })

  it("uses the warning tokens for the warning variant", async () => {
    const el = await render({ label: "x", variant: "warning" })
    const span = el.querySelector("span")
    expect(span.className).toContain("var(--surface-warning)")
  })

  it("falls back to the neutral tokens for an unrecognized variant, never rendering an empty class", async () => {
    const el = await render({ label: "x", variant: "some_future_variant" })
    const span = el.querySelector("span")
    expect(span.className).toContain("var(--surface-neutral)")
    expect(span.className).toContain("var(--border-neutral)")
    expect(span.className).toContain("var(--text-neutral)")
  })

  it("defaults to neutral when no variant prop is given", async () => {
    const el = await render({ label: "x" })
    const span = el.querySelector("span")
    expect(span.className).toContain("var(--surface-neutral)")
  })
})
