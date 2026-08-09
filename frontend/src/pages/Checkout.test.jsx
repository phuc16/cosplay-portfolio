import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter } from "react-router-dom"
import { LanguageProvider } from "../contexts/LanguageContext"

const fetchPaymentMethods = vi.fn()
const createOrder = vi.fn()
const fetchCollection = vi.fn()

vi.mock("../api/shop", () => ({
  fetchPaymentMethods: (...args) => fetchPaymentMethods(...args),
  createOrder: (...args) => createOrder(...args),
  fetchCollection: (...args) => fetchCollection(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: Checkout } = await import("./Checkout")

function seedCart() {
  localStorage.setItem("shop_cart", JSON.stringify([
    { variant_id: 1, qty: 1, product_name: "Card", variant_label: "A1", price: 35000, image_url: null, collection_slug: "drop" },
  ]))
}

async function renderCheckout() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter>
        <LanguageProvider>
          <Checkout />
        </LanguageProvider>
      </MemoryRouter>
    )
  })
  return container
}

beforeEach(() => {
  localStorage.clear()
  fetchPaymentMethods.mockReset()
  createOrder.mockReset()
  fetchCollection.mockReset()
  // Default: both methods offered, matching this file's existing tests which
  // predate fulfillment filtering and expect the ship/pickup radio pair.
  fetchCollection.mockResolvedValue({ allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null })
})

describe("Checkout payment methods", () => {
  it("disables the submit button and shows a contact-seller message when no method is enabled", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: [] })

    const container = await renderCheckout()

    const submit = [...container.querySelectorAll("button")].find((b) => b.type === "button" && b.textContent !== "...")
    // The place-order button is the only non-radio button with disabled state tied to methods.
    const placeOrderBtn = container.querySelector("button.w-full")
    expect(placeOrderBtn).toBeTruthy()
    expect(placeOrderBtn.disabled).toBe(true)

    expect(container.textContent).toContain("No payment method is set up right now")
    expect(submit).toBeTruthy()
  })

  it("enables submit and offers only the enabled methods", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank", "cod"] })

    const container = await renderCheckout()

    const placeOrderBtn = container.querySelector("button.w-full")
    expect(placeOrderBtn.disabled).toBe(false)

    const options = [...container.querySelectorAll("select option")].map((o) => o.value)
    expect(options).toEqual(["bank", "cod"])
    expect(container.textContent).not.toContain("No payment method is set up right now")
  })

  it("falls back to no methods (submit stays disabled) when the fetch itself fails", async () => {
    seedCart()
    fetchPaymentMethods.mockRejectedValue(new Error("network"))

    const container = await renderCheckout()

    const placeOrderBtn = container.querySelector("button.w-full")
    expect(placeOrderBtn.disabled).toBe(true)
  })
})

describe("Checkout fulfillment filtering", () => {
  it("offers both methods when the collection allows both", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    fetchCollection.mockResolvedValue({ allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null })

    const container = await renderCheckout()

    const radios = container.querySelectorAll('input[name="fulfillment"]')
    expect(radios.length).toBe(2)
  })

  it("offers only pickup and auto-selects it when the collection is pickup-only", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    fetchCollection.mockResolvedValue({
      allow_ship: false, allow_pickup: true,
      pickup_location: "Comic Fest, Booth 12", pickup_note: "9am-6pm",
    })

    const container = await renderCheckout()

    const radios = container.querySelectorAll('input[name="fulfillment"]')
    expect(radios.length).toBe(1)
    expect(radios[0].checked).toBe(true)
    // The address form (ship-only UI) must not render for a pickup-only collection.
    expect(container.textContent).not.toContain("checkoutShippingNote")
    expect(container.textContent).toContain("Comic Fest, Booth 12")
    expect(container.textContent).toContain("9am-6pm")
  })

  it("offers only ship and auto-selects it when the collection is ship-only", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    fetchCollection.mockResolvedValue({ allow_ship: true, allow_pickup: false, pickup_location: null, pickup_note: null })

    const container = await renderCheckout()

    const radios = container.querySelectorAll('input[name="fulfillment"]')
    expect(radios.length).toBe(1)
    expect(radios[0].checked).toBe(true)
  })

  it("shows a contact-seller message when the collection offers neither method", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    fetchCollection.mockResolvedValue({ allow_ship: false, allow_pickup: false, pickup_location: null, pickup_note: null })

    const container = await renderCheckout()

    expect(container.querySelectorAll('input[name="fulfillment"]').length).toBe(0)
    expect(container.textContent).toContain("This collection currently offers no delivery method")
  })
})

describe("Checkout — payment window notice (Phase 6)", () => {
  it("shows the payment-window notice when a non-COD payment method is selected", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank", "cod"] })

    const container = await renderCheckout()

    expect(container.textContent).toContain("must be paid within a limited window")
  })

  it("hides the payment-window notice when cod is the selected payment method", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["cod"] })

    const container = await renderCheckout()

    const select = container.querySelector("select")
    expect(select.value).toBe("cod")
    expect(container.textContent).not.toContain("must be paid within a limited window")
  })
})
