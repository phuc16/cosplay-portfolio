import { describe, it, expect, beforeEach } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter } from "react-router-dom"
import { LanguageProvider } from "../../contexts/LanguageContext"
import { addToCart, clearCart } from "../../shop/cart"
import ShopHeader from "./ShopHeader"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function renderHeader() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter>
        <LanguageProvider>
          <ShopHeader />
        </LanguageProvider>
      </MemoryRouter>
    )
  })
  return container
}

const cartLink = (c) => [...c.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/cart")

beforeEach(() => localStorage.clear())

describe("ShopHeader", () => {
  it("renders a link to the cart — the route that was unreachable from inside the shop", async () => {
    const container = await renderHeader()
    expect(cartLink(container)).toBeTruthy()
  })

  it("links back to the collection list", async () => {
    const container = await renderHeader()
    const shopLink = [...container.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/shop")
    expect(shopLink).toBeTruthy()
  })

  it("shows no count badge for an empty cart", async () => {
    const container = await renderHeader()
    expect(cartLink(container).textContent.trim()).toBe("")
  })

  it("shows the item count for a cart that already has items at mount", async () => {
    addToCart({ variant_id: 1, qty: 2, price: 1000, product_name: "A", variant_label: "A1" })
    const container = await renderHeader()
    expect(cartLink(container).textContent).toContain("2")
  })

  // The regression that matters. Adding to cart happens on the collection page
  // WITHOUT navigating, so a header that reads localStorage only at mount shows
  // a stale number until a full reload — which is exactly the bug the old
  // portfolio badge had. This fails against any mount-only read.
  it("updates the count when the cart changes without a remount", async () => {
    const container = await renderHeader()
    expect(cartLink(container).textContent.trim()).toBe("")

    await act(async () => {
      addToCart({ variant_id: 1, qty: 3, price: 1000, product_name: "A", variant_label: "A1" })
    })
    expect(cartLink(container).textContent).toContain("3")

    await act(async () => {
      clearCart()
    })
    expect(cartLink(container).textContent.trim()).toBe("")
  })
})
