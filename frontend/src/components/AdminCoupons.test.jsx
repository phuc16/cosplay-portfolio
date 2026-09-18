import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminListCoupons = vi.fn()
const adminCreateCoupon = vi.fn()
const adminUpdateCoupon = vi.fn()

vi.mock("../api/shop", () => ({
  adminListCoupons: (...args) => adminListCoupons(...args),
  adminCreateCoupon: (...args) => adminCreateCoupon(...args),
  adminUpdateCoupon: (...args) => adminUpdateCoupon(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminCoupons } = await import("./AdminCoupons")

async function renderAdminCoupons() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<AdminCoupons />)
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
  adminListCoupons.mockReset()
  adminCreateCoupon.mockReset()
  adminUpdateCoupon.mockReset()
  adminListCoupons.mockResolvedValue([])
})

it("lists existing coupons with their usage", async () => {
  adminListCoupons.mockResolvedValue([
    { id: 1, code: "SAVE10", type: "percent", value: 10, active: true, times_used: 3, max_uses: 10 },
  ])
  const container = await renderAdminCoupons()
  await flush()

  expect(container.textContent).toContain("SAVE10")
  expect(container.textContent).toContain("10%")
  expect(container.textContent).toContain("3 / 10")
})

it("creates a coupon from the form", async () => {
  const container = await renderAdminCoupons()
  await flush()

  const codeInput = container.querySelector('input[type="text"]')
  await act(async () => { setValue(codeInput, "SAVE10") })

  const valueInput = container.querySelectorAll('input[type="number"]')[0]
  await act(async () => { setValue(valueInput, "10") })

  adminCreateCoupon.mockResolvedValue({ id: 1 })
  adminListCoupons.mockResolvedValue([
    { id: 1, code: "SAVE10", type: "percent", value: 10, active: true, times_used: 0, max_uses: null },
  ])
  const createButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Tạo mã")
  await act(async () => { createButton.click() })
  await flush()

  expect(adminCreateCoupon).toHaveBeenCalledWith(
    expect.objectContaining({ code: "SAVE10", type: "percent", value: 10 })
  )
})

it("shows the server's validation message on create failure", async () => {
  const container = await renderAdminCoupons()
  await flush()

  adminCreateCoupon.mockRejectedValue({ response: { data: { message: "Cần nhập mã giảm giá" } } })
  const createButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Tạo mã")
  await act(async () => { createButton.click() })
  await flush()

  expect(container.textContent).toContain("Cần nhập mã giảm giá")
})

it("toggles a coupon's active state", async () => {
  adminListCoupons.mockResolvedValue([
    { id: 1, code: "SAVE10", type: "percent", value: 10, active: true, times_used: 0, max_uses: null },
  ])
  const container = await renderAdminCoupons()
  await flush()

  adminUpdateCoupon.mockResolvedValue({ ok: true })
  const toggleButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Tắt")
  await act(async () => { toggleButton.click() })
  await flush()

  expect(adminUpdateCoupon).toHaveBeenCalledWith(1, { active: false })
})
