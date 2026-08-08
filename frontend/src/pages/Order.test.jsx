import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { LanguageProvider } from "../contexts/LanguageContext"

const fetchOrder = vi.fn()
const fetchPaymentInstructions = vi.fn()
const uploadPaymentProof = vi.fn()

vi.mock("../api/shop", () => ({
  fetchOrder: (...args) => fetchOrder(...args),
  fetchPaymentInstructions: (...args) => fetchPaymentInstructions(...args),
  uploadPaymentProof: (...args) => uploadPaymentProof(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: Order } = await import("./Order")

function baseOrder(over = {}) {
  return {
    id: 1, order_token: "tok123", status: "confirmed", total: 35000,
    fulfillment_method: "ship", tracking_code: null, created_at: new Date().toISOString(),
    items: [{ id: 1, product_name_snapshot: "Card", variant_label_snapshot: "A1", unit_price_snapshot: 35000, qty: 1 }],
    pickup_location: null, pickup_note: null,
    ...over,
  }
}

async function renderOrder() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/order/tok123"]}>
        <LanguageProvider>
          <Routes>
            <Route path="/order/:token" element={<Order />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>
    )
  })
  return container
}

beforeEach(() => {
  fetchOrder.mockReset()
  fetchPaymentInstructions.mockReset()
  uploadPaymentProof.mockReset()
})

describe("Order pickup info", () => {
  it("shows pickup location and note for a pickup order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      fulfillment_method: "pickup",
      pickup_location: "Comic Fest, Booth 12",
      pickup_note: "9am-6pm, both days",
    }))

    const container = await renderOrder()

    expect(container.textContent).toContain("Comic Fest, Booth 12")
    expect(container.textContent).toContain("9am-6pm, both days")
  })

  it("does not render a pickup block for a ship order even if fields are somehow present", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      fulfillment_method: "ship",
      pickup_location: "Comic Fest, Booth 12",
    }))

    const container = await renderOrder()

    expect(container.textContent).not.toContain("Comic Fest, Booth 12")
  })

  it("renders no pickup block when the pickup order has neither location nor note", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ fulfillment_method: "pickup" }))

    const container = await renderOrder()

    expect(container.textContent).not.toContain("undefined")
    expect(container.querySelector('[class*="rounded-xl"][class*="opacity-80"]')).toBeNull()
  })
})
