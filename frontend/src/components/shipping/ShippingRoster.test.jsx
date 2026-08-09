import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminListCollections = vi.fn()
const adminGetPickupRoster = vi.fn()

vi.mock("../../api/shop", () => ({
  adminListCollections: (...args) => adminListCollections(...args),
  adminGetPickupRoster: (...args) => adminGetPickupRoster(...args),
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

    const rows = container.querySelectorAll("tbody tr")
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain("Ánh Dương")
    expect(rows[0].textContent).toContain("Đã thanh toán")
    expect(rows[1].textContent).toContain("75.000₫")
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

    const rows = container.querySelectorAll("tbody tr")
    const paidRow = rows[0]
    const codRow = rows[1]
    expect(paidRow.textContent).toContain("Đã thanh toán")
    expect(paidRow.textContent).toContain("—")
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

    const row = container.querySelector("tbody tr")
    expect(row.textContent).toContain("Photocard")
    expect(row.textContent).toContain("A1")
    expect(row.textContent).toContain("x2")
    expect(row.textContent).toContain("Keychain")
    expect(row.textContent).toContain("B2")
    expect(row.textContent).toContain("x3")
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
})
