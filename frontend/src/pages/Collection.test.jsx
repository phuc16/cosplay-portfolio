import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { LanguageProvider } from "../contexts/LanguageContext"
import { ThemeProvider } from "../contexts/ThemeContext"

const fetchCollection = vi.fn()

vi.mock("../api/shop", () => ({
  fetchCollection: (...args) => fetchCollection(...args),
}))

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

describe("Collection — product ordering", () => {
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

describe("Collection — add-to-cart toast", () => {
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
