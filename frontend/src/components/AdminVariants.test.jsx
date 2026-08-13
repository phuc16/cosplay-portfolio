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
  it("renders a file input for each row, plus the batch-upload input", async () => {
    const container = await renderVariants()
    const fileInputs = container.querySelectorAll('input[type="file"]')
    expect(fileInputs.length).toBe(2)
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

describe("AdminVariants — batch image upload", () => {
  it("uploads multiple files and creates one row per file, labeled from the filename", async () => {
    adminUploadImage
      .mockResolvedValueOnce({ url: "https://x/a1.jpg" })
      .mockResolvedValueOnce({ url: "https://x/a2.jpg" })
    const container = await renderVariants(baseProduct({ variants: [] }))

    const batchInput = container.querySelector('input[aria-label="Tải ảnh hàng loạt"]')
    const files = [
      new File(["x"], "A1.png", { type: "image/png" }),
      new File(["x"], "A2.png", { type: "image/png" }),
    ]
    Object.defineProperty(batchInput, "files", { value: files, configurable: true })
    await act(async () => {
      batchInput.dispatchEvent(new Event("change", { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(adminUploadImage).toHaveBeenCalledTimes(2)
    expect(adminUploadImage).toHaveBeenCalledWith(expect.any(String), "products/1/variants")

    const labelInputs = [...container.querySelectorAll('input[placeholder="Mã (A1) hoặc size (M)"]')]
    expect(labelInputs.map((i) => i.value)).toEqual(["A1", "A2"])
    expect(container.querySelector('img[src="https://x/a1.jpg"]')).toBeTruthy()
    expect(container.querySelector('img[src="https://x/a2.jpg"]')).toBeTruthy()
  })

  it("appends batch-uploaded rows after existing labeled rows, and reports a per-file error without dropping successful uploads", async () => {
    adminUploadImage
      .mockResolvedValueOnce({ url: "https://x/b1.jpg" })
      .mockRejectedValueOnce({ message: "Tải ảnh thất bại" })
    const container = await renderVariants(baseProduct())

    const batchInput = container.querySelector('input[aria-label="Tải ảnh hàng loạt"]')
    const files = [
      new File(["x"], "B1.png", { type: "image/png" }),
      new File(["x"], "B2.png", { type: "image/png" }),
    ]
    Object.defineProperty(batchInput, "files", { value: files, configurable: true })
    await act(async () => {
      batchInput.dispatchEvent(new Event("change", { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const labelInputs = [...container.querySelectorAll('input[placeholder="Mã (A1) hoặc size (M)"]')]
    expect(labelInputs.map((i) => i.value)).toEqual(["A1", "B1"])
    expect(container.textContent).toContain("Tải ảnh thất bại")
  })
})

describe("AdminVariants — reordering rows", () => {
  it("swaps a row with the previous one when its up arrow is clicked", async () => {
    const container = await renderVariants(
      baseProduct({
        variants: [
          { id: 10, label: "A1", stock_qty: 1, image_url: null },
          { id: 11, label: "A2", stock_qty: 1, image_url: null },
        ],
      })
    )

    const upButtons = [...container.querySelectorAll('button[aria-label^="Đưa lên trên"]')]
    await act(async () => upButtons[1].dispatchEvent(new MouseEvent("click", { bubbles: true })))

    const labelInputs = [...container.querySelectorAll('input[placeholder="Mã (A1) hoặc size (M)"]')]
    expect(labelInputs.map((i) => i.value)).toEqual(["A2", "A1"])
  })

  it("sends rows to adminSaveVariants in their current (reordered) order", async () => {
    adminSaveVariants.mockResolvedValue({})
    const container = await renderVariants(
      baseProduct({
        variants: [
          { id: 10, label: "A1", stock_qty: 1, image_url: null },
          { id: 11, label: "A2", stock_qty: 1, image_url: null },
        ],
      })
    )

    const downButtons = [...container.querySelectorAll('button[aria-label^="Đưa xuống dưới"]')]
    await act(async () => downButtons[0].dispatchEvent(new MouseEvent("click", { bubbles: true })))

    const saveBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Lưu phân loại")
    await act(async () => saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(adminSaveVariants).toHaveBeenCalledWith(1, [
      { id: 11, label: "A2", image_url: null, stock_qty: 1 },
      { id: 10, label: "A1", image_url: null, stock_qty: 1 },
    ])
  })

  it("disables the up arrow on the first row and the down arrow on the last row", async () => {
    const container = await renderVariants(
      baseProduct({
        variants: [
          { id: 10, label: "A1", stock_qty: 1, image_url: null },
          { id: 11, label: "A2", stock_qty: 1, image_url: null },
        ],
      })
    )

    const upButtons = [...container.querySelectorAll('button[aria-label^="Đưa lên trên"]')]
    const downButtons = [...container.querySelectorAll('button[aria-label^="Đưa xuống dưới"]')]
    expect(upButtons[0].disabled).toBe(true)
    expect(downButtons[downButtons.length - 1].disabled).toBe(true)
  })
})
