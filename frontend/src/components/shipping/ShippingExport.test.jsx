import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { LanguageProvider } from "../../contexts/LanguageContext"

const adminListShippingExportOrders = vi.fn()
const adminSetShippingPayer = vi.fn()
const adminSetOrderPrepared = vi.fn()
const adminGenerateShippingExport = vi.fn()
const adminGetOrder = vi.fn()
const adminListCollections = vi.fn()

vi.mock("../../api/shop", () => ({
  adminListShippingExportOrders: (...args) => adminListShippingExportOrders(...args),
  adminSetShippingPayer: (...args) => adminSetShippingPayer(...args),
  adminSetOrderPrepared: (...args) => adminSetOrderPrepared(...args),
  adminGenerateShippingExport: (...args) => adminGenerateShippingExport(...args),
  adminGetOrder: (...args) => adminGetOrder(...args),
  adminListCollections: (...args) => adminListCollections(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.URL.createObjectURL = vi.fn(() => "blob:mock")
globalThis.URL.revokeObjectURL = vi.fn()

// The component builds a throwaway <a download="..."> and calls .click() on
// it to trigger the browser download - capture the download attribute at
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
    payment_method: "bank", shipping_payer: "buyer", prepared: false, ...over,
  }
}

async function renderShippingExport() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<LanguageProvider><ShippingExport /></LanguageProvider>) })
  return container
}

async function flush() { await act(async () => {}) }
async function click(el) { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })) }) }

function setInputValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

async function pickOption(container, testId, optionText) {
  const trigger = container.querySelector(`[data-testid="${testId}"]`)
  await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })))
  const optionBtn = [...container.querySelectorAll("li button")].find((b) => b.textContent === optionText)
  await act(async () => optionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
}

async function selectOrderAndFillBatch(container) {
  const checkbox = container.querySelector('input[aria-label="Chọn đơn DH1"]')
  await click(checkbox)
  await act(async () => setInputValue(container.querySelector('[data-testid="ten-hang-hoa"]'), "Photocard"))
  await act(async () => setInputValue(container.querySelector('[data-testid="trong-luong"]'), "50"))
  await pickOption(container, "thoi-gian-hen-lay", "Ngày mai - Cả ngày")
}

beforeEach(() => {
  adminListShippingExportOrders.mockReset()
  adminSetShippingPayer.mockReset()
  adminSetOrderPrepared.mockReset()
  adminGenerateShippingExport.mockReset()
  adminGetOrder.mockReset()
  adminListCollections.mockReset()
  adminListCollections.mockResolvedValue([{ id: 1, title: "Drop" }, { id: 2, title: "Drop 2" }])
  lastAnchorDownload = null
})

describe("ShippingExport", () => {
  it("shows an empty state when no orders are eligible", async () => {
    adminListShippingExportOrders.mockResolvedValue([])
    const container = await renderShippingExport()
    await flush()
    expect(container.textContent).toContain("Không có đơn nào cần xuất")
  })

  it("shows a '+ Sản phẩm số' badge for an order that also has a digital item", async () => {
    adminListShippingExportOrders.mockResolvedValue([order({ has_digital_item: true })])
    const container = await renderShippingExport()
    await flush()

    expect(container.textContent).toContain("+ Sản phẩm số")
  })

  it("shows the buyer's note inside the expandable detail row (click to reveal), not a hover tooltip", async () => {
    adminListShippingExportOrders.mockResolvedValue([order({ id: 1, note: "Nhờ shop ký lên card giúp em" })])
    adminGetOrder.mockResolvedValue({ id: 1, items: [] })
    const container = await renderShippingExport()
    await flush()

    // Not visible before expanding - this is a click-to-reveal detail, not a
    // truncated cell with a hover tooltip (a long note previously overflowed
    // past the page edge as a title="" tooltip).
    expect(container.textContent).not.toContain("Nhờ shop ký lên card giúp em")

    const toggleButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sản phẩm")
    await click(toggleButton)
    await flush()

    expect(container.textContent).toContain("Nhờ shop ký lên card giúp em")
  })

  it("renders nothing extra in the detail row when there is no note", async () => {
    adminListShippingExportOrders.mockResolvedValue([order({ id: 1, note: null })])
    adminGetOrder.mockResolvedValue({ id: 1, items: [] })
    const container = await renderShippingExport()
    await flush()

    const toggleButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sản phẩm")
    await click(toggleButton)
    await flush()

    expect(container.textContent).not.toContain("null")
    expect(container.textContent).not.toContain("Ghi chú:")
  })

  it("does not show the badge for a purely physical order", async () => {
    adminListShippingExportOrders.mockResolvedValue([order({ has_digital_item: false })])
    const container = await renderShippingExport()
    await flush()

    expect(container.textContent).not.toContain("+ Sản phẩm số")
  })

  it("lists orders across all collections by default", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    await renderShippingExport()
    await flush()
    expect(adminListShippingExportOrders).toHaveBeenCalledWith(undefined)
  })

  it("refetches filtered by collection_id when a collection is chosen, and clears the current selection", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    const container = await renderShippingExport()
    await flush()

    const orderCheckbox = container.querySelector('input[aria-label="Chọn đơn DH1"]')
    await click(orderCheckbox)
    expect(orderCheckbox.checked).toBe(true)

    await pickOption(container, "collection-filter", "Drop 2")
    await flush()

    expect(adminListShippingExportOrders).toHaveBeenLastCalledWith("2")
    expect(container.querySelector('input[aria-label="Chọn đơn DH1"]').checked).toBe(false)
  })

  it("shows the staff packing queue number, or a dash when not yet assigned", async () => {
    adminListShippingExportOrders.mockResolvedValue([
      order({ id: 1, order_code: "DH1", queue_number: 3 }),
      order({ id: 2, order_code: "DH2", queue_number: null }),
    ])
    const container = await renderShippingExport()
    await flush()

    const rows = [...container.querySelectorAll("tbody tr")].filter((tr) => !tr.querySelector("td[colspan]"))
    expect(rows[0].textContent).toContain("3")
    expect(rows[1].querySelector("td:nth-child(2)").textContent).toBe("-")
  })

  it("lists eligible orders with a checkbox each", async () => {
    adminListShippingExportOrders.mockResolvedValue([order(), order({ id: 2, order_code: "DH2" })])
    const container = await renderShippingExport()
    await flush()
    // 1 select-all header checkbox + (1 select + 1 freeship) per order.
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(5)
    expect(container.textContent).toContain("DH1")
    expect(container.textContent).toContain("DH2")
  })

  it("select-all checks every order row and the header checkbox reflects it", async () => {
    adminListShippingExportOrders.mockResolvedValue([
      order({ id: 1, order_code: "DH1" }), order({ id: 2, order_code: "DH2" }),
    ])
    const container = await renderShippingExport()
    await flush()

    const selectAll = container.querySelector('input[aria-label="Chọn tất cả"]')
    expect(selectAll.checked).toBe(false)

    await click(selectAll)

    expect(container.querySelector('input[aria-label="Chọn đơn DH1"]').checked).toBe(true)
    expect(container.querySelector('input[aria-label="Chọn đơn DH2"]').checked).toBe(true)
    expect(selectAll.checked).toBe(true)
  })

  it("select-all again clears every order row", async () => {
    adminListShippingExportOrders.mockResolvedValue([
      order({ id: 1, order_code: "DH1" }), order({ id: 2, order_code: "DH2" }),
    ])
    const container = await renderShippingExport()
    await flush()

    const selectAll = container.querySelector('input[aria-label="Chọn tất cả"]')
    await click(selectAll)
    await click(selectAll)

    expect(container.querySelector('input[aria-label="Chọn đơn DH1"]').checked).toBe(false)
    expect(container.querySelector('input[aria-label="Chọn đơn DH2"]').checked).toBe(false)
    expect(selectAll.checked).toBe(false)
  })

  it("select-all only affects orders matching the current search, not the whole list", async () => {
    adminListShippingExportOrders.mockResolvedValue([
      order({ id: 1, order_code: "DH1", buyer_name: "Nguyễn Văn A" }),
      order({ id: 2, order_code: "DH2", buyer_name: "Trần Thị B" }),
    ])
    const container = await renderShippingExport()
    await flush()

    const searchInput = container.querySelector('input[placeholder="Mã đơn, tên, SĐT..."]')
    await act(async () => setInputValue(searchInput, "trần"))

    const selectAll = container.querySelector('input[aria-label="Chọn tất cả"]')
    await click(selectAll)

    await act(async () => setInputValue(searchInput, ""))

    expect(container.querySelector('input[aria-label="Chọn đơn DH1"]').checked).toBe(false)
    expect(container.querySelector('input[aria-label="Chọn đơn DH2"]').checked).toBe(true)
  })

  it("checking one order row individually does not check the select-all header (only a partial selection)", async () => {
    adminListShippingExportOrders.mockResolvedValue([
      order({ id: 1, order_code: "DH1" }), order({ id: 2, order_code: "DH2" }),
    ])
    const container = await renderShippingExport()
    await flush()

    await click(container.querySelector('input[aria-label="Chọn đơn DH1"]'))

    expect(container.querySelector('input[aria-label="Chọn tất cả"]').checked).toBe(false)
  })

  it("shows the buyer's phone so an admin can match an order without decoding order_code", async () => {
    adminListShippingExportOrders.mockResolvedValue([order({ phone: "0901234567" })])
    const container = await renderShippingExport()
    await flush()
    expect(container.textContent).toContain("0901234567")
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

  it("toggles prepared via adminSetOrderPrepared when the prepared pill is clicked", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminSetOrderPrepared.mockResolvedValue({ ok: true })
    const container = await renderShippingExport()
    await flush()

    const preparedToggle = container.querySelector('[data-testid="prepared-1"]')
    expect(preparedToggle.textContent).toBe("Cần đóng gói")
    await click(preparedToggle)

    expect(adminSetOrderPrepared).toHaveBeenCalledWith(1, true)
  })

  it("reflects the server's response for the prepared toggle instead of assuming success", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminSetOrderPrepared.mockResolvedValue({ ok: true })
    const container = await renderShippingExport()
    await flush()

    const preparedToggle = container.querySelector('[data-testid="prepared-1"]')
    await click(preparedToggle)

    expect(container.querySelector('[data-testid="prepared-1"]').textContent).toBe("Đã đóng gói")
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

  it("lazily loads and shows an order's items when 'Sản phẩm' is clicked, so the seller knows what to pack", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminGetOrder.mockResolvedValue({
      id: 1,
      items: [{ id: 11, product_name_snapshot: "Card", variant_label_snapshot: "A1", qty: 2 }],
    })
    const container = await renderShippingExport()
    await flush()
    expect(adminGetOrder).not.toHaveBeenCalled()

    const toggleButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sản phẩm")
    await click(toggleButton)
    await flush()

    expect(adminGetOrder).toHaveBeenCalledWith(1)
    expect(container.textContent).toContain("Card")
    expect(container.textContent).toContain("A1")
    expect(container.textContent).toContain("2")
  })

  it("badges a digital item in the expanded item list, matching the roster's per-item cue", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminGetOrder.mockResolvedValue({
      id: 1,
      items: [
        { id: 11, product_name_snapshot: "Card", variant_label_snapshot: "A1", qty: 1, delivery_link_snapshot: null },
        { id: 12, product_name_snapshot: "Digital Bonus", variant_label_snapshot: "", qty: 1, delivery_link_snapshot: "https://drive.google.com/x" },
      ],
    })
    const container = await renderShippingExport()
    await flush()

    const toggleButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sản phẩm")
    await click(toggleButton)
    await flush()

    expect(container.textContent).toContain("Digital Bonus")
    const items = [...container.querySelectorAll("li")]
    const digitalItem = items.find((li) => li.textContent.includes("Digital Bonus"))
    const physicalItem = items.find((li) => li.textContent.includes("Card"))
    expect(digitalItem.textContent).toContain("Sản phẩm số")
    expect(physicalItem.textContent).not.toContain("Sản phẩm số")
  })

  it("marks a free gift line and doesn't render a dangling separator for its blank variant label", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminGetOrder.mockResolvedValue({
      id: 1,
      items: [{ id: 11, product_name_snapshot: "Postcard", variant_label_snapshot: "", qty: 1, unit_price_snapshot: 0, is_gift: true }],
    })
    const container = await renderShippingExport()
    await flush()

    const toggleButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sản phẩm")
    await click(toggleButton)
    await flush()

    expect(container.textContent).toContain("🎁 Quà tặng")
    expect(container.textContent).not.toContain("Postcard ·")
  })

  it("does not render a stray '0' for a non-gift item (mysql2 returns is_gift as the number 0, not false)", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminGetOrder.mockResolvedValue({
      id: 1,
      items: [{ id: 11, product_name_snapshot: "Card", variant_label_snapshot: "A1", qty: 3, unit_price_snapshot: 40000, is_gift: 0 }],
    })
    const container = await renderShippingExport()
    await flush()

    const toggleButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sản phẩm")
    await click(toggleButton)
    await flush()

    expect(container.textContent).not.toContain("🎁 Quà tặng")
    const li = [...container.querySelectorAll("li")].find((el) => el.textContent.includes("Card"))
    expect(li.textContent.trim()).toBe("Card · A1 × 3")
  })

  it("shows a variant photo per item when the order has one", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminGetOrder.mockResolvedValue({
      id: 1,
      items: [{ id: 11, product_name_snapshot: "Card", variant_label_snapshot: "A1", qty: 2, image_url: "/api/storage/shop/a.webp" }],
    })
    const container = await renderShippingExport()
    await flush()

    const toggleButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sản phẩm")
    await click(toggleButton)
    await flush()

    expect(container.querySelector('img[src="/api/storage/shop/a.webp"]')).not.toBeNull()
  })

  it("collapses the items panel on a second click without re-fetching (cached)", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminGetOrder.mockResolvedValue({ id: 1, items: [{ id: 11, product_name_snapshot: "Card", variant_label_snapshot: "A1", qty: 1 }] })
    const container = await renderShippingExport()
    await flush()

    const toggle = () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Sản phẩm" || b.textContent === "Ẩn")
    await click(toggle())
    await flush()
    expect(container.textContent).toContain("Card")

    await click(toggle())
    await flush()
    expect(container.textContent).not.toContain("Card")

    await click(toggle())
    await flush()
    expect(container.textContent).toContain("Card")
    expect(adminGetOrder).toHaveBeenCalledTimes(1)
  })

  it("shows an error, not a crash, when loading an order's items fails", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminGetOrder.mockRejectedValue(new Error("network down"))
    const container = await renderShippingExport()
    await flush()

    const toggleButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sản phẩm")
    await click(toggleButton)
    await flush()

    expect(container.textContent).toContain("Không tải được sản phẩm")
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
