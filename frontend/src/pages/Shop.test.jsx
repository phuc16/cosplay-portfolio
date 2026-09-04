import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import axios from "axios"
import { LanguageProvider } from "../contexts/LanguageContext"
import { ThemeProvider } from "../contexts/ThemeContext"

const fetchCollections = vi.fn()

vi.mock("../api/shop", () => ({
  fetchCollections: (...args) => fetchCollections(...args),
}))

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal()
  return { default: { ...actual.default, get: vi.fn() } }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: Shop } = await import("./Shop")

async function renderShop() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/merchandise"]}>
        <ThemeProvider>
          <LanguageProvider>
            <Routes>
              <Route path="/merchandise" element={<Shop />} />
            </Routes>
          </LanguageProvider>
        </ThemeProvider>
      </MemoryRouter>
    )
  })
  return container
}

async function flush() { await act(async () => {}) }

beforeEach(() => {
  fetchCollections.mockReset()
  axios.get.mockReset()
})

describe("Shop — collection ordering", () => {
  it("sinks closed (ended) collections after active ones, without reordering within each group", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "ended-a", title: "Ended A", status: "closed", product_count: 0 },
      { id: 2, slug: "active-a", title: "Active A", status: "active", product_count: 1 },
      { id: 3, slug: "ended-b", title: "Ended B", status: "closed", product_count: 0 },
      { id: 4, slug: "active-b", title: "Active B", status: "active", product_count: 2 },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const titles = [...container.querySelectorAll("h2")].map((h) => h.textContent)
    expect(titles).toEqual(["Active A", "Active B", "Ended A", "Ended B"])
  })
})

describe("Shop — search, filter, sort", () => {
  it("filters collections by title, case-insensitively", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "hobby", title: "Hobby Horizon", status: "active", product_count: 1 },
      { id: 2, slug: "winter", title: "Winter Fest", status: "active", product_count: 1 },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const searchInput = container.querySelector('input[placeholder="Search by name..."]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      setter.call(searchInput, "winter")
      searchInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(container.textContent).toContain("Winter Fest")
    expect(container.textContent).not.toContain("Hobby Horizon")
  })

  it("filters by status", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "a", title: "Active One", status: "active", product_count: 1 },
      { id: 2, slug: "b", title: "Ended One", status: "closed", product_count: 1 },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const statusSelect = [...container.querySelectorAll("select")][0]
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
      setter.call(statusSelect, "active")
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(container.textContent).toContain("Active One")
    expect(container.textContent).not.toContain("Ended One")
  })

  it("sorts by name A-Z", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "z", title: "Zebra Drop", status: "active", product_count: 1 },
      { id: 2, slug: "a", title: "Apple Drop", status: "active", product_count: 1 },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const sortSelect = [...container.querySelectorAll("select")][1]
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
      setter.call(sortSelect, "name_asc")
      sortSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const titles = [...container.querySelectorAll("h2")].map((h) => h.textContent)
    expect(titles).toEqual(["Apple Drop", "Zebra Drop"])
  })

  it("shows a no-match message when the search matches nothing", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "hobby", title: "Hobby Horizon", status: "active", product_count: 1 },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const searchInput = container.querySelector('input[placeholder="Search by name..."]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      setter.call(searchInput, "nobody")
      searchInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(container.textContent).toContain("No collections match your search.")
  })
})

describe("Shop — closed drop overlay", () => {
  it("shows a 'this drop has ended' overlay on the thumbnail for a closed collection", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "ended", title: "Ended", status: "closed", product_count: 0, cover_image: "https://x/cover.jpg" },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const img = container.querySelector('img[src="https://x/cover.jpg"]')
    const overlay = img.parentElement.querySelector("span")
    expect(overlay).toBeTruthy()
    expect(overlay.textContent).toBe("This drop has ended")
  })

  it("shows no overlay for an active collection's thumbnail", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "active", title: "Active", status: "active", product_count: 1, cover_image: "https://x/cover.jpg" },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const img = container.querySelector('img[src="https://x/cover.jpg"]')
    expect(img.parentElement.querySelector("span")).toBeNull()
  })
})

describe("Shop — footer", () => {
  // Full footer content/behavior is covered by ShopFooter.test.jsx — this
  // just confirms Shop.jsx actually renders it.
  it("renders the shared ShopFooter", async () => {
    fetchCollections.mockResolvedValue([])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    expect(container.querySelector("footer")).toBeTruthy()
  })
})
