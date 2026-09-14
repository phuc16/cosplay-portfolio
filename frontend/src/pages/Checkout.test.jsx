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
// mount - must resolve, not just exist, or its effect throws synchronously.
const fetchProvinces = vi.fn().mockResolvedValue([])
const fetchWards = vi.fn().mockResolvedValue([])
const searchAddress = vi.fn().mockResolvedValue({ predictions: [] })
const fetchGiftSettings = vi.fn()

vi.mock("../api/shop", () => ({
  fetchPaymentMethods: (...args) => fetchPaymentMethods(...args),
  createOrder: (...args) => createOrder(...args),
  fetchCollection: (...args) => fetchCollection(...args),
  fetchProvinces: (...args) => fetchProvinces(...args),
  fetchWards: (...args) => fetchWards(...args),
  searchAddress: (...args) => searchAddress(...args),
  fetchGiftSettings: (...args) => fetchGiftSettings(...args),
}))

// ShopFooter (rendered on every shop page) fetches /api/settings - mocked
// here so tests don't attempt a real network call.
vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal()
  return { default: { ...actual.default, get: vi.fn().mockResolvedValue({ data: {} }) } }
})

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
  sessionStorage.clear()
  fetchPaymentMethods.mockReset()
  createOrder.mockReset()
  fetchCollection.mockReset()
  // Default: both methods offered, matching this file's existing tests which
  // predate fulfillment filtering and expect the ship/pickup radio pair.
  fetchCollection.mockResolvedValue({ allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null })
  fetchGiftSettings.mockReset()
  fetchGiftSettings.mockResolvedValue({ enabled: false, min_total: 0, name: "", image_url: null, note: null, is_digital: false })
})

describe("Checkout payment methods", () => {
  it("disables the submit button and shows a contact-seller message when no method is enabled", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: [] })

    const container = await renderCheckout()

    const submit = [...container.querySelectorAll("button")].find((b) => b.type === "button" && b.textContent !== "...")
    // The place-order button is the only non-radio button with disabled state tied to methods.
    const placeOrderBtn = container.querySelector("button.w-full.rounded-xl")
    expect(placeOrderBtn).toBeTruthy()
    expect(placeOrderBtn.disabled).toBe(true)

    expect(container.textContent).toContain("No payment method is set up right now")
    expect(submit).toBeTruthy()
  })

  it("enables submit and offers only the enabled methods", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank", "cod"] })

    const container = await renderCheckout()

    const placeOrderBtn = container.querySelector("button.w-full.rounded-xl")
    expect(placeOrderBtn.disabled).toBe(false)

    const options = [...container.querySelectorAll('[role="radio"]')].map((b) => b.textContent)
    expect(options).toEqual(["Bank transfer", "Cash on delivery"])
    expect(container.textContent).not.toContain("No payment method is set up right now")
  })

  it("falls back to no methods (submit stays disabled) when the fetch itself fails", async () => {
    seedCart()
    fetchPaymentMethods.mockRejectedValue(new Error("network"))

    const container = await renderCheckout()

    const placeOrderBtn = container.querySelector("button.w-full.rounded-xl")
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

  it("shows a labeled pickup location per collection when the cart spans more than one", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([
      { variant_id: 1, qty: 1, product_name: "Card", variant_label: "A1", price: 35000, image_url: null, collection_slug: "drop-a" },
      { variant_id: 2, qty: 1, product_name: "Poster", variant_label: "Std", price: 40000, image_url: null, collection_slug: "drop-b" },
    ]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    fetchCollection.mockImplementation((slug) => Promise.resolve(
      slug === "drop-a"
        ? { id: 1, title: "Drop A", allow_ship: false, allow_pickup: true, pickup_location: "Booth 12", pickup_note: null }
        : { id: 2, title: "Drop B", allow_ship: false, allow_pickup: true, pickup_location: "Booth 7", pickup_note: null }
    ))

    const container = await renderCheckout()

    expect(container.textContent).toContain("Drop A")
    expect(container.textContent).toContain("Booth 12")
    expect(container.textContent).toContain("Drop B")
    expect(container.textContent).toContain("Booth 7")
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

describe("Checkout - payment window notice (Phase 6)", () => {
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

describe("Checkout - COD restricted to ship orders (Event Pickup Verification plan)", () => {
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

describe("Checkout - order-page PIN bypass for this session", () => {
  it("seeds the order session token from the create-order response before navigating, so the PIN gate is skipped this once", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    createOrder.mockResolvedValue({ order_token: "tok123", total: 35000, access_token: "session-jwt" })

    const container = await renderCheckout()
    const placeOrderBtn = container.querySelector("button.w-full.rounded-xl")
    await act(async () => { placeOrderBtn.click() })

    expect(sessionStorage.getItem("order_access:tok123")).toBe("session-jwt")
  })

  it("does not blow up if the response has no access_token (e.g. an older server)", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    createOrder.mockResolvedValue({ order_token: "tok123", total: 35000 })

    const container = await renderCheckout()
    const placeOrderBtn = container.querySelector("button.w-full.rounded-xl")
    await act(async () => { placeOrderBtn.click() })

    expect(sessionStorage.getItem("order_access:tok123")).toBeNull()
  })
})

describe("Checkout - digital cart", () => {
  const digitalCartItem = { variant_id: 1, qty: 1, price: 99000, product_name: "Digital Album", variant_label: "", is_digital: true }
  const physicalCartItem = { variant_id: 2, qty: 1, price: 35000, product_name: "Card", variant_label: "A1", is_digital: false }

  it("hides the fulfillment fieldset for an all-digital cart", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([digitalCartItem]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })

    const container = await renderCheckout()

    expect(container.querySelectorAll('input[name="fulfillment"]')).toHaveLength(0)
    expect(container.textContent).not.toContain("Delivery method")
  })

  it("hides cod for an all-digital cart", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([digitalCartItem]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank", "cod"] })

    const container = await renderCheckout()

    const options = [...container.querySelectorAll('[role="radio"]')].map((b) => b.textContent)
    expect(options).toEqual(["Bank transfer"])
  })

  it("hides cod for a mixed cart but still shows the fulfillment fieldset", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([digitalCartItem, physicalCartItem]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank", "cod"] })
    fetchCollection.mockResolvedValue({ allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null })

    const container = await renderCheckout()

    expect(container.querySelectorAll('input[name="fulfillment"]').length).toBeGreaterThan(0)
    const options = [...container.querySelectorAll('[role="radio"]')].map((b) => b.textContent)
    expect(options).toEqual(["Bank transfer"])
  })

  it("still offers pickup for a mixed cart when only the digital item's collection has allow_pickup=false", async () => {
    // allow_pickup defaults to false and a digital-only collection has no
    // reason to ever flip it - this is the realistic shape, unlike the
    // "hides cod for a mixed cart" test above which gives both collections
    // the same allow_pickup:true and so never exercises this path.
    const digitalItem = { ...digitalCartItem, collection_slug: "digital-drop" }
    const physicalItem = { ...physicalCartItem, collection_slug: "physical-drop" }
    localStorage.setItem("shop_cart", JSON.stringify([digitalItem, physicalItem]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    fetchCollection.mockImplementation((slug) => Promise.resolve(
      slug === "digital-drop"
        ? { id: 1, title: "Digital Drop", allow_ship: false, allow_pickup: false, pickup_location: null, pickup_note: null }
        : { id: 2, title: "Physical Drop", allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null }
    ))

    const container = await renderCheckout()

    const radios = container.querySelectorAll('input[name="fulfillment"]')
    expect(radios.length).toBe(2)
  })

  it("omits fulfillment_method from the submitted order for an all-digital cart", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([digitalCartItem]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    createOrder.mockResolvedValue({ order_token: "tok123", total: 99000 })

    const container = await renderCheckout()
    const placeOrderBtn = container.querySelector("button.w-full.rounded-xl")
    await act(async () => { placeOrderBtn.click() })

    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillment_method: undefined })
    )
  })
})

describe("Checkout - variant_not_found recovery", () => {
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
    const placeOrderBtn = container.querySelector("button.w-full.rounded-xl")
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
      response: { status: 409, data: { error: "variant_not_found", message: "Sản phẩm này không còn tồn tại", variant_ids: [2] } },
    })

    const container = await renderCheckout()
    const placeOrderBtn = container.querySelector("button.w-full.rounded-xl")
    await act(async () => { placeOrderBtn.click() })

    expect(readCart()).toEqual([])
    expect(container.textContent).toContain("Your cart is empty")
    // The buyer must still see WHY their (now-empty) cart lost its only
    // item, not just a bare "cart is empty" as if they never added
    // anything - the empty-cart branch previously never checked `error`.
    expect(container.textContent).toContain("Sản phẩm này không còn tồn tại")
  })
})

describe("Checkout - out_of_stock / collection_not_active recovery", () => {
  it("removes the offending line when the server reports out_of_stock at submit time", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([
      { variant_id: 1, qty: 1, product_name: "Card", variant_label: "A1", price: 35000, image_url: null, collection_slug: "drop" },
      { variant_id: 2, qty: 1, product_name: "Poster", variant_label: "Std", price: 90000, image_url: null, collection_slug: "drop" },
    ]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    createOrder.mockRejectedValue({
      response: { status: 409, data: { error: "out_of_stock", message: "x", variant_id: 2 } },
    })

    const container = await renderCheckout()
    const placeOrderBtn = container.querySelector("button.w-full.rounded-xl")
    await act(async () => { placeOrderBtn.click() })

    const remaining = readCart()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].variant_id).toBe(1)
  })

  it("removes the offending line when the server reports collection_not_active at submit time (drop ended after the cart page's own check)", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([
      { variant_id: 1, qty: 1, product_name: "Card", variant_label: "A1", price: 35000, image_url: null, collection_slug: "drop" },
    ]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    createOrder.mockRejectedValue({
      response: { status: 409, data: { error: "collection_not_active", message: "Đợt mở bán đã kết thúc", variant_id: 1 } },
    })

    const container = await renderCheckout()
    const placeOrderBtn = container.querySelector("button.w-full.rounded-xl")
    await act(async () => { placeOrderBtn.click() })

    expect(readCart()).toEqual([])
    expect(container.textContent).toContain("Đợt mở bán đã kết thúc")
  })
})

describe("Checkout - free gift forces shipping info for a digital-only cart", () => {
  const digitalCartItem = { variant_id: 1, qty: 1, price: 99000, product_name: "Digital Album", variant_label: "", is_digital: true }

  it("forces the shipping section open for an all-digital cart that qualifies for a physical gift", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([digitalCartItem]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    fetchGiftSettings.mockResolvedValue({
      enabled: true, min_total: 1, name: "Postcard", image_url: null, note: null, is_digital: false,
    })

    const container = await renderCheckout()

    expect(container.querySelectorAll('input[name="fulfillment"]').length).toBeGreaterThan(0)
  })

  it("does not force the shipping section when the qualifying gift is itself digital", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([digitalCartItem]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    fetchGiftSettings.mockResolvedValue({
      enabled: true, min_total: 1, name: "Wallpaper", image_url: null, note: null, is_digital: true,
    })

    const container = await renderCheckout()

    expect(container.querySelectorAll('input[name="fulfillment"]')).toHaveLength(0)
  })

  it("does not force the shipping section when the gift threshold isn't met", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([digitalCartItem]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    fetchGiftSettings.mockResolvedValue({
      enabled: true, min_total: 999999999, name: "Postcard", image_url: null, note: null, is_digital: false,
    })

    const container = await renderCheckout()

    expect(container.querySelectorAll('input[name="fulfillment"]')).toHaveLength(0)
  })

  it("sends a real fulfillment_method for an all-digital cart forced physical by the gift", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([digitalCartItem]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    fetchGiftSettings.mockResolvedValue({
      enabled: true, min_total: 1, name: "Postcard", image_url: null, note: null, is_digital: false,
    })
    fetchCollection.mockResolvedValue({ allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null })
    createOrder.mockResolvedValue({ order_token: "tok123", total: 99000 })

    const container = await renderCheckout()
    // loadFulfillmentFlags resolves asynchronously (it's only triggered once
    // effectiveAllDigital flips to false) - flush once more before reading
    // the now-rendered radio.
    await act(async () => {})

    const shipRadio = container.querySelector('input[name="fulfillment"]')
    await act(async () => { shipRadio.click() })

    const placeOrderBtn = container.querySelector("button.w-full.rounded-xl")
    await act(async () => { placeOrderBtn.click() })

    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillment_method: expect.stringMatching(/ship|pickup/) })
    )
  })

  it("recovers from a fulfillment_required rejection (e.g. a failed gift-settings fetch) by revealing the shipping section", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([digitalCartItem]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    // The gift-settings fetch failed (or returned stale data), so the
    // client-side estimate never suspected a physical gift applied - the
    // shipping section starts out hidden even though the cart is over the
    // real (server-side) gift threshold.
    fetchGiftSettings.mockRejectedValueOnce(new Error("network"))
    fetchCollection.mockResolvedValue({ allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null })
    createOrder.mockRejectedValueOnce({
      response: { status: 400, data: { error: "invalid_input", message: "Hình thức nhận hàng không hợp lệ" } },
    })

    const container = await renderCheckout()

    expect(container.querySelectorAll('input[name="fulfillment"]')).toHaveLength(0)

    const placeOrderBtn = container.querySelector("button.w-full.rounded-xl")
    await act(async () => { placeOrderBtn.click() })

    expect(container.textContent).toContain("free gift that needs shipping")
    const radios = container.querySelectorAll('input[name="fulfillment"]')
    expect(radios.length).toBeGreaterThan(0)

    createOrder.mockResolvedValue({ order_token: "tok123", total: 99000 })
    await act(async () => { radios[0].click() })
    await act(async () => { placeOrderBtn.click() })

    expect(createOrder).toHaveBeenLastCalledWith(
      expect.objectContaining({ fulfillment_method: expect.stringMatching(/ship|pickup/) })
    )
  })

  it("shows the gift note once the gift has qualified", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    fetchGiftSettings.mockResolvedValue({
      enabled: true, min_total: 1, name: "Postcard", image_url: null, note: "Limited to one per order", is_digital: false,
    })

    const container = await renderCheckout()
    await act(async () => {})

    expect(container.textContent).toContain("Limited to one per order")
  })

  it("does not show the gift note before the gift has qualified", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    fetchGiftSettings.mockResolvedValue({
      enabled: true, min_total: 999999999, name: "Postcard", image_url: null, note: "Limited to one per order", is_digital: false,
    })

    const container = await renderCheckout()
    await act(async () => {})

    expect(container.textContent).not.toContain("Limited to one per order")
  })
})
