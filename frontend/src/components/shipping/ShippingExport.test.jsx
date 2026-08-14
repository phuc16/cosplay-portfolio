import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminListShippingExportOrders = vi.fn()
const adminSetShippingPayer = vi.fn()
const adminGenerateShippingExport = vi.fn()

vi.mock("../../api/shop", () => ({
  adminListShippingExportOrders: (...args) => adminListShippingExportOrders(...args),
  adminSetShippingPayer: (...args) => adminSetShippingPayer(...args),
  adminGenerateShippingExport: (...args) => adminGenerateShippingExport(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.URL.createObjectURL = vi.fn(() => "blob:mock")
globalThis.URL.revokeObjectURL = vi.fn()

// The component builds a throwaway <a download="..."> and calls .click() on
// it to trigger the browser download — capture the download attribute at
// the moment of the click so tests can assert the exported filename, and
// stub out the click so jsdom doesn't attempt to navigate to a blob: URL.
let lastAnchorDownload = null
vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(function anchorClick() {
  lastAnchorDownload = this.download
})

const { default: ShippingExport } = await import("./ShippingExport")

function order(over = {}) {
  return {
    id: 1, order_code: "DH1", buyer_name: "Nguyễn Văn A", phone: "0901234567",
    address_province: "Hồ Chí Minh", total: 120000, cod_amount: null,
    payment_method: "bank", shipping_payer: "buyer", ...over,
  }
}

async function renderShippingExport() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<ShippingExport />) })
  return container
}

async function flush() { await act(async () => {}) }
async function click(el) { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })) }) }

function setInputValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

function setSelectValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

async function selectOrderAndFillBatch(container) {
  const checkbox = container.querySelector('input[type="checkbox"]')
  await click(checkbox)
  await act(async () => setInputValue(container.querySelector('[data-testid="ten-hang-hoa"]'), "Photocard"))
  await act(async () => setInputValue(container.querySelector('[data-testid="trong-luong"]'), "50"))
  await act(async () => setSelectValue(container.querySelector('[data-testid="thoi-gian-hen-lay"]'), "Ngày mai - Cả ngày"))
}

beforeEach(() => {
  adminListShippingExportOrders.mockReset()
  adminSetShippingPayer.mockReset()
  adminGenerateShippingExport.mockReset()
  lastAnchorDownload = null
})

describe("ShippingExport", () => {
  it("shows an empty state when no orders are eligible", async () => {
    adminListShippingExportOrders.mockResolvedValue([])
    const container = await renderShippingExport()
    await flush()
    expect(container.textContent).toContain("Không có đơn nào cần xuất")
  })

  it("lists eligible orders with a checkbox each", async () => {
    adminListShippingExportOrders.mockResolvedValue([order(), order({ id: 2, order_code: "DH2" })])
    const container = await renderShippingExport()
    await flush()
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(4)
    expect(container.textContent).toContain("DH1")
    expect(container.textContent).toContain("DH2")
  })

  it("filters the visible list by order code, name, or phone, client-side (no extra API call)", async () => {
    adminListShippingExportOrders.mockResolvedValue([
      order({ id: 1, order_code: "DH1", buyer_name: "Nguyễn Văn A", phone: "0901234567" }),
      order({ id: 2, order_code: "DH2", buyer_name: "Trần Thị B", phone: "0909999999" }),
    ])
    const container = await renderShippingExport()
    await flush()
    adminListShippingExportOrders.mockClear()

    const searchInput = container.querySelector('input[placeholder="Mã đơn, tên, SĐT..."]')
    await act(async () => setInputValue(searchInput, "trần"))

    expect(container.textContent).toContain("DH2")
    expect(container.textContent).not.toContain("DH1")
    expect(adminListShippingExportOrders).not.toHaveBeenCalled()
  })

  it("shows a no-match message, not a crash, when the search matches nothing", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    const container = await renderShippingExport()
    await flush()

    const searchInput = container.querySelector('input[placeholder="Mã đơn, tên, SĐT..."]')
    await act(async () => setInputValue(searchInput, "nobody"))

    expect(container.textContent).toContain("Không tìm thấy đơn nào khớp")
  })

  it("toggles freeship via adminSetShippingPayer when the freeship checkbox is clicked", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminSetShippingPayer.mockResolvedValue({ ok: true })
    const container = await renderShippingExport()
    await flush()

    const freeshipToggle = container.querySelector('[data-testid="freeship-1"]')
    await click(freeshipToggle)

    expect(adminSetShippingPayer).toHaveBeenCalledWith(1, "seller")
  })

  it("reflects the server's response for the payer toggle instead of assuming success", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminSetShippingPayer.mockResolvedValue({ ok: true })
    const container = await renderShippingExport()
    await flush()

    const freeshipToggle = container.querySelector('[data-testid="freeship-1"]')
    await click(freeshipToggle)

    expect(freeshipToggle.checked).toBe(true)
  })

  it("generates and triggers download of the export with the selected order and batch fields", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminGenerateShippingExport.mockResolvedValue({
      file_base64: btoa("fake-xlsx-bytes"), filename: "vtp-xuat-don-2026-08-08.xlsx",
      exported_count: 1, excluded: [],
    })
    const container = await renderShippingExport()
    await flush()

    await selectOrderAndFillBatch(container)

    const exportButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xuất file")
    await click(exportButton)

    expect(adminGenerateShippingExport).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({ ten_hang_hoa: "Photocard", trong_luong: 50, thoi_gian_hen_lay: "Ngày mai - Cả ngày" })
    )
  })

  it("uses the server's filename verbatim and revokes the object URL", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminGenerateShippingExport.mockResolvedValue({
      file_base64: btoa("fake-xlsx-bytes"), filename: "vtp-xuat-don-2026-08-08.xlsx",
      exported_count: 1, excluded: [],
    })
    const container = await renderShippingExport()
    await flush()
    await selectOrderAndFillBatch(container)

    const exportButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xuất file")
    await click(exportButton)

    expect(globalThis.URL.createObjectURL).toHaveBeenCalled()
    expect(lastAnchorDownload).toBe("vtp-xuat-don-2026-08-08.xlsx")
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock")
  })

  it("shows excluded orders with their reasons after generating", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminGenerateShippingExport.mockResolvedValue({
      file_base64: btoa("x"), filename: "f.xlsx", exported_count: 0,
      excluded: [{ order_id: 1, reason: "no_address", message: "DH1: không có địa chỉ nhận hàng hợp lệ" }],
    })
    const container = await renderShippingExport()
    await flush()

    await selectOrderAndFillBatch(container)

    const exportButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xuất file")
    await click(exportButton)
    await flush()

    expect(container.textContent).toContain("không có địa chỉ nhận hàng hợp lệ")
  })

  it("shows an error message instead of crashing when generating the export fails", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminGenerateShippingExport.mockRejectedValue(new Error("network down"))
    const container = await renderShippingExport()
    await flush()

    await selectOrderAndFillBatch(container)

    const exportButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xuất file")
    await click(exportButton)
    await flush()

    expect(container.textContent).toContain("Không xuất được file")
  })

  it("renders a readable Vietnamese explanation for every known exclusion reason, never blank or snake_case", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminGenerateShippingExport.mockResolvedValue({
      file_base64: btoa("x"), filename: "f.xlsx", exported_count: 0,
      excluded: [
        { order_id: 1, reason: "no_address", message: "" },
        { order_id: 2, reason: "cod_missing_amount", message: "" },
        { order_id: 3, reason: "not_found", message: "" },
        { order_id: 4, reason: "not_eligible", message: "" },
      ],
    })
    const container = await renderShippingExport()
    await flush()

    await selectOrderAndFillBatch(container)

    const exportButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xuất file")
    await click(exportButton)
    await flush()

    const items = [...container.querySelectorAll("li")]
    expect(items).toHaveLength(4)
    for (const li of items) {
      expect(li.textContent.trim()).not.toBe("")
      expect(li.textContent).not.toMatch(/^[a-z_]+$/)
      expect(li.textContent).not.toMatch(/no_address|cod_missing_amount|not_found|not_eligible/)
    }
  })
})
