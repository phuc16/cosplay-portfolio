import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminSaveVariants = vi.fn()
const adminUploadImage = vi.fn()

vi.mock("../api/shop", () => ({
  adminSaveVariants: (...args) => adminSaveVariants(...args),
  adminUploadImage: (...args) => adminUploadImage(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminVariants } = await import("./AdminVariants")

function baseProduct(over = {}) {
  return { id: 1, name: "Poster", variants: [{ id: 10, label: "A1", stock_qty: 12, image_url: null }], ...over }
}

async function renderVariants(product = baseProduct(), onSaved = vi.fn()) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<AdminVariants product={product} onSaved={onSaved} />)
  })
  return container
}

beforeEach(() => {
  adminSaveVariants.mockReset()
  adminUploadImage.mockReset()
})

describe("AdminVariants — per-row image upload", () => {
  it("renders a file input for each row", async () => {
    const container = await renderVariants()
    const fileInputs = container.querySelectorAll('input[type="file"]')
    expect(fileInputs.length).toBe(1)
  })

  it("uploads the picked file to the product's variants folder and shows a thumbnail", async () => {
    adminUploadImage.mockResolvedValue({ url: "https://x/a1.jpg" })
    const container = await renderVariants(baseProduct())

    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(["x"], "a1.jpg", { type: "image/jpeg" })
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true })
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })))
    await act(async () => {})

    expect(adminUploadImage).toHaveBeenCalledWith(expect.any(String), "products/1/variants")
    const img = container.querySelector('img[src="https://x/a1.jpg"]')
    expect(img).toBeTruthy()
  })

  it("includes the row's image_url when saving", async () => {
    adminSaveVariants.mockResolvedValue({})
    const onSaved = vi.fn()
    const container = await renderVariants(
      baseProduct({ variants: [{ id: 10, label: "A1", stock_qty: 12, image_url: "https://x/a1.jpg" }] }),
      onSaved
    )

    const saveBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Lưu phân loại")
    await act(async () => saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(adminSaveVariants).toHaveBeenCalledWith(1, [
      { id: 10, label: "A1", image_url: "https://x/a1.jpg", stock_qty: 12 },
    ])
    expect(onSaved).toHaveBeenCalled()
  })
})
