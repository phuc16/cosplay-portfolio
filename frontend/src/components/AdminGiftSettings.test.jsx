import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { LanguageProvider } from "../contexts/LanguageContext"

const adminGetGiftSettings = vi.fn()
const adminSaveGiftSettings = vi.fn()
const adminUploadImage = vi.fn()

vi.mock("../api/shop", () => ({
  adminGetGiftSettings: (...args) => adminGetGiftSettings(...args),
  adminSaveGiftSettings: (...args) => adminSaveGiftSettings(...args),
  adminUploadImage: (...args) => adminUploadImage(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminGiftSettings } = await import("./AdminGiftSettings")

function settings(over = {}) {
  return { enabled: false, name: "", image_url: null, min_total: 0, note: null, delivery_link: null, ...over }
}

async function renderGiftSettings() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <LanguageProvider>
        <AdminGiftSettings />
      </LanguageProvider>
    )
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
  adminGetGiftSettings.mockReset()
  adminSaveGiftSettings.mockReset()
  adminUploadImage.mockReset()
  adminGetGiftSettings.mockResolvedValue(settings())
})

describe("AdminGiftSettings", () => {
  it("loads and displays the current gift name when enabled", async () => {
    adminGetGiftSettings.mockResolvedValue(settings({ enabled: true, name: "Postcard", min_total: 200000 }))
    const container = await renderGiftSettings()
    await flush()
    expect(container.querySelector('input[type="text"]').value).toBe("Postcard")
  })

  it("saves the entered config", async () => {
    const container = await renderGiftSettings()
    await flush()

    const enabledCheckbox = container.querySelector('input[type="checkbox"]')
    await act(async () => { enabledCheckbox.click() })

    const nameInput = container.querySelector('input[type="text"]')
    await act(async () => { setValue(nameInput, "Postcard") })

    const minTotalInput = container.querySelector('input[type="number"]')
    await act(async () => { setValue(minTotalInput, "200000") })

    adminSaveGiftSettings.mockResolvedValue({ ok: true })
    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Lưu cấu hình")
    await act(async () => { saveButton.click() })

    expect(adminSaveGiftSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, name: "Postcard", min_total: 200000 })
    )
  })

  it("shows the server's validation message on save failure", async () => {
    const container = await renderGiftSettings()
    await flush()

    const enabledCheckbox = container.querySelector('input[type="checkbox"]')
    await act(async () => { enabledCheckbox.click() })

    adminSaveGiftSettings.mockRejectedValue({ response: { data: { message: "Cần tên quà tặng" } } })
    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Lưu cấu hình")
    await act(async () => { saveButton.click() })
    await flush()

    expect(container.textContent).toContain("Cần tên quà tặng")
  })

  it("uploads a picture and stores its returned URL", async () => {
    adminUploadImage.mockResolvedValue({ url: "/api/storage/gifts/x.png" })
    const container = await renderGiftSettings()
    await flush()

    const enabledCheckbox = container.querySelector('input[type="checkbox"]')
    await act(async () => { enabledCheckbox.click() })

    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(["x"], "gift.png", { type: "image/png" })
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true })
    await act(async () => { fileInput.dispatchEvent(new Event("change", { bubbles: true })) })
    await flush()

    expect(adminUploadImage).toHaveBeenCalledWith(file, "gifts")
    expect(container.querySelector('img[src="/api/storage/gifts/x.png"]')).toBeTruthy()
  })
})
