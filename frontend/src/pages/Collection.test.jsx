import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import axios from "axios"
import { LanguageProvider } from "../contexts/LanguageContext"
import { ThemeProvider } from "../contexts/ThemeContext"
import { formatVnDateTime } from "../utils/orderDeadline"

const fetchCollection = vi.fn()

vi.mock("../api/shop", () => ({
  fetchCollection: (...args) => fetchCollection(...args),
}))

// ShopFooter (rendered on every shop page) fetches /api/settings - mocked
// here so tests don't attempt a real network call.
vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal()
  return { default: { ...actual.default, get: vi.fn().mockResolvedValue({ data: {} }) } }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: Collection } = await import("./Collection")

function baseCollection(over = {}) {
  return {
    slug: "drop", title: "Drop", status: "active", cover_image: null,
    allow_ship: true, allow_pickup: false, pickup_location: null, pickup_note: null,
    description: null,
    products: [
      {
        id: 1, name: "Card", price: 35000, description: null, images: [],
        variants: [{ id: 1, label: "A1", stock_qty: 5 }],
      },
    ],
    ...over,
  }
}

async function renderCollection() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/merchandise/drop"]}>
        <ThemeProvider>
          <LanguageProvider>
            <Routes>
              <Route path="/merchandise/:slug" element={<Collection />} />
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
  // Restore the default (some SEO-metadata tests below override this with a
  // populated artistName/brand name, which would otherwise leak into every
  // later test in this file since nothing else re-mocks it per test).
  axios.get.mockReset().mockResolvedValue({ data: {} })
  // useSeoMeta appends directly to document.head (outside React's own tree,
  // which is otherwise never unmounted between tests in this file) - clear
  // any tags a previous test's still-mounted Collection instance left
  // behind, so document.head queries below only ever see the current test's
  // own tags.
  document.head.querySelectorAll(
    'meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], script[type="application/ld+json"]'
  ).forEach((el) => el.remove())
})

describe("Collection - product ordering", () => {
  it("sinks fully sold-out products after available ones, without reordering within each group", async () => {
    fetchCollection.mockResolvedValue(baseCollection({
      products: [
        { id: 1, name: "Sold A", price: 1000, description: null, images: [], variants: [{ id: 1, label: "A1", stock_qty: 0 }] },
        { id: 2, name: "Avail A", price: 1000, description: null, images: [], variants: [{ id: 2, label: "A1", stock_qty: 5 }] },
        { id: 3, name: "Sold B", price: 1000, description: null, images: [], variants: [{ id: 3, label: "A1", stock_qty: 0 }, { id: 4, label: "B1", stock_qty: 0 }] },
        { id: 4, name: "Avail B", price: 1000, description: null, images: [], variants: [{ id: 5, label: "A1", stock_qty: 0 }, { id: 6, label: "B1", stock_qty: 2 }] },
      ],
    }))
    const container = await renderCollection()

    const names = [...container.querySelectorAll("h3")].map((h) => h.textContent)
    expect(names).toEqual(["Avail A", "Avail B", "Sold A", "Sold B"])
  })
})

describe("Collection - search, filter, sort", () => {
  function twoProducts(over1 = {}, over2 = {}) {
    return baseCollection({
      products: [
        { id: 1, name: "Photocard", price: 35000, description: null, images: [], variants: [{ id: 1, label: "A1", stock_qty: 5 }], ...over1 },
        { id: 2, name: "Poster", price: 90000, description: null, images: [], variants: [{ id: 2, label: "A1", stock_qty: 5 }], ...over2 },
      ],
    })
  }

  it("filters products by name, case-insensitively", async () => {
    fetchCollection.mockResolvedValue(twoProducts())
    const container = await renderCollection()

    const searchInput = container.querySelector('input[placeholder="Search by name..."]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      setter.call(searchInput, "poster")
      searchInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(container.textContent).toContain("Poster")
    expect(container.textContent).not.toContain("Photocard")
  })

  it("filters by stock status", async () => {
    fetchCollection.mockResolvedValue(twoProducts(
      {},
      { variants: [{ id: 2, label: "A1", stock_qty: 0 }] }
    ))
    const container = await renderCollection()

    const stockTrigger = container.querySelector('button[aria-label="All"]')
    await act(async () => {
      stockTrigger.click()
    })

    const optionButtons = container.querySelectorAll("li button")
    const soldOutOption = [...optionButtons].find((btn) => btn.textContent === "Sold out")
    await act(async () => {
      soldOutOption.click()
    })

    expect(container.textContent).toContain("Poster")
    expect(container.textContent).not.toContain("Photocard")
  })

  it("sorts by price low-high", async () => {
    fetchCollection.mockResolvedValue(twoProducts())
    const container = await renderCollection()

    const sortTrigger = container.querySelector('button[aria-label="Default"]')
    await act(async () => {
      sortTrigger.click()
    })

    const optionButtons = container.querySelectorAll("li button")
    const priceAscOption = [...optionButtons].find((btn) => btn.textContent === "Price: low to high")
    await act(async () => {
      priceAscOption.click()
    })

    const names = [...container.querySelectorAll("h3")].map((h) => h.textContent)
    expect(names).toEqual(["Photocard", "Poster"])
  })

  it("shows a no-match message when the search matches nothing", async () => {
    fetchCollection.mockResolvedValue(twoProducts())
    const container = await renderCollection()

    const searchInput = container.querySelector('input[placeholder="Search by name..."]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      setter.call(searchInput, "nobody")
      searchInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(container.textContent).toContain("No products match your search.")
  })

  it("keeps a sold-out product sunk to the end even under a non-default sort (name A-Z)", async () => {
    // "Photocard" would sort before "Zebra Poster" alphabetically, but it's
    // sold out - it must still land last.
    fetchCollection.mockResolvedValue(twoProducts(
      { name: "Photocard", variants: [{ id: 1, label: "A1", stock_qty: 0 }] },
      { name: "Zebra Poster" }
    ))
    const container = await renderCollection()

    const sortTrigger = container.querySelector('button[aria-label="Default"]')
    await act(async () => {
      sortTrigger.click()
    })

    const optionButtons = container.querySelectorAll("li button")
    const nameAscOption = [...optionButtons].find((btn) => btn.textContent === "Name A-Z")
    await act(async () => {
      nameAscOption.click()
    })

    const names = [...container.querySelectorAll("h3")].map((h) => h.textContent)
    expect(names).toEqual(["Zebra Poster", "Photocard"])
  })
})

describe("Collection - add-to-cart toast", () => {
  it("shows a toast linking to /cart after adding an item", async () => {
    fetchCollection.mockResolvedValue(baseCollection())
    const container = await renderCollection()

    // Single-variant product: clicking the card opens its detail directly (no pill list, no gallery).
    const card = container.querySelector('[role="button"]')
    await act(async () => { card.click() })
    const addBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add to cart")
    await act(async () => { addBtn.click() })

    const toastLink = container.querySelector('a[role="status"]')
    expect(toastLink).toBeTruthy()
    expect(toastLink.getAttribute("href")).toBe("/cart")
  })

  it("toast disappears after the timeout, same as before", async () => {
    vi.useFakeTimers()
    fetchCollection.mockResolvedValue(baseCollection())
    const container = await renderCollection()

    // Single-variant product: clicking the card opens its detail directly (no pill list, no gallery).
    const card = container.querySelector('[role="button"]')
    await act(async () => { card.click() })
    const addBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add to cart")
    await act(async () => { addBtn.click() })
    expect(container.querySelector('a[role="status"]')).toBeTruthy()

    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(container.querySelector('a[role="status"]')).toBeNull()
    vi.useRealTimers()
  })
})

describe("Collection - SEO metadata", () => {
  it("sets the title, description, Open Graph, Twitter Card, and JSON-LD ItemList from the collection's own data", async () => {
    axios.get.mockResolvedValue({ data: { artistName: { vi: "Kamidayhehe", en: "Kamidayhehe" } } })
    fetchCollection.mockResolvedValue(baseCollection({
      title: "Mid-Autumn Drop",
      description: "**Limited** photocards for Mid-Autumn.",
      cover_image: "/api/storage/cover.jpg",
      products: [
        { id: 1, name: "Card A", price: 35000, description: null, images: [], thumbnail_image: "/api/storage/a.jpg", variants: [{ id: 1, label: "A1", stock_qty: 5 }] },
        { id: 2, name: "Card B (sold out)", price: 40000, description: null, images: [], variants: [{ id: 2, label: "A1", stock_qty: 0 }] },
      ],
    }))

    await renderCollection()
    await act(async () => {})

    expect(document.title).toBe("Mid-Autumn Drop - Kamidayhehe")
    expect(document.querySelector('meta[name="description"]').getAttribute("content")).toBe("Limited photocards for Mid-Autumn.")
    expect(document.querySelector('meta[property="og:title"]').getAttribute("content")).toBe("Mid-Autumn Drop - Kamidayhehe")
    expect(document.querySelector('meta[property="og:type"]').getAttribute("content")).toBe("website")
    expect(document.querySelector('meta[property="og:image"]').getAttribute("content")).toBe(`${window.location.origin}/api/storage/cover.jpg`)
    expect(document.querySelector('meta[name="twitter:card"]').getAttribute("content")).toBe("summary_large_image")
    expect(document.querySelector('meta[name="twitter:title"]').getAttribute("content")).toBe("Mid-Autumn Drop - Kamidayhehe")

    const script = document.querySelector('script[type="application/ld+json"]')
    expect(script).toBeTruthy()
    const jsonLd = JSON.parse(script.textContent)
    expect(jsonLd["@type"]).toBe("ItemList")
    expect(jsonLd.numberOfItems).toBe(2)
    expect(jsonLd.itemListElement).toHaveLength(2)
    const [first, second] = jsonLd.itemListElement
    expect(first.item.name).toBe("Card A")
    expect(first.item.offers.priceCurrency).toBe("VND")
    expect(first.item.offers.price).toBe("35000")
    expect(first.item.offers.availability).toBe("https://schema.org/InStock")
    expect(first.item.image).toBe(`${window.location.origin}/api/storage/a.jpg`)
    // Sold-out product: never claims InStock, even though the collection itself is open.
    expect(second.item.offers.availability).toBe("https://schema.org/OutOfStock")
  })

  it("falls back to a generic description and omits og:image/twitter:image when the collection has no description or image anywhere", async () => {
    axios.get.mockResolvedValue({ data: {} })
    fetchCollection.mockResolvedValue(baseCollection({ description: null, cover_image: null }))

    await renderCollection()
    await act(async () => {})

    expect(document.querySelector('meta[name="description"]').getAttribute("content")).toBe("Pick what you like, then place an order.")
    expect(document.querySelector('meta[property="og:image"]')).toBeNull()
    expect(document.querySelector('meta[name="twitter:card"]').getAttribute("content")).toBe("summary")
  })

  it("marks every product OutOfStock in JSON-LD when the collection hasn't started yet, even if individually in stock", async () => {
    axios.get.mockResolvedValue({ data: {} })
    fetchCollection.mockResolvedValue(baseCollection({
      not_started_yet: true, start_at: "2026-12-25T13:00:00.000Z",
      products: [
        { id: 1, name: "Card A", price: 35000, description: null, images: [], variants: [{ id: 1, label: "A1", stock_qty: 5 }] },
      ],
    }))

    await renderCollection()
    await act(async () => {})

    const script = document.querySelector('script[type="application/ld+json"]')
    const jsonLd = JSON.parse(script.textContent)
    expect(jsonLd.itemListElement[0].item.offers.availability).toBe("https://schema.org/OutOfStock")
  })

  it("marks every product OutOfStock in JSON-LD once the collection has closed", async () => {
    axios.get.mockResolvedValue({ data: {} })
    fetchCollection.mockResolvedValue(baseCollection({
      status: "closed",
      products: [
        { id: 1, name: "Card A", price: 35000, description: null, images: [], variants: [{ id: 1, label: "A1", stock_qty: 5 }] },
      ],
    }))

    await renderCollection()
    await act(async () => {})

    const script = document.querySelector('script[type="application/ld+json"]')
    const jsonLd = JSON.parse(script.textContent)
    expect(jsonLd.itemListElement[0].item.offers.availability).toBe("https://schema.org/OutOfStock")
  })

  it("emits no JSON-LD when the collection has no products", async () => {
    axios.get.mockResolvedValue({ data: {} })
    fetchCollection.mockResolvedValue(baseCollection({ products: [] }))

    await renderCollection()
    await act(async () => {})

    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull()
  })

  it("emits no title/meta/JSON-LD while the collection is still loading or wasn't found", async () => {
    fetchCollection.mockImplementation(() => new Promise(() => {})) // never resolves - stays "loading"
    document.title = "Kamidayhehe"

    await renderCollection()
    await act(async () => {})

    expect(document.title).toBe("Kamidayhehe")
    expect(document.querySelector('meta[property="og:title"]')).toBeNull()
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull()
  })
})

describe("Collection - not-started preview", () => {
  it("shows a not-started banner with the open date, and still renders products", async () => {
    fetchCollection.mockResolvedValue(baseCollection({
      not_started_yet: true, start_at: "2026-12-25T13:00:00.000Z",
    }))

    const container = await renderCollection()

    // LanguageProvider defaults to English (localStorage.getItem("lang") || "en"),
    // so the rendered strings are translations.en's, not the Vietnamese ones.
    expect(container.textContent).toContain("Not started yet")
    expect(container.textContent).toContain(formatVnDateTime("2026-12-25T13:00:00.000Z", { withYear: true }))
    expect(container.textContent).toContain("Card")
  })

  it("does not show the not-started banner for a started collection", async () => {
    fetchCollection.mockResolvedValue(baseCollection({ not_started_yet: false }))

    const container = await renderCollection()

    expect(container.textContent).not.toContain("Not started yet")
  })

  it("disables add-to-cart for a not-yet-started collection's product", async () => {
    fetchCollection.mockResolvedValue(baseCollection({
      not_started_yet: true, start_at: "2026-12-25T13:00:00.000Z",
    }))

    const container = await renderCollection()
    // baseCollection's product has no cover image (no product.images, no
    // variant image_url), so there's no <img> to click - open its
    // (single-variant) detail via the card's clickable wrapper instead,
    // same trigger the img would otherwise sit inside (see the identical
    // fix in ProductCard.test.jsx's "unavailableLabel" describe block).
    const card = container.querySelector('[role="button"]')
    await act(async () => { card?.click() })

    const addButton = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Thêm vào giỏ") || b.textContent.includes("Add to cart"))
    expect(addButton).toBeTruthy()
    expect(addButton.disabled).toBe(true)
  })
})
