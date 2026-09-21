# SearchableSelect Keyboard Navigation + ARIA - Implementation Plan

**Goal:** Add keyboard operability (open/close, arrow-key highlight, Enter to
pick, Escape to close-and-refocus) and ARIA combobox/listbox/option
semantics to `SearchableSelect`, with no visual or prop-API change.

**Architecture:** Single-file change to
`frontend/src/components/SearchableSelect.jsx` - a new `activeIndex` state
tracks the keyboard-highlighted option within the currently-filtered list, a
`useId()`-derived id set wires the ARIA relationships, and one `onKeyDown`
handler on the existing root wrapper covers both the trigger-focused and
search-input-focused cases.

**Tech Stack:** React 19, Vitest (no `@testing-library/react` in this repo -
raw `createRoot`/`act`/DOM events, matching every existing component test).

---

### Task 1: Add keyboard nav + ARIA to `SearchableSelect.jsx`, with tests

**Files:**
- Modify: `frontend/src/components/SearchableSelect.jsx`
- Modify: `frontend/src/components/SearchableSelect.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/components/SearchableSelect.test.jsx`:

```jsx
async function keydown(el, key) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
  })
}

describe("SearchableSelect - keyboard nav + ARIA", () => {
  it("trigger exposes combobox/listbox ARIA wiring, aria-expanded toggles", async () => {
    const container = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    expect(trigger.getAttribute("role")).toBe("combobox")
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox")
    expect(trigger.getAttribute("aria-expanded")).toBe("false")

    await click(trigger)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    const listbox = container.querySelector('[role="listbox"]')
    expect(listbox).toBeTruthy()
    expect(trigger.getAttribute("aria-controls")).toBe(listbox.id)
  })

  it("every option has role=option and aria-selected matching the current value", async () => {
    const container = await render({ value: "b", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    await click(container.querySelector("button"))
    const opts = [...container.querySelectorAll('[role="option"]')]
    expect(opts).toHaveLength(2)
    expect(opts[0].getAttribute("aria-selected")).toBe("false")
    expect(opts[1].getAttribute("aria-selected")).toBe("true")
  })

  it("Enter on a focused closed trigger opens the menu", async () => {
    const container = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    await keydown(trigger, "Enter")
    expect(container.querySelector('[role="listbox"]')).toBeTruthy()
  })

  it("ArrowDown/ArrowUp move the highlighted option, clamped at both ends", async () => {
    const container = await render({ value: "a", onChange: vi.fn(), options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    await click(trigger)

    // Starts highlighted on the current value ("a" -> index 0).
    expect(trigger.getAttribute("aria-activedescendant")).toBe(container.querySelector('[role="option"]').id)

    await keydown(trigger, "ArrowDown")
    const opts = [...container.querySelectorAll('[role="option"]')]
    expect(trigger.getAttribute("aria-activedescendant")).toBe(opts[1].id)

    await keydown(trigger, "ArrowDown") // already at last - clamped, does not wrap
    expect(trigger.getAttribute("aria-activedescendant")).toBe(opts[1].id)

    await keydown(trigger, "ArrowUp")
    await keydown(trigger, "ArrowUp") // already at first - clamped, does not wrap
    expect(trigger.getAttribute("aria-activedescendant")).toBe(opts[0].id)
  })

  it("Enter while open picks the highlighted option and returns focus to the trigger", async () => {
    const onChange = vi.fn()
    const container = await render({ value: "a", onChange, options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    await click(trigger)
    await keydown(trigger, "ArrowDown")
    await keydown(trigger, "Enter")

    expect(onChange).toHaveBeenCalledWith("b")
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("Escape closes the menu without changing value and returns focus to the trigger", async () => {
    const onChange = vi.fn()
    const container = await render({ value: "a", onChange, options: shortOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    await click(trigger)
    await keydown(trigger, "Escape")

    expect(onChange).not.toHaveBeenCalled()
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("Home/End jump to the first/last option", async () => {
    const container = await render({ value: "opt0", onChange: vi.fn(), options: longOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    await click(trigger)
    const search = container.querySelector('input[type="text"]')

    await keydown(search, "End")
    let opts = [...container.querySelectorAll('[role="option"]')]
    expect(trigger.getAttribute("aria-activedescendant")).toBe(opts[opts.length - 1].id)

    await keydown(search, "Home")
    opts = [...container.querySelectorAll('[role="option"]')]
    expect(trigger.getAttribute("aria-activedescendant")).toBe(opts[0].id)
  })

  it("typing in the search box resets the highlight to the first filtered result, and Enter picks from the filtered list", async () => {
    const onChange = vi.fn()
    const container = await render({ value: "opt0", onChange, options: longOptions, placeholder: "Pick one" })
    const trigger = container.querySelector("button")
    await click(trigger)
    const search = container.querySelector('input[type="text"]')

    await type(search, "Option 3")
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1)

    await keydown(search, "Enter")
    expect(onChange).toHaveBeenCalledWith("opt3")
  })

  it("ArrowDown/Enter are no-ops when the filtered list is empty", async () => {
    const onChange = vi.fn()
    const container = await render({ value: "opt0", onChange, options: longOptions, placeholder: "Pick one" })
    await click(container.querySelector("button"))
    const search = container.querySelector('input[type="text"]')

    await type(search, "no such option")
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0)

    await keydown(search, "ArrowDown")
    await keydown(search, "Enter")
    expect(onChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failures**

Run: `cd frontend && npx vitest run src/components/SearchableSelect.test.jsx`
Expected: FAIL - no `role="combobox"`/`role="listbox"`/`role="option"`
attributes exist yet, keydown handling doesn't exist yet.

- [ ] **Step 3: Implement in `SearchableSelect.jsx`**

- Add `useId, useRef` (already imports `useEffect, useRef, useState`, so
  just add `useId`) from `"react"`.
- Add `const baseId = useId()`, `const listboxId = \`${baseId}-listbox\``,
  `const optionId = (code) => \`${baseId}-option-${code}\``.
- Add `const triggerRef = useRef(null)` and `const [activeIndex,
  setActiveIndex] = useState(0)`.
- Replace the ad-hoc open/close logic (currently inlined in the trigger's
  `onClick` and the click-outside effect) with two helpers:
  ```js
  const openMenu = () => {
    const idx = options.findIndex((o) => o.code === value)
    setActiveIndex(idx >= 0 ? idx : 0)
    setOpen(true)
  }
  const closeMenu = () => {
    setOpen(false)
    setQuery("")
  }
  ```
  Trigger `onClick` becomes:
  ```js
  onClick={() => {
    if (disabled) return
    if (open) closeMenu()
    else openMenu()
  }}
  ```
  Click-outside effect calls `closeMenu()` instead of its two inline
  `setOpen(false)`/`setQuery("")` calls.
- `pick(code)` gains a focus-return: after `onChange(code)`, `closeMenu()`,
  also call `triggerRef.current?.focus()`.
- Search input's `onChange` becomes
  `onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}`
  (was just `setQuery`).
- Add `onKeyDown={handleKeyDown}` to the root wrapper `<div>` (the one
  holding `ref={rootRef}`), where:
  ```js
  const handleKeyDown = (e) => {
    if (disabled) return
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault()
        openMenu()
      }
      return
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault()
        closeMenu()
        triggerRef.current?.focus()
        break
      case "ArrowDown":
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
        break
      case "Home":
        e.preventDefault()
        setActiveIndex(0)
        break
      case "End":
        e.preventDefault()
        setActiveIndex(filtered.length - 1)
        break
      case "Enter":
        e.preventDefault()
        if (filtered[activeIndex]) pick(filtered[activeIndex].code)
        break
      default:
        break
    }
  }
  ```
  Note: `" "` (space) is only treated as "open" while closed - once open,
  the `default` case leaves it untouched, so typing a literal space into the
  search box still works.
- Trigger button gains:
  ```jsx
  ref={triggerRef}
  id={`${baseId}-trigger`}
  role="combobox"
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={open ? listboxId : undefined}
  aria-activedescendant={open && filtered[activeIndex] ? optionId(filtered[activeIndex].code) : undefined}
  ```
  (`aria-controls`/`aria-activedescendant` only point at real, currently-
  rendered elements - both are `undefined` while closed, since the listbox
  doesn't exist in the DOM then.)
- The `<ul>` gains `id={listboxId}` and `role="listbox"`.
- Each option `<li><button>` gains, on the button:
  ```jsx
  role="option"
  id={optionId(o.code)}
  aria-selected={o.code === value}
  onMouseEnter={() => setActiveIndex(idx)}
  ```
  (`idx` from `filtered.map((o, idx) => ...)` - change the existing
  `filtered.map((o) => ...)` to include the index.) Also extend the
  existing highlight className to include the keyboard-active option:
  `${o.code === value || idx === activeIndex ? "bg-[var(--brand-soft)] font-medium" : ""}`.

- [ ] **Step 4: Run to verify tests pass**

Run: `cd frontend && npx vitest run src/components/SearchableSelect.test.jsx`
Expected: PASS (all new + all 13 pre-existing tests green - no behavior
change to search threshold, stable width, or query-reset-on-close).

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: all pass - `SearchableSelect` is used across many admin/checkout
pages (province/ward pickers, filters); a full-suite run confirms none of
those call sites broke from the new props/handlers (none of them pass a
`role`/`aria-*` prop of their own, so there's nothing to collide with).

- [ ] **Step 6: Lint**

Run: `cd frontend && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/SearchableSelect.jsx frontend/src/components/SearchableSelect.test.jsx
git commit -m "feat(a11y): add keyboard navigation and ARIA semantics to SearchableSelect"
```
