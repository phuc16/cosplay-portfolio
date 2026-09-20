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

async function keydown(el, key) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
  })
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

describe("SearchableSelect - keyboard navigation", () => {
  it("ArrowDown on the closed trigger opens the dropdown and highlights the currently selected option", async () => {
    const container = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")

    await keydown(trigger, "ArrowDown")

    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    const optionA = [...container.querySelectorAll("li button")].find((b) => b.textContent === "Option A")
    expect(trigger.getAttribute("aria-activedescendant")).toBe(optionA.id)
  })

  it("ArrowDown on the closed trigger highlights the first option when nothing is selected", async () => {
    const container = await render({ value: null, onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")

    await keydown(trigger, "ArrowDown")

    const optionA = [...container.querySelectorAll("li button")].find((b) => b.textContent === "Option A")
    expect(trigger.getAttribute("aria-activedescendant")).toBe(optionA.id)
  })

  it("ArrowDown moves the highlight forward and wraps from the last option back to the first", async () => {
    const container = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    const optionA = () => [...container.querySelectorAll("li button")].find((b) => b.textContent === "Option A")
    const optionB = () => [...container.querySelectorAll("li button")].find((b) => b.textContent === "Option B")

    await keydown(trigger, "ArrowDown") // opens, highlights the current selection (A)
    expect(trigger.getAttribute("aria-activedescendant")).toBe(optionA().id)

    await keydown(trigger, "ArrowDown") // -> B
    expect(trigger.getAttribute("aria-activedescendant")).toBe(optionB().id)

    await keydown(trigger, "ArrowDown") // wraps -> A
    expect(trigger.getAttribute("aria-activedescendant")).toBe(optionA().id)
  })

  it("ArrowUp moves the highlight backward and wraps from the first option to the last", async () => {
    const container = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    const optionB = () => [...container.querySelectorAll("li button")].find((b) => b.textContent === "Option B")

    await keydown(trigger, "ArrowDown") // opens, highlights A (index 0)
    await keydown(trigger, "ArrowUp") // wraps back -> last option (B)

    expect(trigger.getAttribute("aria-activedescendant")).toBe(optionB().id)
  })

  it("Enter selects the highlighted option and closes the dropdown", async () => {
    const onChange = vi.fn()
    const container = await render({ value: "a", onChange, options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")

    await keydown(trigger, "ArrowDown") // highlight A
    await keydown(trigger, "ArrowDown") // highlight B
    await keydown(trigger, "Enter")

    expect(onChange).toHaveBeenCalledWith("b")
    expect(container.querySelector('ul[role="listbox"]')).toBeNull()
  })

  it("Escape closes the dropdown without changing the selection and returns focus to the trigger", async () => {
    const onChange = vi.fn()
    const container = await render({ value: "a", onChange, options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")

    await keydown(trigger, "ArrowDown")
    await keydown(trigger, "ArrowDown")
    await keydown(trigger, "Escape")

    expect(onChange).not.toHaveBeenCalled()
    expect(container.querySelector('ul[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("Home/End jump to the first/last currently-filtered option, and Arrow/Enter work identically when the search input has focus", async () => {
    const homeEndOptions = Array.from({ length: 10 }, (_, i) => ({
      code: `o${i}`,
      name: i < 3 ? `Match ${i}` : `Other ${i}`,
    }))
    const onChange = vi.fn()
    const container = await render({ value: null, onChange, options: homeEndOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    await click(trigger) // mouse open - search input renders (10 > SEARCH_THRESHOLD)

    const search = container.querySelector('input[type="text"]')
    await type(search, "Match")
    expect(container.querySelectorAll("li button")).toHaveLength(3)

    const match = (n) => [...container.querySelectorAll("li button")].find((b) => b.textContent === `Match ${n}`)

    await keydown(search, "End")
    expect(search.getAttribute("aria-activedescendant")).toBe(match(2).id)

    await keydown(search, "Home")
    expect(search.getAttribute("aria-activedescendant")).toBe(match(0).id)

    await keydown(search, "ArrowDown")
    expect(search.getAttribute("aria-activedescendant")).toBe(match(1).id)

    await keydown(search, "Enter")
    expect(onChange).toHaveBeenCalledWith("o1")
    expect(container.querySelector('ul[role="listbox"]')).toBeNull()
  })

  it("Escape on the search input closes without selecting and returns focus to the trigger", async () => {
    const onChange = vi.fn()
    const container = await render({ value: null, onChange, options: longOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    await click(trigger)

    const search = container.querySelector('input[type="text"]')
    await keydown(search, "ArrowDown")
    await keydown(search, "Escape")

    expect(onChange).not.toHaveBeenCalled()
    expect(container.querySelector('ul[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("ArrowDown/Enter are a no-op when the filtered list is empty", async () => {
    const onChange = vi.fn()
    const container = await render({ value: null, onChange, options: longOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    await click(trigger)

    const search = container.querySelector('input[type="text"]')
    await type(search, "nonexistent-query")
    expect(container.querySelectorAll("li button")).toHaveLength(0)

    await keydown(search, "ArrowDown")
    await keydown(search, "Enter")

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe("SearchableSelect - ARIA", () => {
  it("always exposes role=combobox and aria-haspopup=listbox on the trigger", async () => {
    const container = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")

    expect(trigger.getAttribute("role")).toBe("combobox")
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox")
  })

  it("flips aria-expanded from false to true when opened", async () => {
    const container = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    expect(trigger.getAttribute("aria-expanded")).toBe("false")

    await click(trigger)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
  })

  it("gives the option list role=listbox and each option role=option with correct aria-selected", async () => {
    const container = await render({ value: "b", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    await click(trigger)

    const listbox = container.querySelector("ul")
    expect(listbox.getAttribute("role")).toBe("listbox")

    const optionA = [...container.querySelectorAll("li button")].find((b) => b.textContent === "Option A")
    const optionB = [...container.querySelectorAll("li button")].find((b) => b.textContent === "Option B")
    expect(optionA.getAttribute("role")).toBe("option")
    expect(optionA.getAttribute("aria-selected")).toBe("false")
    expect(optionB.getAttribute("aria-selected")).toBe("true")
  })

  it("has no aria-activedescendant when closed or nothing highlighted, and matches the highlighted option's id once one is set", async () => {
    const container = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    expect(trigger.hasAttribute("aria-activedescendant")).toBe(false)

    await click(trigger) // mouse-opened - no highlight set yet
    expect(trigger.hasAttribute("aria-activedescendant")).toBe(false)

    await keydown(trigger, "ArrowDown")
    const optionA = [...container.querySelectorAll("li button")].find((b) => b.textContent === "Option A")
    expect(trigger.getAttribute("aria-activedescendant")).toBe(optionA.id)
  })
})
