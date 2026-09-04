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
  it("shows the brand name (from /api/settings), copyright, and an Admin link", async () => {
    fetchCollections.mockResolvedValue([])
    axios.get.mockResolvedValue({ data: { artistName: { vi: "Kamidayhehe", en: "Kamidayhehe" } } })

    const container = await renderShop()
    await flush()

    const footer = container.querySelector("footer")
    expect(footer).toBeTruthy()
    expect(footer.textContent).toContain("Kamidayhehe")
    expect(footer.textContent).toContain("Made with ♥")
    const adminBtn = [...footer.querySelectorAll("button")].find((b) => b.textContent === "Admin")
    expect(adminBtn).toBeTruthy()
  })

  it("still renders a footer without crashing when /api/settings fails", async () => {
    fetchCollections.mockResolvedValue([])
    axios.get.mockRejectedValue(new Error("network down"))

    const container = await renderShop()
    await flush()

    expect(container.querySelector("footer")).toBeTruthy()
  })
})
