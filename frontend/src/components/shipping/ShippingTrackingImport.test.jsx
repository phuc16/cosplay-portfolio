import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminPreviewTrackingImport = vi.fn()
const adminConfirmTrackingImport = vi.fn()

vi.mock("../../api/shop", () => ({
  adminPreviewTrackingImport: (...args) => adminPreviewTrackingImport(...args),
  adminConfirmTrackingImport: (...args) => adminConfirmTrackingImport(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: ShippingTrackingImport } = await import("./ShippingTrackingImport")

async function renderComponent() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<ShippingTrackingImport />) })
  return container
}
async function flush() { await act(async () => {}) }
async function click(el) { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })) }) }

function setTextareaValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

async function pasteAndPreview(container, text) {
  const textarea = container.querySelector("textarea")
  await act(async () => setTextareaValue(textarea, text))
  const previewButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xem trước")
  await click(previewButton)
  await flush()
}

beforeEach(() => {
  adminPreviewTrackingImport.mockReset()
  adminConfirmTrackingImport.mockReset()
})

describe("ShippingTrackingImport", () => {
  it("shows a preview of toApply and skipped rows after pasting text and clicking 'Xem trước'", async () => {
    adminPreviewTrackingImport.mockResolvedValue({
      toApply: [{ order_id: 1, order_code: "DH1", tracking_code: "VTP001" }],
      skipped: [{ order_code: "DH999", tracking_code: "VTP002", reason: "not_found", message: "Không tìm thấy đơn DH999" }],
    })
    const container = await renderComponent()

    await pasteAndPreview(container, "DH1\tVTP001\nDH999\tVTP002")

    expect(container.textContent).toContain("DH1")
    expect(container.textContent).toContain("VTP001")
    expect(container.textContent).toContain("Không tìm thấy đơn DH999")
  })

  it("does not write anything until 'Xác nhận' is clicked (no confirm call on preview alone)", async () => {
    adminPreviewTrackingImport.mockResolvedValue({ toApply: [{ order_id: 1, order_code: "DH1", tracking_code: "VTP001" }], skipped: [] })
    const container = await renderComponent()

    await pasteAndPreview(container, "DH1\tVTP001")

    expect(adminConfirmTrackingImport).not.toHaveBeenCalled()
  })

  it("calls confirm with exactly the previewed toApply rows and shows per-order results", async () => {
    const toApply = [{ order_id: 1, order_code: "DH1", tracking_code: "VTP001" }]
    adminPreviewTrackingImport.mockResolvedValue({ toApply, skipped: [] })
    adminConfirmTrackingImport.mockResolvedValue({ results: [{ order_id: 1, ok: true, message: "Đã cập nhật mã vận đơn cho DH1" }] })

    const container = await renderComponent()
    await pasteAndPreview(container, "DH1\tVTP001")

    const confirmButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xác nhận")
    await click(confirmButton)
    await flush()

    expect(adminConfirmTrackingImport).toHaveBeenCalledWith(toApply)
    expect(container.textContent).toContain("Đã cập nhật mã vận đơn cho DH1")
  })

  it("shows an empty-preview state when toApply is empty", async () => {
    adminPreviewTrackingImport.mockResolvedValue({ toApply: [], skipped: [] })
    const container = await renderComponent()

    await pasteAndPreview(container, "garbage")

    expect(container.textContent).toContain("Không có đơn nào để áp dụng")
  })

  it("shows both a success and a failure result individually, not a blanket success message", async () => {
    const toApply = [
      { order_id: 1, order_code: "DH1", tracking_code: "VTP001" },
      { order_id: 2, order_code: "DH2", tracking_code: "VTP002" },
    ]
    adminPreviewTrackingImport.mockResolvedValue({ toApply, skipped: [] })
    adminConfirmTrackingImport.mockResolvedValue({
      results: [
        { order_id: 1, ok: true, message: "Đã cập nhật mã vận đơn cho DH1" },
        { order_id: 2, ok: false, reason: "already_shipped", message: "DH2 đã được giao trước đó" },
      ],
    })

    const container = await renderComponent()
    await pasteAndPreview(container, "DH1\tVTP001\nDH2\tVTP002")

    const confirmButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xác nhận")
    await click(confirmButton)
    await flush()

    expect(container.textContent).toContain("Đã cập nhật mã vận đơn cho DH1")
    expect(container.textContent).toContain("DH2 đã được giao trước đó")
    expect(container.textContent).not.toMatch(/^Thành công$/m)
  })

  it("uploads a file and previews via file_base64, without sending rows_text", async () => {
    adminPreviewTrackingImport.mockResolvedValue({
      toApply: [{ order_id: 1, order_code: "DH1", tracking_code: "VTP001" }],
      skipped: [],
    })
    const container = await renderComponent()

    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(["DH1\tVTP001"], "vtp-result.xlsx", { type: "application/octet-stream" })
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true })
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })))

    const previewButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xem trước")
    await click(previewButton)
    await flush()

    expect(adminPreviewTrackingImport).toHaveBeenCalledTimes(1)
    const payload = adminPreviewTrackingImport.mock.calls[0][0]
    expect(payload).toHaveProperty("file_base64")
    expect(payload).not.toHaveProperty("rows_text")
    expect(container.textContent).toContain("DH1")
  })

  it("clears a chosen file when the user types into the textarea instead", async () => {
    adminPreviewTrackingImport.mockResolvedValue({ toApply: [{ order_id: 1, order_code: "DH1", tracking_code: "VTP001" }], skipped: [] })
    const container = await renderComponent()

    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(["DH1\tVTP001"], "vtp-result.xlsx")
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true })
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })))

    await pasteAndPreview(container, "DH1\tVTP001")

    const payload = adminPreviewTrackingImport.mock.calls[0][0]
    expect(payload).toEqual({ rows_text: "DH1\tVTP001" })
  })

  it("shows an error message instead of crashing when the preview call fails", async () => {
    adminPreviewTrackingImport.mockRejectedValue(new Error("network down"))
    const container = await renderComponent()

    await pasteAndPreview(container, "DH1\tVTP001")

    expect(container.textContent).toContain("Không xem trước được")
  })

  it("shows an error message instead of crashing when the confirm call fails", async () => {
    const toApply = [{ order_id: 1, order_code: "DH1", tracking_code: "VTP001" }]
    adminPreviewTrackingImport.mockResolvedValue({ toApply, skipped: [] })
    adminConfirmTrackingImport.mockRejectedValue(new Error("network down"))

    const container = await renderComponent()
    await pasteAndPreview(container, "DH1\tVTP001")

    const confirmButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xác nhận")
    await click(confirmButton)
    await flush()

    expect(container.textContent).toContain("Không xác nhận được")
  })

  it("renders a readable Vietnamese explanation for every known skipped reason, never blank or snake_case", async () => {
    const reasons = [
      "invalid_code",
      "missing_tracking_code",
      "duplicate_tracking_code",
      "duplicate_order_code",
      "not_found",
      "already_shipped",
      "not_confirmed",
      "not_shippable",
    ]
    adminPreviewTrackingImport.mockResolvedValue({
      toApply: [],
      skipped: reasons.map((reason, i) => ({ order_code: `DH${i}`, tracking_code: `VTP${i}`, reason, message: "" })),
    })
    const container = await renderComponent()

    await pasteAndPreview(container, "garbage")

    const items = [...container.querySelectorAll("li")]
    expect(items).toHaveLength(reasons.length)
    for (const li of items) {
      expect(li.textContent.trim()).not.toBe("")
      expect(li.textContent).not.toMatch(/^[a-z_]+$/)
      expect(li.textContent).not.toMatch(new RegExp(reasons.join("|")))
    }
  })
})
