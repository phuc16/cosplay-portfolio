import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminListCollections = vi.fn()
const adminGetPickupRoster = vi.fn()
const adminSetOrderPrepared = vi.fn()

vi.mock("../../api/shop", () => ({
  adminListCollections: (...args) => adminListCollections(...args),
  adminGetPickupRoster: (...args) => adminGetPickupRoster(...args),
  adminSetOrderPrepared: (...args) => adminSetOrderPrepared(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: ShippingRoster } = await import("./ShippingRoster")

async function setSelectValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
  await act(async () => {
    setter.call(el, value)
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

async function setInputValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
  await act(async () => {
    setter.call(el, value)
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

async function renderComponent() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<ShippingRoster />) })
  return container
}
async function flush() { await act(async () => {}) }

beforeEach(() => {
  adminListCollections.mockReset()
  adminGetPickupRoster.mockReset()
  adminSetOrderPrepared.mockReset()
  adminListCollections.mockResolvedValue([{ id: 1, title: "Drop" }, { id: 2, title: "Drop 2" }])
})

describe("ShippingRoster", () => {
  it("prompts to choose a collection before any is selected", async () => {
    const container = await renderComponent()
    await flush()
    expect(container.textContent).toContain("Chọn một bộ sưu tập")
    expect(adminGetPickupRoster).not.toHaveBeenCalled()
  })

  it("renders one row per pickup order with items and paid/collect amount, sorted as returned", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [{ product_name: "Photocard", variant_label: "A1", qty: 2 }], paid: true, amount_due: 0,
        },
        {
          order_id: 2, order_code: "DH2", buyer_name: "Trần Văn B", phone: "0900000002",
          items: [{ product_name: "Poster", variant_label: "Std", qty: 1 }], paid: false, amount_due: 75000,
        },
      ],
      excluded: [],
    })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    const rows = container.querySelectorAll('[data-testid^="order-row-"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain("Ánh Dương")
    expect(rows[0].textContent).toContain("Đã thanh toán")
    expect(rows[1].textContent).toContain("75.000₫")
  })

  it("shows the buyer's note in the order's detail row, visible on print regardless of expand state", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [{ product_name: "Photocard", variant_label: "A1", qty: 2 }], paid: true, amount_due: 0,
          note: "Nhờ shop ký lên card giúp em",
        },
      ],
      excluded: [],
    })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    const detailRow = container.querySelector('[data-testid="order-detail-1"]')
    expect(detailRow.textContent).toContain("Nhờ shop ký lên card giúp em")
    // Must not be gated behind print:hidden - staff hand the printed page
    // over at pickup and need this visible without any on-screen interaction.
    expect(detailRow.className).not.toContain("print:hidden")
  })

  it("shows a prepaid row and a collect-at-handover row unmistakably differently", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [{ product_name: "Photocard", variant_label: "A1", qty: 2 }], paid: true, amount_due: 0,
        },
        {
          order_id: 2, order_code: "DH2", buyer_name: "Trần Văn B", phone: "0900000002",
          items: [{ product_name: "Poster", variant_label: "Std", qty: 1 }], paid: false, amount_due: 75000,
        },
      ],
      excluded: [],
    })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    const rows = container.querySelectorAll('[data-testid^="order-row-"]')
    const paidRow = rows[0]
    const codRow = rows[1]
    expect(paidRow.textContent).toContain("Đã thanh toán")
    expect(paidRow.textContent).toContain("-")
    expect(paidRow.textContent).not.toContain("75.000₫")
    expect(codRow.textContent).toContain("Thu khi giao")
    expect(codRow.textContent).toContain("75.000₫")
  })

  it("renders items with product name, variant label and quantity", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [
            { product_name: "Photocard", variant_label: "A1", qty: 2 },
            { product_name: "Keychain", variant_label: "B2", qty: 3 },
          ],
          paid: true, amount_due: 0,
        },
      ],
      excluded: [],
    })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    const detail = container.querySelector('[data-testid="order-detail-1"]')
    expect(detail.textContent).toContain("Photocard")
    expect(detail.textContent).toContain("A1")
    expect(detail.textContent).toContain("× 2")
    expect(detail.textContent).toContain("Keychain")
    expect(detail.textContent).toContain("B2")
    expect(detail.textContent).toContain("× 3")
  })

  it("collapses the item list on screen behind a toggle, but always renders it in full for print", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [
            { product_name: "Photocard", variant_label: "A1", qty: 2 },
            { product_name: "Keychain", variant_label: "B2", qty: 3 },
          ],
          paid: true, amount_due: 0,
        },
      ],
      excluded: [],
    })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    const detail = container.querySelector('[data-testid="order-detail-1"]')
    // Its own full-width row below the order row, not crammed into the
    // narrow "Sản phẩm" cell - collapsed by default on screen, but the print
    // override keeps it in the DOM and visible when the page is printed.
    expect(detail.className).toContain("hidden")
    expect(detail.className).toContain("print:table-row")
    expect(detail.textContent).toContain("Photocard")

    const toggle = container.querySelector('[data-testid="order-row-1"] button')
    expect(toggle.textContent).toBe("2 sản phẩm")

    await act(async () => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(container.querySelector('[data-testid="order-detail-1"]').className).not.toContain("hidden")
    expect(container.querySelector('[data-testid="order-row-1"] button').textContent).toBe("Ẩn")
  })

  it("shows a variant photo per item when the row has one, and a placeholder when it doesn't", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [
            { product_name: "Photocard", variant_label: "A1", qty: 2, image_url: "/api/storage/shop/a.webp" },
            { product_name: "Keychain", variant_label: "B2", qty: 3, image_url: null },
          ],
          paid: true, amount_due: 0,
        },
      ],
      excluded: [],
    })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    expect(container.querySelector('img[src="/api/storage/shop/a.webp"]')).not.toBeNull()
  })

  it("badges a digital item mixed into a pickup order's item list, so it isn't invisible to staff packing the physical one", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [
            { product_name: "Photocard", variant_label: "A1", qty: 1, delivery_link: null },
            { product_name: "Digital Bonus", variant_label: "", qty: 1, delivery_link: "https://drive.google.com/x" },
          ],
          paid: true, amount_due: 0,
        },
      ],
      excluded: [],
    })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    const detail = container.querySelector('[data-testid="order-detail-1"]')
    expect(detail.textContent).toContain("Sản phẩm số")
  })

  it("shows a '+ Sản phẩm số' badge next to the order code, matching the export queue's cue", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [{ product_name: "Photocard", variant_label: "A1", qty: 1 }],
          paid: true, amount_due: 0, has_digital_item: true,
        },
      ],
      excluded: [],
    })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    const row = container.querySelector('[data-testid="order-row-1"]')
    expect(row.textContent).toContain("+ Sản phẩm số")
  })

  it("does not show the '+' badge for a purely physical order", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [{ product_name: "Photocard", variant_label: "A1", qty: 1 }],
          paid: true, amount_due: 0, has_digital_item: false,
        },
      ],
      excluded: [],
    })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    const row = container.querySelector('[data-testid="order-row-1"]')
    expect(row.textContent).not.toContain("+ Sản phẩm số")
  })

  it("shows a prepared pill defaulting to 'Cần đóng gói', toggling it via adminSetOrderPrepared", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [{ product_name: "Photocard", variant_label: "A1", qty: 2 }], paid: true, amount_due: 0,
          prepared: false,
        },
      ],
      excluded: [],
    })
    adminSetOrderPrepared.mockResolvedValue({ ok: true })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    const toggle = container.querySelector('[data-testid="prepared-1"]')
    expect(toggle.textContent).toBe("Cần đóng gói")

    await act(async () => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await flush()

    expect(adminSetOrderPrepared).toHaveBeenCalledWith(1, true)
    expect(container.querySelector('[data-testid="prepared-1"]').textContent).toBe("Đã đóng gói")
  })

  it("shows excluded orders with their reason", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [],
      excluded: [{ order_id: 5, reason: "cod_missing_amount", message: "DH5: đơn COD nhưng chưa có số tiền thu hộ" }],
    })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    expect(container.textContent).toContain("đơn COD nhưng chưa có số tiền thu hộ")
  })

  it("renders the pickup code for a row that has one", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [{ product_name: "Photocard", variant_label: "A1", qty: 2 }], paid: true, amount_due: 0,
          pickup_code: "PICKUP-7X2K",
        },
      ],
      excluded: [],
    })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    expect(container.textContent).toContain("Mã nhận hàng")
    const row = container.querySelector("tbody tr")
    expect(row.textContent).toContain("PICKUP-7X2K")
  })

  it("has a print button", async () => {
    adminGetPickupRoster.mockResolvedValue({ rows: [], excluded: [] })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    const printButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "In")
    expect(printButton).toBeDefined()
  })

  it("shows an error message instead of crashing or hanging when the roster fetch fails", async () => {
    adminGetPickupRoster.mockRejectedValue(new Error("network down"))
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    expect(container.textContent).toContain("Không tải được danh sách nhận hàng")
  })

  it("ignores a stale response when the collection selection changes before it resolves", async () => {
    let resolveFirst
    adminGetPickupRoster.mockImplementation((id) => {
      if (id === "1") {
        return new Promise((resolve) => { resolveFirst = resolve })
      }
      return Promise.resolve({
        rows: [{
          order_id: 9, order_code: "DH9", buyer_name: "Người Hai", phone: "0900000009",
          items: [{ product_name: "Sticker", variant_label: "Set", qty: 1 }], paid: true, amount_due: 0,
        }],
        excluded: [],
      })
    })
    const container = await renderComponent()
    await flush()

    await setSelectValue(container.querySelector("select"), "1")
    await flush()
    await setSelectValue(container.querySelector("select"), "2")
    await flush()

    await act(async () => {
      resolveFirst({
        rows: [{
          order_id: 1, order_code: "DH1", buyer_name: "Người Một", phone: "0900000001",
          items: [{ product_name: "Photocard", variant_label: "A1", qty: 2 }], paid: true, amount_due: 0,
        }],
        excluded: [],
      })
    })

    expect(container.textContent).toContain("Người Hai")
    expect(container.textContent).not.toContain("Người Một")
  })

  it("hides non-matching rows on screen but keeps them for print, so a lookup can't shrink the printed roster", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [{ product_name: "Photocard", variant_label: "A1", qty: 2 }], paid: true, amount_due: 0,
        },
        {
          order_id: 2, order_code: "DH2", buyer_name: "Trần Văn B", phone: "0900000002",
          items: [{ product_name: "Poster", variant_label: "Std", qty: 1 }], paid: false, amount_due: 75000,
        },
      ],
      excluded: [],
    })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()
    adminGetPickupRoster.mockClear()

    const searchInput = container.querySelector('input[placeholder="Mã đơn, tên, SĐT, mã nhận..."]')
    await setInputValue(searchInput, "trần")

    const rows = container.querySelectorAll('[data-testid^="order-row-"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].className).toContain("hidden")
    expect(rows[0].className).toContain("print:table-row")
    expect(rows[1].className).not.toContain("hidden")

    // The non-matching order's detail row must also stay print-visible, so a
    // quick on-screen lookup can never shrink what actually gets printed.
    const details = container.querySelectorAll('[data-testid^="order-detail-"]')
    expect(details[0].className).toContain("hidden")
    expect(details[0].className).toContain("print:table-row")
    expect(adminGetPickupRoster).not.toHaveBeenCalled()
  })

  it("shows a no-match message, not a crash, when the search matches nothing", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [{ product_name: "Photocard", variant_label: "A1", qty: 2 }], paid: true, amount_due: 0,
        },
      ],
      excluded: [],
    })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    const searchInput = container.querySelector('input[placeholder="Mã đơn, tên, SĐT, mã nhận..."]')
    await setInputValue(searchInput, "nobody")

    expect(container.textContent).toContain("Không tìm thấy đơn nào khớp")
  })
})
