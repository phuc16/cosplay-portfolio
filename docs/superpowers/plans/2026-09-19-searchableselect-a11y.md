# SearchableSelect Accessibility Implementation Plan

**Goal:** Add keyboard operability (arrow keys, Enter, Escape, Home/End) and
ARIA combobox/listbox semantics to `SearchableSelect`, with zero prop or
call-site changes, per `docs/superpowers/specs/2026-09-19-searchableselect-a11y-design.md`.

**Tech stack:** React 19 (`useId`), Vitest, no `@testing-library/react` in
this codebase - raw `createRoot`/`act`, matching
`SearchableSelect.test.jsx`'s existing style exactly.

---

### Task 1: Add ARIA attributes and keyboard handling to `SearchableSelect.jsx`

**Files:**
- Modify: `frontend/src/components/SearchableSelect.jsx`

- [ ] **Step 1:** Add `useId` import, an `activeIndex` state, and an
      `optionId(code)` helper (`${listboxId}-opt-${code}`).
- [ ] **Step 2:** Clamp/reset `activeIndex` whenever `filtered` changes
      (query typed, or `options` prop changes while open) - `0` when
      non-empty, `-1` when empty.
- [ ] **Step 3:** On open (click, or an arrow key while closed), seed
      `activeIndex` to the selected option's index within `filtered` if
      present, else `0` (or `-1` if `filtered` is empty).
- [ ] **Step 4:** Write `handleKeyDown(e)`: `ArrowDown`/`ArrowUp` move+clamp
      `activeIndex` (opening the list first if closed); `Home`/`End` jump to
      `0`/`filtered.length - 1`; `Enter` calls `pick(filtered[activeIndex].code)`
      when `activeIndex >= 0` and the list is open, otherwise (list closed)
      opens it; `Escape` closes without picking and keeps focus where it is
      (browser default already keeps focus on the element that received the
      keydown - no explicit `.focus()` call needed since neither the button
      nor input is unmounted). Bail out immediately if `disabled`.
- [ ] **Step 5:** Wire `onKeyDown={handleKeyDown}` on both the trigger
      `<button>` and the search `<input>`.
- [ ] **Step 6:** Add ARIA attributes: trigger gets `role="combobox"`,
      `aria-haspopup="listbox"`, `aria-expanded={open}`,
      `aria-controls={listboxId}`, and (only when `!showSearch`)
      `aria-activedescendant`. The search input gets the same
      `aria-expanded`/`aria-controls`/`aria-activedescendant` plus
      `aria-autocomplete="list"`, `role="combobox"`. The `<ul>` gets
      `role="listbox"` and `id={listboxId}`. Each `<li>` gets
      `role="option"`, `id={optionId(o.code)}`, `aria-selected={o.code ===
      value}`, and the active-highlight class extended to also match
      `index === activeIndex`.
- [ ] **Step 7:** Run `cd frontend && npx vitest run src/components/SearchableSelect.test.jsx`
      to confirm all pre-existing tests still pass unchanged (pure addition,
      no removed behavior).

---

### Task 2: Tests for keyboard nav and ARIA semantics

**Files:**
- Modify: `frontend/src/components/SearchableSelect.test.jsx`

- [ ] **Step 1:** Add a `keydown(el, key)` test helper alongside the
      existing `click`/`type` helpers (`el.dispatchEvent(new
      KeyboardEvent("keydown", { key, bubbles: true }))`, wrapped in `act`).
- [ ] **Step 2:** Add `describe("SearchableSelect - keyboard and ARIA")`
      covering: initial `aria-expanded="false"`/`role="combobox"` on the
      trigger; `ArrowDown` opens + highlights; repeated `ArrowDown` clamps
      at the last option (no wraparound); `ArrowUp` clamps at the first;
      `Enter` commits the highlighted option and closes; `Escape` closes
      without calling `onChange`; typing resets the highlight to the first
      filtered match; every `<li>` has `role="option"` + a stable `id`
      matching the current `aria-activedescendant`.
- [ ] **Step 3:** Run `cd frontend && npx vitest run src/components/SearchableSelect.test.jsx`
      - expect all tests (old + new) green.
- [ ] **Step 4:** Run `cd frontend && npm test` for a full-suite regression
      check (this component is used by AddressFields, AdminProducts,
      AdminCollections, Shop/Collection filters, stats filters, shipping
      screens - confirm none of their own tests assumed the old
      button/li DOM shape in a way the new `role`/`id` attributes break).
- [ ] **Step 5:** Commit.

```bash
git add frontend/src/components/SearchableSelect.jsx frontend/src/components/SearchableSelect.test.jsx
git commit -m "feat(a11y): add keyboard nav and ARIA combobox semantics to SearchableSelect"
```
