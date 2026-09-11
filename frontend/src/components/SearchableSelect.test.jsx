import { describe, it, expect, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock("../contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (key) => key }),
}))

const { default: SearchableSelect } = await import("./SearchableSelect")

async function render(props) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<SearchableSelect {...props} />) })
  return container
}

async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
}

// React tracks a controlled <input>'s value via the native property setter,
// so a plain `el.value = x` followed by an "input" event is invisible to it
// - this goes through the same setter React itself overrides, the way a
// real keystroke would.
async function type(el, text) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
  await act(async () => {
    setter.call(el, text)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

const shortOptions = [
  { code: "a", name: "Option A" },
  { code: "b", name: "Option B" },
]

const longOptions = Array.from({ length: 10 }, (_, i) => ({ code: `opt${i}`, name: `Option ${i}` }))

describe("SearchableSelect - search threshold", () => {
  it("does not render a search input when options.length is 8 or fewer", async () => {
    const container = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    await click(trigger)

    expect(container.querySelector('input[type="text"]')).toBeNull()
  })

  it("renders a search input when options.length is more than 8", async () => {
    const container = await render({ value: "opt0", onChange: vi.fn(), options: longOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    await click(trigger)

    expect(container.querySelector('input[type="text"]')).toBeTruthy()
  })

  it("sits exactly on the boundary: 8 options is still no search input, 9 is", async () => {
    const eightOptions = Array.from({ length: 8 }, (_, i) => ({ code: `opt${i}`, name: `Option ${i}` }))
    const nineOptions = Array.from({ length: 9 }, (_, i) => ({ code: `opt${i}`, name: `Option ${i}` }))

    const atEight = await render({ value: "opt0", onChange: vi.fn(), options: eightOptions, placeholder: "Pick one" })
    await click(atEight.querySelector("button"))
    expect(atEight.querySelector('input[type="text"]')).toBeNull()

    const atNine = await render({ value: "opt0", onChange: vi.fn(), options: nineOptions, placeholder: "Pick one" })
    await click(atNine.querySelector("button"))
    expect(atNine.querySelector('input[type="text"]')).toBeTruthy()
  })

  it("still opens and picks correctly with no search input rendered", async () => {
    const onChange = vi.fn()
    const container = await render({ value: "a", onChange, options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    await click(trigger)

    const optionBtn = [...container.querySelectorAll("li button")].find((b) => b.textContent === "Option B")
    await click(optionBtn)

    expect(onChange).toHaveBeenCalledWith("b")
  })

  it("sets data-testid on the trigger button when dataTestId is provided", async () => {
    const container = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one", dataTestId: "my-select" })
    expect(container.querySelector('[data-testid="my-select"]')).toBeTruthy()
  })
})

describe("SearchableSelect - stable width", () => {
  it("renders an invisible sizer line for every option (plus the placeholder if it isn't itself an option), so the box's width is set by the widest option rather than by whichever one is currently selected", async () => {
    const container = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    const sizer = container.querySelector('[aria-hidden="true"]')
    expect(sizer).toBeTruthy()
    expect(sizer.className).toContain("h-0")
    expect(sizer.className).toContain("overflow-hidden")
    // One div per option, plus the placeholder line since it isn't one of shortOptions' names.
    expect(sizer.children).toHaveLength(shortOptions.length + 1)
    expect(sizer.textContent).toContain("Option A")
    expect(sizer.textContent).toContain("Option B")
    expect(sizer.textContent).toContain("Pick one")
  })

  it("does not add a placeholder sizer line when the placeholder text duplicates an existing option's name", async () => {
    const container = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Option A" })
    const sizer = container.querySelector('[aria-hidden="true"]')
    expect(sizer.children).toHaveLength(shortOptions.length)
  })

  it("keeps the sizer's horizontal padding (for width) but drops its vertical padding (which, under border-box, silently prevents h-0 from truly collapsing the box and pushes the real button down inside its own wrapper)", async () => {
    const container = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one", padding: "px-2 py-1.5" })
    const sizer = container.querySelector('[aria-hidden="true"]')
    expect(sizer.className).toContain("px-2")
    expect(sizer.className).not.toMatch(/(^|\s)py-1\.5(\s|$)/)
  })

  it("applies the padding prop to the trigger button, defaulting to px-3 py-2", async () => {
    const defaultContainer = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    expect(defaultContainer.querySelector("button").className).toContain("px-3 py-2")

    const customContainer = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one", padding: "px-2 py-1" })
    expect(customContainer.querySelector("button").className).toContain("px-2 py-1")
    expect(customContainer.querySelector("button").className).not.toContain("px-3 py-2")
  })

  it("applies the height prop to the trigger button when given, and adds nothing when omitted", async () => {
    const withHeight = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one", height: "h-[38px]" })
    expect(withHeight.querySelector("button").className).toContain("h-[38px]")

    const withoutHeight = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    expect(withoutHeight.querySelector("button").className).not.toContain("h-[38px]")
    expect(withoutHeight.querySelector("button").className).not.toContain("undefined")
  })
})

describe("SearchableSelect - search query reset", () => {
  it("clears a typed search query when the trigger is re-clicked closed, so the next open isn't silently pre-filtered", async () => {
    const container = await render({ value: "opt0", onChange: vi.fn(), options: longOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")

    await click(trigger)
    const search = container.querySelector('input[type="text"]')
    await type(search, "Option 3")
    expect(container.querySelectorAll("li button")).toHaveLength(1)

    await click(trigger) // close
    await click(trigger) // reopen

    expect(container.querySelectorAll("li button")).toHaveLength(longOptions.length)
  })
})
