import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminListCollections = vi.fn()
const adminGetDropStats = vi.fn()
const adminDownloadDropStatsCsv = vi.fn()

vi.mock("../../api/shop", () => ({
  adminListCollections: (...args) => adminListCollections(...args),
  adminGetDropStats: (...args) => adminGetDropStats(...args),
  adminDownloadDropStatsCsv: (...args) => adminDownloadDropStatsCsv(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.URL.createObjectURL = vi.fn(() => "blob:mock")
globalThis.URL.revokeObjectURL = vi.fn()

const { default: StatsDrop } = await import("./StatsDrop")

function dropStats(over = {}) {
  return {
    collection_id: 1, collection_title: "Drop",
    received: { bank: 35000, momo: 0, paypal: 0, cod: 0 }, received_total: 35000,
    awaiting_payment: 0, to_collect: 0, lost: 0, pending_cod: 0,
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
  adminDownloadDropStatsCsv.mockReset()
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

  it("renders the pending-COD bucket as its own labelled figure, distinct from received_total", async () => {
    adminGetDropStats.mockResolvedValue(dropStats({ received_total: 35000, pending_cod: 12000 }))
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    expect(container.textContent).toContain("Đơn COD chưa xác nhận")
    expect(container.textContent).toContain("12.000₫")
    expect(container.textContent).not.toContain("47.000₫") // never folded into received_total
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

  it("shows 'không giới hạn' specifically in the sell-through cell for an unlimited variant, not '—'", async () => {
    adminGetDropStats.mockResolvedValue(dropStats({
      variants: [{ variant_id: 9, product_name: "Poster", variant_label: "Std", sold: 3, deleted: false, unlimited: true, remaining: null, sell_through: null, time_to_sellout_days: null }],
    }))
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    const row = Array.from(container.querySelectorAll("tbody tr")).find((tr) => tr.textContent.includes("Poster"))
    const cells = row.querySelectorAll("td")
    const remainingCell = cells[3]
    const sellThroughCell = cells[4]
    expect(remainingCell.textContent).toBe("không giới hạn")
    expect(sellThroughCell.textContent).toBe("không giới hạn")
  })

  it("renders time_to_sellout_days rounded up with a 'ngày' suffix when non-null", async () => {
    adminGetDropStats.mockResolvedValue(dropStats({
      variants: [{ variant_id: 7, product_name: "Badge", variant_label: "Std", sold: 2, deleted: false, unlimited: false, remaining: 3, sell_through: 0.4, time_to_sellout_days: 4.2 }],
    }))
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    const row = Array.from(container.querySelectorAll("tbody tr")).find((tr) => tr.textContent.includes("Badge"))
    const timeCell = row.querySelectorAll("td")[5]
    expect(timeCell.textContent).toBe("5 ngày")
  })

  it("renders no time-to-sellout value when time_to_sellout_days is null", async () => {
    adminGetDropStats.mockResolvedValue(dropStats({
      variants: [{ variant_id: 8, product_name: "Sticker", variant_label: "Std", sold: 1, deleted: false, unlimited: false, remaining: 5, sell_through: 0.1, time_to_sellout_days: null }],
    }))
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    const row = Array.from(container.querySelectorAll("tbody tr")).find((tr) => tr.textContent.includes("Sticker"))
    const timeCell = row.querySelectorAll("td")[5]
    expect(timeCell.textContent).not.toMatch(/ngày/)
    expect(timeCell.textContent).toBe("—")
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

  it("discards a stale response when a later selection resolves first (out-of-order race)", async () => {
    let resolveFirst
    let resolveSecond
    adminGetDropStats.mockImplementation((id) => {
      if (id === "1") return new Promise((resolve) => { resolveFirst = resolve })
      return new Promise((resolve) => { resolveSecond = resolve })
    })
    adminListCollections.mockResolvedValue([{ id: 1, title: "Drop" }, { id: 2, title: "Second Drop" }])

    const container = await renderStatsDrop()
    await flush()

    setSelectValue(container.querySelector("select"), "1")
    await flush()
    setSelectValue(container.querySelector("select"), "2")
    await flush()

    await act(async () => { resolveSecond(dropStats({ collection_id: 2, collection_title: "Second Drop", received_total: 99000 })) })
    await act(async () => { resolveFirst(dropStats({ collection_id: 1, collection_title: "Drop", received_total: 35000 })) })

    expect(container.textContent).toContain("99.000₫")
    expect(container.textContent).not.toContain("35.000₫")
  })

  it("shows an error message when the stats fetch rejects, instead of hanging or a blank view", async () => {
    adminGetDropStats.mockRejectedValue(new Error("network down"))
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    expect(container.textContent).toContain("Không tải được thống kê cho bộ sưu tập này")
    expect(container.querySelector("table")).toBeNull()
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

describe("StatsDrop — statistics emphasis (Admin UI plan)", () => {
  it("still renders all five money figures with their original values", async () => {
    adminGetDropStats.mockResolvedValue(dropStats({
      received_total: 500000, awaiting_payment: 70000, to_collect: 30000, lost: 10000, pending_cod: 20000,
    }))
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    expect(container.textContent).toContain("500.000₫")
    expect(container.textContent).toContain("70.000₫")
    expect(container.textContent).toContain("30.000₫")
    expect(container.textContent).toContain("10.000₫")
    expect(container.textContent).toContain("20.000₫")
  })

  it("gives the received figure a visibly larger/dominant treatment than the other four", async () => {
    adminGetDropStats.mockResolvedValue(dropStats({ received_total: 500000 }))
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    const dominant = [...container.querySelectorAll("*")].find((el) => el.textContent.trim() === "500.000₫")
    expect(dominant.className).toContain("text-3xl")
  })

  it("does not give the same dominant treatment to the four secondary figures", async () => {
    adminGetDropStats.mockResolvedValue(dropStats({ awaiting_payment: 70000 }))
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    const secondary = [...container.querySelectorAll("*")].find((el) => el.textContent.trim() === "70.000₫")
    expect(secondary.className).not.toContain("text-3xl")
  })
})

describe("StatsDrop — CSV export", () => {
  it("has no export button before a collection is selected", async () => {
    const container = await renderStatsDrop()
    await flush()
    const exportBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent.includes("Xuất CSV"))
    expect(exportBtn).toBeUndefined()
  })

  it("downloads a CSV for the selected collection", async () => {
    adminGetDropStats.mockResolvedValue(dropStats())
    adminDownloadDropStatsCsv.mockResolvedValue(new Blob(["csv"], { type: "text/csv" }))
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    const exportBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent.includes("Xuất CSV"))
    await act(async () => { exportBtn.click() })
    await flush()

    expect(adminDownloadDropStatsCsv).toHaveBeenCalledWith("1")
  })

  it("shows an error message when the CSV export fails", async () => {
    adminGetDropStats.mockResolvedValue(dropStats())
    adminDownloadDropStatsCsv.mockRejectedValue(new Error("network down"))
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    const exportBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent.includes("Xuất CSV"))
    await act(async () => { exportBtn.click() })
    await flush()

    expect(container.textContent).toContain("Không xuất được CSV")
  })
})
