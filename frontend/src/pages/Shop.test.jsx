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
