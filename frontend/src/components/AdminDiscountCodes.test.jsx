import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminListDiscountCodes = vi.fn()
const adminCreateDiscountCode = vi.fn()
const adminUpdateDiscountCode = vi.fn()
const adminDeleteDiscountCode = vi.fn()

vi.mock("../api/shop", () => ({
  adminListDiscountCodes: (...args) => adminListDiscountCodes(...args),
  adminCreateDiscountCode: (...args) => adminCreateDiscountCode(...args),
  adminUpdateDiscountCode: (...args) => adminUpdateDiscountCode(...args),
  adminDeleteDiscountCode: (...args) => adminDeleteDiscountCode(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminDiscountCodes } = await import("./AdminDiscountCodes")

function code(over = {}) {
  return {
    id: 1, code: "LAUNCH10", type: "percent", value: 10, enabled: true,
    max_uses: null, used_count: 0, min_total: 0, expires_at: null,
    ...over,
  }
}

async function render() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<AdminDiscountCodes />)
  })
  return container
}

async function flush() { await act(async () => {}) }

function setValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
  setter.call(input, value)
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

beforeEach(() => {
  adminListDiscountCodes.mockReset()
  adminCreateDiscountCode.mockReset()
  adminUpdateDiscountCode.mockReset()
  adminDeleteDiscountCode.mockReset()
  adminListDiscountCodes.mockResolvedValue([])
  vi.stubGlobal("confirm", vi.fn(() => true))
})

describe("AdminDiscountCodes - list", () => {
  it("lists existing codes with type/value and usage", async () => {
    adminListDiscountCodes.mockResolvedValue([code({ code: "LAUNCH10", type: "percent", value: 10, used_count: 3, max_uses: 10 })])
    const container = await render()
    await flush()

    expect(container.textContent).toContain("LAUNCH10")
    expect(container.textContent).toContain("10%")
    expect(container.textContent).toContain("3/10")
  })

  it("shows a disabled badge for a disabled code", async () => {
    adminListDiscountCodes.mockResolvedValue([code({ enabled: false })])
    const container = await render()
    await flush()

    expect(container.textContent).toContain("Đã tắt")
  })
})

describe("AdminDiscountCodes - create", () => {
  it("submits a new percent code", async () => {
    const container = await render()
    await flush()

    const codeInput = container.querySelector('input[placeholder="Mã (VD: LAUNCH10)"]')
    await act(async () => setValue(codeInput, "SAVE10"))

    const valueInput = container.querySelector('input[type="number"]')
    await act(async () => setValue(valueInput, "10"))

    adminCreateDiscountCode.mockResolvedValue(code({ code: "SAVE10", value: 10 }))
    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Tạo")
    await act(async () => { saveButton.click() })

    expect(adminCreateDiscountCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SAVE10", type: "percent", value: 10 })
    )
  })

  it("shows the server's validation/duplicate message on failure", async () => {
    const container = await render()
    await flush()

    const codeInput = container.querySelector('input[placeholder="Mã (VD: LAUNCH10)"]')
    await act(async () => setValue(codeInput, "SAVE10"))

    adminCreateDiscountCode.mockRejectedValue({ response: { data: { message: "Mã giảm giá này đã tồn tại" } } })
    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Tạo")
    await act(async () => { saveButton.click() })
    await flush()

    expect(container.textContent).toContain("Mã giảm giá này đã tồn tại")
  })
})

describe("AdminDiscountCodes - edit", () => {
  it("populates the form and submits an update when 'Sửa' is clicked", async () => {
    adminListDiscountCodes.mockResolvedValue([code({ id: 5, code: "OLD", type: "fixed", value: 5000 })])
    const container = await render()
    await flush()

    const form = container.querySelector("p.font-medium.mb-3")?.closest("div")
    form.scrollIntoView = vi.fn()

    const editButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sửa")
    await act(async () => { editButton.click() })

    const codeInput = container.querySelector('input[placeholder="Mã (VD: LAUNCH10)"]')
    expect(codeInput.value).toBe("OLD")

    adminUpdateDiscountCode.mockResolvedValue(code({ id: 5, code: "OLD", type: "fixed", value: 5000 }))
    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Cập nhật")
    await act(async () => { saveButton.click() })

    expect(adminUpdateDiscountCode).toHaveBeenCalledWith(5, expect.objectContaining({ code: "OLD" }))
  })

  it("toggles enabled via the Tắt/Bật button without opening the edit form", async () => {
    adminListDiscountCodes.mockResolvedValue([code({ id: 5, enabled: true })])
    adminUpdateDiscountCode.mockResolvedValue(code({ id: 5, enabled: false }))
    const container = await render()
    await flush()

    const toggleButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Tắt")
    await act(async () => { toggleButton.click() })
    await flush()

    expect(adminUpdateDiscountCode).toHaveBeenCalledWith(5, expect.objectContaining({ enabled: false }))
  })
})

describe("AdminDiscountCodes - delete", () => {
  it("confirms then deletes a code", async () => {
    adminListDiscountCodes.mockResolvedValue([code({ id: 7 })])
    adminDeleteDiscountCode.mockResolvedValue({ ok: true })
    const container = await render()
    await flush()

    const deleteButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xóa")
    await act(async () => { deleteButton.click() })
    await flush()

    expect(globalThis.confirm).toHaveBeenCalled()
    expect(adminDeleteDiscountCode).toHaveBeenCalledWith(7)
  })
})
