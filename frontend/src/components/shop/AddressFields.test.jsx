import { describe, it, expect, beforeEach, vi } from "vitest"
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

function setSelectValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

function setInputValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new Event("change", { bubbles: true }))
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
    const provinceOptions = [...container.querySelectorAll("select")[0].querySelectorAll("option")]
    expect(provinceOptions.map((o) => o.textContent)).toEqual(
      expect.arrayContaining(["Hồ Chí Minh", "Hà Nội"])
    )
  })

  it("the ward select starts disabled, and only fetches that province's wards once one is picked", async () => {
    const { container } = await renderField()
    const [provinceSelect, wardSelect] = container.querySelectorAll("select")
    expect(wardSelect.disabled).toBe(true)
    expect(fetchWards).not.toHaveBeenCalled()

    await act(async () => setSelectValue(provinceSelect, "30"))

    expect(fetchWards).toHaveBeenCalledWith("30")
    expect(wardSelect.disabled).toBe(false)
    const wardOptions = [...wardSelect.querySelectorAll("option")]
    expect(wardOptions.map((o) => o.textContent)).toEqual(
      expect.arrayContaining(["Dĩ An", "Hiệp Bình"])
    )
  })

  it("composes address_raw and the structured fields from province + ward + street, with district always null (no district level post-2025)", async () => {
    const { container, onChange } = await renderField()
    const [provinceSelect, wardSelect] = container.querySelectorAll("select")

    await act(async () => setSelectValue(provinceSelect, "30"))
    await act(async () => setSelectValue(wardSelect, "00003"))
    await act(async () => setInputValue(container.querySelector("input"), "512 Nguyễn Xiển"))

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
    const [provinceSelect, wardSelect] = container.querySelectorAll("select")

    await act(async () => setSelectValue(provinceSelect, "30"))
    await act(async () => setSelectValue(wardSelect, "00003"))
    await act(async () => setSelectValue(provinceSelect, "01"))

    expect(wardSelect.value).toBe("")
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ address_ward: null, address_province: "Hà Nội" }))
  })

  it("degrades to an empty province list rather than crashing when the backend call fails", async () => {
    fetchProvinces.mockRejectedValue(new Error("network error"))
    const { container } = await renderField()

    const provinceOptions = [...container.querySelectorAll("select")[0].querySelectorAll("option")]
    expect(provinceOptions).toHaveLength(1) // just the placeholder
  })
})

describe("AddressFields — on-demand street search (not per-keystroke)", () => {
  it("never calls searchAddress just from typing in the street field", async () => {
    const { container } = await renderField()
    await act(async () => setInputValue(container.querySelector("input"), "66B Nguyen Si Sach"))

    expect(searchAddress).not.toHaveBeenCalled()
  })

  it("disables the search button until at least 3 characters are typed", async () => {
    const { container } = await renderField()
    const searchBtn = container.querySelector('button[aria-label="Search address"]')
    expect(searchBtn.disabled).toBe(true)

    await act(async () => setInputValue(container.querySelector("input"), "66"))
    expect(searchBtn.disabled).toBe(true)

    await act(async () => setInputValue(container.querySelector("input"), "66B"))
    expect(searchBtn.disabled).toBe(false)
  })

  it("clicking the search button calls searchAddress with the street text plus the picked ward/province", async () => {
    const { container } = await renderField()
    const [provinceSelect, wardSelect] = container.querySelectorAll("select")
    await act(async () => setSelectValue(provinceSelect, "30"))
    await act(async () => setSelectValue(wardSelect, "00003"))
    await act(async () => setInputValue(container.querySelector("input"), "66B Nguyen Si Sach"))

    const searchBtn = container.querySelector('button[aria-label="Search address"]')
    await act(async () => searchBtn.click())

    expect(searchAddress).toHaveBeenCalledWith("66B Nguyen Si Sach", "Hiệp Bình", "Hồ Chí Minh")
  })

  it("picking a search result fills the street field and re-emits address_raw, without overriding the already-picked ward/province", async () => {
    searchAddress.mockResolvedValue({
      predictions: [{
        place_id: "1",
        description: "66b Nguyễn Sĩ Sách, Tân Sơn, Hồ Chí Minh",
        structured_formatting: { main_text: "66b Nguyễn Sĩ Sách" },
      }],
    })
    const { container, onChange } = await renderField()
    const [provinceSelect, wardSelect] = container.querySelectorAll("select")
    await act(async () => setSelectValue(provinceSelect, "30"))
    await act(async () => setSelectValue(wardSelect, "00003"))
    await act(async () => setInputValue(container.querySelector("input"), "66B Nguyen Si Sach"))
    await act(async () => container.querySelector('button[aria-label="Search address"]').click())

    const suggestionBtn = [...container.querySelectorAll("li button")][0]
    await act(async () => suggestionBtn.click())

    expect(container.querySelector("input").value).toBe("66b Nguyễn Sĩ Sách")
    expect(onChange).toHaveBeenLastCalledWith({
      address_raw: "66b Nguyễn Sĩ Sách, Hiệp Bình, Hồ Chí Minh",
      address_street: "66b Nguyễn Sĩ Sách",
      address_ward: "Hiệp Bình",
      address_district: null,
      address_province: "Hồ Chí Minh",
    })
  })
})
