import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { LanguageProvider } from "../../contexts/LanguageContext"

const adminListCollections = vi.fn()
const adminGetRestockStats = vi.fn()
const adminDownloadRestockStatsCsv = vi.fn()

vi.mock("../../api/shop", () => ({
  adminListCollections: (...args) => adminListCollections(...args),
  adminGetRestockStats: (...args) => adminGetRestockStats(...args),
  adminDownloadRestockStatsCsv: (...args) => adminDownloadRestockStatsCsv(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.URL.createObjectURL = vi.fn(() => "blob:mock")
globalThis.URL.revokeObjectURL = vi.fn()

const { default: StatsRestock } = await import("./StatsRestock")

async function renderStatsRestock() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <LanguageProvider>
        <StatsRestock />
      </LanguageProvider>
    )
  })
  return container
}

async function flush() {
  await act(async () => {})
}

// Opens the SearchableSelect trigger and clicks the option with this exact text.
async function pickOption(container, optionText) {
  const trigger = container.querySelector('button[aria-label="- Tất cả bộ sưu tập -"]')
  await act(async () => trigger.click())
  const optionBtn = [...container.querySelectorAll("li button")].find((b) => b.textContent === optionText)
  await act(async () => optionBtn.click())
}

beforeEach(() => {
  adminListCollections.mockReset()
  adminGetRestockStats.mockReset()
  adminDownloadRestockStatsCsv.mockReset()
  adminListCollections.mockResolvedValue([{ id: 1, title: "Drop" }, { id: 2, title: "Second Drop" }])
})

describe("StatsRestock", () => {
  it("shows an empty state with no data", async () => {
    adminGetRestockStats.mockResolvedValue([])
    const container = await renderStatsRestock()
    await flush()
    expect(container.textContent).toContain("Chưa có dữ liệu")
  })

  it("renders one row per variant, in the order the API returned them", async () => {
    adminGetRestockStats.mockResolvedValue([
      { variant_id: 1, label: "A1", product_name: "Fast card", collection_id: 1, collection_title: "Drop", stock_qty: 0, unlimited: false, remaining: 0, sold: 20, velocity: 5, sell_through: 1, time_to_sellout_days: 4 },
      { variant_id: 2, label: "B1", product_name: "Slow card", collection_id: 1, collection_title: "Drop", stock_qty: 90, unlimited: false, remaining: 90, sold: 1, velocity: 0.1, sell_through: 0.01, time_to_sellout_days: null },
    ])
    const container = await renderStatsRestock()
    await flush()

    const rows = container.querySelectorAll("tbody tr")
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain("Fast card")
    expect(rows[1].textContent).toContain("Slow card")
  })

  it("shows 'không giới hạn' for an unlimited variant's remaining and sell-through, in the right cells", async () => {
    adminGetRestockStats.mockResolvedValue([
      { variant_id: 3, label: "C1", product_name: "Sticker", collection_id: 1, collection_title: "Drop", stock_qty: null, unlimited: true, remaining: null, sold: 10, velocity: 2, sell_through: null, time_to_sellout_days: null },
    ])
    const container = await renderStatsRestock()
    await flush()

    const row = container.querySelector("tbody tr")
    expect(row.textContent).toContain("không giới hạn")

    const cells = row.querySelectorAll("td")
    // columns: collection, product, label, sold, remaining, velocity, sell-through, time-to-sellout
    const remainingCell = cells[4]
    const sellThroughCell = cells[6]
    expect(remainingCell.textContent).toBe("không giới hạn")
    expect(sellThroughCell.textContent).toBe("không giới hạn")
    expect(sellThroughCell.textContent).not.toBe("-")
    expect(sellThroughCell.textContent).not.toBe("0%")
  })

  it("renders time_to_sellout_days when non-null", async () => {
    adminGetRestockStats.mockResolvedValue([
      { variant_id: 4, label: "D1", product_name: "Badge", collection_id: 1, collection_title: "Drop", stock_qty: 0, unlimited: false, remaining: 0, sold: 8, velocity: 4, sell_through: 1, time_to_sellout_days: 4.2 },
    ])
    const container = await renderStatsRestock()
    await flush()

    const row = container.querySelector("tbody tr")
    const timeCell = row.querySelectorAll("td")[7]
    expect(timeCell.textContent).toContain("ngày")
    expect(timeCell.textContent).not.toBe("-")
  })

  it("renders no time-to-sellout value when time_to_sellout_days is null", async () => {
    adminGetRestockStats.mockResolvedValue([
      { variant_id: 5, label: "E1", product_name: "Poster", collection_id: 1, collection_title: "Drop", stock_qty: 20, unlimited: false, remaining: 20, sold: 1, velocity: 0.05, sell_through: 0.05, time_to_sellout_days: null },
    ])
    const container = await renderStatsRestock()
    await flush()

    const row = container.querySelector("tbody tr")
    const timeCell = row.querySelectorAll("td")[7]
    expect(timeCell.textContent).not.toMatch(/ngày/)
    expect(timeCell.textContent).toBe("-")
  })

  it("renders a velocity of 0 as 0, not blank or '-'", async () => {
    adminGetRestockStats.mockResolvedValue([
      { variant_id: 6, label: "F1", product_name: "Dead stock", collection_id: 1, collection_title: "Drop", stock_qty: 50, unlimited: false, remaining: 50, sold: 0, velocity: 0, sell_through: 0, time_to_sellout_days: null },
    ])
    const container = await renderStatsRestock()
    await flush()

    const row = container.querySelector("tbody tr")
    const velocityCell = row.querySelectorAll("td")[5]
    expect(velocityCell.textContent).toBe("0")
  })

  it("shows an error message when the stats fetch rejects, instead of hanging or a blank view", async () => {
    adminGetRestockStats.mockRejectedValue(new Error("network down"))
    const container = await renderStatsRestock()
    await flush()

    expect(container.textContent).toContain("Không tải được thống kê restock")
    expect(container.querySelector("table")).toBeNull()
  })

  it("prints the demand-invisibility limitation note (spec: sold-out variants hide true demand)", async () => {
    adminGetRestockStats.mockResolvedValue([])
    const container = await renderStatsRestock()
    await flush()
    expect(container.textContent).toContain("không còn hiển thị được")
  })

  it("loads all collections with no filter by default", async () => {
    adminGetRestockStats.mockResolvedValue([])
    await renderStatsRestock()
    await flush()
    expect(adminGetRestockStats).toHaveBeenCalledWith(undefined)
  })

  it("re-fetches scoped to the selected collection when the filter changes", async () => {
    adminGetRestockStats.mockResolvedValue([])
    const container = await renderStatsRestock()
    await flush()

    await pickOption(container, "Second Drop")
    await flush()

    expect(adminGetRestockStats).toHaveBeenLastCalledWith("2")
  })

  it("downloads a CSV scoped to the current filter", async () => {
    adminGetRestockStats.mockResolvedValue([])
    adminDownloadRestockStatsCsv.mockResolvedValue(new Blob(["csv"], { type: "text/csv" }))
    const container = await renderStatsRestock()
    await flush()

    await pickOption(container, "Second Drop")
    await flush()

    const exportBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent.includes("Xuất CSV"))
    await act(async () => { exportBtn.click() })
    await flush()

    expect(adminDownloadRestockStatsCsv).toHaveBeenCalledWith("2")
  })

  it("shows an error message when the CSV export fails", async () => {
    adminGetRestockStats.mockResolvedValue([])
    adminDownloadRestockStatsCsv.mockRejectedValue(new Error("network down"))
    const container = await renderStatsRestock()
    await flush()

    const exportBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent.includes("Xuất CSV"))
    await act(async () => { exportBtn.click() })
    await flush()

    expect(container.textContent).toContain("Không xuất được CSV")
  })
})
