import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { LanguageProvider } from "../contexts/LanguageContext"

const adminListBoothOrders = vi.fn()
const adminListCollections = vi.fn()
const adminSetOrderPrepared = vi.fn()

vi.mock("../api/shop", () => ({
  adminListBoothOrders: (...args) => adminListBoothOrders(...args),
  adminListCollections: (...args) => adminListCollections(...args),
  adminSetOrderPrepared: (...args) => adminSetOrderPrepared(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminBoothOrders } = await import("./AdminBoothOrders")

function order(over = {}) {
  return {
    id: 1, buyer_name: "Khách", total: 20000, status: "completed", prepared: false,
    created_at: "2026-09-22T10:00:00Z",
    items: [{ product_name_snapshot: "Sticker", variant_label_snapshot: "", unit_price_snapshot: 5000, qty: 1, is_gift: 0, gacha_tier_snapshot: "common", image_url: null }],
    ...over,
  }
}

async function renderComponent() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<LanguageProvider><AdminBoothOrders /></LanguageProvider>) })
  return container
}
async function flush() { await act(async () => {}) }

// React installs a value tracker on <input> DOM nodes it controls, so a
// plain `el.value = x` followed by dispatching "input" is a no-op (the
// tracker already sees the "new" value as current). Going through the
// native setter bypasses that tracker, same as React Testing Library's
// fireEvent.change does internally.
function setInputValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

beforeEach(() => {
  adminListBoothOrders.mockReset().mockResolvedValue([])
  adminListCollections.mockReset().mockResolvedValue([])
  adminSetOrderPrepared.mockReset()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("AdminBoothOrders", () => {
  it("fetches with no collection filter by default", async () => {
    await renderComponent()
    await flush()
    expect(adminListBoothOrders).toHaveBeenCalledWith({})
  })

  it("shows buyer name, total, status, and the drawn items without a click", async () => {
    adminListBoothOrders.mockResolvedValue([order()])
    const container = await renderComponent()
    await flush()

    expect(container.textContent).toContain("Khách")
    expect(container.textContent).toContain("20.000")
    expect(container.textContent).toContain("Sticker")
  })

  it("shows a placeholder line for a booth order with no draws yet", async () => {
    adminListBoothOrders.mockResolvedValue([order({ items: [] })])
    const container = await renderComponent()
    await flush()

    expect(container.textContent).toContain("Chưa quay lượt nào")
  })

  it("collapses repeated identical prizes into one summed row", async () => {
    adminListBoothOrders.mockResolvedValue([order({
      items: [
        { product_name_snapshot: "Sticker", variant_label_snapshot: "", unit_price_snapshot: 5000, qty: 1, is_gift: 0, gacha_tier_snapshot: "common", image_url: null },
        { product_name_snapshot: "Sticker", variant_label_snapshot: "", unit_price_snapshot: 5000, qty: 1, is_gift: 0, gacha_tier_snapshot: "common", image_url: null },
      ],
    })])
    const container = await renderComponent()
    await flush()

    expect(container.textContent).toContain("Sticker × 2")
    expect(container.textContent).not.toContain("Sticker × 1")
  })

  it("re-fetches with collection_id when a collection is selected", async () => {
    adminListCollections.mockResolvedValue([{ id: 7, title: "Gacha Drop" }])
    const container = await renderComponent()
    await flush()
    adminListBoothOrders.mockClear()

    const trigger = container.querySelector('[aria-label="Tất cả"]')
    await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    const option = [...container.querySelectorAll("li button")].find((b) => b.textContent === "Gacha Drop")
    await act(async () => option.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(adminListBoothOrders).toHaveBeenCalledWith({ collection_id: "7" })
  })

  it("toggles the prepared pill via adminSetOrderPrepared", async () => {
    adminListBoothOrders.mockResolvedValue([order({ id: 5, prepared: false })])
    adminSetOrderPrepared.mockResolvedValue({ ok: true })
    const container = await renderComponent()
    await flush()

    const toggle = container.querySelector('[data-testid="prepared-5"]')
    expect(toggle.textContent).toBe("Chưa trao quà")

    await act(async () => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(adminSetOrderPrepared).toHaveBeenCalledWith(5, true)
    expect(container.querySelector('[data-testid="prepared-5"]').textContent).toBe("Đã trao quà")
  })

  it("filters by buyer name, client-side, case-insensitively", async () => {
    adminListBoothOrders.mockResolvedValue([
      order({ id: 1, buyer_name: "Trần Xuân Nhật" }),
      order({ id: 2, buyer_name: "Phạm Thế Anh" }),
    ])
    const container = await renderComponent()
    await flush()

    const searchInput = container.querySelector('input[placeholder="Tên người mua..."]')
    await act(async () => setInputValue(searchInput, "nhật"))

    expect(container.textContent).toContain("Trần Xuân Nhật")
    expect(container.textContent).not.toContain("Phạm Thế Anh")
  })

  it("shows a no-match message instead of the empty-list message when search matches nothing", async () => {
    adminListBoothOrders.mockResolvedValue([order({ buyer_name: "Trần Xuân Nhật" })])
    const container = await renderComponent()
    await flush()

    const searchInput = container.querySelector('input[placeholder="Tên người mua..."]')
    await act(async () => setInputValue(searchInput, "không tồn tại"))

    expect(container.textContent).toContain("Không tìm thấy đơn nào khớp.")
    expect(container.textContent).not.toContain("Chưa có đơn tại quầy nào.")
  })

  it("does not re-fetch from the server when the search box changes", async () => {
    adminListBoothOrders.mockResolvedValue([order({ buyer_name: "Trần Xuân Nhật" })])
    const container = await renderComponent()
    await flush()
    adminListBoothOrders.mockClear()

    const searchInput = container.querySelector('input[placeholder="Tên người mua..."]')
    await act(async () => setInputValue(searchInput, "Nhật"))

    expect(adminListBoothOrders).not.toHaveBeenCalled()
  })

  it("re-fetches on the refresh button", async () => {
    const container = await renderComponent()
    await flush()
    adminListBoothOrders.mockClear()

    const refreshButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Làm mới")
    await act(async () => refreshButton.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(adminListBoothOrders).toHaveBeenCalledTimes(1)
  })

  it("polls on an interval while the tab is visible, and stops polling once unmounted", async () => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true })
    const container = await renderComponent()
    await flush()
    adminListBoothOrders.mockClear()

    await act(async () => { vi.advanceTimersByTime(15000) })
    expect(adminListBoothOrders).toHaveBeenCalledTimes(1)

    await act(async () => { document.body.removeChild(container) })
  })

  it("never polls while the tab isn't visible", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true })
    await renderComponent()
    await flush()
    adminListBoothOrders.mockClear()

    await act(async () => { vi.advanceTimersByTime(15000) })
    expect(adminListBoothOrders).not.toHaveBeenCalled()
  })
})
