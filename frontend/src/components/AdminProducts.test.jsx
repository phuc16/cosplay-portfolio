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
// class there — a plain object with the handler-required shape (dataTransfer
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

describe("AdminProducts — reordering via drag and drop", () => {
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
