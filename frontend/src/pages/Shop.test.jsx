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

describe("Shop - collection ordering", () => {
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

    const titles = [...container.querySelectorAll("h3")].map((h) => h.textContent)
    expect(titles).toEqual(["Active A", "Active B", "Ended A", "Ended B"])
  })
})

describe("Shop - digital badge", () => {
  it("badges only the collection that has a digital product", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "mid-autumn", title: "Mid-Autumn Festival", status: "active", product_count: 1, has_digital_item: true },
      { id: 2, slug: "spring-fest", title: "Spring Festival", status: "active", product_count: 1, has_digital_item: false },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const cards = [...container.querySelectorAll("a")]
    const withDigital = cards.find((a) => a.textContent.includes("Mid-Autumn Festival"))
    const withoutDigital = cards.find((a) => a.textContent.includes("Spring Festival"))
    expect(withDigital.textContent).toContain("Digital")
    expect(withoutDigital.textContent).not.toContain("Digital")
  })
})

describe("Shop - grouped by type", () => {
  it("groups collections under Digital/Physical headings, each listing only its own collections", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "a", title: "A", status: "active", product_count: 1, has_digital_item: true },
      { id: 2, slug: "b", title: "B", status: "active", product_count: 1, has_digital_item: true },
      { id: 3, slug: "c", title: "C", status: "active", product_count: 1, has_digital_item: true },
      { id: 4, slug: "d", title: "D", status: "active", product_count: 1, has_digital_item: false },
      { id: 5, slug: "e", title: "E", status: "active", product_count: 1, has_digital_item: false },
      { id: 6, slug: "f", title: "F", status: "active", product_count: 1, has_digital_item: false },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const groups = [...container.querySelectorAll('[data-testid="collection-group-title"]')]
    expect(groups.map((g) => g.textContent)).toEqual(["Digital", "Physical"])

    const digitalGroup = groups[0].closest("div")
    const physicalGroup = groups[1].closest("div")
    expect([...digitalGroup.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["A", "B", "C"])
    expect([...physicalGroup.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["D", "E", "F"])
  })

  it("omits the Digital group heading entirely when no collection has a digital item", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "d", title: "D", status: "active", product_count: 1, has_digital_item: false },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const groups = [...container.querySelectorAll('[data-testid="collection-group-title"]')]
    expect(groups.map((g) => g.textContent)).toEqual(["Physical"])
  })

  it("omits the Physical group heading entirely when every collection has a digital item", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "a", title: "A", status: "active", product_count: 1, has_digital_item: true },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const groups = [...container.querySelectorAll('[data-testid="collection-group-title"]')]
    expect(groups.map((g) => g.textContent)).toEqual(["Digital"])
  })

  it("groups a gacha collection under its own Gacha heading, ahead of Digital and Physical", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "a", title: "Gacha One", status: "active", product_count: 1, has_gacha_item: true, has_digital_item: false },
      { id: 2, slug: "b", title: "Digital One", status: "active", product_count: 1, has_gacha_item: false, has_digital_item: true },
      { id: 3, slug: "c", title: "Physical One", status: "active", product_count: 1, has_gacha_item: false, has_digital_item: false },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const groups = [...container.querySelectorAll('[data-testid="collection-group-title"]')]
    expect(groups.map((g) => g.textContent)).toEqual(["Gacha", "Digital", "Physical"])

    const gachaGroup = groups[0].closest("div")
    expect([...gachaGroup.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Gacha One"])
  })

  it("puts a collection mixing gacha and digital items into the Gacha group, not Digital", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "a", title: "Mixed", status: "active", product_count: 2, has_gacha_item: true, has_digital_item: true },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const groups = [...container.querySelectorAll('[data-testid="collection-group-title"]')]
    expect(groups.map((g) => g.textContent)).toEqual(["Gacha"])
  })

  it("badges a gacha collection's card with Gacha instead of Digital", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "a", title: "Gacha One", status: "active", product_count: 1, has_gacha_item: true, has_digital_item: false },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const card = [...container.querySelectorAll("a")].find((a) => a.textContent.includes("Gacha One"))
    expect(card.textContent).toContain("Gacha")
    expect(card.textContent).not.toContain("Digital")
  })
})

describe("Shop - not-started preview", () => {
  it("badges a not-yet-started collection with its open date, distinct from the closed overlay", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "upcoming", title: "Upcoming Drop", status: "active", product_count: 2, not_started_yet: true, start_at: "2026-12-25T13:00:00.000Z" },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    expect(container.textContent).toContain("Not started yet")
    expect(container.textContent).not.toContain("This drop has ended")
  })

  it("does not badge a started, active collection", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "live", title: "Live Drop", status: "active", product_count: 2, not_started_yet: false },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    expect(container.textContent).not.toContain("Not started yet")
  })

  it("sorts not-started collections between live and closed ones", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "ended", title: "Ended", status: "closed", product_count: 0, not_started_yet: false },
      { id: 2, slug: "live", title: "Live", status: "active", product_count: 1, not_started_yet: false },
      { id: 3, slug: "upcoming", title: "Upcoming", status: "active", product_count: 1, not_started_yet: true, start_at: "2026-12-25T13:00:00.000Z" },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const titles = [...container.querySelectorAll("h3")].map((h) => h.textContent)
    expect(titles).toEqual(["Live", "Upcoming", "Ended"])
  })
})

describe("Shop - search, filter, sort", () => {
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

    // Find the status filter trigger by its aria-label (the placeholder text "All")
    const statusTrigger = container.querySelector('button[aria-label="All"]')
    await act(async () => {
      statusTrigger.click()
    })

    const optionButtons = container.querySelectorAll("li button")
    const activeOption = [...optionButtons].find((btn) => btn.textContent === "Open")
    await act(async () => {
      activeOption.click()
    })

    expect(container.textContent).toContain("Active One")
    expect(container.textContent).not.toContain("Ended One")
  })

  it("filters by type (Digital/Physical)", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "a", title: "Digital One", status: "active", product_count: 1, has_digital_item: true },
      { id: 2, slug: "b", title: "Physical One", status: "active", product_count: 1, has_digital_item: false },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const typeTrigger = container.querySelector('button[aria-label="All types"]')
    await act(async () => {
      typeTrigger.click()
    })

    const optionButtons = container.querySelectorAll("li button")
    const digitalOption = [...optionButtons].find((btn) => btn.textContent === "Digital")
    await act(async () => {
      digitalOption.click()
    })

    expect(container.textContent).toContain("Digital One")
    expect(container.textContent).not.toContain("Physical One")

    const groups = [...container.querySelectorAll('[data-testid="collection-group-title"]')]
    expect(groups.map((g) => g.textContent)).toEqual(["Digital"])
  })

  it("sorts by name A-Z", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "z", title: "Zebra Drop", status: "active", product_count: 1 },
      { id: 2, slug: "a", title: "Apple Drop", status: "active", product_count: 1 },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    // Find the sort filter trigger by its aria-label (the placeholder text "Default")
    const sortTrigger = container.querySelector('button[aria-label="Default"]')
    await act(async () => {
      sortTrigger.click()
    })

    const optionButtons = container.querySelectorAll("li button")
    const nameAscOption = [...optionButtons].find((btn) => btn.textContent === "Name A-Z")
    await act(async () => {
      nameAscOption.click()
    })

    const titles = [...container.querySelectorAll("h3")].map((h) => h.textContent)
    expect(titles).toEqual(["Apple Drop", "Zebra Drop"])
  })

  it("keeps a closed (ended) collection sunk to the end even under a non-default sort (name A-Z)", async () => {
    // "Apple Drop" would sort before "Zebra Drop" alphabetically, but it's
    // closed - it must still land last.
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "a", title: "Apple Drop", status: "closed", product_count: 1 },
      { id: 2, slug: "z", title: "Zebra Drop", status: "active", product_count: 1 },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    // Find the sort filter trigger by its aria-label (the placeholder text "Default")
    const sortTrigger = container.querySelector('button[aria-label="Default"]')
    await act(async () => {
      sortTrigger.click()
    })

    const optionButtons = container.querySelectorAll("li button")
    const nameAscOption = [...optionButtons].find((btn) => btn.textContent === "Name A-Z")
    await act(async () => {
      nameAscOption.click()
    })

    const titles = [...container.querySelectorAll("h3")].map((h) => h.textContent)
    expect(titles).toEqual(["Zebra Drop", "Apple Drop"])
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

describe("Shop - closed drop overlay", () => {
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

describe("Shop - footer", () => {
  // Full footer content/behavior is covered by ShopFooter.test.jsx - this
  // just confirms Shop.jsx actually renders it.
  it("renders the shared ShopFooter", async () => {
    fetchCollections.mockResolvedValue([])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    expect(container.querySelector("footer")).toBeTruthy()
  })
})
