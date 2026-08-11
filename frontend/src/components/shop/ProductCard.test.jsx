import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { LanguageProvider } from "../../contexts/LanguageContext"
import { readCart } from "../../shop/cart"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: ProductCard } = await import("./ProductCard")

function baseProduct(over = {}) {
  return {
    id: 1, name: "Poster", price: 35000, description: null, images: ["https://x/cover.jpg"],
    variants: [
      { id: 1, label: "A1", stock_qty: 5, image_url: "https://x/a1.jpg" },
      { id: 2, label: "B2", stock_qty: 0, image_url: null },
    ],
    ...over,
  }
}

async function renderCard(props = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  const onAdded = props.onAdded || vi.fn()
  const product = props.product || baseProduct()
  await act(async () => {
    root.render(
      <LanguageProvider>
        <ProductCard product={product} collectionSlug="drop" orderable={true} onAdded={onAdded} {...props} />
      </LanguageProvider>
    )
  })
  return { container, onAdded }
}

beforeEach(() => {
  localStorage.clear()
})

describe("ProductCard — variant detail modal", () => {
  it("opens the detail modal showing the variant's own photo when a chip is clicked", async () => {
    const { container } = await renderCard()
    const chip = [...container.querySelectorAll("button")].find((b) => b.textContent === "A1")
    await act(async () => { chip.click() })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog.querySelector('img[src="https://x/a1.jpg"]')).toBeTruthy()
    expect(dialog.textContent).toContain("A1")
  })

  it("does not add to cart just from clicking the chip", async () => {
    const { container } = await renderCard()
    const chip = [...container.querySelectorAll("button")].find((b) => b.textContent === "A1")
    await act(async () => { chip.click() })

    expect(readCart()).toEqual([])
  })

  it("adds to cart and closes the modal when the modal's add button is clicked", async () => {
    const { container, onAdded } = await renderCard()
    const chip = [...container.querySelectorAll("button")].find((b) => b.textContent === "A1")
    await act(async () => { chip.click() })

    const addBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Add to cart")
    await act(async () => { addBtn.click() })

    expect(readCart()).toHaveLength(1)
    expect(readCart()[0].variant_id).toBe(1)
    expect(onAdded).toHaveBeenCalledWith("A1")
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it("closes without adding when Close is clicked", async () => {
    const { container } = await renderCard()
    const chip = [...container.querySelectorAll("button")].find((b) => b.textContent === "A1")
    await act(async () => { chip.click() })

    const closeBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Close")
    await act(async () => { closeBtn.click() })

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(readCart()).toEqual([])
  })

  it("disables the add button in the modal for a sold-out variant, but still shows details", async () => {
    const { container } = await renderCard()
    const chip = [...container.querySelectorAll("button")].find((b) => b.textContent === "B2")
    await act(async () => { chip.click() })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    const addBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Add to cart")
    expect(addBtn.disabled).toBe(true)
  })
})

describe("ProductCard — full variant gallery", () => {
  it("clicking anywhere on the card (cover image) opens the full gallery of all variants", async () => {
    const { container } = await renderCard()
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog.querySelector('img[src="https://x/a1.jpg"]')).toBeTruthy()
    expect(dialog.querySelector('img[alt="B2"][src="https://x/cover.jpg"]')).toBeTruthy() // B2 has no own photo, falls back to cover
    const labels = [...dialog.querySelectorAll("span")].map((s) => s.textContent)
    expect(labels).toContain("A1")
    expect(labels).toContain("B2")
  })

  it("clicking a thumbnail in the gallery opens that variant's detail modal", async () => {
    const { container } = await renderCard()
    const coverImg = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { coverImg.click() })

    const gallery = container.querySelector('[role="dialog"]')
    const b2Thumb = [...gallery.querySelectorAll("button")].find((b) => b.textContent.includes("B2"))
    await act(async () => { b2Thumb.click() })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.textContent).toContain("Poster · B2")
    expect(dialog.querySelector("h3").textContent).toContain("B2")
  })

  it("the detail modal has a link back to the full gallery", async () => {
    const { container } = await renderCard()
    const chip = [...container.querySelectorAll("button")].find((b) => b.textContent === "A1")
    await act(async () => { chip.click() })

    const viewAllBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "View all")
    await act(async () => { viewAllBtn.click() })

    const dialog = container.querySelector('[role="dialog"]')
    const labels = [...dialog.querySelectorAll("span")].map((s) => s.textContent)
    expect(labels).toContain("A1")
    expect(labels).toContain("B2")
  })

  it("a single-variant product skips the gallery and opens detail directly from a card click", async () => {
    const single = baseProduct({ variants: [{ id: 9, label: "Std", stock_qty: null, image_url: null }] })
    const { container } = await renderCard({ product: single })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.textContent).toContain("Poster · Std")
    expect(dialog.querySelector("button")?.textContent).not.toBe("Close")
  })

  it("does not open the picker from a card click when the collection is closed (not orderable)", async () => {
    const { container } = await renderCard({ orderable: false })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
