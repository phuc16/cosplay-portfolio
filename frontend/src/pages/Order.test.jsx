import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
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

function futureIso(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

function pastIso(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

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

describe("Order — pickup code (Event Pickup Verification plan)", () => {
  it("shows the pickup code for a pickup order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ fulfillment_method: "pickup", pickup_code: "482913" }))
    const container = await renderOrder()
    expect(container.textContent).toContain("482913")
  })

  it("does not render a pickup code section for a ship order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ fulfillment_method: "ship", pickup_code: null }))
    const container = await renderOrder()
    expect(container.textContent).not.toContain("Pickup code")
  })
})

describe("Order — payment deadline (Phase 6)", () => {
  it("renders the deadline block for a pending, prepaid order with a future expires_at", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: futureIso(3) }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("Payment deadline:")
    expect(container.textContent).not.toContain("The payment deadline has passed")
  })

  it("renders nothing deadline-related for a COD order (null expires_at)", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: null, payment_method: "cod" }))
    fetchPaymentInstructions.mockResolvedValue({ method: "cod", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).not.toContain("Payment deadline:")
    expect(container.textContent).not.toContain("The payment deadline has passed")
    expect(container.textContent).not.toContain("Invalid Date")
  })

  it("renders the passed-deadline message, not a countdown, when expires_at is in the past but status is still pending (the sweep window)", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: pastIso(1) }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("The payment deadline has passed")
    expect(container.textContent).not.toContain("còn")
    expect(container.textContent).not.toContain("h left")
  })

  it("does not render the deadline block once the order is confirmed", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "confirmed", expires_at: futureIso(3) }))

    const container = await renderOrder()

    expect(container.textContent).not.toContain("Payment deadline:")
    expect(container.textContent).not.toContain("The payment deadline has passed")
  })

  it("renders the manual-confirmation note and the transfer-note explanation while pending", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: futureIso(3) }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("Payments are checked manually by the seller")
    expect(container.textContent).toContain("Please include the exact transfer note above")
  })

  it("renders the extended save-the-link line mentioning the email", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: futureIso(3) }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("We also emailed it to you.")
  })

  it("does not render the manual-confirm note for a pending COD order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: null, payment_method: "cod" }))
    fetchPaymentInstructions.mockResolvedValue({ method: "cod", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).not.toContain("Payments are checked manually by the seller")
  })

  it("does not render the manual-confirm note for a pending prepaid order whose deadline has passed", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: pastIso(1) }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("The payment deadline has passed")
    expect(container.textContent).not.toContain("Payments are checked manually by the seller")
  })

  it("still renders the manual-confirm note for a pending prepaid order with time remaining", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: futureIso(3) }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("Payments are checked manually by the seller")
  })
})

describe("Order — Vietnamese countdown copy", () => {
  afterEach(() => {
    localStorage.removeItem("lang")
  })

  it("renders the Vietnamese 'còn N giờ' countdown when lang is vi", async () => {
    localStorage.setItem("lang", "vi")
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: futureIso(3) }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("còn 3 giờ")
  })
})

describe("Order — semantic status colour (Admin UI plan)", () => {
  it("renders the order status as a StatusBadge with the warning variant while pending", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: null }))
    fetchPaymentInstructions.mockResolvedValue({ method: "cod", amount: 35000 })

    const container = await renderOrder()
    const badge = [...container.querySelectorAll("span")].find((el) => el.className.includes("var(--surface-"))
    expect(badge).toBeTruthy()
    expect(badge.className).toContain("var(--border-warning)")
  })

  it("renders the order status with the success variant once confirmed", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "confirmed" }))

    const container = await renderOrder()
    const badge = [...container.querySelectorAll("span")].find((el) => el.className.includes("var(--surface-"))
    expect(badge.className).toContain("var(--border-success)")
  })

  it("renders the order status with the danger variant once cancelled", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "cancelled" }))

    const container = await renderOrder()
    const badge = [...container.querySelectorAll("span")].find((el) => el.className.includes("var(--surface-"))
    expect(badge.className).toContain("var(--border-danger)")
  })

  it("still falls back to the raw status text for a status with no translation key, per STATUS_KEY's existing fallback", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "some_future_status" }))

    const container = await renderOrder()
    expect(container.textContent).toContain("some_future_status")
  })
})
