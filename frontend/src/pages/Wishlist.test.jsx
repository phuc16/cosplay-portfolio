import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { LanguageProvider } from "../contexts/LanguageContext"
import { ThemeProvider } from "../contexts/ThemeContext"
import { addToWishlist, readWishlist } from "../shop/wishlist"
import { readCart } from "../shop/cart"

// ShopFooter (rendered on every shop page) fetches /api/settings - mocked
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

const { default: Wishlist } = await import("./Wishlist")

async function renderWishlist() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/merchandise/wishlist"]}>
        <ThemeProvider>
          <LanguageProvider>
            <Routes>
              <Route path="/merchandise/wishlist" element={<Wishlist />} />
            </Routes>
          </LanguageProvider>
        </ThemeProvider>
      </MemoryRouter>
    )
  })
  return container
}

const physicalCollection = (over = {}) => ({
  status: "active",
  products: [{
    id: 10, name: "Poster", price: 90000, type: "physical",
    variants: [{ id: 1, label: "A1", stock_qty: 5, image_url: "https://x/a1.jpg" }],
  }],
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  fetchCollection.mockReset()
})

describe("Wishlist - empty state", () => {
  it("shows an empty message when nothing is saved", async () => {
    const container = await renderWishlist()
    await act(async () => {})
    expect(container.textContent).toContain("Your wishlist is empty.")
  })
})

describe("Wishlist - rendering saved items with live data", () => {
  it("shows the product name, variant label and live price for a saved item", async () => {
    addToWishlist({ variant_id: 1, product_id: 10, collection_slug: "drop" })
    fetchCollection.mockResolvedValue(physicalCollection())

    const container = await renderWishlist()
    await act(async () => {})

    expect(container.textContent).toContain("Poster · A1")
    expect(container.textContent).toContain("90.000")
  })

  it("links the item back to its collection page", async () => {
    addToWishlist({ variant_id: 1, product_id: 10, collection_slug: "drop" })
    fetchCollection.mockResolvedValue(physicalCollection())

    const container = await renderWishlist()
    await act(async () => {})

    const link = [...container.querySelectorAll("a")].find((a) => a.textContent.includes("Poster"))
    expect(link.getAttribute("href")).toBe("/merchandise/drop")
  })

  it("shows a sold-out badge and disables Add to cart for a variant that's since sold out", async () => {
    addToWishlist({ variant_id: 1, product_id: 10, collection_slug: "drop" })
    fetchCollection.mockResolvedValue(physicalCollection({
      products: [{ id: 10, name: "Poster", price: 90000, type: "physical", variants: [{ id: 1, label: "A1", stock_qty: 0 }] }],
    }))

    const container = await renderWishlist()
    await act(async () => {})

    expect(container.textContent).toContain("Sold out")
    const addBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add to cart")
    expect(addBtn.disabled).toBe(true)
  })

  it("supports a digital product's flattened variant", async () => {
    addToWishlist({ variant_id: 42, product_id: 10, collection_slug: "drop" })
    fetchCollection.mockResolvedValue({
      status: "active",
      products: [{ id: 10, name: "Wallpaper Pack", price: 30000, type: "digital", variant_id: 42, stock_qty: 5 }],
    })

    const container = await renderWishlist()
    await act(async () => {})

    expect(container.textContent).toContain("Wallpaper Pack")
  })
})

describe("Wishlist - a since-deleted/unpublished product", () => {
  it("shows 'no longer available' instead of crashing when the collection 404s", async () => {
    addToWishlist({ variant_id: 1, product_id: 10, collection_slug: "gone" })
    fetchCollection.mockRejectedValue(new Error("404"))

    const container = await renderWishlist()
    await act(async () => {})

    expect(container.textContent).toContain("No longer available")
  })

  it("shows 'no longer available' when the product was deleted from an otherwise-live collection", async () => {
    addToWishlist({ variant_id: 1, product_id: 999, collection_slug: "drop" })
    fetchCollection.mockResolvedValue(physicalCollection())

    const container = await renderWishlist()
    await act(async () => {})

    expect(container.textContent).toContain("No longer available")
  })

  it("does not break the rest of the list when one collection's fetch fails and another's succeeds", async () => {
    addToWishlist({ variant_id: 1, product_id: 10, collection_slug: "gone" })
    addToWishlist({ variant_id: 2, product_id: 20, collection_slug: "drop" })
    fetchCollection.mockImplementation((slug) => {
      if (slug === "gone") return Promise.reject(new Error("404"))
      return Promise.resolve({
        status: "active",
        products: [{ id: 20, name: "Card", price: 20000, type: "physical", variants: [{ id: 2, label: "B1", stock_qty: 3 }] }],
      })
    })

    const container = await renderWishlist()
    await act(async () => {})

    expect(container.textContent).toContain("No longer available")
    expect(container.textContent).toContain("Card · B1")
  })
})

describe("Wishlist - remove", () => {
  it("removes an item from the wishlist and storage when Remove is clicked", async () => {
    addToWishlist({ variant_id: 1, product_id: 10, collection_slug: "drop" })
    fetchCollection.mockResolvedValue(physicalCollection())

    const container = await renderWishlist()
    await act(async () => {})

    const removeBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Remove")
    await act(async () => { removeBtn.click() })

    expect(readWishlist()).toEqual([])
    expect(container.textContent).toContain("Your wishlist is empty.")
  })
})

describe("Wishlist - quick add to cart", () => {
  it("adds the live-priced item to the cart via the existing addToCart function", async () => {
    addToWishlist({ variant_id: 1, product_id: 10, collection_slug: "drop" })
    fetchCollection.mockResolvedValue(physicalCollection())

    const container = await renderWishlist()
    await act(async () => {})

    const addBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add to cart")
    await act(async () => { addBtn.click() })

    const cart = readCart()
    expect(cart).toHaveLength(1)
    expect(cart[0]).toMatchObject({ variant_id: 1, qty: 1, price: 90000, product_name: "Poster", variant_label: "A1" })
  })
})
