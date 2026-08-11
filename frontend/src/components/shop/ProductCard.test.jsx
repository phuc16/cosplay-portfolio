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
  await act(async () => {
    root.render(
      <LanguageProvider>
        <ProductCard product={baseProduct()} collectionSlug="drop" orderable={true} onAdded={onAdded} {...props} />
      </LanguageProvider>
    )
  })
  return { container, onAdded }
}

beforeEach(() => {
  localStorage.clear()
})

describe("ProductCard — variant detail modal", () => {
  it("opens a modal showing the variant's own photo when a chip is clicked", async () => {
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

  it("lists every variant inside the modal so the buyer can switch without closing it", async () => {
    const { container } = await renderCard()
    const chip = [...container.querySelectorAll("button")].find((b) => b.textContent === "A1")
    await act(async () => { chip.click() })

    const dialog = container.querySelector('[role="dialog"]')
    const dialogLabels = [...dialog.querySelectorAll("button")].map((b) => b.textContent)
    expect(dialogLabels).toContain("A1")
    expect(dialogLabels).toContain("B2")
  })

  it("switches the preview photo/details when another variant is picked inside the modal", async () => {
    const { container } = await renderCard()
    const chip = [...container.querySelectorAll("button")].find((b) => b.textContent === "A1")
    await act(async () => { chip.click() })

    const dialog = container.querySelector('[role="dialog"]')
    const switchToB2 = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "B2")
    await act(async () => { switchToB2.click() })

    const updatedDialog = container.querySelector('[role="dialog"]')
    expect(updatedDialog.textContent).toContain("Poster · B2")
    expect(updatedDialog.querySelector('img[src="https://x/a1.jpg"]')).toBeNull()
  })
})
