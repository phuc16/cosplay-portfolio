import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { LanguageProvider } from "../contexts/LanguageContext"
import { STATUS_LABELS, FULFILLMENT_METHOD_LABELS, labelFor } from "../admin/orderLabels"

const adminListOrders = vi.fn()
const adminListCollections = vi.fn()
const adminBulkCancelOrders = vi.fn()
const adminBulkCompleteOrders = vi.fn()
const adminGetOrder = vi.fn()
const adminTransitionOrder = vi.fn()
const adminGetOrderPayment = vi.fn()
const adminFindOrderByToken = vi.fn()
const adminUpdateOrderBuyerInfo = vi.fn()
// AddressFields.jsx (rendered inside the buyer-info edit form for a ship
// order) calls these on its own - must resolve, not just exist, or its
// mount-time effect throws synchronously.
const fetchProvinces = vi.fn().mockResolvedValue([])
const fetchWards = vi.fn().mockResolvedValue([])
const searchAddress = vi.fn().mockResolvedValue({ predictions: [] })

vi.mock("../api/shop", () => ({
  adminListOrders: (...args) => adminListOrders(...args),
  adminListCollections: (...args) => adminListCollections(...args),
  adminBulkCancelOrders: (...args) => adminBulkCancelOrders(...args),
  adminBulkCompleteOrders: (...args) => adminBulkCompleteOrders(...args),
  adminGetOrder: (...args) => adminGetOrder(...args),
  adminTransitionOrder: (...args) => adminTransitionOrder(...args),
  adminGetOrderPayment: (...args) => adminGetOrderPayment(...args),
  adminFindOrderByToken: (...args) => adminFindOrderByToken(...args),
  adminUpdateOrderBuyerInfo: (...args) => adminUpdateOrderBuyerInfo(...args),
  fetchProvinces: (...args) => fetchProvinces(...args),
  fetchWards: (...args) => fetchWards(...args),
  searchAddress: (...args) => searchAddress(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminOrders } = await import("./AdminOrders")

function order(over = {}) {
  return {
    id: 1, buyer_name: "A", phone: "090", status: "confirmed",
    fulfillment_method: "ship", payment_method: "bank", total: 35000,
    allowed_transitions: ["shipped", "cancelled"],
    ...over,
  }
}

async function renderAdminOrders() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <LanguageProvider>
        <AdminOrders />
      </LanguageProvider>
    )
  })
  return { container, root }
}

async function flush() {
  await act(async () => {})
}

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
  adminListOrders.mockReset()
  adminListCollections.mockReset()
  adminBulkCancelOrders.mockReset()
  adminBulkCompleteOrders.mockReset()
  adminGetOrder.mockReset()
  adminTransitionOrder.mockReset()
  adminGetOrderPayment.mockReset()
  adminFindOrderByToken.mockReset()
  adminUpdateOrderBuyerInfo.mockReset()
  adminListCollections.mockResolvedValue([{ id: 7, title: "Fes Drop" }])
  adminGetOrderPayment.mockResolvedValue(null)
  // Re-applied every test (not just at declaration) - some tests in this
  // file call vi.restoreAllMocks(), which would otherwise wipe these back
  // to a bare vi.fn() with no resolved value for every test that runs after.
  fetchProvinces.mockReset().mockResolvedValue([])
  fetchWards.mockReset().mockResolvedValue([])
  searchAddress.mockReset().mockResolvedValue({ predictions: [] })
})

describe("AdminOrders filters", () => {
  it("sends date_from/date_to and collection_id alongside status", async () => {
    adminListOrders.mockResolvedValue([order()])
    const { container } = await renderAdminOrders()
    await flush()

    adminListOrders.mockClear()
    adminListOrders.mockResolvedValue([order()])

    const [dateFromInput, dateToInput] = container.querySelectorAll('input[type="date"]')

    const pickOption = async (label, optionText) => {
      const trigger = container.querySelector(`[aria-label="${label}"]`)
      await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })))
      const optionBtn = [...container.querySelectorAll("li button")].find((b) => b.textContent === optionText)
      await act(async () => optionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    }

    await pickOption("Trạng thái", labelFor(STATUS_LABELS, "pending"))
    await pickOption("Hình thức nhận hàng", labelFor(FULFILLMENT_METHOD_LABELS, "booth"))
    await pickOption("Bộ sưu tập", "Fes Drop")
    await act(async () => setInputValue(dateFromInput, "2026-08-01"))
    await act(async () => setInputValue(dateToInput, "2026-08-08"))

    const lastCall = adminListOrders.mock.calls.at(-1)[0]
    expect(lastCall).toEqual({
      status: "pending", fulfillment_method: "booth", collection_id: "7",
      date_from: "2026-08-01", date_to: "2026-08-08",
    })
  })

  it("sends search alongside the other filters, but only after the debounce settles (not per keystroke)", async () => {
    adminListOrders.mockResolvedValue([order()])
    const { container } = await renderAdminOrders()
    await flush()

    adminListOrders.mockClear()
    adminListOrders.mockResolvedValue([order()])

    const searchInput = container.querySelector('input[placeholder="Mã đơn, tên, SĐT, email..."]')
    await act(async () => setInputValue(searchInput, "0900000000"))

    // Right after typing, the debounce (400ms) hasn't elapsed yet.
    expect(adminListOrders).not.toHaveBeenCalled()

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450))
    })

    expect(adminListOrders).toHaveBeenLastCalledWith({ search: "0900000000" })
  })
})

describe("AdminOrders bulk cancel", () => {
  it("asks for confirmation before cancelling and does nothing if declined", async () => {
    adminListOrders.mockResolvedValue([order()])
    const { container } = await renderAdminOrders()
    await flush()

    const checkbox = container.querySelector('input[aria-label="Chọn đơn #1"]')
    await act(async () => { checkbox.click() })

    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(false)
    const bulkBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.startsWith("Huỷ đã chọn"))
    await act(async () => { bulkBtn.click() })

    expect(confirmSpy).toHaveBeenCalled()
    expect(adminBulkCancelOrders).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it("renders the bulk-cancel button with danger styling, same as the single-order cancel", async () => {
    adminListOrders.mockResolvedValue([order()])
    const { container } = await renderAdminOrders()
    await flush()

    const bulkBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.startsWith("Huỷ đã chọn"))
    expect(bulkBtn).toBeTruthy()
    expect(bulkBtn.className).toContain("var(--border-danger)")
  })

  it("surfaces per-order failures instead of a blanket success message", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 }), order({ id: 2, status: "completed", allowed_transitions: [] })])
    const { container } = await renderAdminOrders()
    await flush()

    const selectAll = container.querySelector('input[type="checkbox"]')
    await act(async () => { selectAll.click() })

    vi.spyOn(globalThis, "confirm").mockReturnValue(true)
    adminBulkCancelOrders.mockResolvedValue({
      results: [
        { id: 1, ok: true },
        { id: 2, ok: false, error: "invalid_transition", message: 'Không thể chuyển từ "completed" sang "cancelled"' },
      ],
    })
    adminListOrders.mockResolvedValue([order({ id: 1, status: "cancelled", allowed_transitions: [] }), order({ id: 2, status: "completed", allowed_transitions: [] })])

    const bulkBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.startsWith("Huỷ đã chọn"))
    await act(async () => { bulkBtn.click() })
    await flush()

    expect(container.textContent).toContain("Huỷ thành công 1/2 đơn")
    expect(container.textContent).toContain("completed")
    expect(container.textContent).toContain("#2")
  })

  it("shows the cancel-specific banner text after a full-success bulk cancel", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 }), order({ id: 2 })])
    const { container } = await renderAdminOrders()
    await flush()

    const selectAll = container.querySelector('input[type="checkbox"]')
    await act(async () => { selectAll.click() })

    vi.spyOn(globalThis, "confirm").mockReturnValue(true)
    adminBulkCancelOrders.mockResolvedValue({ results: [{ id: 1, ok: true }, { id: 2, ok: true }] })
    adminListOrders.mockResolvedValue([order({ id: 1, status: "cancelled" }), order({ id: 2, status: "cancelled" })])

    const bulkBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.startsWith("Huỷ đã chọn"))
    await act(async () => { bulkBtn.click() })
    await flush()

    expect(container.textContent).toContain("Đã huỷ 2 đơn.")
    expect(container.textContent).not.toContain("Đã hoàn tất")
  })
})

describe("AdminOrders - bulk complete (Event Pickup Verification plan)", () => {
  it("renders a bulk-complete button beside bulk-cancel, disabled with nothing selected", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    const { container } = await renderAdminOrders()
    await flush()

    const buttons = [...container.querySelectorAll("button")]
    const completeBtn = buttons.find((b) => b.textContent.startsWith("Hoàn tất đã chọn"))
    expect(completeBtn).toBeTruthy()
    expect(completeBtn.disabled).toBe(true)
  })

  it("uses success styling, not danger, distinct from the cancel button", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    const { container } = await renderAdminOrders()
    await flush()

    const buttons = [...container.querySelectorAll("button")]
    const completeBtn = buttons.find((b) => b.textContent.startsWith("Hoàn tất đã chọn"))
    const cancelBtn = buttons.find((b) => b.textContent.startsWith("Huỷ đã chọn"))
    expect(completeBtn.className).toContain("var(--border-success)")
    expect(completeBtn.className).not.toBe(cancelBtn.className)
  })

  it("calls adminBulkCompleteOrders with the selected ids and reloads", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 }), order({ id: 2 })])
    adminBulkCompleteOrders.mockResolvedValue({ results: [{ id: 1, ok: true }, { id: 2, ok: true }] })
    const { container } = await renderAdminOrders()
    await flush()

    const checkboxes = [...container.querySelectorAll('input[type="checkbox"][aria-label]')]
    await act(async () => { checkboxes[0].click() })
    await act(async () => { checkboxes[1].click() })

    const completeBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.startsWith("Hoàn tất đã chọn"))
    await act(async () => { completeBtn.click() })

    expect(adminBulkCompleteOrders).toHaveBeenCalledWith([1, 2])
  })

  it("shows the complete-specific banner text, not the cancel wording, after a bulk complete", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 }), order({ id: 2 })])
    adminBulkCompleteOrders.mockResolvedValue({ results: [{ id: 1, ok: true }, { id: 2, ok: true }] })
    const { container } = await renderAdminOrders()
    await flush()

    const checkboxes = [...container.querySelectorAll('input[type="checkbox"][aria-label]')]
    await act(async () => { checkboxes[0].click() })
    await act(async () => { checkboxes[1].click() })

    const completeBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.startsWith("Hoàn tất đã chọn"))
    await act(async () => { completeBtn.click() })
    await flush()

    expect(container.textContent).toContain("Đã hoàn tất 2 đơn.")
    expect(container.textContent).not.toContain("Đã huỷ")
  })

  it("shows the partial-success complete wording when some orders fail", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 }), order({ id: 2 })])
    adminBulkCompleteOrders.mockResolvedValue({
      results: [
        { id: 1, ok: true },
        { id: 2, ok: false, error: "invalid_transition", message: 'Không thể chuyển từ "pending" sang "completed"' },
      ],
    })
    const { container } = await renderAdminOrders()
    await flush()

    const checkboxes = [...container.querySelectorAll('input[type="checkbox"][aria-label]')]
    await act(async () => { checkboxes[0].click() })
    await act(async () => { checkboxes[1].click() })

    const completeBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.startsWith("Hoàn tất đã chọn"))
    await act(async () => { completeBtn.click() })
    await flush()

    expect(container.textContent).toContain("Hoàn tất thành công 1/2 đơn")
    expect(container.textContent).not.toContain("Huỷ thành công")
  })
})

describe("AdminOrders - semantic status/action styling (Admin UI plan)", () => {
  it("renders the status as a Vietnamese-labelled badge, not the raw enum", async () => {
    adminListOrders.mockResolvedValue([order({ status: "confirmed" })])
    const { container } = await renderAdminOrders()
    expect(container.textContent).toContain("Đã xác nhận")
    expect(container.textContent).not.toContain("confirmed ·")
  })

  it("renders payment and fulfilment method with Vietnamese labels, not raw enums", async () => {
    adminListOrders.mockResolvedValue([order({ payment_method: "bank", fulfillment_method: "ship" })])
    const { container } = await renderAdminOrders()
    expect(container.textContent).toContain("Chuyển khoản")
    expect(container.textContent).toContain("Giao hàng")
  })

  it("renders the cancel action button with danger styling and a Vietnamese label", async () => {
    adminListOrders.mockResolvedValue([order({ allowed_transitions: ["shipped", "cancelled"] })])
    const { container } = await renderAdminOrders()
    const buttons = [...container.querySelectorAll("button")]
    const cancelBtn = buttons.find((b) => b.textContent === "Hủy")
    expect(cancelBtn).toBeTruthy()
    expect(cancelBtn.className).toContain("var(--border-danger)")
  })

  it("renders a confirm-type action button (shipped) with success styling, not danger", async () => {
    adminListOrders.mockResolvedValue([order({ allowed_transitions: ["shipped", "cancelled"] })])
    const { container } = await renderAdminOrders()
    const buttons = [...container.querySelectorAll("button")]
    const shippedBtn = buttons.find((b) => b.textContent === "Đã gửi")
    expect(shippedBtn).toBeTruthy()
    expect(shippedBtn.className).toContain("var(--border-success)")
  })

  it("fails if cancel and a confirm-type action ever render with the same class string again", async () => {
    adminListOrders.mockResolvedValue([order({ allowed_transitions: ["shipped", "cancelled"] })])
    const { container } = await renderAdminOrders()
    const buttons = [...container.querySelectorAll("button")]
    const cancelBtn = buttons.find((b) => b.textContent === "Hủy")
    const shippedBtn = buttons.find((b) => b.textContent === "Đã gửi")
    expect(cancelBtn.className).not.toBe(shippedBtn.className)
  })

  it("keeps 'Chi tiết' neutral, distinct from both success and danger actions", async () => {
    adminListOrders.mockResolvedValue([order({ allowed_transitions: ["cancelled"] })])
    const { container } = await renderAdminOrders()
    const buttons = [...container.querySelectorAll("button")]
    const detailBtn = buttons.find((b) => b.textContent === "Chi tiết")
    expect(detailBtn.className).toContain("var(--border-neutral)")
    expect(detailBtn.className).not.toContain("var(--border-danger)")
  })

  it("still shows the confirm() guard before cancelling (unchanged behavior)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
    adminTransitionOrder.mockResolvedValue({})
    adminListOrders.mockResolvedValue([order({ allowed_transitions: ["cancelled"] })])
    const { container } = await renderAdminOrders()
    const cancelBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Hủy")
    await act(async () => { cancelBtn.click() })
    expect(confirmSpy).toHaveBeenCalled()
    expect(adminTransitionOrder).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it("includes a trimmed cancel_reason from the prompt when cancelling", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("  Hết hàng thực tế  ")
    adminTransitionOrder.mockResolvedValue({})
    adminListOrders.mockResolvedValue([order({ allowed_transitions: ["cancelled"] })])
    const { container } = await renderAdminOrders()

    const cancelBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Hủy")
    await act(async () => { cancelBtn.click() })

    expect(promptSpy).toHaveBeenCalled()
    expect(adminTransitionOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: "cancelled", cancel_reason: "Hết hàng thực tế" })
    )
    vi.restoreAllMocks()
  })

  it("still cancels the order even if the reason prompt is skipped (empty/dismissed)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    vi.spyOn(window, "prompt").mockReturnValue(null)
    adminTransitionOrder.mockResolvedValue({})
    adminListOrders.mockResolvedValue([order({ allowed_transitions: ["cancelled"] })])
    const { container } = await renderAdminOrders()

    const cancelBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Hủy")
    await act(async () => { cancelBtn.click() })

    expect(adminTransitionOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ cancel_reason: expect.anything() })
    )
    vi.restoreAllMocks()
  })

  it("surfaces an order with a pending action above one with none, without hiding either", async () => {
    adminListOrders.mockResolvedValue([
      order({ id: 1, status: "completed", allowed_transitions: [] }),
      order({ id: 2, status: "pending", allowed_transitions: ["confirmed", "cancelled"] }),
    ])
    const { container } = await renderAdminOrders()
    const ids = [...container.querySelectorAll("[data-order-id]")].map((el) => el.dataset.orderId)
    expect(ids).toEqual(["2", "1"])
  })

  it("falls back to the raw value for an unknown status, never rendering blank", async () => {
    adminListOrders.mockResolvedValue([order({ status: "some_future_status", allowed_transitions: [] })])
    const { container } = await renderAdminOrders()
    expect(container.textContent).toContain("some_future_status")
  })

  it("collapses the detail panel again when 'Chi tiết' (now 'Ẩn') is clicked a second time", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    adminGetOrder.mockResolvedValue(order({ id: 1, email: "a@b.com", items: [] }))
    const { container } = await renderAdminOrders()
    await flush()

    const detailBtn = () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết" || b.textContent === "Ẩn")

    await act(async () => { detailBtn().click() })
    await flush()
    expect(container.textContent).toContain("a@b.com")
    expect(detailBtn().textContent).toBe("Ẩn")

    await act(async () => { detailBtn().click() })
    await flush()
    expect(container.textContent).not.toContain("a@b.com")
    expect(detailBtn().textContent).toBe("Chi tiết")
  })

  it("shows a digital badge and the delivery link for a digital line item", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    adminGetOrder.mockResolvedValue(order({
      id: 1, email: "a@b.com",
      items: [{ id: 1, product_name_snapshot: "Digital Album", variant_label_snapshot: "", qty: 1, unit_price_snapshot: 99000, delivery_link_snapshot: "https://drive.google.com/x" }],
    }))
    const { container } = await renderAdminOrders()
    await flush()

    const detailBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết")
    await act(async () => { detailBtn.click() })
    await flush()

    expect(container.textContent).toContain("Sản phẩm số")
    expect(container.querySelector('a[href="https://drive.google.com/x"]')).toBeTruthy()
  })

  it("marks a free gift line distinctly from a priced item", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    adminGetOrder.mockResolvedValue(order({
      id: 1, email: "a@b.com",
      items: [{ id: 1, product_name_snapshot: "Postcard", variant_label_snapshot: "", unit_price_snapshot: 0, qty: 1, is_gift: true }],
    }))
    const { container } = await renderAdminOrders()
    await flush()

    const detailBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết")
    await act(async () => { detailBtn.click() })
    await flush()

    expect(container.textContent).toContain("🎁 Quà tặng")
    expect(container.textContent).not.toContain("Postcard ·")
  })

  it("does not render a stray '0' after the price for a non-gift item (mysql2 returns is_gift as the number 0, not false)", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    adminGetOrder.mockResolvedValue(order({
      id: 1, email: "a@b.com",
      items: [{ id: 1, product_name_snapshot: "Card", variant_label_snapshot: "A1", unit_price_snapshot: 40000, qty: 1, is_gift: 0 }],
    }))
    const { container } = await renderAdminOrders()
    await flush()

    const detailBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết")
    await act(async () => { detailBtn.click() })
    await flush()

    expect(container.textContent).not.toContain("🎁 Quà tặng")
    expect(container.textContent).toContain("40.000₫")
    expect(container.textContent).not.toMatch(/₫0(?!\d)/)
  })

  it("shows no digital badge or link for a physical line item", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    adminGetOrder.mockResolvedValue(order({
      id: 1, email: "a@b.com",
      items: [{ id: 1, product_name_snapshot: "Card", variant_label_snapshot: "A1", qty: 1, unit_price_snapshot: 35000, delivery_link_snapshot: null }],
    }))
    const { container } = await renderAdminOrders()
    await flush()

    const detailBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết")
    await act(async () => { detailBtn.click() })
    await flush()

    // Scoped to the item list, not the whole page - the fulfillment-method
    // filter dropdown also renders the string "Sản phẩm số" as one of its
    // options, which would make a container-wide assertion falsely fail.
    const itemList = container.querySelector("ul")
    expect(itemList.textContent).not.toContain("Sản phẩm số")
  })

  it("shows a '+ Sản phẩm số' badge on a mixed ship+digital order's collapsed row", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1, fulfillment_method: "ship", has_digital_item: true })])
    const { container } = await renderAdminOrders()
    await flush()

    expect(container.textContent).toContain("+ Sản phẩm số")
  })

  it("does not show the '+' badge for a purely physical order", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1, fulfillment_method: "ship", has_digital_item: false })])
    const { container } = await renderAdminOrders()
    await flush()

    expect(container.textContent).not.toContain("+ Sản phẩm số")
  })

  it("does not double-label an all-digital order with the '+' badge", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1, fulfillment_method: "digital", has_digital_item: true })])
    const { container } = await renderAdminOrders()
    await flush()

    expect(container.textContent).not.toContain("+ Sản phẩm số")
    expect(container.textContent).toContain("Sản phẩm số")
  })

  it("flags an under-drawn gacha order on its collapsed row", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1, fulfillment_method: "ship", has_incomplete_gacha_session: true })])
    const { container } = await renderAdminOrders()
    await flush()

    expect(container.textContent).toContain("Chưa quay hết")
  })

  it("does not flag an order with no active gacha session", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1, fulfillment_method: "ship", has_incomplete_gacha_session: false })])
    const { container } = await renderAdminOrders()
    await flush()

    expect(container.textContent).not.toContain("Chưa quay hết")
  })

  it("shows a queue number badge for a pickup order that has one", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1, fulfillment_method: "pickup", queue_number: 7 })])
    const { container } = await renderAdminOrders()
    await flush()

    expect(container.textContent).toContain("STT 7")
  })

  it("shows no queue number badge for a pickup order that doesn't have one yet", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1, fulfillment_method: "pickup", queue_number: null })])
    const { container } = await renderAdminOrders()
    await flush()

    expect(container.textContent).not.toContain("STT")
  })

  it("shows a queue number badge for a ship order too (staff packing sequence)", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1, fulfillment_method: "ship", queue_number: 7 })])
    const { container } = await renderAdminOrders()
    await flush()

    expect(container.textContent).toContain("STT 7")
  })

  it("shows no queue number badge for a ship order that doesn't have one yet", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1, fulfillment_method: "ship", queue_number: null })])
    const { container } = await renderAdminOrders()
    await flush()

    expect(container.textContent).not.toContain("STT")
  })

  it("fetches payment instructions by id under admin auth when opening the detail panel, not the buyer's public token route", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    adminGetOrder.mockResolvedValue(order({ id: 1, email: "a@b.com", items: [] }))
    adminGetOrderPayment.mockResolvedValue({ instructions: "Chuyển khoản tới STK 123" })
    const { container } = await renderAdminOrders()
    await flush()

    const detailBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết")
    await act(async () => { detailBtn.click() })
    await flush()

    expect(adminGetOrderPayment).toHaveBeenCalledWith(1)
  })

  it("shows the Vietnamese payment-method label in the detail panel, not the raw enum", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1, payment_method: "bank" })])
    adminGetOrder.mockResolvedValue(order({ id: 1, payment_method: "bank", email: "a@b.com", items: [] }))
    const { container } = await renderAdminOrders()
    await flush()

    const detailBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết")
    await act(async () => { detailBtn.click() })
    await flush()

    const strongTags = [...container.querySelectorAll("strong")].map((el) => el.textContent)
    expect(strongTags).toContain("Chuyển khoản")
    expect(strongTags).not.toContain("bank")
    expect(container.textContent).toContain("Thanh toán:")
  })

  it("shows the cancel reason in the detail panel for a cancelled order", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1, status: "cancelled", allowed_transitions: [] })])
    adminGetOrder.mockResolvedValue(order({
      id: 1, status: "cancelled", allowed_transitions: [], email: "a@b.com", items: [],
      cancel_reason: "Hết hàng thực tế",
    }))
    const { container } = await renderAdminOrders()
    await flush()

    const detailBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết")
    await act(async () => { detailBtn.click() })
    await flush()

    expect(container.textContent).toContain("Lý do hủy: Hết hàng thực tế")
  })

  it("does not show a cancel-reason line for a cancelled order with none recorded", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1, status: "cancelled", allowed_transitions: [] })])
    adminGetOrder.mockResolvedValue(order({
      id: 1, status: "cancelled", allowed_transitions: [], email: "a@b.com", items: [], cancel_reason: null,
    }))
    const { container } = await renderAdminOrders()
    await flush()

    const detailBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết")
    await act(async () => { detailBtn.click() })
    await flush()

    expect(container.textContent).not.toContain("Lý do hủy")
  })

  it("refetches the order list when 'Làm mới' is clicked", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    const { container } = await renderAdminOrders()
    await flush()

    expect(adminListOrders).toHaveBeenCalledTimes(1)

    const refreshBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Làm mới")
    await act(async () => { refreshBtn.click() })
    await flush()

    expect(adminListOrders).toHaveBeenCalledTimes(2)
  })

  it("renders the status filter options with Vietnamese text but raw-enum values", async () => {
    adminListOrders.mockResolvedValue([order()])
    const { container } = await renderAdminOrders()
    await flush()

    const trigger = container.querySelector('[aria-label="Trạng thái"]')
    await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    const options = [...container.querySelectorAll("li button")]

    const STATUSES = ["", "pending", "confirmed", "shipped", "completed", "cancelled"]
    const texts = options.map((o) => o.textContent)
    expect(texts).toEqual(STATUSES.map((s) => (s ? labelFor(STATUS_LABELS, s) : "Tất cả")))

    expect(texts).toContain("Tất cả")
    expect(texts).toContain("Đã xác nhận")
    expect(texts).not.toContain("pending")
    expect(texts).not.toContain("confirmed")
    expect(texts).not.toContain("shipped")
    expect(texts).not.toContain("completed")
    expect(texts).not.toContain("cancelled")
  })

  it("edits and saves buyer info from the order detail panel", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    adminGetOrder.mockResolvedValue(order({ id: 1, buyer_name: "Nguyễn Văn A", phone: "0900000000", email: "a@b.com", note: null, items: [] }))
    const { container } = await renderAdminOrders()
    await flush()

    const detailBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết")
    await act(async () => { detailBtn.click() })
    await flush()

    const editBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sửa thông tin")
    await act(async () => { editBtn.click() })
    await flush()

    const nameInput = container.querySelector('input[data-testid="edit-buyer-name"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    await act(async () => {
      setter.call(nameInput, "Nguyễn Văn B")
      nameInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    adminUpdateOrderBuyerInfo.mockResolvedValue({ changed: true, order: order({ id: 1, buyer_name: "Nguyễn Văn B", phone: "0900000000", email: "a@b.com", items: [] }) })
    const saveBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Lưu")
    await act(async () => { saveBtn.click() })
    await flush()

    expect(adminUpdateOrderBuyerInfo).toHaveBeenCalledWith(1, expect.objectContaining({ buyer_name: "Nguyễn Văn B" }))
    expect(container.textContent).toContain("Nguyễn Văn B")
  })

  it("has no email input in the edit form - email is not editable", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    adminGetOrder.mockResolvedValue(order({ id: 1, buyer_name: "A", phone: "090", email: "a@b.com", items: [] }))
    const { container } = await renderAdminOrders()
    await flush()

    await act(async () => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết").click() })
    await flush()
    await act(async () => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Sửa thông tin").click() })
    await flush()

    expect(container.querySelector('input[placeholder="Email"]')).toBeNull()
  })

  it("does not show the address picker in the edit form for a pickup order", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1, fulfillment_method: "pickup" })])
    adminGetOrder.mockResolvedValue(order({ id: 1, fulfillment_method: "pickup", items: [] }))
    const { container } = await renderAdminOrders()
    await flush()

    await act(async () => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết").click() })
    await flush()
    await act(async () => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Sửa thông tin").click() })
    await flush()

    expect(container.querySelector('button[aria-label="Province/City"]')).toBeNull()
  })

  it("shows the address picker in the edit form for a ship order", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1, fulfillment_method: "ship" })])
    adminGetOrder.mockResolvedValue(order({ id: 1, fulfillment_method: "ship", items: [] }))
    const { container } = await renderAdminOrders()
    await flush()

    await act(async () => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết").click() })
    await flush()
    await act(async () => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Sửa thông tin").click() })
    await flush()

    expect(container.querySelector('button[aria-label="Province/City"]')).toBeTruthy()
  })

  it("does not leak an in-progress edit draft into a different order opened afterward", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 }), order({ id: 2 })])
    adminGetOrder.mockImplementation((id) =>
      Promise.resolve(order({
        id, buyer_name: id === 1 ? "Order One Buyer" : "Order Two Buyer",
        note: id === 1 ? "Note from order one" : null, items: [],
      }))
    )
    const { container } = await renderAdminOrders()
    await flush()

    const detailBtns = () => [...container.querySelectorAll("button")].filter((b) => b.textContent === "Chi tiết")

    await act(async () => { detailBtns()[0].click() })
    await flush()
    await act(async () => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Sửa thông tin").click() })
    await flush()
    expect(container.querySelector('textarea[placeholder="Ghi chú"]').value).toBe("Note from order one")

    // Order 1's own detail toggle now reads "Ẩn" ("Hide"), so the only
    // remaining "Chi tiết" button belongs to order 2.
    await act(async () => { detailBtns()[0].click() })
    await flush()

    // The edit form must not still be open with order 1's stale draft
    // showing through order 2's detail panel.
    expect(container.querySelector('textarea[placeholder="Ghi chú"]')).toBeNull()
    expect(container.textContent).toContain("Order Two Buyer")
    expect(container.textContent).not.toContain("Note from order one")
  })
})
