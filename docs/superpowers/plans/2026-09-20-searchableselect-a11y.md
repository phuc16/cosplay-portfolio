# SearchableSelect Keyboard Navigation + ARIA — Implementation Plan

**Goal:** Close the tracked accessibility gap in `SearchableSelect`
(`docs/DECISIONS.md`, 2026-09-11 entry) - add keyboard navigation and
ARIA combobox/listbox semantics, purely additive to existing
click-driven behavior.

**Design doc:**
`docs/superpowers/specs/2026-09-20-searchableselect-a11y-design.md`

**Files touched:**
- `frontend/src/components/SearchableSelect.jsx` (implementation)
- `frontend/src/components/SearchableSelect.test.jsx` (new tests)

---

### Task 1: Add `highlightedIndex` state and derive stable option ids

- [ ] Add `const [highlightedIndex, setHighlightedIndex] = useState(-1)`.
- [ ] Add a stable listbox id via `useId()` (import from `react`), and a
      helper `optionId(code)` returning `` `${listboxId}-option-${code}` ``.
- [ ] Reset `highlightedIndex` to `-1` everywhere `query`/`open` are
      already reset on close: the click-outside effect, the trigger's
      close-click branch, `pick()`, and the new Escape handler (added in
      Task 3).
- [ ] Clamp `highlightedIndex` back into range whenever `filtered`
      shrinks under it (e.g. via a small effect or inline guard computed
      alongside `filtered` - if `filtered[highlightedIndex]` is
      undefined after a query change, snap to `0` when `filtered.length
      > 0`, else `-1`).

### Task 2: ARIA attributes (no interaction yet)

- [ ] Trigger `<button>`: add `role="combobox"`,
      `aria-haspopup="listbox"`, `aria-expanded={open}`,
      `aria-controls={listboxId}`,
      `aria-activedescendant={open && highlightedIndex >= 0 ?
      optionId(filtered[highlightedIndex].code) : undefined}`.
- [ ] `<ul>`: add `role="listbox"` and `id={listboxId}`.
- [ ] Each option's inner `<button>`: add `role="option"`,
      `aria-selected={o.code === value}`, `id={optionId(o.code)}`.
- [ ] Search `<input>` (when `showSearch`): add the same
      `aria-activedescendant` expression as the trigger (it's the
      focused element while typing).
- [ ] Verify nothing existing (`aria-label`, `data-testid`) was removed
      or renamed.

### Task 3: Keyboard handler - shared logic + wiring to both focus targets

- [ ] Write one `handleKeyDown(e)` function (not duplicated per
      element) covering: ArrowDown, ArrowUp, Home, End, Enter, Escape,
      as specified in the design doc (wrap-around math, no-op on an
      empty filtered list, `preventDefault()` only when the key was
      actually handled).
- [ ] Trigger button: `onKeyDown={handleKeyDown}`, plus special-case
      "open on ArrowDown/ArrowUp/Enter when currently closed" (pre-highlight
      the selected option, or index 0, per the design doc's Opening
      section) before falling through to the shared handler for the
      already-open case.
- [ ] Search `<input>`: `onKeyDown={handleKeyDown}` (dropdown is always
      open while this input is visible, so no closed-trigger branch
      needed here).
- [ ] Enter: call the existing `pick(option.code)` on the highlighted
      option; no-op if `highlightedIndex === -1` or the filtered list is
      empty.
- [ ] Escape: close (`setOpen(false)`, `setQuery("")`,
      `setHighlightedIndex(-1)`), do **not** call `onChange`, then focus
      the trigger button (needs a `ref` on the trigger - add
      `triggerRef` alongside the existing `rootRef` and call
      `triggerRef.current?.focus()`).

### Task 4: Highlight visual affordance

- [ ] Add the highlighted-option class (reuse
      `hover:bg-[var(--brand-soft)]`'s color as a plain applied class
      when `i === highlightedIndex`, distinct from the `o.code === value`
      "selected" background so both can be visually told apart when they
      differ).

### Task 5: Tests

Add to `frontend/src/components/SearchableSelect.test.jsx`, following
its existing `createRoot`/`act` style (see the file's `click()`/`type()`
helpers for the pattern to match):

- [ ] Add a `keydown(el, key)` helper:
      `el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))`
      wrapped in `act(async () => { ... })`.
- [ ] `describe("SearchableSelect - keyboard navigation")`:
  - ArrowDown moves highlight forward (assert via the highlighted
    option's class or `aria-activedescendant` value on the trigger).
  - ArrowUp moves highlight backward.
  - ArrowDown wraps from the last option back to the first.
  - ArrowUp wraps from the first option to the last.
  - Home jumps to the first *filtered* option; End jumps to the last
    *filtered* option (test with a typed query narrowing `longOptions`
    so filtered != full list).
  - Enter on a highlighted option calls `onChange` with its code and
    closes the dropdown (`querySelector('ul')` becomes null, or `open`
    proxy via the search input disappearing).
  - Escape closes the dropdown without calling `onChange`, and moves
    focus back to the trigger button
    (`document.activeElement === trigger`).
  - Opening via ArrowDown on the closed trigger highlights the
    currently-selected option (assert its `aria-activedescendant`/id),
    not the first option, when `value` is already set to a non-first
    option.
  - Opening via ArrowDown when nothing is selected (`value` doesn't
    match any option) highlights the first option.
  - Same Arrow/Enter/Escape behavior works when the search `<input>`
    has focus (long-list case) - not just the trigger button.
- [ ] `describe("SearchableSelect - ARIA")`:
  - Trigger has `role="combobox"`, `aria-haspopup="listbox"` always.
  - `aria-expanded` is `"false"` before opening, `"true"` after.
  - `<ul>` has `role="listbox"` once open.
  - Each option button has `role="option"` and correct `aria-selected`
    (true for the selected option, false for others).
  - `aria-activedescendant` is absent/falsy when closed or nothing
    highlighted, and matches the highlighted option's `id` once one is
    highlighted.
- [ ] Run the full existing file to confirm no regressions in the
      pre-existing search-threshold / stable-width / query-reset
      describe blocks.

### Task 6: Full suite + lint

- [ ] `cd frontend && npm test` - confirm 0 failures, note the final
      pass count (must be >= the 597-test baseline plus new tests).
- [ ] `cd frontend && npm run lint` - fix anything the change
      introduces (e.g. unused import, missing dependency in an
      unrelated `useEffect` this change doesn't touch should be left
      alone).

### Task 7: Log entry + commit + PR

- [ ] Append the automated-feature-log line to
      `docs/AUTOMATED_FEATURES_LOG.md`.
- [ ] Commit implementation + tests + docs (no `Co-Authored-By`
      trailer per this run's instructions).
- [ ] Push branch, open PR against `main`.
