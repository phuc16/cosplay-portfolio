import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminListOrders = vi.fn()
const adminListCollections = vi.fn()
const adminBulkCancelOrders = vi.fn()
const adminGetOrder = vi.fn()
const adminTransitionOrder = vi.fn()
const fetchPaymentInstructions = vi.fn()

vi.mock("../api/shop", () => ({
  adminListOrders: (...args) => adminListOrders(...args),
  adminListCollections: (...args) => adminListCollections(...args),
  adminBulkCancelOrders: (...args) => adminBulkCancelOrders(...args),
  adminGetOrder: (...args) => adminGetOrder(...args),
  adminTransitionOrder: (...args) => adminTransitionOrder(...args),
  fetchPaymentInstructions: (...args) => fetchPaymentInstructions(...args),
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
    root.render(<AdminOrders />)
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
  adminGetOrder.mockReset()
  adminTransitionOrder.mockReset()
  fetchPaymentInstructions.mockReset()
  adminListCollections.mockResolvedValue([{ id: 7, title: "Fes Drop" }])
})

describe("AdminOrders filters", () => {
  it("sends date_from/date_to and collection_id alongside status", async () => {
    adminListOrders.mockResolvedValue([order()])
    const { container } = await renderAdminOrders()
    await flush()

    adminListOrders.mockClear()
    adminListOrders.mockResolvedValue([order()])

    const [statusSelect, collectionSelect] = container.querySelectorAll("select")
    const [dateFromInput, dateToInput] = container.querySelectorAll('input[type="date"]')

    await act(async () => {
      statusSelect.value = "pending"
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => {
      collectionSelect.value = "7"
      collectionSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => setInputValue(dateFromInput, "2026-08-01"))
    await act(async () => setInputValue(dateToInput, "2026-08-08"))

    const lastCall = adminListOrders.mock.calls.at(-1)[0]
    expect(lastCall).toEqual({
      status: "pending", collection_id: "7", date_from: "2026-08-01", date_to: "2026-08-08",
    })
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
})

describe("AdminOrders — semantic status/action styling (Admin UI plan)", () => {
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
})
