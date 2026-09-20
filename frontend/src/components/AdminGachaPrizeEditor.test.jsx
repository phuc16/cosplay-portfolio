import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminFetchPrizes = vi.fn()
const adminSavePrizes = vi.fn()
const adminUploadImage = vi.fn()

vi.mock("../api/shop", () => ({
  adminFetchPrizes: (...args) => adminFetchPrizes(...args),
  adminSavePrizes: (...args) => adminSavePrizes(...args),
  adminUploadImage: (...args) => adminUploadImage(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminGachaPrizeEditor } = await import("./AdminGachaPrizeEditor")

async function renderEditor(productId = 1) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<AdminGachaPrizeEditor productId={productId} />)
  })
  await act(async () => {})
  return container
}

async function setValue(el, value) {
  const proto = el instanceof window.HTMLSelectElement
    ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value)
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

const buttonByText = (container, text) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === text)

const nameInputs = (container) =>
  [...container.querySelectorAll('input[placeholder="Tên phần thưởng"]')]

beforeEach(() => {
  adminFetchPrizes.mockReset()
  adminSavePrizes.mockReset()
  adminUploadImage.mockReset()
})

describe("AdminGachaPrizeEditor - loading", () => {
  it("fetches the product's prizes on mount and renders one row each", async () => {
    adminFetchPrizes.mockResolvedValue([
      { id: 1, name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10, quantity_remaining: 8 },
      { id: 2, name: "Keychain", tier: "rare", display_price: 25000, quantity_total: 3, quantity_remaining: 3 },
    ])

    const container = await renderEditor(7)

    expect(adminFetchPrizes).toHaveBeenCalledWith(7)
    expect(nameInputs(container).map((i) => i.value)).toEqual(["Sticker", "Keychain"])
    const tiers = [...container.querySelectorAll("select")].map((s) => s.value)
    expect(tiers).toEqual(["common", "rare"])
  })

  it("shows how many copies of a prize have already been drawn", async () => {
    adminFetchPrizes.mockResolvedValue([
      { id: 1, name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10, quantity_remaining: 8 },
    ])

    const container = await renderEditor()

    expect(container.textContent).toContain("Đã trúng: 2")
  })

  it("surfaces a load failure instead of rendering an empty table silently", async () => {
    adminFetchPrizes.mockRejectedValue(new Error("network down"))

    const container = await renderEditor()

    expect(container.textContent).toContain("Không tải được danh sách phần thưởng")
  })
})

describe("AdminGachaPrizeEditor - editing rows", () => {
  it("adds a row, fills it in, and saves the full list", async () => {
    adminFetchPrizes.mockResolvedValue([])
    adminSavePrizes.mockResolvedValue({ ok: true })

    const container = await renderEditor(7)

    const addBtn = buttonByText(container, "+ Thêm phần thưởng")
    await act(async () => addBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    await setValue(nameInputs(container)[0], "Sticker")
    await setValue(container.querySelector('input[placeholder="Số lượng"]'), "10")
    await setValue(container.querySelector('input[placeholder="Giá trị hiển thị (VND)"]'), "5000")
    await setValue(container.querySelector("select"), "rare")

    const saveBtn = buttonByText(container, "Lưu phần thưởng")
    await act(async () => saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(adminSavePrizes).toHaveBeenCalledWith(7, [
      { id: undefined, name: "Sticker", tier: "rare", display_price: 5000, quantity_total: 10, image_url: "", description: "" },
    ])
  })

  it("removes a row and saves the remaining ones", async () => {
    adminFetchPrizes.mockResolvedValue([
      { id: 1, name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10, quantity_remaining: 10 },
      { id: 2, name: "Keychain", tier: "rare", display_price: 25000, quantity_total: 3, quantity_remaining: 3 },
    ])
    adminSavePrizes.mockResolvedValue({ ok: true })

    const container = await renderEditor(7)

    const removeBtn = container.querySelector('button[aria-label="Xóa phần thưởng: Sticker"]')
    await act(async () => removeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(nameInputs(container).map((i) => i.value)).toEqual(["Keychain"])

    const saveBtn = buttonByText(container, "Lưu phần thưởng")
    await act(async () => saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(adminSavePrizes).toHaveBeenCalledWith(7, [
      { id: 2, name: "Keychain", tier: "rare", display_price: 25000, quantity_total: 3, image_url: "", description: "" },
    ])
  })

  it("round-trips image_url and description so a save never wipes them", async () => {
    adminFetchPrizes.mockResolvedValue([
      {
        id: 1,
        name: "Sticker",
        tier: "common",
        display_price: 5000,
        quantity_total: 10,
        quantity_remaining: 10,
        image_url: "https://x/sticker.jpg",
        description: "Sticker bóng",
      },
    ])
    adminSavePrizes.mockResolvedValue({ ok: true })

    const container = await renderEditor(7)

    await setValue(nameInputs(container)[0], "Sticker mới")

    const saveBtn = buttonByText(container, "Lưu phần thưởng")
    await act(async () => saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(adminSavePrizes).toHaveBeenCalledWith(7, [
      {
        id: 1,
        name: "Sticker mới",
        tier: "common",
        display_price: 5000,
        quantity_total: 10,
        image_url: "https://x/sticker.jpg",
        description: "Sticker bóng",
      },
    ])
  })

  it("moves a row up and saves the new order", async () => {
    adminFetchPrizes.mockResolvedValue([
      { id: 1, name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10, quantity_remaining: 10 },
      { id: 2, name: "Keychain", tier: "rare", display_price: 25000, quantity_total: 3, quantity_remaining: 3 },
    ])
    adminSavePrizes.mockResolvedValue({ ok: true })

    const container = await renderEditor(7)

    const upBtn = container.querySelector('button[aria-label="Đưa lên trên: Keychain"]')
    await act(async () => upBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(nameInputs(container).map((i) => i.value)).toEqual(["Keychain", "Sticker"])

    const saveBtn = buttonByText(container, "Lưu phần thưởng")
    await act(async () => saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(adminSavePrizes.mock.calls[0][1].map((p) => p.name)).toEqual(["Keychain", "Sticker"])
  })
})

describe("AdminGachaPrizeEditor - prize photo", () => {
  it("uploads a picked image, sets that row's image_url, and includes it in the save payload", async () => {
    adminFetchPrizes.mockResolvedValue([
      { id: 1, name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10, quantity_remaining: 10 },
    ])
    adminUploadImage.mockResolvedValue({ url: "https://x/prize.jpg" })
    adminSavePrizes.mockResolvedValue({ ok: true })

    const container = await renderEditor(7)

    const fileInput = container.querySelector('input[aria-label="Ảnh phần thưởng: Sticker"]')
    const file = new File(["x"], "prize.jpg", { type: "image/jpeg" })
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true })
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })))
    await act(async () => {})

    expect(adminUploadImage).toHaveBeenCalledWith(expect.any(File), "products/7/gacha")
    expect(container.querySelector("img").getAttribute("src")).toBe("https://x/prize.jpg")

    const saveBtn = buttonByText(container, "Lưu phần thưởng")
    await act(async () => saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(adminSavePrizes).toHaveBeenCalledWith(7, [
      expect.objectContaining({ id: 1, image_url: "https://x/prize.jpg" }),
    ])
  })
})

describe("AdminGachaPrizeEditor - post-save resync", () => {
  it("re-fetches after a save so a newly added row picks up its server-assigned id", async () => {
    adminFetchPrizes.mockResolvedValueOnce([])
    adminSavePrizes.mockResolvedValue({ ok: true })
    adminFetchPrizes.mockResolvedValueOnce([
      { id: 42, name: "Sticker", tier: "common", display_price: 0, quantity_total: 0, quantity_remaining: 0 },
    ])

    const container = await renderEditor(7)

    await setValue(nameInputs(container)[0], "Sticker")

    const saveBtn = buttonByText(container, "Lưu phần thưởng")
    await act(async () => saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await act(async () => {})

    expect(adminSavePrizes.mock.calls[0][1][0].id).toBeUndefined()
    expect(adminFetchPrizes).toHaveBeenCalledTimes(2)

    await act(async () => saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await act(async () => {})

    expect(adminSavePrizes.mock.calls[1][1]).toEqual([
      expect.objectContaining({ id: 42, name: "Sticker" }),
    ])
  })

  it("drops blank-named rows from the payload", async () => {
    adminFetchPrizes.mockResolvedValue([])
    adminSavePrizes.mockResolvedValue({ ok: true })

    const container = await renderEditor(7)

    const addBtn = buttonByText(container, "+ Thêm phần thưởng")
    await act(async () => addBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await act(async () => addBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    await setValue(nameInputs(container)[0], "  Sticker  ")

    const saveBtn = buttonByText(container, "Lưu phần thưởng")
    await act(async () => saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(adminSavePrizes).toHaveBeenCalledWith(7, [
      expect.objectContaining({ name: "Sticker" }),
    ])
  })
})

describe("AdminGachaPrizeEditor - save errors", () => {
  it("shows the backend's specific message when a quantity drops below what was already drawn", async () => {
    adminFetchPrizes.mockResolvedValue([
      { id: 1, name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10, quantity_remaining: 8 },
    ])
    adminSavePrizes.mockRejectedValue({
      response: { status: 409, data: { error: "gacha_prize_quantity", message: 'Phần thưởng "Sticker" đã có lượt trúng' } },
    })

    const container = await renderEditor()

    const saveBtn = buttonByText(container, "Lưu phần thưởng")
    await act(async () => saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await act(async () => {})

    expect(container.textContent).toContain('Phần thưởng "Sticker" đã có lượt trúng')
  })

  it("falls back to a generic message when the server sends none", async () => {
    adminFetchPrizes.mockResolvedValue([
      { id: 1, name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10, quantity_remaining: 10 },
    ])
    adminSavePrizes.mockRejectedValue(new Error("boom"))

    const container = await renderEditor()

    const saveBtn = buttonByText(container, "Lưu phần thưởng")
    await act(async () => saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await act(async () => {})

    expect(container.textContent).toContain("Lưu phần thưởng thất bại")
  })

  it("clears a previous error once a save succeeds", async () => {
    adminFetchPrizes.mockResolvedValue([
      { id: 1, name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10, quantity_remaining: 10 },
    ])
    adminSavePrizes
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true })

    const container = await renderEditor()

    const saveBtn = buttonByText(container, "Lưu phần thưởng")
    await act(async () => saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await act(async () => {})
    expect(container.textContent).toContain("Lưu phần thưởng thất bại")

    await act(async () => saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await act(async () => {})
    expect(container.textContent).not.toContain("Lưu phần thưởng thất bại")
  })
})
