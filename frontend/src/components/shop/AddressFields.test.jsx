import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { LanguageProvider } from "../../contexts/LanguageContext"

const fetchProvinces = vi.fn()
const fetchWards = vi.fn()
const searchAddress = vi.fn()

vi.mock("../../api/shop", () => ({
  fetchProvinces: (...args) => fetchProvinces(...args),
  fetchWards: (...args) => fetchWards(...args),
  searchAddress: (...args) => searchAddress(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AddressFields } = await import("./AddressFields")

const PROVINCES = [{ code: "30", name: "Hồ Chí Minh" }, { code: "01", name: "Hà Nội" }]
const HCM_WARDS = [{ code: "00002", name: "Dĩ An" }, { code: "00003", name: "Hiệp Bình" }]

async function renderField(value = {}, onChange = vi.fn()) {
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

function setInputValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

const provinceTrigger = (c) => c.querySelector('button[aria-label="Province/City"]')
const wardTrigger = (c) => c.querySelector('button[aria-label="Ward/Commune"]')

// Opens a SearchableSelect trigger and clicks the option with this exact text.
async function pickOption(container, trigger, optionText) {
  await act(async () => trigger.click())
  const optionBtn = [...container.querySelectorAll("li button")].find((b) => b.textContent === optionText)
  await act(async () => optionBtn.click())
}

beforeEach(() => {
  fetchProvinces.mockReset()
  fetchWards.mockReset()
  searchAddress.mockReset()
  fetchProvinces.mockResolvedValue(PROVINCES)
  fetchWards.mockResolvedValue(HCM_WARDS)
  searchAddress.mockResolvedValue({ predictions: [] })
})

describe("AddressFields — province/ward picker (no live per-keystroke autocomplete)", () => {
  it("loads the province list on mount, through our own backend proxy", async () => {
    const { container } = await renderField()

    expect(fetchProvinces).toHaveBeenCalled()
    await act(async () => provinceTrigger(container).click())
    const optionTexts = [...container.querySelectorAll("li button")].map((b) => b.textContent)
    expect(optionTexts).toEqual(expect.arrayContaining(["Hồ Chí Minh", "Hà Nội"]))
  })

  it("the ward trigger starts disabled, and only fetches that province's wards once one is picked", async () => {
    const { container } = await renderField()
    expect(wardTrigger(container).disabled).toBe(true)
    expect(fetchWards).not.toHaveBeenCalled()

    await pickOption(container, provinceTrigger(container), "Hồ Chí Minh")

    expect(fetchWards).toHaveBeenCalledWith("30")
    expect(wardTrigger(container).disabled).toBe(false)

    await act(async () => wardTrigger(container).click())
    const optionTexts = [...container.querySelectorAll("li button")].map((b) => b.textContent)
    expect(optionTexts).toEqual(expect.arrayContaining(["Dĩ An", "Hiệp Bình"]))
  })

  it("typing in the dropdown's search box filters the option list", async () => {
    const { container } = await renderField()
    await pickOption(container, provinceTrigger(container), "Hồ Chí Minh")

    await act(async () => wardTrigger(container).click())
    const filterInput = container.querySelector("ul").previousElementSibling
    await act(async () => setInputValue(filterInput, "hiệp"))

    const optionTexts = [...container.querySelectorAll("li button")].map((b) => b.textContent)
    expect(optionTexts).toEqual(["Hiệp Bình"])
  })

  it("composes address_raw and the structured fields from province + ward + street, with district always null (no district level post-2025)", async () => {
    const { container, onChange } = await renderField()

    await pickOption(container, provinceTrigger(container), "Hồ Chí Minh")
    await pickOption(container, wardTrigger(container), "Hiệp Bình")
    await act(async () => setInputValue(container.querySelector("input[type='text']"), "512 Nguyễn Xiển"))

    expect(onChange).toHaveBeenLastCalledWith({
      address_raw: "512 Nguyễn Xiển, Hiệp Bình, Hồ Chí Minh",
      address_street: "512 Nguyễn Xiển",
      address_ward: "Hiệp Bình",
      address_district: null,
      address_province: "Hồ Chí Minh",
    })
  })

  it("resets the ward selection when the province changes", async () => {
    fetchWards.mockImplementation((code) =>
      Promise.resolve(code === "30" ? HCM_WARDS : [{ code: "00099", name: "Ba Đình" }])
    )
    const { container, onChange } = await renderField()

    await pickOption(container, provinceTrigger(container), "Hồ Chí Minh")
    await pickOption(container, wardTrigger(container), "Hiệp Bình")
    await pickOption(container, provinceTrigger(container), "Hà Nội")

    expect(wardTrigger(container).textContent).toContain("Select ward/commune")
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ address_ward: null, address_province: "Hà Nội" }))
  })

  it("degrades to an empty province list rather than crashing when the backend call fails", async () => {
    fetchProvinces.mockRejectedValue(new Error("network error"))
    const { container } = await renderField()

    await act(async () => provinceTrigger(container).click())
    expect(container.querySelectorAll("li button")).toHaveLength(0)
    expect(container.querySelector("li").textContent).toBe("No results")
  })
})

describe("AddressFields — street field requires province + ward first", () => {
  it("starts disabled, with a hint placeholder, before province/ward are picked", async () => {
    const { container } = await renderField()
    const streetInput = container.querySelector("input[type='text']")
    expect(streetInput.disabled).toBe(true)
    expect(streetInput.placeholder).toBe("Select province/city and ward/commune first")
  })

  it("stays disabled with only province picked (ward still missing)", async () => {
    const { container } = await renderField()
    await pickOption(container, provinceTrigger(container), "Hồ Chí Minh")
    expect(container.querySelector("input[type='text']").disabled).toBe(true)
  })

  it("becomes enabled, with the real placeholder, once both are picked", async () => {
    const { container } = await renderField()
    await pickOption(container, provinceTrigger(container), "Hồ Chí Minh")
    await pickOption(container, wardTrigger(container), "Hiệp Bình")

    const streetInput = container.querySelector("input[type='text']")
    expect(streetInput.disabled).toBe(false)
    expect(streetInput.placeholder).toBe("e.g. 66B Nguyen Si Sach")
  })

  it("disables again if the province changes (ward resets, so streetEnabled goes false)", async () => {
    fetchWards.mockImplementation((code) =>
      Promise.resolve(code === "30" ? HCM_WARDS : [{ code: "00099", name: "Ba Đình" }])
    )
    const { container } = await renderField()
    await pickOption(container, provinceTrigger(container), "Hồ Chí Minh")
    await pickOption(container, wardTrigger(container), "Hiệp Bình")
    await pickOption(container, provinceTrigger(container), "Hà Nội")

    expect(container.querySelector("input[type='text']").disabled).toBe(true)
  })
})

describe("AddressFields — debounced auto-search (not per-keystroke, not button-gated)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("never calls searchAddress before province + ward are both picked, no matter what's typed", async () => {
    await renderField()
    // The input is disabled at this point (see the describe block above);
    // this just confirms the debounce effect itself never fires either.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(searchAddress).not.toHaveBeenCalled()
  })

  it("does not call searchAddress immediately on keystroke — only after the debounce settles", async () => {
    const { container } = await renderField()
    await pickOption(container, provinceTrigger(container), "Hồ Chí Minh")
    await pickOption(container, wardTrigger(container), "Hiệp Bình")

    await act(async () => setInputValue(container.querySelector("input[type='text']"), "66B Nguyen Si Sach"))
    expect(searchAddress).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(searchAddress).toHaveBeenCalledWith("66B Nguyen Si Sach", "Hiệp Bình", "Hồ Chí Minh")
  })

  it("restarts the debounce on every keystroke — a fast typing burst fires only once, for the final text", async () => {
    const { container } = await renderField()
    await pickOption(container, provinceTrigger(container), "Hồ Chí Minh")
    await pickOption(container, wardTrigger(container), "Hiệp Bình")

    const input = container.querySelector("input[type='text']")
    await act(async () => setInputValue(input, "66"))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    await act(async () => setInputValue(input, "66B"))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    await act(async () => setInputValue(input, "66B Nguyen Si Sach"))
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })

    expect(searchAddress).toHaveBeenCalledTimes(1)
    expect(searchAddress).toHaveBeenCalledWith("66B Nguyen Si Sach", "Hiệp Bình", "Hồ Chí Minh")
  })

  it("does not search for fewer than 3 characters", async () => {
    const { container } = await renderField()
    await pickOption(container, provinceTrigger(container), "Hồ Chí Minh")
    await pickOption(container, wardTrigger(container), "Hiệp Bình")

    await act(async () => setInputValue(container.querySelector("input[type='text']"), "66"))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    expect(searchAddress).not.toHaveBeenCalled()
  })

  it("picking a search result fills the street field with the full description (not the too-short main_text), stripping the already-known ward/province suffix", async () => {
    searchAddress.mockResolvedValue({
      predictions: [{
        place_id: "1",
        description: "Sảnh chính S3.01, CC Vinhomes Grand Park, Nguyễn Xiển, Hiệp Bình, Hồ Chí Minh",
        // main_text alone would lose "CC Vinhomes Grand Park" — the real
        // bug this test guards against.
        structured_formatting: { main_text: "Sảnh chính S3.01" },
      }],
    })
    const { container, onChange } = await renderField()
    await pickOption(container, provinceTrigger(container), "Hồ Chí Minh")
    await pickOption(container, wardTrigger(container), "Hiệp Bình")
    await act(async () => setInputValue(container.querySelector("input[type='text']"), "Sanh chinh S3.01"))
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })

    const suggestionBtn = [...container.querySelectorAll("li button")][0]
    await act(async () => suggestionBtn.click())

    expect(container.querySelector("input[type='text']").value).toBe("Sảnh chính S3.01, CC Vinhomes Grand Park, Nguyễn Xiển")
    expect(onChange).toHaveBeenLastCalledWith({
      address_raw: "Sảnh chính S3.01, CC Vinhomes Grand Park, Nguyễn Xiển, Hiệp Bình, Hồ Chí Minh",
      address_street: "Sảnh chính S3.01, CC Vinhomes Grand Park, Nguyễn Xiển",
      address_ward: "Hiệp Bình",
      address_district: null,
      address_province: "Hồ Chí Minh",
    })
  })
})
