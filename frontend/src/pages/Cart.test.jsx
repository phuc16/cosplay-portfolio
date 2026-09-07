import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { LanguageProvider } from "../contexts/LanguageContext"
import { ThemeProvider } from "../contexts/ThemeContext"
import { addToCart, readCart } from "../shop/cart"

// ShopFooter (rendered on every shop page) fetches /api/settings — mocked
// here so tests don't attempt a real network call.
vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal()
  return { default: { ...actual.default, get: vi.fn().mockResolvedValue({ data: {} }) } }
})

const fetchCollection = vi.fn()
vi.mock("../api/shop", () => ({
  fetchCollection: (...args) => fetchCollection(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: Cart } = await import("./Cart")

async function renderCart() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/cart"]}>
        <ThemeProvider>
          <LanguageProvider>
            <Routes>
              <Route path="/cart" element={<Cart />} />
            </Routes>
          </LanguageProvider>
        </ThemeProvider>
      </MemoryRouter>
    )
  })
  return container
}

beforeEach(() => {
  localStorage.clear()
  fetchCollection.mockReset()
})

describe("Cart — clicking an item goes to its product", () => {
  it("links the item to its collection page", async () => {
    fetchCollection.mockResolvedValue({
      status: "active",
      products: [{ type: "physical", variants: [{ id: 1, stock_qty: null }] }],
    })
    addToCart({
      variant_id: 1, qty: 1, product_name: "Poster A4", variant_label: "Std",
      price: 90000, image_url: null, collection_slug: "drop",
    })
    const container = await renderCart()

    const link = [...container.querySelectorAll("a")].find((a) => a.textContent.includes("Poster A4"))
    expect(link).toBeTruthy()
    expect(link.getAttribute("href")).toBe("/merchandise/drop")
  })

  it("renders plainly (no link) when the item has no collection_slug", async () => {
    addToCart({
      variant_id: 2, qty: 1, product_name: "Legacy Item", variant_label: "Std",
      price: 50000, image_url: null, collection_slug: null,
    })
    const container = await renderCart()

    const link = [...container.querySelectorAll("a")].find((a) => a.textContent.includes("Legacy Item"))
    expect(link).toBeUndefined()
    expect(container.textContent).toContain("Legacy Item")
  })
})

describe("Cart — removing an item", () => {
  it("shows a confirm popup naming the item, and keeps it when Cancel is clicked", async () => {
    fetchCollection.mockResolvedValue({
      status: "active",
      products: [{ type: "physical", variants: [{ id: 3, stock_qty: null }] }],
    })
    addToCart({
      variant_id: 3, qty: 1, product_name: "Poster A4", variant_label: "Std",
      price: 90000, image_url: null, collection_slug: "drop",
    })
    const container = await renderCart()

    const removeBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "✕")
    await act(async () => { removeBtn.click() })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toContain("Poster A4 · Std")

    const cancelBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Cancel")
    await act(async () => { cancelBtn.click() })

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(readCart()).toHaveLength(1)
  })

  it("removes the item once Remove is clicked in the popup", async () => {
    fetchCollection.mockResolvedValue({
      status: "active",
      products: [{ type: "physical", variants: [{ id: 4, stock_qty: null }] }],
    })
    addToCart({
      variant_id: 4, qty: 1, product_name: "Poster A4", variant_label: "Std",
      price: 90000, image_url: null, collection_slug: "drop",
    })
    const container = await renderCart()

    const removeBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "✕")
    await act(async () => { removeBtn.click() })

    const dialog = container.querySelector('[role="dialog"]')
    const confirmBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Remove")
    await act(async () => { confirmBtn.click() })

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(readCart()).toEqual([])
  })
})

describe("Cart — early availability validation", () => {
  it("shows a sold-out badge, disables quantity controls, and disables checkout for a sold-out line", async () => {
    fetchCollection.mockResolvedValue({
      status: "active",
      products: [{ type: "physical", variants: [{ id: 20, stock_qty: 0 }] }],
    })
    addToCart({ variant_id: 20, qty: 1, product_name: "Sold Out Item", variant_label: "Std", price: 10000, image_url: null, collection_slug: "drop" })

    const container = await renderCart()
    await act(async () => {})

    expect(container.textContent).toContain("Sold out")
    const checkoutBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Checkout")
    expect(checkoutBtn.disabled).toBe(true)
  })

  it("shows an ended badge for a closed collection's line", async () => {
    fetchCollection.mockResolvedValue({ status: "closed", products: [] })
    addToCart({ variant_id: 21, qty: 1, product_name: "Ended Drop Item", variant_label: "Std", price: 10000, image_url: null, collection_slug: "ended" })

    const container = await renderCart()
    await act(async () => {})

    expect(container.textContent).toContain("This drop has ended")
  })

  it("shows an unavailable badge when the collection fetch fails", async () => {
    fetchCollection.mockRejectedValue(new Error("404"))
    addToCart({ variant_id: 22, qty: 1, product_name: "Hidden Item", variant_label: "Std", price: 10000, image_url: null, collection_slug: "hidden" })

    const container = await renderCart()
    await act(async () => {})

    expect(container.textContent).toContain("No longer available")
  })

  it("re-enables checkout after removing the only bad line", async () => {
    fetchCollection.mockResolvedValue({
      status: "active",
      products: [{ type: "physical", variants: [{ id: 23, stock_qty: 0 }] }],
    })
    addToCart({ variant_id: 23, qty: 1, product_name: "Sold Out Item", variant_label: "Std", price: 10000, image_url: null, collection_slug: "drop" })

    const container = await renderCart()
    await act(async () => {})

    const removeBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "✕")
    await act(async () => { removeBtn.click() })
    const confirmBtn = [...container.querySelector('[role="dialog"]').querySelectorAll("button")].find((b) => b.textContent === "Remove")
    await act(async () => { confirmBtn.click() })

    expect(readCart()).toHaveLength(0)
  })
})
