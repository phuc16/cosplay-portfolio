import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { LanguageProvider } from "../../contexts/LanguageContext"

const adminListGachaProducts = vi.fn()
const adminGetGachaDropStats = vi.fn()

vi.mock("../../api/shop", () => ({
  adminListGachaProducts: (...args) => adminListGachaProducts(...args),
  adminGetGachaDropStats: (...args) => adminGetGachaDropStats(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: StatsGacha } = await import("./StatsGacha")

function gachaStats(over = {}) {
  return {
    product_id: 1, product_name: "Mystery Case", collection_id: 1, collection_title: "Gacha Drop",
    prizes: [
      { id: 1, name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10, quantity_remaining: 5, drawn_online: 3, drawn_booth: 2 },
    ],
    tiers: [
      { tier: "common", drawn_online: 3, drawn_booth: 2, value_online: 15000, value_booth: 10000 },
      { tier: "rare", drawn_online: 0, drawn_booth: 0, value_online: 0, value_booth: 0 },
      { tier: "mythical", drawn_online: 0, drawn_booth: 0, value_online: 0, value_booth: 0 },
      { tier: "legendary", drawn_online: 0, drawn_booth: 0, value_online: 0, value_booth: 0 },
      { tier: "ancient", drawn_online: 0, drawn_booth: 0, value_online: 0, value_booth: 0 },
    ],
    revenue: { online: 60000, booth: 40000, total: 100000 },
    value_given_out: { online: 15000, booth: 10000, total: 25000 },
    ...over,
  }
}

async function renderStatsGacha() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<LanguageProvider><StatsGacha /></LanguageProvider>) })
  return container
}

async function flush() {
  await act(async () => {})
}

async function selectProductOption(container, label) {
  const trigger = container.querySelector('[aria-label="- Chọn một sản phẩm gacha -"]')
  await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })))
  const option = [...container.querySelectorAll("li button")].find((b) => b.textContent === label)
  await act(async () => option.dispatchEvent(new MouseEvent("click", { bubbles: true })))
}

beforeEach(() => {
  adminListGachaProducts.mockReset()
  adminGetGachaDropStats.mockReset()
  adminListGachaProducts.mockResolvedValue([{ id: 1, name: "Mystery Case", collection_id: 1, collection_title: "Gacha Drop" }])
})

describe("StatsGacha", () => {
  it("prompts to choose a product before any is selected", async () => {
    const container = await renderStatsGacha()
    await flush()
    expect(container.textContent).toContain("Chọn một sản phẩm gacha")
    expect(adminGetGachaDropStats).not.toHaveBeenCalled()
  })

  it("loads and renders revenue/value once a product is selected", async () => {
    adminGetGachaDropStats.mockResolvedValue(gachaStats())
    const container = await renderStatsGacha()
    await flush()

    await selectProductOption(container, "Gacha Drop · Mystery Case")
    await flush()

    expect(adminGetGachaDropStats).toHaveBeenCalledWith("1")
    expect(container.textContent).toContain("60.000₫") // revenue.online
    expect(container.textContent).toContain("40.000₫") // revenue.booth
    expect(container.textContent).toContain("100.000₫") // revenue.total
  })

  it("highlights both the tier rows and the prize rows on hover to separate each line", async () => {
    adminGetGachaDropStats.mockResolvedValue(gachaStats())
    const container = await renderStatsGacha()
    await flush()
    await selectProductOption(container, "Gacha Drop · Mystery Case")
    await flush()

    const rows = container.querySelectorAll("tbody tr")
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((row) => expect(row.className).toContain("hover:bg-[var(--brand-soft)]"))
  })

  it("shows the online/booth split per prize", async () => {
    adminGetGachaDropStats.mockResolvedValue(gachaStats())
    const container = await renderStatsGacha()
    await flush()
    await selectProductOption(container, "Gacha Drop · Mystery Case")
    await flush()

    expect(container.textContent).toContain("Sticker")
    const row = [...container.querySelectorAll("tbody tr")].find((r) => r.textContent.includes("Sticker"))
    expect(row.textContent).toContain("3") // drawn_online
    expect(row.textContent).toContain("2") // drawn_booth
    expect(row.textContent).toContain("5") // quantity_remaining
  })

  it("shows the per-tier rollup", async () => {
    adminGetGachaDropStats.mockResolvedValue(gachaStats())
    const container = await renderStatsGacha()
    await flush()
    await selectProductOption(container, "Gacha Drop · Mystery Case")
    await flush()

    expect(container.textContent).toContain("THƯỜNG")
  })

  it("shows an error message when the stats fetch fails", async () => {
    adminGetGachaDropStats.mockRejectedValue(new Error("network down"))
    const container = await renderStatsGacha()
    await flush()
    await selectProductOption(container, "Gacha Drop · Mystery Case")
    await flush()

    expect(container.textContent).toContain("Không tải được thống kê")
  })
})
