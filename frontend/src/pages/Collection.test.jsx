import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
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

describe("Collection - tag filter chips", () => {
  function taggedProducts() {
    return baseCollection({
      products: [
        { id: 1, name: "Raiden", price: 35000, description: null, images: [], tags: ["Genshin Impact", "Raiden Shogun"], variants: [{ id: 1, label: "A1", stock_qty: 5 }] },
        { id: 2, name: "Bocchi", price: 35000, description: null, images: [], tags: ["Bocchi the Rock"], variants: [{ id: 2, label: "A1", stock_qty: 5 }] },
        { id: 3, name: "Untagged", price: 35000, description: null, images: [], variants: [{ id: 3, label: "A1", stock_qty: 5 }] },
      ],
    })
  }

  it("does not render a chip bar when no product has any tag", async () => {
    fetchCollection.mockResolvedValue(baseCollection())
    const container = await renderCollection()

    expect(container.textContent).not.toContain("Genshin")
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "All")).toBe(false)
  })

  it("renders a chip per distinct tag, plus an All chip, when at least one product is tagged", async () => {
    fetchCollection.mockResolvedValue(taggedProducts())
    const container = await renderCollection()

    const chipLabels = ["All", "Genshin Impact", "Raiden Shogun", "Bocchi the Rock"]
    for (const label of chipLabels) {
      expect([...container.querySelectorAll("button")].some((b) => b.textContent === label)).toBe(true)
    }
  })

  it("filters the grid to products carrying the clicked tag", async () => {
    fetchCollection.mockResolvedValue(taggedProducts())
    const container = await renderCollection()

    const chip = [...container.querySelectorAll("button")].find((b) => b.textContent === "Bocchi the Rock")
    await act(async () => { chip.click() })

    const names = [...container.querySelectorAll("h3")].map((h) => h.textContent)
    expect(names).toEqual(["Bocchi"])
  })

  it("toggles back to showing everything when the active chip is clicked again", async () => {
    fetchCollection.mockResolvedValue(taggedProducts())
    const container = await renderCollection()

    const chip = () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Bocchi the Rock")
    await act(async () => { chip().click() })
    expect([...container.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Bocchi"])

    await act(async () => { chip().click() })
    const names = [...container.querySelectorAll("h3")].map((h) => h.textContent).sort()
    expect(names).toEqual(["Bocchi", "Raiden", "Untagged"])
  })

  it("the All chip resets an active tag filter", async () => {
    fetchCollection.mockResolvedValue(taggedProducts())
    const container = await renderCollection()

    const tagChip = [...container.querySelectorAll("button")].find((b) => b.textContent === "Bocchi the Rock")
    await act(async () => { tagChip.click() })
    expect([...container.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Bocchi"])

    const allChip = [...container.querySelectorAll("button")].find((b) => b.textContent === "All")
    await act(async () => { allChip.click() })
    const names = [...container.querySelectorAll("h3")].map((h) => h.textContent).sort()
    expect(names).toEqual(["Bocchi", "Raiden", "Untagged"])
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
