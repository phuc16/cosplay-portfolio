import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { LanguageProvider } from "../../contexts/LanguageContext"

const fetchAddressAutocomplete = vi.fn()

vi.mock("../../api/shop", () => ({
  fetchAddressAutocomplete: (...args) => fetchAddressAutocomplete(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AddressFields } = await import("./AddressFields")

async function renderField(value = { address_raw: "" }, onChange = vi.fn()) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <LanguageProvider>
        <AddressFields value={value} onChange={onChange} />
      </LanguageProvider>
    )
  })
  return { container, onChange }
}

function setTextareaValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

async function typeAndFlush(container, text) {
  const textarea = container.querySelector("textarea")
  await act(async () => setTextareaValue(textarea, text))
  // Debounce is 350ms; flush well past it, then let the resolved promise's
  // state update land.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400))
  })
}

beforeEach(() => {
  fetchAddressAutocomplete.mockReset()
})

describe("AddressFields", () => {
  it("does not call the backend for fewer than 4 characters", async () => {
    const { container } = await renderField()
    await typeAndFlush(container, "123")
    expect(fetchAddressAutocomplete).not.toHaveBeenCalled()
  })

  it("calls the backend proxy (not Goong directly) once 4+ characters are typed, after the debounce", async () => {
    fetchAddressAutocomplete.mockResolvedValue({ predictions: [] })
    const { container } = await renderField()
    await typeAndFlush(container, "512 Nguyen Xien")
    expect(fetchAddressAutocomplete).toHaveBeenCalledWith("512 Nguyen Xien")
  })

  it("renders suggestions returned from the backend", async () => {
    fetchAddressAutocomplete.mockResolvedValue({
      predictions: [{ place_id: "1", description: "512 Nguyễn Xiển, Quận 9, Hồ Chí Minh" }],
    })
    const { container } = await renderField()
    await typeAndFlush(container, "512 Nguyen Xien")

    expect(container.textContent).toContain("512 Nguyễn Xiển, Quận 9, Hồ Chí Minh")
  })

  it("picking a suggestion fills structured fields from Goong's compound object, not a comma-split guess", async () => {
    fetchAddressAutocomplete.mockResolvedValue({
      predictions: [{
        place_id: "1",
        description: "512 Nguyễn Xiển, Quận 9, Hồ Chí Minh",
        structured_formatting: { main_text: "512 Nguyễn Xiển" },
        compound: { commune: "Long Thạnh Mỹ", district: "Thủ Đức", province: "Hồ Chí Minh" },
      }],
    })
    const { container, onChange } = await renderField()
    await typeAndFlush(container, "512 Nguyen Xien")

    const suggestionBtn = [...container.querySelectorAll("button")][0]
    await act(async () => suggestionBtn.click())

    expect(onChange).toHaveBeenCalledWith({
      address_raw: "512 Nguyễn Xiển, Quận 9, Hồ Chí Minh",
      address_street: "512 Nguyễn Xiển",
      address_ward: "Long Thạnh Mỹ",
      address_district: "Thủ Đức",
      address_province: "Hồ Chí Minh",
    })
  })

  it("degrades silently to just the textarea when the backend call fails", async () => {
    fetchAddressAutocomplete.mockRejectedValue(new Error("network error"))
    const { container } = await renderField()
    await typeAndFlush(container, "512 Nguyen Xien")

    expect(container.querySelectorAll("li").length).toBe(0)
    expect(container.querySelector("textarea")).toBeTruthy()
  })
})
