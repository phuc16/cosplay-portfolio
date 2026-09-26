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

describe("Collection - character/series tag filter", () => {
  function taggedProducts(tags) {
    return baseCollection({
      products: tags.map((tag, i) => ({
        id: i + 1, name: `Product ${i + 1}`, price: 1000 * (i + 1), description: null, images: [],
        variants: [{ id: i + 1, label: "A1", stock_qty: 5 }],
        character_tag: tag,
      })),
    })
  }

  it("renders no tag filter when every product shares the same single tag", async () => {
    fetchCollection.mockResolvedValue(taggedProducts(["A", "A"]))
    const container = await renderCollection()

    expect(container.querySelector('button[aria-label="All characters"]')).toBeNull()
  })

  it("renders no tag filter when no product is tagged at all", async () => {
    fetchCollection.mockResolvedValue(taggedProducts([null, null]))
    const container = await renderCollection()

    expect(container.querySelector('button[aria-label="All characters"]')).toBeNull()
  })

  it("offers exactly the distinct real tags (no separate untagged option) when 2+ distinct tags exist", async () => {
    fetchCollection.mockResolvedValue(taggedProducts(["A", "A", null, "B"]))
    const container = await renderCollection()

    const trigger = container.querySelector('button[aria-label="All characters"]')
    expect(trigger).toBeTruthy()
    await act(async () => { trigger.click() })

    const options = [...container.querySelectorAll("li button")].map((b) => b.textContent)
    expect(options).toEqual(["All characters", "A", "B"])
  })

  it("filters to only the matching tag, leaving untagged products hidden", async () => {
    fetchCollection.mockResolvedValue(taggedProducts(["A", "B", null]))
    const container = await renderCollection()

    const trigger = container.querySelector('button[aria-label="All characters"]')
    await act(async () => { trigger.click() })
    const optionA = [...container.querySelectorAll("li button")].find((b) => b.textContent === "A")
    await act(async () => { optionA.click() })

    const names = [...container.querySelectorAll("h3")].map((h) => h.textContent)
    expect(names).toEqual(["Product 1"])
  })

  it("combines with the existing stock filter", async () => {
    fetchCollection.mockResolvedValue(baseCollection({
      products: [
        { id: 1, name: "A In Stock", price: 1000, description: null, images: [], character_tag: "A", variants: [{ id: 1, label: "A1", stock_qty: 5 }] },
        { id: 2, name: "A Sold Out", price: 1000, description: null, images: [], character_tag: "A", variants: [{ id: 2, label: "A1", stock_qty: 0 }] },
        { id: 3, name: "B In Stock", price: 1000, description: null, images: [], character_tag: "B", variants: [{ id: 3, label: "A1", stock_qty: 5 }] },
      ],
    }))
    const container = await renderCollection()

    const tagTrigger = container.querySelector('button[aria-label="All characters"]')
    await act(async () => { tagTrigger.click() })
    const tagA = [...container.querySelectorAll("li button")].find((b) => b.textContent === "A")
    await act(async () => { tagA.click() })

    const stockTrigger = container.querySelector('button[aria-label="All"]')
    await act(async () => { stockTrigger.click() })
    const inStockOption = [...container.querySelectorAll("li button")].find((b) => b.textContent === "In stock")
    await act(async () => { inStockOption.click() })

    const names = [...container.querySelectorAll("h3")].map((h) => h.textContent)
    expect(names).toEqual(["A In Stock"])
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

describe("Collection - share deep link", () => {
  function twoVariantProduct(over = {}) {
    return baseCollection({
      products: [
        {
          id: 7, name: "Photocard Set", price: 35000, description: null, images: ["https://x/cover.jpg"],
          variants: [
            { id: 71, label: "A1", stock_qty: 5, image_url: "https://x/a1.jpg" },
            { id: 72, label: "B1", stock_qty: 5, image_url: "https://x/b1.jpg" },
          ],
          ...over,
        },
      ],
    })
  }

  async function renderCollectionAt(path) {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
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

  it("auto-opens the specific variant's detail view when ?product=&variant= match", async () => {
    fetchCollection.mockResolvedValue(twoVariantProduct())
    const container = await renderCollectionAt("/merchandise/drop?product=7&variant=72")

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toContain("Photocard Set · B1")
  })

  it("opens the single-variant product's detail directly when ?product= matches but has only one variant", async () => {
    fetchCollection.mockResolvedValue(baseCollection())
    const container = await renderCollectionAt("/merchandise/drop?product=1")

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toContain("Card")
  })

  it("opens the full gallery when ?product= matches a multi-variant product with no/invalid variant param", async () => {
    fetchCollection.mockResolvedValue(twoVariantProduct())
    const container = await renderCollectionAt("/merchandise/drop?product=7")

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    const labels = [...dialog.querySelectorAll("span")].map((s) => s.textContent)
    expect(labels).toContain("A1")
    expect(labels).toContain("B1")
  })

  it("falls back to the plain grid, no crash, when ?product= matches no product in the collection", async () => {
    fetchCollection.mockResolvedValue(twoVariantProduct())
    const container = await renderCollectionAt("/merchandise/drop?product=999")

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).toContain("Photocard Set")
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
