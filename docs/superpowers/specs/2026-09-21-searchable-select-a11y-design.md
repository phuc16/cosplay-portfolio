# SearchableSelect Keyboard Navigation + ARIA — Design

## Trend angle

**Tech trend: accessibility/ARIA.** Keyboard navigation and screen-reader
semantics are table stakes for any production web app in 2026, not a
nice-to-have - and this gap is not hypothetical: it was already found and
explicitly deferred (see `docs/DECISIONS.md`, 2026-09-11 entry
"SearchableSelect ships without keyboard nav/ARIA, tracked as follow-up"),
scoped exactly as "Escape-to-close, arrow-key option navigation, and
`aria-expanded`/`role="listbox"`/`role="option"` semantics." This feature
closes that tracked gap.

## Background

`SearchableSelect` (`frontend/src/components/SearchableSelect.jsx`) replaced
every native `<select>` in the app (province/ward pickers, admin sort/status
filters, payment-method-adjacent pickers) for dark-theme styling and
type-to-filter. A native `<select>` gets keyboard operability and
screen-reader semantics for free from the browser; this custom
button+list-in-a-popover replacement currently has neither - a keyboard-only
or screen-reader user cannot open it with Enter/Space-then-arrows, cannot
close it with Escape, and a screen reader announces the trigger as a plain
button with no indication it controls a list of options or which one is
selected.

## Goal

Bring `SearchableSelect` to parity with the ARIA "select-only combobox"
pattern (a button that opens a `listbox` popup - distinct from an editable
combobox, since the trigger itself is never text-editable; only the optional
internal search box is), without changing its visual design, its public
prop API, or any of its existing behavior (search threshold, stable width,
padding/height props).

## Scope

- Trigger button: `role="combobox"`, `aria-haspopup="listbox"`,
  `aria-expanded`, `aria-controls` (pointing at the listbox's `id`),
  `aria-activedescendant` (pointing at the currently-highlighted option's
  `id` while open).
- Listbox: `role="listbox"` + matching `id` on the `<ul>`.
- Each option: `role="option"`, a stable `id`, `aria-selected` reflecting
  whether it's the current `value`.
- Keyboard support while closed, trigger focused: `Enter`/`Space`/`ArrowDown`
  opens the menu.
- Keyboard support while open: `ArrowDown`/`ArrowUp` moves a highlighted
  index (clamped to the filtered list's bounds, no wraparound - matches how
  a native `<select>`'s open listbox behaves in every major browser),
  `Home`/`End` jump to the first/last visible option, `Enter` picks the
  highlighted option, `Escape` closes the menu and returns focus to the
  trigger without changing `value`.
- The highlighted index resets to the current `value`'s position (or `0` if
  the current value isn't in `options`) every time the menu opens, and
  resets to `0` whenever the typed search query changes the filtered list
  (so a stale highlight can never point past the end of a shorter filtered
  list).
- Mouse hover on an option also updates the highlighted index, so keyboard
  and mouse interaction stay visually consistent (only one option is ever
  highlighted at a time).
- Picking an option (by `Enter` or click) returns focus to the trigger
  button, since the popover unmounts and focus would otherwise silently
  fall back to `<body>`.

## Non-goals

- No typeahead-on-trigger (jumping to an option by typing its first letter
  while the trigger itself is focused, distinct from this component's
  existing full-text search box that already exists once the menu is open).
  Out of scope: the existing search-box already covers "find an option by
  typing" once open; adding a second, different typeahead behavior on the
  closed trigger would be a new interaction pattern, not a fix to this
  tracked gap.
- No change to `SEARCH_THRESHOLD`, the stable-width sizer, or any prop.
- No visual redesign - the existing highlight-on-select styling
  (`bg-[var(--brand-soft)]`) is reused for the keyboard-highlighted option
  too, so nothing needs new CSS.

## Implementation approach

All state/logic lives in `SearchableSelect.jsx` itself - this is a
self-contained UI-behavior fix, not a data-model or backend change:

- `activeIndex` (state): index into the *currently filtered* options array
  of the keyboard-highlighted option.
- `useId()` (React 18+/19 hook already available - see `package.json`,
  React 19.2) generates a stable, collision-free id prefix per component
  instance for the listbox and its options, so multiple `SearchableSelect`
  instances on the same page (e.g. two filters side by side) never collide.
- A single `onKeyDown` handler on the component's existing root wrapper
  `<div>` catches keydown events bubbling from either the trigger button or
  the internal search `<input>` (when rendered), so one handler covers both
  interaction states (`showSearch` true/false) without duplicating logic.
- `triggerRef` (new `useRef`) lets `Escape` and "pick via keyboard" return
  focus to the trigger button explicitly - React doesn't do this
  automatically when the focused popover element unmounts.

## Testing approach

Extends the existing `SearchableSelect.test.jsx` (no `@testing-library/react`
in this codebase - raw `createRoot`/`act` + `container.querySelector`/
`dispatchEvent(new KeyboardEvent(...))`, matching the file's established
pattern) with a new `describe("SearchableSelect - keyboard nav + ARIA")`
block:

- Trigger exposes `role="combobox"`, `aria-haspopup="listbox"`,
  `aria-expanded` toggling true/false, `aria-controls` matching the
  listbox's `id`.
- `Enter` on a focused, closed trigger opens the menu.
- `ArrowDown`/`ArrowUp` move `aria-activedescendant` / the highlighted
  option's class between options, clamped at both ends (does not wrap).
- `Enter` while open selects the highlighted option and calls `onChange`
  with its code.
- `Escape` closes the menu without calling `onChange` and returns focus to
  the trigger (`document.activeElement === trigger`).
- Listbox has `role="listbox"`; every option button has `role="option"` and
  `aria-selected` matching whether it's the current value.
- Typing in the search box (long-list case) resets the highlight to the
  first result, and `ArrowDown`/`Enter` after filtering picks from the
  *filtered* list, not the original unfiltered one.

## Edge cases

- Highlighted index out of bounds after filtering (e.g. was on the 5th
  option, search narrows to 2 results) - clamped to `0` on every query
  change rather than left dangling past the end of `filtered`.
- Menu opened with no options (`options.length === 0`, `filtered.length ===
  0`) - `Enter`/`ArrowDown`/`ArrowUp` are no-ops when there's nothing to
  highlight or select (`filtered[activeIndex]` guarded before use).
- `disabled` prop - keyboard handling short-circuits identically to how the
  existing mouse `onClick` already does.
