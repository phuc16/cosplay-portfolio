import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminGetShopDisplaySettings = vi.fn()
const adminSaveShopDisplaySettings = vi.fn()

vi.mock("../api/shop", () => ({
  adminGetShopDisplaySettings: (...args) => adminGetShopDisplaySettings(...args),
  adminSaveShopDisplaySettings: (...args) => adminSaveShopDisplaySettings(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminShopGroupOrder } = await import("./AdminShopGroupOrder")

async function renderComponent() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<AdminShopGroupOrder />) })
  return container
}

async function flush() { await act(async () => {}) }

beforeEach(() => {
  adminGetShopDisplaySettings.mockReset().mockResolvedValue({ group_order: ["gacha", "digital", "physical"] })
  adminSaveShopDisplaySettings.mockReset().mockResolvedValue({ ok: true })
})

describe("AdminShopGroupOrder", () => {
  it("renders the loaded order top to bottom", async () => {
    const container = await renderComponent()
    await flush()

    const labels = [...container.querySelectorAll("li span")].map((s) => s.textContent)
    expect(labels).toEqual(["Gacha", "Sản phẩm số", "Sản phẩm vật lý"])
  })

  it("moves a group down and saves the new order", async () => {
    const container = await renderComponent()
    await flush()

    const downButtons = [...container.querySelectorAll('button[aria-label^="Đưa"][aria-label$="xuống"]')]
    const gachaDown = downButtons.find((b) => b.getAttribute("aria-label") === "Đưa Gacha xuống")
    await act(async () => { gachaDown.click() })

    let labels = [...container.querySelectorAll("li span")].map((s) => s.textContent)
    expect(labels).toEqual(["Sản phẩm số", "Gacha", "Sản phẩm vật lý"])

    const saveBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Lưu thứ tự")
    await act(async () => { saveBtn.click() })
    await flush()

    expect(adminSaveShopDisplaySettings).toHaveBeenCalledWith(["digital", "gacha", "physical"])
    expect(container.textContent).toContain("Đã lưu.")
  })

  it("disables the up arrow for the first item and the down arrow for the last", async () => {
    const container = await renderComponent()
    await flush()

    const items = [...container.querySelectorAll("li")]
    const firstUp = items[0].querySelector('button[aria-label$="lên"]')
    const lastDown = items[items.length - 1].querySelector('button[aria-label$="xuống"]')
    expect(firstUp.disabled).toBe(true)
    expect(lastDown.disabled).toBe(true)
  })

  it("shows an error message when saving fails", async () => {
    adminSaveShopDisplaySettings.mockRejectedValue(new Error("network down"))
    const container = await renderComponent()
    await flush()

    const saveBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Lưu thứ tự")
    await act(async () => { saveBtn.click() })
    await flush()

    expect(container.textContent).toContain("network down")
  })
})
