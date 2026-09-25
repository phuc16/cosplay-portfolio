import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter } from "react-router-dom"
import { LanguageProvider } from "../../contexts/LanguageContext"
import { readCart } from "../../shop/cart"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: ProductCard, isProductSoldOut, isSoldOut } = await import("./ProductCard")

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
      <MemoryRouter>
        <LanguageProvider>
          <ProductCard product={product} collectionSlug="drop" orderable={true} onAdded={onAdded} {...props} />
        </LanguageProvider>
      </MemoryRouter>
    )
  })
  return { container, onAdded }
}

beforeEach(() => {
  localStorage.clear()
})

// The per-card pill list was removed - opening any variant's detail now goes
// through the "click the card -> full gallery -> pick a thumbnail" flow. A
// single-variant product skips the gallery and lands on the detail modal
// directly from the card click, so there is no thumbnail to click there.
async function openVariantDetail(container, label) {
  const cover = container.querySelector('img[src="https://x/cover.jpg"]')
  await act(async () => { cover.click() })
  const dialog = container.querySelector('[role="dialog"]')
  const thumb = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes(label))
  if (thumb) await act(async () => { thumb.click() })
}

describe("ProductCard - variant description", () => {
  it("renders a variant's own markdown description in its detail modal", async () => {
    const product = baseProduct({
      variants: [{ id: 1, label: "A1", stock_qty: 5, image_url: "https://x/a1.jpg", description: "**Size chart** here" }],
    })
    const { container } = await renderCard({ product })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.querySelector("strong")?.textContent).toBe("Size chart")
    expect(dialog.textContent).toContain("here")
  })

  it("shows nothing extra when the variant has no description", async () => {
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.querySelector(".prose")).toBeNull()
  })
})

describe("isSoldOut (per-variant)", () => {
  it("is exported and reports true only for a variant whose stock_qty is a non-null number <= 0", () => {
    expect(isSoldOut({ stock_qty: 0 })).toBe(true)
    expect(isSoldOut({ stock_qty: 5 })).toBe(false)
    expect(isSoldOut({ stock_qty: null })).toBe(false)
    expect(isSoldOut({ stock_qty: undefined })).toBe(false)
  })
})

describe("ProductCard - sold-out overlay", () => {
  it("shows a 'Sold out' overlay on the cover when every variant is sold out", async () => {
    const product = baseProduct({
      variants: [
        { id: 1, label: "A1", stock_qty: 0, image_url: "https://x/a1.jpg" },
        { id: 2, label: "B2", stock_qty: 0, image_url: null },
      ],
    })
    const { container } = await renderCard({ product })

    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    const overlay = cover.parentElement.querySelector("span")
    expect(overlay).toBeTruthy()
    expect(overlay.textContent).toBe("Sold out")
  })

  it("shows no overlay when at least one variant is still in stock", async () => {
    const { container } = await renderCard()
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    expect(cover.parentElement.querySelector("span")).toBeNull()
  })
})

describe("ProductCard - variant thumbnail_image", () => {
  it("uses a variant's own thumbnail_image as its gallery-grid cover, not its own photo", async () => {
    const product = baseProduct({
      variants: [
        { id: 1, label: "A1", stock_qty: 5, image_url: "https://x/a1.jpg", thumbnail_image: "https://x/a1-thumb.jpg" },
        { id: 2, label: "B2", stock_qty: 5, image_url: "https://x/b2.jpg" },
      ],
    })
    const { container } = await renderCard({ product })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.querySelector('img[src="https://x/a1-thumb.jpg"]')).toBeTruthy()
    expect(dialog.querySelector('img[alt="A1"][src="https://x/a1.jpg"]')).toBeNull()
  })

  it("falls back to the variant's own photo when it has no thumbnail_image", async () => {
    const { container } = await renderCard()
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.querySelector('img[src="https://x/a1.jpg"]')).toBeTruthy()
  })

  it("is never used as the detail modal's own picture - only variantImages (images/image_url) appear there", async () => {
    const product = baseProduct({
      variants: [{ id: 1, label: "A1", stock_qty: 5, image_url: "https://x/a1.jpg", thumbnail_image: "https://x/a1-thumb.jpg" }],
    })
    const { container } = await renderCard({ product })
    await openVariantDetail(container, "A1")

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.querySelector('img[src="https://x/a1.jpg"]')).toBeTruthy()
    expect(dialog.querySelector('img[src="https://x/a1-thumb.jpg"]')).toBeNull()
  })
})

describe("ProductCard - variant detail modal", () => {
  it("opens the detail modal showing the variant's own photo when picked from the gallery", async () => {
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog.querySelector('img[src="https://x/a1.jpg"]')).toBeTruthy()
    expect(dialog.textContent).toContain("A1")
  })

  it("does not add to cart just from opening the detail modal", async () => {
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    expect(readCart()).toEqual([])
  })

  it("adds to cart and returns to the gallery grid (not closing entirely) for a multi-variant product", async () => {
    const { container, onAdded } = await renderCard()
    await openVariantDetail(container, "A1")

    const addBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Add to cart")
    await act(async () => { addBtn.click() })

    expect(readCart()).toHaveLength(1)
    expect(readCart()[0].variant_id).toBe(1)
    expect(onAdded).toHaveBeenCalledWith("A1")

    // Back at the picker, not closed - so the buyer can add another code
    // right away instead of re-opening the product from the collection page.
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    const labels = [...dialog.querySelectorAll("span")].map((s) => s.textContent)
    expect(labels).toContain("A1")
    expect(labels).toContain("B2")
  })

  it("closes entirely after adding to cart for a single-variant product", async () => {
    const single = baseProduct({ variants: [{ id: 9, label: "Std", stock_qty: null, image_url: null }] })
    const { container, onAdded } = await renderCard({ product: single })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const addBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Add to cart")
    await act(async () => { addBtn.click() })

    expect(readCart()).toHaveLength(1)
    expect(onAdded).toHaveBeenCalledWith("Std")
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it("closes without adding when Close is clicked", async () => {
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    const closeBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Close")
    await act(async () => { closeBtn.click() })

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(readCart()).toEqual([])
  })

  it("disables the add button in the modal for a sold-out variant, but still shows details", async () => {
    const { container } = await renderCard()
    await openVariantDetail(container, "B2")

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    const addBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Add to cart")
    expect(addBtn.disabled).toBe(true)
  })
})

describe("ProductCard - quantity in the detail modal", () => {
  it("defaults to qty 1 and adds that quantity to cart", async () => {
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    const dialog = container.querySelector('[role="dialog"]')
    const qtyInput = dialog.querySelector('input[type="number"]')
    expect(qtyInput.value).toBe("1")

    const addBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Add to cart")
    await act(async () => { addBtn.click() })

    expect(readCart()[0].qty).toBe(1)
  })

  it("increments and decrements via the +/- buttons", async () => {
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    let dialog = container.querySelector('[role="dialog"]')
    const plus = dialog.querySelector('button[aria-label="Increase quantity"]')
    const minus = dialog.querySelector('button[aria-label="Decrease quantity"]')

    await act(async () => { plus.click() })
    await act(async () => { plus.click() })
    dialog = container.querySelector('[role="dialog"]')
    expect(dialog.querySelector('input[type="number"]').value).toBe("3")

    await act(async () => { minus.click() })
    dialog = container.querySelector('[role="dialog"]')
    expect(dialog.querySelector('input[type="number"]').value).toBe("2")

    const addBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Add to cart")
    await act(async () => { addBtn.click() })
    expect(readCart()[0].qty).toBe(2)
  })

  it("clamps quantity to the variant's remaining stock", async () => {
    const { container } = await renderCard({
      product: baseProduct({ variants: [{ id: 3, label: "A1", stock_qty: 2, image_url: null }] }),
    })
    await openVariantDetail(container, "A1")

    let dialog = container.querySelector('[role="dialog"]')
    const plus = dialog.querySelector('button[aria-label="Increase quantity"]')

    await act(async () => { plus.click() })
    await act(async () => { plus.click() })
    await act(async () => { plus.click() }) // one extra past the stock ceiling of 2

    dialog = container.querySelector('[role="dialog"]')
    expect(dialog.querySelector('input[type="number"]').value).toBe("2")
    expect(plus.disabled).toBe(true)
  })

  it("does not clamp quantity for an unlimited-stock variant", async () => {
    const { container } = await renderCard({
      product: baseProduct({ variants: [{ id: 4, label: "A1", stock_qty: null, image_url: null }] }),
    })
    await openVariantDetail(container, "A1")

    const dialog = container.querySelector('[role="dialog"]')
    const plus = dialog.querySelector('button[aria-label="Increase quantity"]')
    for (let i = 0; i < 10; i++) {
      await act(async () => { plus.click() })
    }
    expect(container.querySelector('[role="dialog"] input[type="number"]').value).toBe("11")
  })

  it("resets quantity back to 1 when switching to a different variant via the gallery", async () => {
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    let dialog = container.querySelector('[role="dialog"]')
    const plus = dialog.querySelector('button[aria-label="Increase quantity"]')
    await act(async () => { plus.click() })
    dialog = container.querySelector('[role="dialog"]')
    expect(dialog.querySelector('input[type="number"]').value).toBe("2")

    const viewAllBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "View all")
    await act(async () => { viewAllBtn.click() })
    const gallery = container.querySelector('[role="dialog"]')
    const a1Thumb = [...gallery.querySelectorAll("button")].find((b) => b.textContent.includes("A1"))
    await act(async () => { a1Thumb.click() })

    dialog = container.querySelector('[role="dialog"]')
    expect(dialog.querySelector('input[type="number"]').value).toBe("1")
  })
})

describe("digital products", () => {
  const digitalProduct = (overrides = {}) => ({
    id: 1, name: "Digital Album", price: 99000, type: "digital",
    images: ["https://x/cover.jpg"], variant_id: 42, stock_qty: 5,
    ...overrides,
  })

  it("has no variant picker - opens straight to add-to-cart", async () => {
    const { container } = await renderCard({ product: digitalProduct() })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    expect(container.textContent).toContain("Digital Album")
  })

  it("adds to cart using the flattened variant_id", async () => {
    const { container } = await renderCard({ product: digitalProduct() })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const addButton = [...container.querySelectorAll("button")].find((b) => /add to cart/i.test(b.textContent))
    await act(async () => { addButton.click() })

    const cart = readCart()
    expect(cart[0].variant_id).toBe(42)
    expect(cart[0].is_digital).toBe(true)
  })

  it("isProductSoldOut reads the flattened stock_qty for a digital product", () => {
    expect(isProductSoldOut(digitalProduct({ stock_qty: 0 }))).toBe(true)
    expect(isProductSoldOut(digitalProduct({ stock_qty: 5 }))).toBe(false)
    expect(isProductSoldOut(digitalProduct({ stock_qty: null }))).toBe(false)
  })

  it("shows the sold-out overlay on a digital product's cover when stock_qty is 0", async () => {
    const { container } = await renderCard({ product: digitalProduct({ stock_qty: 0 }) })
    expect(container.textContent).toContain("Sold out")
  })

  it("badges the card and the detail view as digital, so a buyer can tell without reading the title/description", async () => {
    const { container } = await renderCard({ product: digitalProduct() })
    expect(container.textContent).toContain("Digital")

    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })
    expect(container.querySelectorAll('[role="dialog"] *').length).toBeGreaterThan(0)
    const dialogText = container.querySelector('[role="dialog"]').textContent
    expect(dialogText).toContain("Digital")
  })

  it("does not badge a physical product as digital", async () => {
    const { container } = await renderCard({
      product: { id: 2, name: "Card", price: 35000, images: ["https://x/card.jpg"], variants: [{ id: 1, label: "A1", stock_qty: 5 }] },
    })
    expect(container.textContent).not.toContain("Digital")
  })

  it("uses thumbnail_image as the cover when set, not the first gallery image", async () => {
    const { container } = await renderCard({
      product: digitalProduct({ thumbnail_image: "https://x/thumb.jpg" }),
    })
    expect(container.querySelector('img[src="https://x/thumb.jpg"]')).toBeTruthy()
    expect(container.querySelector('img[src="https://x/cover.jpg"]')).toBeNull()
  })

  it("falls back to the first gallery image when thumbnail_image is not set", async () => {
    const { container } = await renderCard({ product: digitalProduct() })
    expect(container.querySelector('img[src="https://x/cover.jpg"]')).toBeTruthy()
  })

  it("uses thumbnail_image (not the first gallery image) as the cart line's image_url", async () => {
    const { container } = await renderCard({
      product: digitalProduct({ thumbnail_image: "https://x/thumb.jpg" }),
    })
    const cover = container.querySelector('img[src="https://x/thumb.jpg"]')
    await act(async () => { cover.click() })
    const addButton = [...container.querySelectorAll("button")].find((b) => /add to cart/i.test(b.textContent))
    await act(async () => { addButton.click() })

    const cart = readCart()
    expect(cart[0].image_url).toBe("https://x/thumb.jpg")
  })
})

describe("gacha products", () => {
  const gachaProduct = (overrides = {}) => ({
    id: 3, name: "Mystery Case", price: 20000, type: "gacha",
    images: ["https://x/cover.jpg"], variant_id: 77, stock_qty: null,
    variants: [], gacha_pool_remaining: 10,
    ...overrides,
  })

  it("has no variant picker - opens straight to add-to-cart, like a digital product", async () => {
    const { container } = await renderCard({ product: gachaProduct() })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    expect(container.textContent).toContain("Mystery Case")
  })

  it("links to the practice page for the product, on both the teaser card and the detail view", async () => {
    const { container } = await renderCard({ product: gachaProduct() })

    const teaserLink = container.querySelector('a[href="/merchandise/gacha/3/try"]')
    expect(teaserLink).not.toBeNull()
    expect(teaserLink.textContent).toMatch(/try it for free/i)

    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const detailLinks = [...container.querySelectorAll('a[href="/merchandise/gacha/3/try"]')]
    expect(detailLinks.length).toBe(2)
  })

  it("never shows the practice link for a non-gacha product", async () => {
    const { container } = await renderCard({ product: baseProduct() })
    expect(container.querySelector('a[href*="/try"]')).toBeNull()
  })

  it("adds turns to cart using the flattened variant_id", async () => {
    const { container } = await renderCard({ product: gachaProduct() })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const addButton = [...container.querySelectorAll("button")].find((b) => /add to cart/i.test(b.textContent))
    await act(async () => { addButton.click() })

    const cart = readCart()
    expect(cart[0].variant_id).toBe(77)
    expect(cart[0].is_digital).toBe(false)
  })

  // A gacha turn is never stock-limited at the variant level - the prize pool is.
  it("isProductSoldOut reads gacha_pool_remaining, not the (always null) stock_qty", () => {
    expect(isProductSoldOut(gachaProduct({ gacha_pool_remaining: 0 }))).toBe(true)
    expect(isProductSoldOut(gachaProduct({ gacha_pool_remaining: 3 }))).toBe(false)
    expect(isProductSoldOut(gachaProduct({ gacha_pool_remaining: null }))).toBe(false)
  })

  it("shows the sold-out overlay when the prize pool is empty", async () => {
    const { container } = await renderCard({ product: gachaProduct({ gacha_pool_remaining: 0 }) })
    expect(container.textContent).toContain("Sold out")
  })

  // The hidden turn variant's stock_qty is null (unlimited) - only the pool caps it.
  it("caps the turn stepper at gacha_pool_remaining instead of treating it as unlimited", async () => {
    const { container } = await renderCard({ product: gachaProduct({ gacha_pool_remaining: 3 }) })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const plus = container.querySelector('button[aria-label="Increase quantity"]')
    const input = container.querySelector('input[type="number"]')
    for (let i = 0; i < 5; i++) await act(async () => { plus.click() })

    expect(Number(input.value)).toBe(3)
    expect(plus.disabled).toBe(true)

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      setter.call(input, "50")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(Number(input.value)).toBe(3)
  })

  it("leaves a genuinely unlimited (no prizes configured) gacha stepper unclamped", async () => {
    const { container } = await renderCard({ product: gachaProduct({ gacha_pool_remaining: null }) })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const plus = container.querySelector('button[aria-label="Increase quantity"]')
    for (let i = 0; i < 5; i++) await act(async () => { plus.click() })
    expect(Number(container.querySelector('input[type="number"]').value)).toBe(6)
  })

  it("blocks adding turns when the cart already holds another product, with an inline reason", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([
      { variant_id: 1, qty: 1, product_name: "Card", variant_label: "A1", price: 35000 },
    ]))
    const { container } = await renderCard({ product: gachaProduct() })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const addButton = [...container.querySelectorAll("button")].find((b) => /add to cart/i.test(b.textContent))
    await act(async () => { addButton.click() })

    expect(readCart()).toHaveLength(1)
    expect(container.querySelector('[role="alert"]').textContent).toMatch(/on their own/i)
  })

  it("blocks adding an ordinary product while gacha turns are in the cart", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([
      { variant_id: 77, qty: 1, product_name: "Mystery Case", variant_label: "", price: 20000, is_gacha: true },
    ]))
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    const addButton = [...container.querySelectorAll("button")].find((b) => /add to cart/i.test(b.textContent))
    await act(async () => { addButton.click() })

    expect(readCart()).toHaveLength(1)
    expect(container.querySelector('[role="alert"]').textContent).toMatch(/gacha/i)
  })

  it("disables add-to-cart when the prize pool is empty", async () => {
    const { container } = await renderCard({ product: gachaProduct({ gacha_pool_remaining: 0 }) })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const addButton = [...container.querySelectorAll("button")].find((b) => /add to cart/i.test(b.textContent))
    expect(addButton.disabled).toBe(true)
  })
})

describe("ProductCard - full variant gallery", () => {
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

  it("sinks sold-out variants after in-stock ones in the gallery, without reordering within each group", async () => {
    const product = baseProduct({
      variants: [
        { id: 1, label: "Sold1", stock_qty: 0, image_url: null },
        { id: 2, label: "InStock1", stock_qty: 5, image_url: null },
        { id: 3, label: "Sold2", stock_qty: 0, image_url: null },
        { id: 4, label: "InStock2", stock_qty: 3, image_url: null },
      ],
    })
    const { container } = await renderCard({ product })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const dialog = container.querySelector('[role="dialog"]')
    const labels = [...dialog.querySelectorAll("button")]
      .map((b) => [...b.querySelectorAll("span")].map((s) => s.textContent)[0])
      .filter(Boolean)
    expect(labels).toEqual(["InStock1", "InStock2", "Sold1", "Sold2"])
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
    await openVariantDetail(container, "A1")

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

  it("still opens the picker from a card click when the collection is closed (not orderable) - browsing is allowed, buying isn't", async () => {
    const { container } = await renderCard({ orderable: false })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
  })

  it("disables Add to cart and hides the qty stepper in the detail modal for a closed (not orderable) collection, even for in-stock variants", async () => {
    const { container } = await renderCard({ orderable: false })
    await openVariantDetail(container, "A1")

    const dialog = container.querySelector('[role="dialog"]')
    const addBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Add to cart")
    expect(addBtn.disabled).toBe(true)
    expect(dialog.querySelector('input[type="number"]')).toBeNull()
  })

  it("shows 'this drop has ended', not the (irrelevant) stock count, for a closed collection's in-stock variant", async () => {
    const { container } = await renderCard({ orderable: false })
    await openVariantDetail(container, "A1")

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.textContent).toContain("This drop has ended")
    expect(dialog.textContent).not.toContain("left")
  })

  it("uses a narrow column layout for a small number of variants", async () => {
    // 2 variants from baseProduct().
    const { container } = await renderCard()
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const grid = container.querySelector('[role="dialog"] .grid-cols-2')
    expect(grid).toBeTruthy()
    expect(grid.className).not.toContain("grid-cols-8")
  })

  it("uses a wide column layout for a large photocard-style sheet", async () => {
    const many = baseProduct({
      variants: Array.from({ length: 24 }, (_, i) => ({ id: i + 1, label: `V${i + 1}`, stock_qty: 5, image_url: null })),
    })
    const { container } = await renderCard({ product: many })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const grid = container.querySelector('[role="dialog"] [class*="grid-cols-3"]')
    expect(grid).toBeTruthy()
    expect(grid.className).toContain("lg:grid-cols-8")
  })
})

describe("ProductCard - share", () => {
  const originalShare = navigator.share
  const originalClipboard = navigator.clipboard

  afterEach(() => {
    if (originalShare === undefined) delete navigator.share
    else navigator.share = originalShare
    if (originalClipboard === undefined) delete navigator.clipboard
    else navigator.clipboard = originalClipboard
  })

  it("calls navigator.share with title/text/url when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    navigator.share = share
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    const shareBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Share")
    await act(async () => { shareBtn.click() })

    expect(share).toHaveBeenCalledTimes(1)
    const arg = share.mock.calls[0][0]
    expect(arg.title).toBe("Poster · A1")
    expect(arg.url).toContain("product=1")
    expect(arg.url).toContain("variant=1")
  })

  it("does not throw when the user cancels the native share sheet", async () => {
    navigator.share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"))
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    const shareBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Share")
    await expect(act(async () => { shareBtn.click() })).resolves.not.toThrow()
  })

  it("falls back to clipboard + shows a copied confirmation when navigator.share is unavailable", async () => {
    delete navigator.share
    const writeText = vi.fn().mockResolvedValue(undefined)
    navigator.clipboard = { writeText }
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    const shareBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Share")
    await act(async () => { shareBtn.click() })

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain("product=1")
    expect(container.querySelector('[role="dialog"]').textContent).toContain("Link copied!")
  })

  it("falls back to window.prompt when neither the Clipboard API nor execCommand works", async () => {
    delete navigator.share
    delete navigator.clipboard
    const execCommand = vi.fn().mockReturnValue(false)
    document.execCommand = execCommand
    const prompt = vi.spyOn(window, "prompt").mockImplementation(() => {})
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    const shareBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Share")
    await act(async () => { shareBtn.click() })

    expect(prompt).toHaveBeenCalledTimes(1)
    expect(prompt.mock.calls[0][1]).toContain("product=1")

    prompt.mockRestore()
    execCommand.mockRestore?.()
  })

  it("omits the variant query param for a single-variant product", async () => {
    delete navigator.share
    const writeText = vi.fn().mockResolvedValue(undefined)
    navigator.clipboard = { writeText }
    const single = baseProduct({ variants: [{ id: 9, label: "Std", stock_qty: null, image_url: null }] })
    const { container } = await renderCard({ product: single })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const shareBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Share")
    await act(async () => { shareBtn.click() })

    expect(writeText.mock.calls[0][0]).not.toContain("variant=")
  })
})

describe("unavailableLabel", () => {
  it("shows the custom unavailableLabel instead of the stock line when not orderable", async () => {
    const { container } = await renderCard({
      product: { id: 1, name: "Card", price: 35000, images: [], variants: [{ id: 1, label: "A1", stock_qty: 5 }] },
      orderable: false,
      unavailableLabel: "Chưa mở bán",
    })
    // This product has no cover image (no product.images, no variant image_url),
    // so there's no <img> to click - open its (single-variant) detail via the
    // card's clickable wrapper instead, same trigger the img would otherwise sit inside.
    const card = container.querySelector('[role="button"]')
    await act(async () => { card?.click() })

    expect(container.textContent).toContain("Chưa mở bán")
  })
})
