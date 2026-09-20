import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminGetBookkeepingStats = vi.fn()
const adminDownloadBookkeepingCsv = vi.fn()

vi.mock("../../api/shop", () => ({
  adminGetBookkeepingStats: (...args) => adminGetBookkeepingStats(...args),
  adminDownloadBookkeepingCsv: (...args) => adminDownloadBookkeepingCsv(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.URL.createObjectURL = vi.fn(() => "blob:mock")
globalThis.URL.revokeObjectURL = vi.fn()

// The component builds a throwaway <a download="..."> and calls .click() on
// it to trigger the browser download - capture the download attribute at
// the moment of the click so tests can assert the exported filename.
let lastAnchorDownload = null
vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(function anchorClick() {
  lastAnchorDownload = this.download
})

const { default: StatsBookkeeping } = await import("./StatsBookkeeping")

function bookkeepingStats(over = {}) {
  return {
    date_from: "2026-08-01", date_to: "2026-08-08",
    received: { bank: 100000, momo: 20000, paypal: 0, cod: 30000, cash: 0 }, received_total: 150000,
    awaiting_payment: 40000, to_collect: 10000, lost: 5000, pending_cod: 15000, shipping_cost: 25000,
    by_collection: [
      { collection_id: 1, collection_title: "Drop hè", received_total: 150000, awaiting_payment: 40000, to_collect: 10000, lost: 5000, pending_cod: 15000 },
    ],
    ...over,
  }
}

async function setDateInput(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
  await act(async () => {
    setter.call(el, value)
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

function findDateInput(container, labelText) {
  const label = [...container.querySelectorAll("label")].find((l) => l.textContent.startsWith(labelText))
  return label.querySelector("input")
}

async function renderStatsBookkeeping() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<StatsBookkeeping />) })
  return container
}

async function flush() {
  await act(async () => {})
}

async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
}

function findButton(container, text) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent === text)
}

function jsonErrorBlob(message) {
  return new Blob([JSON.stringify({ error: "invalid_input", message })], { type: "application/json" })
}

beforeEach(() => {
  adminGetBookkeepingStats.mockReset()
  adminDownloadBookkeepingCsv.mockReset()
  lastAnchorDownload = null
})

describe("StatsBookkeeping", () => {
  it("loads and renders totals when 'Xem' is clicked", async () => {
    adminGetBookkeepingStats.mockResolvedValue(bookkeepingStats())
    const container = await renderStatsBookkeeping()
    await flush()

    await click(findButton(container, "Xem"))

    expect(adminGetBookkeepingStats).toHaveBeenCalled()
    expect(container.textContent).toContain("150.000₫")
    expect(container.textContent).toContain("Drop hè")
  })

  it("shows an explicit empty state for a range with no orders", async () => {
    adminGetBookkeepingStats.mockResolvedValue(bookkeepingStats({ by_collection: [], received_total: 0 }))
    const container = await renderStatsBookkeeping()
    await flush()
    await click(findButton(container, "Xem"))

    expect(container.textContent).toContain("Không có đơn hàng nào")
  })

  it("downloads the CSV with the same date params shown on screen, even after editing the inputs without clicking 'Xem'", async () => {
    adminGetBookkeepingStats.mockResolvedValue(bookkeepingStats({ date_from: "2026-08-01", date_to: "2026-08-08" }))
    adminDownloadBookkeepingCsv.mockResolvedValue(new Blob(["csv"], { type: "text/csv" }))
    const container = await renderStatsBookkeeping()
    await flush()

    await click(findButton(container, "Xem"))

    // Edit the date inputs after loading, without clicking "Xem" again - the
    // screen still shows the August range, so the export must too.
    await setDateInput(findDateInput(container, "Từ ngày"), "2026-09-01")
    await setDateInput(findDateInput(container, "Đến ngày"), "2026-09-08")

    await click(findButton(container, "Xuất CSV"))

    expect(adminDownloadBookkeepingCsv).toHaveBeenCalledTimes(1)
    const params = adminDownloadBookkeepingCsv.mock.calls[0][0]
    expect(params.date_from).toBe("2026-08-01")
    expect(params.date_to).toBe("2026-08-08")
    expect(lastAnchorDownload).toBe("so-quy-2026-08-01-2026-08-08.csv")
  })

  it("surfaces the server's real Vietnamese message from a blob-wrapped 400 on CSV export, not a generic fallback", async () => {
    adminGetBookkeepingStats.mockResolvedValue(bookkeepingStats())
    adminDownloadBookkeepingCsv.mockRejectedValue({
      response: { status: 400, data: jsonErrorBlob("Ngày kết thúc phải sau ngày bắt đầu") },
    })
    const container = await renderStatsBookkeeping()
    await flush()

    await click(findButton(container, "Xem"))
    await click(findButton(container, "Xuất CSV"))
    await flush()

    expect(container.textContent).toContain("Ngày kết thúc phải sau ngày bắt đầu")
    expect(container.textContent).not.toContain("Không xuất được CSV")
  })

  it("surfaces the server's real Vietnamese message from a 400 on the JSON bookkeeping endpoint", async () => {
    adminGetBookkeepingStats.mockRejectedValue({
      response: { status: 400, data: { error: "invalid_input", message: "Cần chọn ngày bắt đầu và ngày kết thúc" } },
    })
    const container = await renderStatsBookkeeping()
    await flush()

    await click(findButton(container, "Xem"))

    expect(container.textContent).toContain("Cần chọn ngày bắt đầu và ngày kết thúc")
  })

  it("falls back to a generic message when the blob error body can't be parsed", async () => {
    adminGetBookkeepingStats.mockResolvedValue(bookkeepingStats())
    adminDownloadBookkeepingCsv.mockRejectedValue({
      response: { status: 400, data: new Blob(["not json"], { type: "text/plain" }) },
    })
    const container = await renderStatsBookkeeping()
    await flush()

    await click(findButton(container, "Xem"))
    await click(findButton(container, "Xuất CSV"))
    await flush()

    expect(container.textContent).toContain("Không xuất được CSV")
  })

  it("labels shipping_cost as a recorded cost and never folds it into the received total", async () => {
    adminGetBookkeepingStats.mockResolvedValue(bookkeepingStats({ received_total: 150000, shipping_cost: 25000 }))
    const container = await renderStatsBookkeeping()
    await flush()
    await click(findButton(container, "Xem"))

    expect(container.textContent).toContain("Chi phí ship đã ghi nhận (chi phí, không phải doanh thu)")
    expect(container.textContent).not.toContain("175.000₫")
    expect(container.textContent).toContain("150.000₫")
    expect(container.textContent).toContain("25.000₫")
  })

  it("breaks received down per payment method and shows awaiting-payment and to-collect as distinct figures", async () => {
    adminGetBookkeepingStats.mockResolvedValue(bookkeepingStats())
    const container = await renderStatsBookkeeping()
    await flush()
    await click(findButton(container, "Xem"))

    expect(container.textContent).toContain("Ngân hàng 100.000₫")
    expect(container.textContent).toContain("Momo 20.000₫")
    expect(container.textContent).toContain("PayPal 0₫")
    expect(container.textContent).toContain("COD 30.000₫")
    expect(container.textContent).toContain("40.000₫")
    expect(container.textContent).toContain("10.000₫")
  })

  it("renders the pending-COD bucket as its own labelled figure, distinct from received_total", async () => {
    adminGetBookkeepingStats.mockResolvedValue(bookkeepingStats({ received_total: 150000, pending_cod: 15000 }))
    const container = await renderStatsBookkeeping()
    await flush()
    await click(findButton(container, "Xem"))

    expect(container.textContent).toContain("Đơn COD chưa xác nhận")
    expect(container.textContent).toContain("15.000₫")
    expect(container.textContent).not.toContain("165.000₫") // never folded into received_total
  })

  it("renders the no-collection bucket with its backend-provided label", async () => {
    adminGetBookkeepingStats.mockResolvedValue(bookkeepingStats({
      by_collection: [
        { collection_id: null, collection_title: "Không thuộc bộ sưu tập", received_total: 50000, awaiting_payment: 0, to_collect: 0, lost: 0 },
      ],
    }))
    const container = await renderStatsBookkeeping()
    await flush()
    await click(findButton(container, "Xem"))

    expect(container.textContent).toContain("Không thuộc bộ sưu tập")
  })

  it("discards a stale response when a later 'Xem' click resolves first (out-of-order race)", async () => {
    let resolveFirst
    let resolveSecond
    let callCount = 0
    adminGetBookkeepingStats.mockImplementation(() => {
      callCount += 1
      if (callCount === 1) return new Promise((resolve) => { resolveFirst = resolve })
      return new Promise((resolve) => { resolveSecond = resolve })
    })

    const container = await renderStatsBookkeeping()
    await flush()

    const viewButton = findButton(container, "Xem")
    // Dispatch both clicks inside a single act() so the second click fires
    // before React has re-rendered the button as disabled - this is the
    // narrow window in which two in-flight requests can genuinely race.
    await act(async () => {
      viewButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      viewButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await act(async () => { resolveSecond(bookkeepingStats({ received_total: 99000 })) })
    await act(async () => { resolveFirst(bookkeepingStats({ received_total: 35000 })) })

    expect(container.textContent).toContain("99.000₫")
    expect(container.textContent).not.toContain("35.000₫")
  })
})
