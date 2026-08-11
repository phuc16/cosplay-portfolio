import { describe, it, expect, beforeEach } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { LanguageProvider } from "../contexts/LanguageContext"
import { ThemeProvider } from "../contexts/ThemeContext"
import { addToCart } from "../shop/cart"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: Cart } = await import("./Cart")

async function renderCart() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/cart"]}>
        <ThemeProvider>
          <LanguageProvider>
            <Routes>
              <Route path="/cart" element={<Cart />} />
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
})

describe("Cart — clicking an item goes to its product", () => {
  it("links the item to its collection page", async () => {
    addToCart({
      variant_id: 1, qty: 1, product_name: "Poster A4", variant_label: "Std",
      price: 90000, image_url: null, collection_slug: "drop",
    })
    const container = await renderCart()

    const link = [...container.querySelectorAll("a")].find((a) => a.textContent.includes("Poster A4"))
    expect(link).toBeTruthy()
    expect(link.getAttribute("href")).toBe("/merchandise/drop")
  })

  it("renders plainly (no link) when the item has no collection_slug", async () => {
    addToCart({
      variant_id: 2, qty: 1, product_name: "Legacy Item", variant_label: "Std",
      price: 50000, image_url: null, collection_slug: null,
    })
    const container = await renderCart()

    const link = [...container.querySelectorAll("a")].find((a) => a.textContent.includes("Legacy Item"))
    expect(link).toBeUndefined()
    expect(container.textContent).toContain("Legacy Item")
  })
})
