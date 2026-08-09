import { describe, it, expect, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

vi.mock("./shipping/ShippingExport", () => ({ default: () => <div data-testid="shipping-export" /> }))
vi.mock("./shipping/ShippingTrackingImport", () => ({ default: () => <div data-testid="shipping-tracking-import" /> }))
vi.mock("./shipping/ShippingRoster", () => ({ default: () => <div data-testid="shipping-roster" /> }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminShipping } = await import("./AdminShipping")

async function renderAdminShipping() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<AdminShipping />) })
  return container
}

describe("AdminShipping", () => {
  it("defaults to the export view", async () => {
    const container = await renderAdminShipping()
    expect(container.querySelector('[data-testid="shipping-export"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="shipping-tracking-import"]')).toBeNull()
  })

  it("switches to the tracking-import view on click", async () => {
    const container = await renderAdminShipping()
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Nhập mã vận đơn")
    await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(container.querySelector('[data-testid="shipping-tracking-import"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="shipping-export"]')).toBeNull()
  })

  it("switches to the roster view on click", async () => {
    const container = await renderAdminShipping()
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Danh sách nhận hàng")
    await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(container.querySelector('[data-testid="shipping-roster"]')).not.toBeNull()
  })
})
