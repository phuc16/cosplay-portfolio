import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminListCollections = vi.fn()
const adminGetDropStats = vi.fn()

vi.mock("../../api/shop", () => ({
  adminListCollections: (...args) => adminListCollections(...args),
  adminGetDropStats: (...args) => adminGetDropStats(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: StatsDrop } = await import("./StatsDrop")

function dropStats(over = {}) {
  return {
    collection_id: 1, collection_title: "Drop",
    received: { bank: 35000, momo: 0, paypal: 0, cod: 0 }, received_total: 35000,
    awaiting_payment: 0, to_collect: 0, lost: 0,
    order_counts: { pending: 0, confirmed: 1, shipped: 0, completed: 0, cancelled: 0 },
    units_sold: 1, expiry_rate: null, prepaid_order_count: 0, expired_order_count: 0,
    fulfillment_counts: { ship: 1, pickup: 0 },
    variants: [
      { variant_id: 5, product_name: "Card", variant_label: "A1", sold: 1, deleted: false, unlimited: false, remaining: 4, sell_through: 0.2, time_to_sellout_days: null },
    ],
    ...over,
  }
}

function setSelectValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

async function renderStatsDrop() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<StatsDrop />) })
  return container
}

async function flush() {
  await act(async () => {})
}

beforeEach(() => {
  adminListCollections.mockReset()
  adminGetDropStats.mockReset()
  adminListCollections.mockResolvedValue([{ id: 1, title: "Drop" }])
})

describe("StatsDrop", () => {
  it("prompts to choose a collection before any is selected", async () => {
    const container = await renderStatsDrop()
    await flush()
    expect(container.textContent).toContain("Chọn một bộ sưu tập")
    expect(adminGetDropStats).not.toHaveBeenCalled()
  })

  it("loads and renders received/outstanding/lost after selecting a collection", async () => {
    adminGetDropStats.mockResolvedValue(dropStats())
    const container = await renderStatsDrop()
    await flush()

    setSelectValue(container.querySelector("select"), "1")
    await flush()

    expect(adminGetDropStats).toHaveBeenCalledWith("1")
    expect(container.textContent).toContain("35.000₫")
  })

  it("shows 'không giới hạn' for an unlimited variant, never a stock number", async () => {
    adminGetDropStats.mockResolvedValue(dropStats({
      variants: [{ variant_id: 9, product_name: "Poster", variant_label: "Std", sold: 3, deleted: false, unlimited: true, remaining: null, sell_through: null, time_to_sellout_days: null }],
    }))
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    expect(container.textContent).toContain("không giới hạn")
  })

  it("shows '—' for a deleted variant's remaining stock, never 0", async () => {
    adminGetDropStats.mockResolvedValue(dropStats({
      variants: [{ variant_id: null, product_name: "Old card", variant_label: "B2", sold: 2, deleted: true, unlimited: false, remaining: null, sell_through: null, time_to_sellout_days: null }],
    }))
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    const table = container.querySelector("table")
    expect(table.textContent).toContain("—")
    expect(table.textContent).not.toMatch(/\b0\b.*Old card|Old card.*\b0\b/)
  })

  it("prints the sell-through honesty caveat (spec: mid-drop restock shifts the number)", async () => {
    adminGetDropStats.mockResolvedValue(dropStats())
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    expect(container.textContent).toContain("nhập thêm hàng giữa đợt bán")
  })
})
