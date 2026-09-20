# SearchableSelect Keyboard Navigation + ARIA — Design

## Trend angle

**Tech trend - modern web app accessibility expectations.** WCAG 2.1 AA
and the ARIA Authoring Practices Guide's combobox pattern are now a
baseline expectation for any production web app, not a nice-to-have - and
this is not a speculative "let's get ahead of a trend" pick: it's an
explicitly tracked gap in this exact codebase (see
`docs/DECISIONS.md`, "2026-09-11 - SearchableSelect ships without
keyboard nav/ARIA, tracked as follow-up"), deliberately deferred out of
the native-`<select>` migration rather than dropped. Every native
`<select>` in the app was replaced by `SearchableSelect` for dark-theme
consistency and type-to-filter (see
`docs/superpowers/specs/2026-09-10-custom-select-dropdown-design.md`),
which means every dropdown in the app - admin catalog forms, order
filters, shipping export, address pickers - lost the keyboard support and
screen-reader semantics a native `<select>` provides for free. This is
that follow-up, closing the gap now that it has its own scoped spec
rather than riding along on a UI-parity migration.

## Goal

`SearchableSelect` (`frontend/src/components/SearchableSelect.jsx`)
becomes operable without a mouse and legible to a screen reader, matching
the ARIA APG "select-only combobox" pattern, while staying visually and
behaviorally identical for existing mouse/touch users.

## Scope

**In scope:**
- Keyboard navigation on the trigger button and, once open, on whichever
  element currently has focus (trigger button when there's no search
  box; the search `<input>` when there is one) - ArrowDown/ArrowUp move a
  highlighted option with wrap-around, Enter selects the highlighted
  option and closes, Escape closes without changing the selection and
  returns focus to the trigger, Home/End jump to the first/last
  *currently visible* (filtered) option.
- Opening the dropdown via keyboard (ArrowDown, ArrowUp, or Enter on the
  closed trigger) pre-highlights the current selection (or the first
  option, if nothing is selected yet).
- ARIA combobox/listbox semantics: `role="combobox"`,
  `aria-haspopup="listbox"`, `aria-expanded` on the trigger button;
  `role="listbox"` on the `<ul>`; `role="option"` + `aria-selected` on
  each `<li>`'s option; `aria-activedescendant` on the combobox element
  (trigger button, or the search input when it's focused) pointing at
  the highlighted option's id.
- Stable per-option DOM ids derived from `option.code`, since
  `aria-activedescendant` needs an id to point at.
- Tests for all of the above, added to the existing
  `SearchableSelect.test.jsx`, following that file's established
  `createRoot`/`act` pattern (no `@testing-library/react` in this repo).

**Explicitly out of scope:**
- Any visual/styling redesign of the component. Colors, spacing, the
  sizer-div width trick, the dropdown's positioning - all unchanged.
- The type-to-filter behavior itself (query state, `SEARCH_THRESHOLD`,
  filtering logic) - untouched, only made reachable/operable via
  keyboard in addition to mouse.
- Typeahead-by-single-keystroke on the closed trigger (the native
  `<select>` behavior of jumping to an option by typing its first
  letter while closed). Not requested, and would conflict with this
  component already having its own explicit search input for long
  lists.
- Any remaining native `<select>` elements in the app - there are none.
  Confirmed via `grep -rn "<select" frontend/src`, which only matches
  comment prose inside `SearchableSelect.jsx` itself describing the
  native element it replaces. The full migration already landed per
  `docs/superpowers/specs/2026-09-10-custom-select-dropdown-design.md`.
- Multi-select, or any change to the `{ code, name }` options contract
  or the `value`/`onChange` prop shape used by every call site (grep
  shows 12 call sites across admin catalog/orders/shipping/stats pages,
  the public Shop/Collection pages, and `AddressFields.jsx`'s
  province/ward pickers - none of their prop usage changes).

## Behavior spec

### State

One new piece of state: `highlightedIndex` (an index into the *filtered*
options array, or `-1` when nothing is highlighted / the dropdown is
closed). Reset to `-1` whenever the dropdown closes (mirrors the existing
`setQuery("")` reset on close, for the same reason: no stale highlight
should silently carry into the next open).

### Opening

- Mouse click on the trigger: unchanged (toggles `open`, clears `query`).
  No highlight is set from a mouse-driven open - a screen reader user who
  clicked will still get correct `aria-activedescendant` once they start
  using arrow keys, matching how the ARIA APG pattern treats "no
  selection reflected yet" as a valid combobox state.
- ArrowDown / ArrowUp / Enter on the *closed* trigger button: opens the
  dropdown and sets `highlightedIndex` to the index (within the
  filtered/full list, which are identical while `query` is empty on a
  fresh open) of the currently selected option, or `0` if nothing is
  selected, or stays `-1` if there are no options at all.

### Navigating while open

Keydown handling is identical whether the focused element is the trigger
button (short lists, no search box) or the search `<input>` (long
lists) - both attach the same handler, since focus moves to the input
the moment it renders (`autoFocus`) and the user must be able to arrow
through results while still typing to refine the filter.

- **ArrowDown**: move `highlightedIndex` to the next option, wrapping
  from the last back to `0`. If nothing is highlighted yet (`-1`), goes
  to `0`.
- **ArrowUp**: move to the previous option, wrapping from `0` to the
  last. If nothing is highlighted yet, goes to the last option.
- **Home**: jump to index `0` of the filtered list.
- **End**: jump to the last index of the filtered list.
- **Enter**: if an option is highlighted, select it (same effect as
  clicking it - calls `onChange`, closes, clears query) and return focus
  to the trigger button. If nothing is highlighted (e.g. the filtered
  list is empty), Enter is a no-op - it does not submit an enclosing
  form or select nothing silently as a "selection."
- **Escape**: closes the dropdown, clears `query`, does **not** call
  `onChange` (selection is left exactly as it was before opening), and
  moves focus back to the trigger button. This matters most when the
  search input has focus, since it's a separate DOM node the browser
  would otherwise leave focus stranded on (or move to `<body>`) once its
  parent list disappears.
- All of the above call `preventDefault()` on the key event only when
  they actually acted (dropdown open, and the key is one this component
  handles) - typing ordinary characters into the search input is left
  entirely alone, and Tab is never intercepted (moving focus out via Tab
  closes the dropdown through the existing click-outside effect's
  target-not-contained check, since a tabbed-to element is outside
  `rootRef`... actually Tab moving within the same `rootRef` subtree
  would not trigger that; see Edge cases below for why this is fine to
  leave as-is).

### ARIA wiring

- Trigger `<button>`: `role="combobox"`, `aria-haspopup="listbox"`,
  `aria-expanded={open}`, `aria-controls` pointing at the listbox's id
  (new, stable, derived once via `useId()` so multiple instances on one
  page - e.g. `ShippingExport.jsx`'s several selects - never collide),
  `aria-activedescendant` set to the highlighted option's DOM id when
  `open && highlightedIndex >= 0`, otherwise omitted/`undefined`.
- Search `<input>` (when rendered): gets the same
  `aria-activedescendant` (it's the actual focused element while
  typing, and a screen reader announces the active descendant of
  whatever currently has focus, not of the button underneath it),
  `role="combobox"` is *not* duplicated onto it - the button remains the
  single combobox owner throughout the interaction per the APG pattern's
  "input-owns-listbox while focused" variant being unnecessary here
  since this widget never lets you type free text that isn't just a
  filter.
- `<ul>`: `role="listbox"`, `id` matching the trigger's
  `aria-controls`.
- Each option `<li>`'s inner `<button>`: `role="option"`,
  `aria-selected={option.code === value}`, `id` built from `option.code`
  (e.g. `` `${listboxId}-option-${option.code}` ``, stable across
  re-renders since `code` is already every call site's stable key).
- Existing `aria-label` on the trigger is kept exactly as-is (it remains
  the combobox's accessible name); nothing about the label mechanism
  changes.
- `data-testid` on the trigger: unchanged.

### Highlight visual affordance

The highlighted option gets a lightweight visual indicator (distinct
from the existing "currently selected" background) so sighted keyboard
users can track it - reusing the existing hover treatment
(`hover:bg-[var(--brand-soft)]`) class on the highlighted item is
sufficient and keeps this a purely additive style change (no new CSS
variables, no visual redesign).

## Edge cases

- **Empty filtered list** (search query matches nothing): `highlightedIndex`
  cannot point at a real option. ArrowDown/ArrowUp/Home/End are no-ops
  while the filtered list is empty (nothing to move to); Enter is a
  no-op (nothing to select); the "no results" `<li>` is not itself
  focusable/selectable and is not given `role="option"` (it doesn't
  represent a selectable value, matching how it's excluded from the
  sizer's width calculation and from `pick()` today).
- **Disabled component**: keyboard handling on the trigger only runs
  when `!disabled`, identical to how the existing `onClick` already
  bails out early. `aria-expanded`/`aria-haspopup` are still present
  (a disabled combobox is still a combobox, just non-interactive) but
  `open` can never become `true` since nothing can trigger it while
  disabled - the existing `disabled` attribute on the `<button>` already
  keeps it out of the tab order's *interactive* state per normal HTML
  semantics, so no extra `tabIndex` handling is needed here.
- **Single-option list**: ArrowDown/ArrowUp/Home/End all resolve to the
  same (only) index - wrapping from index 0 back to index 0. Enter
  selects it. No special-casing needed; the modulo-wrap arithmetic
  already degenerates correctly for length 1.
- **Long list with the search box present** (`options.length >
  SEARCH_THRESHOLD`): keydown handler lives on the search `<input>`
  itself (in addition to the trigger, for the closed-trigger-opens-tab
  case). Typing a character does not move the highlight - only the four
  navigation keys do - so a user can type a partial match and then arrow
  down into the now-shorter filtered list.
- **Short list with no search box** (`options.length <=
  SEARCH_THRESHOLD`): the trigger button itself keeps focus for the
  entire interaction (nothing else to focus), so its own `onKeyDown`
  handles everything; no `autoFocus`-driven focus shift ever happens for
  this case, matching the existing `showSearch` conditional exactly.
- **Query changes the filtered list while an option is highlighted**:
  `highlightedIndex` is an index into the filtered array, not a
  remembered option code. If typing shrinks the filtered list out from
  under the current index, the index is clamped back into range
  (specifically: if the highlighted option's code is no longer present
  in the filtered results, fall back to `0` when the filtered list is
  non-empty, or `-1` when it's empty) rather than silently pointing at
  the wrong option or going out of bounds.
- **Escape when the dropdown is already closed**: no listener is
  attached to the closed trigger for Escape (only Down/Up/Enter open
  it), so this is inherently a no-op - nothing to revert.
- **Tab / click-outside while open**: unchanged existing behavior
  (click-outside effect closes and clears query). Tabbing away from the
  search input while the dropdown is open is left exactly as today - it
  was not accessible before this change either, and reproducing full
  APG focus-trap semantics for that transition is a larger change than
  this scoped follow-up covers; noted as a known remaining gap in the
  ARIA APG sense, not a regression this change introduces.

## Testing approach

Extend `frontend/src/components/SearchableSelect.test.jsx` in place,
matching its existing style exactly: raw `createRoot`/`act`, a
`dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))`
helper (mirroring the existing `click()`/`type()` helpers), no new test
infra or dependency.

New coverage:
- ArrowDown moves the highlight forward through filtered options;
  ArrowUp moves it backward; both wrap at the ends.
- Enter on a highlighted option calls `onChange` with that option's code
  and closes the dropdown (mirrors the existing click-to-pick
  assertion style).
- Escape closes the dropdown without calling `onChange`, and moves
  `document.activeElement` back to the trigger button.
- Home/End jump to the first/last option of the *filtered* set (tested
  with the long-list + a typed query, so filtered != full options).
- Opening via ArrowDown on the closed trigger highlights the currently
  selected option, not index 0, when a value is already selected; falls
  back to index 0 when nothing is selected.
- ARIA attributes: `role="combobox"` and `aria-haspopup="listbox"`
  present at all times on the trigger; `aria-expanded` flips
  `"false"`/`"true"` with `open`; `role="listbox"` on the `<ul>` once
  open; each rendered option has `role="option"` and correct
  `aria-selected`; `aria-activedescendant` on the trigger (short-list
  case) or the search input (long-list case) matches the highlighted
  option's `id` and is absent/empty when nothing is highlighted.
- Keyboard nav on the search input specifically (long-list case):
  arrow/Enter/Escape work identically when focus is on the `<input>`,
  not just the button - regression-guards the exact gap called out in
  the task ("don't just handle keys on the button").
- Regression guard: the full pre-existing `SearchableSelect.test.jsx`
  suite (search threshold, stable width, query reset) keeps passing
  unmodified, and the full frontend suite (597+ tests as of this
  writing) is run at the end to catch any of the 12 call sites breaking
  from an unintended prop/behavior change.
