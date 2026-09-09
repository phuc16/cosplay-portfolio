import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminGetCollection = vi.fn()
const adminCreateProduct = vi.fn()
const adminUpdateProduct = vi.fn()
const adminDeleteProduct = vi.fn()
const adminUploadImage = vi.fn()
const adminReorderProducts = vi.fn()
const adminSaveVariants = vi.fn()

vi.mock("../api/shop", () => ({
  adminGetCollection: (...args) => adminGetCollection(...args),
  adminCreateProduct: (...args) => adminCreateProduct(...args),
  adminUpdateProduct: (...args) => adminUpdateProduct(...args),
  adminDeleteProduct: (...args) => adminDeleteProduct(...args),
  adminUploadImage: (...args) => adminUploadImage(...args),
  adminReorderProducts: (...args) => adminReorderProducts(...args),
  adminSaveVariants: (...args) => adminSaveVariants(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminProducts } = await import("./AdminProducts")

function product(over = {}) {
  return { id: 1, name: "Card", price: 35000, description: null, images: [], variants: [], ...over }
}

async function renderProducts(collection = { id: 1 }) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<AdminProducts collection={collection} />) })
  return container
}

async function flush() { await act(async () => {}) }

// jsdom doesn't implement HTML5 drag-and-drop, so DragEvent isn't a real
// class there - a plain object with the handler-required shape (dataTransfer
// with the methods the component calls, preventDefault/stopPropagation) is
// dispatched directly at the handler instead of through a real drag gesture.
function fireDrag(el, type, dataTransfer) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  event.dataTransfer = dataTransfer
  el.dispatchEvent(event)
}

function makeDataTransfer() {
  const store = {}
  return {
    effectAllowed: null,
    dropEffect: null,
    setData: (k, v) => { store[k] = v },
    getData: (k) => store[k],
  }
}

beforeEach(() => {
  adminGetCollection.mockReset()
  adminCreateProduct.mockReset()
  adminUpdateProduct.mockReset()
  adminDeleteProduct.mockReset()
  adminUploadImage.mockReset()
  adminReorderProducts.mockReset()
  adminSaveVariants.mockReset()
})

describe("AdminProducts - reordering via drag and drop", () => {
  it("shows a drag hint only when there is more than one product", async () => {
    adminGetCollection.mockResolvedValue({ products: [product()] })
    const container = await renderProducts()
    await flush()
    expect(container.textContent).not.toContain("Kéo thả sản phẩm")
  })

  it("reorders products locally and persists via adminReorderProducts on drop", async () => {
    adminGetCollection.mockResolvedValue({
      products: [product({ id: 1, name: "A" }), product({ id: 2, name: "B" }), product({ id: 3, name: "C" })],
    })
    adminReorderProducts.mockResolvedValue({ ok: true })
    const container = await renderProducts({ id: 7 })
    await flush()

    const rows = [...container.querySelectorAll("[data-product-row]")]
    expect(rows.map((r) => r.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("A")])
    )

    const dt = makeDataTransfer()
    const handleA = rows[0].querySelector('[draggable="true"]')
    await act(async () => { fireDrag(handleA, "dragstart", dt) })
    await act(async () => { fireDrag(rows[2], "dragover", dt) })
    await act(async () => { fireDrag(rows[2], "drop", dt) })

    expect(adminReorderProducts).toHaveBeenCalledWith(7, [2, 3, 1])
  })

  it("reloads from the server if the reorder request fails", async () => {
    adminGetCollection
      .mockResolvedValueOnce({
        products: [product({ id: 1, name: "A" }), product({ id: 2, name: "B" })],
      })
      .mockResolvedValueOnce({
        products: [product({ id: 1, name: "A" }), product({ id: 2, name: "B" })],
      })
    adminReorderProducts.mockRejectedValue(new Error("network down"))
    const container = await renderProducts()
    await flush()

    const rows = [...container.querySelectorAll("[data-product-row]")]
    const dt = makeDataTransfer()
    const handleA = rows[0].querySelector('[draggable="true"]')
    await act(async () => { fireDrag(handleA, "dragstart", dt) })
    await act(async () => { fireDrag(rows[1], "dragover", dt) })
    await act(async () => { fireDrag(rows[1], "drop", dt) })
    await flush()

    expect(adminGetCollection).toHaveBeenCalledTimes(2)
  })

  it("does not call adminReorderProducts when dropping a product onto itself", async () => {
    adminGetCollection.mockResolvedValue({
      products: [product({ id: 1, name: "A" }), product({ id: 2, name: "B" })],
    })
    const container = await renderProducts()
    await flush()

    const rows = [...container.querySelectorAll("[data-product-row]")]
    const dt = makeDataTransfer()
    const handleA = rows[0].querySelector('[draggable="true"]')
    await act(async () => { fireDrag(handleA, "dragstart", dt) })
    await act(async () => { fireDrag(rows[0], "drop", dt) })

    expect(adminReorderProducts).not.toHaveBeenCalled()
  })
})

describe("AdminProducts - digital products", () => {
  it("creates a digital product with stock_qty and delivery_link, no variant button", async () => {
    adminGetCollection.mockResolvedValue({ products: [] })
    adminCreateProduct.mockResolvedValue({ id: 1 })

    const container = await renderProducts()
    await flush()

    const typeSelect = container.querySelector('select[name="product-type"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
      setter.call(typeSelect, "digital")
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(container.querySelector('input[placeholder="Số lượng"]')).toBeTruthy()
    expect(container.querySelector('input[placeholder="Link tải về"]')).toBeTruthy()

    const nameInput = container.querySelector('input[placeholder="Tên sản phẩm"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      setter.call(nameInput, "Digital Album")
      nameInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Thêm")
    await act(async () => { saveButton.click() })

    expect(adminCreateProduct).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ name: "Digital Album", type: "digital" })
    )
  })

  it("hides the variant/Phân loại button for a digital product", async () => {
    adminGetCollection.mockResolvedValue({
      products: [{ id: 1, name: "Digital Album", price: 99000, type: "digital", images: [], stock_qty: 10, delivery_link: "https://x" }],
    })

    const container = await renderProducts()
    await flush()

    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Phân loại")).toBe(false)
  })

  it("still shows the variant/Phân loại button for a physical product", async () => {
    adminGetCollection.mockResolvedValue({
      products: [{ id: 1, name: "Card", price: 35000, type: "physical", images: [], variants: [] }],
    })

    const container = await renderProducts()
    await flush()

    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Phân loại")).toBe(true)
  })

  it("filters a digital product as sold out by its flattened stock_qty, not its (empty) variants", async () => {
    adminGetCollection.mockResolvedValue({
      products: [
        product({ id: 1, name: "Digital In Stock", type: "digital", stock_qty: 5, variants: [] }),
        product({ id: 2, name: "Digital Sold Out", type: "digital", stock_qty: 0, variants: [] }),
      ],
    })
    const container = await renderProducts()
    await flush()

    const stockSelect = [...container.querySelectorAll("select")][0]
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
      setter.call(stockSelect, "sold_out")
      stockSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(container.textContent).toContain("Digital Sold Out")
    expect(container.textContent).not.toContain("Digital In Stock")
  })
})

describe("AdminProducts - search, filter, sort", () => {
  it("filters the list by name, case-insensitively", async () => {
    adminGetCollection.mockResolvedValue({
      products: [product({ id: 1, name: "Photocard" }), product({ id: 2, name: "Poster" })],
    })
    const container = await renderProducts()
    await flush()

    const searchInput = container.querySelector('input[placeholder="Tìm theo tên..."]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      setter.call(searchInput, "poster")
      searchInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(container.textContent).toContain("Poster")
    expect(container.textContent).not.toContain("Photocard")
  })

  it("filters by stock status", async () => {
    adminGetCollection.mockResolvedValue({
      products: [
        product({ id: 1, name: "In Stock", variants: [{ id: 1, label: "A1", stock_qty: 5 }] }),
        product({ id: 2, name: "Sold Out", variants: [{ id: 2, label: "A1", stock_qty: 0 }] }),
      ],
    })
    const container = await renderProducts()
    await flush()

    const stockSelect = [...container.querySelectorAll("select")][0]
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
      setter.call(stockSelect, "sold_out")
      stockSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(container.textContent).toContain("Sold Out")
    expect(container.textContent).not.toContain("In Stock")
  })

  it("sorts by price low-high, and disables drag reordering while sorted", async () => {
    adminGetCollection.mockResolvedValue({
      products: [product({ id: 1, name: "Expensive", price: 90000 }), product({ id: 2, name: "Cheap", price: 10000 })],
    })
    const container = await renderProducts()
    await flush()

    const sortSelect = [...container.querySelectorAll("select")][1]
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
      setter.call(sortSelect, "price_asc")
      sortSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const names = [...container.querySelectorAll("[data-product-row] p.font-medium")].map((p) => p.textContent)
    expect(names).toEqual(["Cheap", "Expensive"])
    expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(0)
  })

  it("shows a no-match message when the search matches nothing", async () => {
    adminGetCollection.mockResolvedValue({
      products: [product({ id: 1, name: "Photocard" }), product({ id: 2, name: "Poster" })],
    })
    const container = await renderProducts()
    await flush()

    const searchInput = container.querySelector('input[placeholder="Tìm theo tên..."]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      setter.call(searchInput, "nobody")
      searchInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(container.textContent).toContain("Không tìm thấy sản phẩm nào khớp")
  })
})
