# Accessible SearchableSelect (keyboard nav + ARIA) — Design

**Trend angle:** Tech trend — accessibility/ARIA. Basic keyboard operability
and screen-reader semantics for form controls are table stakes for any
storefront in 2026 (WCAG 2.2 is the current baseline auditors check against,
and a checkout flow that can't be operated without a mouse is a real
conversion/compliance risk, not a cosmetic nicety). This isn't a new idea in
this codebase - it's explicitly called out as deferred follow-up work in
`docs/DECISIONS.md`'s 2026-09-11 entry ("SearchableSelect ships without
keyboard nav/ARIA, tracked as follow-up... Needs a follow-up: Escape-to-close,
arrow-key option navigation, and `aria-expanded`/`role="listbox"`/
`role="option"` semantics"). This feature is exactly that follow-up.

## Goal

`frontend/src/components/SearchableSelect.jsx` (used for admin filters,
province/ward pickers, checkout's payment method context, etc. - 12 call
sites) is currently a `<button>` + absolutely-positioned `<div>` with no
keyboard operability beyond Tab-to-focus and click. A keyboard-only or
screen-reader user cannot open it, navigate its options, or close it without
a mouse. Bring it up to the same operability a native `<select>` already
gave for free, without changing its visual design or any call site's props.

## Scope decisions

- **No new props, no call-site changes.** All 12 existing usages keep working
  unchanged - this is purely additive behavior inside the component.
- **Combobox pattern, not native `<select>`.** Rewriting on top of a native
  `<select>` would regain accessibility for free but lose the type-to-filter
  search box this component exists for (province/ward pickers with 100+
  options - see the 2026-08-14 DECISIONS.md entry this component was born
  from). Implement the [WAI-ARIA combobox-with-listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
  instead: `role="combobox"` trigger + `role="listbox"` popup, matching what
  the DECISIONS.md follow-up note already specified.
- **Roving highlight via `aria-activedescendant`, not real DOM focus
  moving into the list.** Keyboard focus stays on the trigger button (when
  no search box is shown) or the search input (when it is); arrow keys move
  a visually/programmatically tracked "active option" index, communicated to
  assistive tech via `aria-activedescendant` pointing at the active
  `role="option"` element's id. This is the standard combobox pattern and
  avoids fighting the existing click-to-select handlers on `<li><button>`.
- **Ids via `useId()`** (React 19, already a dependency) - each instance gets
  a stable, unique id prefix for its listbox and per-option ids, so multiple
  `SearchableSelect` instances on one page (e.g. province + ward side by
  side) never collide.
- **Keys implemented:** `ArrowDown`/`ArrowUp` (move active option, opening
  the list first if closed), `Home`/`End` (jump to first/last visible
  option), `Enter` (commit the active option, closing the list), `Escape`
  (close without changing selection, return focus to the trigger),
  `Tab`/`Shift+Tab` (closes the list, default browser focus movement
  otherwise unmodified - never trapped).
- **Filtering interacts with navigation**: typing in the search box narrows
  `filtered` (existing behavior, unchanged) and resets the active index to
  the first visible option, so arrow keys always operate against what's
  currently visible, never a stale index into a shorter list.
- **No behavior change for mouse users** - click-to-open, click-outside-to-
  close, click-to-pick all work exactly as before; this is additive.

## Implementation

State added: `activeIndex` (number, index into `filtered`, `-1` when
nothing should be highlighted e.g. list just opened with no query and no
prior selection match).

- Opening the list (click or an arrow key while closed) seeds `activeIndex`
  to the index of the currently selected option within `filtered` if
  present, else `0`.
- `filtered` changing (query typed) resets `activeIndex` to `0` if
  `filtered.length > 0`, else `-1`.
- The trigger button gets `role="combobox"`, `aria-expanded={open}`,
  `aria-haspopup="listbox"`, `aria-controls={listboxId}`, and (only when no
  search input is rendered, since focus stays on the button itself in that
  case) `aria-activedescendant={activeOptionId || undefined}`.
- The search `<input>` (when rendered) gets `role="combobox"` semantics
  instead: `aria-expanded`, `aria-controls={listboxId}`,
  `aria-activedescendant`, `aria-autocomplete="list"` - the same
  activedescendant wiring, just living on whichever element currently holds
  real DOM focus.
- The `<ul>` gets `role="listbox"` and `id={listboxId}`.
- Each option `<button>`'s wrapping `<li>` gets `role="option"`,
  `id={optionId(o.code)}`, `aria-selected={o.code === value}`. The visual
  "active" highlight (currently only `o.code === value`) also applies when
  `index === activeIndex`, so sighted keyboard users see where they are.
- `onKeyDown` handler attached to both the trigger button and the search
  input (they're never both interactive at once - one or the other holds
  focus depending on `showSearch`), implementing the key list above.
- Enter with the list closed and focus on the trigger re-opens it (standard
  combobox behavior - matches how a native `<select>` reacts to Enter),
  rather than doing nothing.

## Testing approach

Extend `frontend/src/components/SearchableSelect.test.jsx` (same
`createRoot`/`act`, no `@testing-library/react` - matches every other
component test in this codebase) with a new `describe("SearchableSelect -
keyboard and ARIA")` block:

- Trigger has `role="combobox"`, `aria-haspopup="listbox"`,
  `aria-expanded="false"` when closed, `"true"` once opened.
- `ArrowDown` from the closed trigger opens the list and highlights the
  first option (or the currently selected one, if present further down).
- Repeated `ArrowDown`/`ArrowUp` move the highlighted option without
  wrapping past the ends (clamped, not cyclic - matches native `<select>`'s
  own non-wrapping behavior on most platforms and avoids a surprise jump
  from last back to first).
- `Enter` commits the highlighted option (calls `onChange` with its code)
  and closes the list.
- `Escape` closes the list without calling `onChange` and leaves the
  trigger focused.
- Typing in the search box resets the highlighted option to the first
  filtered match; arrow keys after typing operate on the filtered list.
- Every rendered `<li>` has `role="option"` and a stable `id`; the `<ul>`
  has `role="listbox"`; `aria-activedescendant` on the currently-focused
  element matches the active option's `id`.

## Edge cases

- **Filtering to zero results** while an option was highlighted: highlight
  resets to `-1` (nothing highlighted, matches the existing "no results"
  message already rendered) - `Enter` in this state is a no-op, not a crash
  on `filtered[-1]`.
- **`options` prop changing while open** (a caller updates the list live,
  e.g. ward options after province changes) - `activeIndex` re-clamped
  against the new `filtered.length` on every render rather than trusted
  blindly, so it can never point past the end of a shrunk list.
- **No options at all** (`options = []`): `ArrowDown` opens the list (shows
  the existing "no results" message) but never sets an active index -
  matches the empty-filtered-results case above.
- **Disabled select**: keydown handler bails out immediately when
  `disabled` is true, mirroring the existing click handler's own `if
  (disabled) return` guard.
