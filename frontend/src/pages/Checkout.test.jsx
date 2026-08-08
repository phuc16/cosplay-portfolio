import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter } from "react-router-dom"
import { LanguageProvider } from "../contexts/LanguageContext"

const fetchPaymentMethods = vi.fn()
const createOrder = vi.fn()

vi.mock("../api/shop", () => ({
  fetchPaymentMethods: (...args) => fetchPaymentMethods(...args),
  createOrder: (...args) => createOrder(...args),
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
