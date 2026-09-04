import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter } from "react-router-dom"
import axios from "axios"
import { LanguageProvider } from "../../contexts/LanguageContext"

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal()
  return { default: { ...actual.default, get: vi.fn() } }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: ShopFooter } = await import("./ShopFooter")

async function renderFooter() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter>
        <LanguageProvider>
          <ShopFooter />
        </LanguageProvider>
      </MemoryRouter>
    )
  })
  return container
}

async function flush() { await act(async () => {}) }

beforeEach(() => {
  axios.get.mockReset()
})

describe("ShopFooter", () => {
  it("shows the brand name (from /api/settings), copyright, and an Admin link", async () => {
    axios.get.mockResolvedValue({ data: { artistName: { vi: "Kamidayhehe", en: "Kamidayhehe" } } })

    const container = await renderFooter()
    await flush()

    const footer = container.querySelector("footer")
    expect(footer).toBeTruthy()
    expect(footer.textContent).toContain("Kamidayhehe")
    expect(footer.textContent).toContain("Made with ♥")
    const adminBtn = [...footer.querySelectorAll("button")].find((b) => b.textContent === "Admin")
    expect(adminBtn).toBeTruthy()
  })

  it("still renders a footer without crashing when /api/settings fails", async () => {
    axios.get.mockRejectedValue(new Error("network down"))

    const container = await renderFooter()
    await flush()

    expect(container.querySelector("footer")).toBeTruthy()
  })
})
