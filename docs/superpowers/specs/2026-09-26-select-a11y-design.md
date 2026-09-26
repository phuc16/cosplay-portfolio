# SearchableSelect Keyboard Navigation + ARIA Combobox Semantics — Design

**Tech trend: accessibility**

## Problem

From `docs/DECISIONS.md`, 2026-09-11 entry ("SearchableSelect ships without
keyboard nav/ARIA, tracked as follow-up"):

> Migrating every native `<select>` to the custom `SearchableSelect` (dark-theme
> consistency, type-to-filter for long lists like province/ward) drops the
> keyboard navigation and ARIA combobox/listbox semantics a native `<select>`
> gets for free. Reviewed and explicitly deferred rather than blocking this
> migration on it - the custom component's accessibility deserves its own
> scoped spec/plan rather than being folded into a UI-parity migration. Needs
> a follow-up: Escape-to-close, arrow-key option navigation, and
> `aria-expanded`/`role="listbox"`/`role="option"` semantics on the trigger
> and list.

`SearchableSelect` (`frontend/src/components/SearchableSelect.jsx`) is now the
storefront/admin-wide replacement for every native `<select>` in the app (20
sites across 10 files, per the 2026-09-10 rollout). A native `<select>` is
fully keyboard-operable and exposes correct combobox semantics to assistive
tech for free; this custom replacement is a `<button>` + conditionally
rendered `<ul>`/`<button>` popup with **no keyboard handling at all** beyond
whatever a plain `<button>` gets natively (Enter/Space triggers its `onClick`,
which only toggles `open` - there is no way to move between options, pick one,
or close the popup without a mouse). This is a real, previously-flagged
regression versus the native control it replaces, not a hypothetical gap.

## Solution

Add a small explicit keyboard state machine plus the ARIA attributes the
combobox pattern (WAI-ARIA "select-only combobox with listbox popup")
expects, without changing the component's rendered visual style, external
prop contract, or any existing behavior.

### New state

- `highlightedIndex` (number, `-1` when nothing is highlighted): tracks which
  row of the **filtered** list is currently keyboard-highlighted.
  - Set to `filtered.length ? 0 : -1` at the moment the dropdown opens
    (whether via mouse click on the trigger, or via a keyboard key that opens
    it).
  - Reset the same way whenever the search query changes while open (typing
    changes what "the filtered list" means, so any previously-highlighted
    position could now point at a different or no-longer-existing row).
  - Both resets are done directly in the event handlers that cause the
    transition (the trigger's click/keydown handler, the search input's
    `onChange`) rather than via a `useEffect` keyed on the freshly-computed
    `filtered` array - `filtered` is a plain derived local (not memoized), so
    an effect depending on it would refire every render. Computing the
    post-change filtered list inline at the point of the state change is both
    simpler and avoids that churn.

### Stable ids

`useId()` (available - React `19.2.0`, confirmed in `frontend/package.json`)
generates one stable id per component instance, used for:
- The `<ul>`'s `id` (`aria-controls` target).
- Each rendered option's id: `` `${listboxId}-option-${index}` ``, where
  `index` is the option's position in the **filtered** array, not a hash of
  its `code`. Codes are free-form catalog/status strings (a photocard code
  like `"A-1/2"`, a raw variant id) that aren't guaranteed to be valid as a
  DOM id fragment; index position always is.

### ARIA wiring

Trigger `<button>`:
- `role="combobox"`, `aria-haspopup="listbox"` - static, always present.
- `aria-expanded={open}` - always present, `"true"`/`"false"`.
- `aria-controls={open ? listboxId : undefined}` - only present (and only
  ever points at a real, currently-rendered element) while open, since the
  `<ul>` itself only exists in the DOM when `open` is true; pointing
  `aria-controls` at a nonexistent id while closed would be worse than
  omitting it.
- `aria-activedescendant` - the id of the currently-highlighted option when
  open and something is highlighted; `undefined` otherwise (closed, or the
  filtered list is empty).

`<ul>`: `role="listbox"`, `id={listboxId}`.

Each option `<button>` (kept as the interactive element; the wrapping `<li>`
gets `role="presentation"` so the accessibility tree's listbox→option parent/
child relationship isn't broken by the extra `<li>` layer): `role="option"`,
`id` per above, `aria-selected={o.code === value}`.

### Keyboard state machine

One `onKeyDown` handler, attached to the component's existing outermost
`<div ref={rootRef}>` (not to the trigger button alone) - this is the one DOM
node that's an ancestor of both the trigger button and, when open and
`showSearch` is true, the search `<input>` inside the popup. A native keydown
bubbles up to it regardless of which of those two elements currently has
focus, so a single handler covers both without duplicating logic on two
elements or needing a ref-forwarding dance.

```
handleKeyDown(e):
  if disabled: return

  if not open:
    if e.key in {ArrowDown, ArrowUp, Enter, " "}:
      preventDefault()  # stop a real <button>'s native Enter/Space-activates-click
      open = true
      highlightedIndex = options.length ? 0 : -1
    return

  # open
  switch e.key:
    ArrowDown: preventDefault(); highlightedIndex = clamp(highlightedIndex + 1, 0, filtered.length - 1) or -1 if empty
    ArrowUp:   preventDefault(); highlightedIndex = clamp(highlightedIndex - 1, 0, filtered.length - 1) or -1 if empty
    Home:      preventDefault(); if filtered.length: highlightedIndex = 0
    End:       preventDefault(); if filtered.length: highlightedIndex = filtered.length - 1
    Enter:     preventDefault(); if filtered.length and highlightedIndex valid: pick(filtered[highlightedIndex].code)
    Escape:    preventDefault(); closeAndClear(); focus the trigger button
    Tab:       do nothing (no preventDefault, no case) - let it move focus natively
    default:   do nothing (lets ordinary typing reach the search <input>)
```

No wraparound anywhere (explicitly not asked for, and not how most comboboxes
behave) - `ArrowDown` at the last item, or `ArrowUp` at the first, is a no-op.

`closeAndClear()` is the exact function the existing click-outside
`useEffect` already uses to close the popup and drop the typed query (wrapped
in `useCallback` with an empty dependency array so the click-outside effect's
own dependency array can correctly list it without refiring on every render) -
Escape reuses it rather than duplicating the two `setOpen(false)`/
`setQuery("")` calls a third time.

### What's deliberately unchanged

- The click-outside-to-close `useEffect` - still does its job for mouse users;
  Escape does not rely on it (calls `closeAndClear()` directly), so Escape
  works whether or not a blur/click-outside path would also have fired.
- `pick()`, `showSearch`/`SEARCH_THRESHOLD`, the sizer div, the `padding`/
  `height` props, the component's public prop contract
  (`value, onChange, options, placeholder, disabled, label, dataTestId,
  padding, height`) - zero changes, so every existing call site (10 files)
  keeps working unmodified.
- Mouse click on an option still calls `pick()` directly; it doesn't route
  through `highlightedIndex` at all, so mouse and keyboard interaction paths
  stay independent (no risk of a keyboard change regressing a mouse click or
  vice versa).

## Edge cases (see plan/tests for the concrete assertions)

- `ArrowDown` on the closed trigger opens + highlights index 0.
- `ArrowDown`/`ArrowUp` clamp at the ends, no wraparound.
- `Enter` selects whichever option is highlighted, not always index 0.
- `Escape` closes without mutating `value`/calling `onChange`, and returns
  focus to the trigger.
- Typing resets/re-clamps `highlightedIndex`, including down to `-1` when the
  filtered list becomes empty.
- Zero filtered results: arrow keys/Enter are no-ops, never throw, never call
  `onChange`.
- `aria-expanded` toggles; `aria-controls`/`aria-activedescendant` only exist
  (and only ever point at real, present ids) while open.
- Every option has `role="option"`; the selected one has
  `aria-selected="true"`, the rest `"false"`.
- `disabled` still blocks keyboard activation, mirroring the existing
  disabled-click test.

## Testing approach

Extends `frontend/src/components/SearchableSelect.test.jsx` in place, matching
its existing conventions exactly: raw `createRoot`/`act`/
`container.querySelector`, no `@testing-library/react`. Keyboard events are
simulated with `el.dispatchEvent(new KeyboardEvent("keydown", { key: ...,
bubbles: true }))`, matching the one other place in the frontend suite that
already does this (`frontend/src/pages/GachaKiosk.test.jsx`, its Space-bar
booth-button test). `bubbles: true` matters here specifically because React
19 attaches its delegated listeners on the root container node passed to
`createRoot`, not on each individual element - an event that doesn't bubble
up to that container never reaches the component's `onKeyDown` handler in
this test harness.

All existing tests in the file must keep passing unmodified - none of them
exercise keyboard behavior today, so there's no existing assertion for new
code to contradict.
