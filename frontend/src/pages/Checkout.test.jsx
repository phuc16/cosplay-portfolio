import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter } from "react-router-dom"
import { LanguageProvider } from "../contexts/LanguageContext"
import { ThemeProvider } from "../contexts/ThemeContext"
import { readCart } from "../shop/cart"

const fetchPaymentMethods = vi.fn()
const createOrder = vi.fn()
const fetchCollection = vi.fn()
// AddressFields.jsx (rendered when fulfillment === "ship") calls these on
// mount — must resolve, not just exist, or its effect throws synchronously.
const fetchProvinces = vi.fn().mockResolvedValue([])
const fetchWards = vi.fn().mockResolvedValue([])
const searchAddress = vi.fn().mockResolvedValue({ predictions: [] })

vi.mock("../api/shop", () => ({
  fetchPaymentMethods: (...args) => fetchPaymentMethods(...args),
  createOrder: (...args) => createOrder(...args),
  fetchCollection: (...args) => fetchCollection(...args),
  fetchProvinces: (...args) => fetchProvinces(...args),
  fetchWards: (...args) => fetchWards(...args),
  searchAddress: (...args) => searchAddress(...args),
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
        <ThemeProvider>
          <LanguageProvider>
            <Checkout />
          </LanguageProvider>
        </ThemeProvider>
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

    const options = [...container.querySelectorAll('[role="radio"]')].map((b) => b.textContent)
    expect(options).toEqual(["Bank transfer", "Cash on delivery"])
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

    const codBtn = [...container.querySelectorAll('[role="radio"]')].find((b) => b.textContent.includes("Cash on delivery"))
    expect(codBtn.getAttribute("aria-checked")).toBe("true")
    expect(container.textContent).not.toContain("must be paid within a limited window")
  })
})

describe("Checkout — COD restricted to ship orders (Event Pickup Verification plan)", () => {
  it("hides COD from the payment picker when pickup is selected", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank", "cod"] })
    fetchCollection.mockResolvedValue({ allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null })

    const container = await renderCheckout()
    const pickupRadio = [...container.querySelectorAll('input[name="fulfillment"]')][1]
    await act(async () => { pickupRadio.click() })

    const options = [...container.querySelectorAll('[role="radio"]')].map((b) => b.textContent)
    expect(options).toEqual(["Bank transfer"])
  })

  it("resets away from cod when switching from ship to pickup with cod selected", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank", "cod"] })
    fetchCollection.mockResolvedValue({ allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null })

    const container = await renderCheckout()
    const codBtn = () => [...container.querySelectorAll('[role="radio"]')].find((b) => b.textContent.includes("Cash on delivery"))
    await act(async () => { codBtn().click() })
    expect(codBtn().getAttribute("aria-checked")).toBe("true")

    const pickupRadio = [...container.querySelectorAll('input[name="fulfillment"]')][1]
    await act(async () => { pickupRadio.click() })

    // cod itself is no longer even offered once pickup is selected.
    expect(codBtn()).toBeUndefined()
  })

  it("still offers cod for a ship order", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank", "cod"] })
    fetchCollection.mockResolvedValue({ allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null })

    const container = await renderCheckout()
    const options = [...container.querySelectorAll('[role="radio"]')].map((b) => b.textContent)
    expect(options).toEqual(["Bank transfer", "Cash on delivery"])
  })
})

describe("Checkout — variant_not_found recovery", () => {
  it("removes the stale line(s) from the cart itself, not just shows an error", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([
      { variant_id: 1, qty: 1, product_name: "Card", variant_label: "A1", price: 35000, image_url: null, collection_slug: "drop" },
      { variant_id: 2, qty: 1, product_name: "Poster", variant_label: "Std", price: 90000, image_url: null, collection_slug: "drop" },
    ]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    createOrder.mockRejectedValue({
      response: {
        status: 409,
        data: {
          error: "variant_not_found",
          message: "Rất tiếc, một sản phẩm trong giỏ hàng không còn tồn tại. Đã tự động xóa khỏi giỏ hàng, vui lòng kiểm tra lại và thử lại.",
          variant_ids: [2],
        },
      },
    })

    const container = await renderCheckout()
    const placeOrderBtn = container.querySelector("button.w-full")
    await act(async () => { placeOrderBtn.click() })

    expect(container.textContent).toContain("Đã tự động xóa khỏi giỏ hàng")
    const remaining = readCart()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].variant_id).toBe(1)
  })

  it("shows the empty-cart state if the stale line was the only item", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([
      { variant_id: 2, qty: 1, product_name: "Poster", variant_label: "Std", price: 90000, image_url: null, collection_slug: "drop" },
    ]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    createOrder.mockRejectedValue({
      response: { status: 409, data: { error: "variant_not_found", message: "x", variant_ids: [2] } },
    })

    const container = await renderCheckout()
    const placeOrderBtn = container.querySelector("button.w-full")
    await act(async () => { placeOrderBtn.click() })

    expect(readCart()).toEqual([])
    expect(container.textContent).toContain("Your cart is empty")
  })
})
