import { describe, it, expect, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

vi.mock("./stats/StatsDrop", () => ({ default: () => <div data-testid="stats-drop" /> }))
vi.mock("./stats/StatsRestock", () => ({ default: () => <div data-testid="stats-restock" /> }))
vi.mock("./stats/StatsBookkeeping", () => ({ default: () => <div data-testid="stats-bookkeeping" /> }))
vi.mock("./stats/StatsGacha", () => ({ default: () => <div data-testid="stats-gacha" /> }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminStats } = await import("./AdminStats")

async function renderAdminStats() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<AdminStats />) })
  return container
}

describe("AdminStats", () => {
  it("defaults to the drop view", async () => {
    const container = await renderAdminStats()
    expect(container.querySelector('[data-testid="stats-drop"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="stats-restock"]')).toBeNull()
  })

  it("switches to the restock view on click", async () => {
    const container = await renderAdminStats()
    const restockButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Restock")
    await act(async () => { restockButton.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(container.querySelector('[data-testid="stats-restock"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="stats-drop"]')).toBeNull()
  })

  it("switches to the bookkeeping view on click", async () => {
    const container = await renderAdminStats()
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sổ quỹ")
    await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(container.querySelector('[data-testid="stats-bookkeeping"]')).not.toBeNull()
  })

  it("switches to the gacha stats view on click", async () => {
    const container = await renderAdminStats()
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Gacha")
    await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(container.querySelector('[data-testid="stats-gacha"]')).not.toBeNull()
  })
})
