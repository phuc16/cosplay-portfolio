# Custom Select Dropdown Rollout — Design

## Problem

Native `<select>` dropdown popups are rendered by the OS/browser, not by app
CSS. This site's dark/light theme is controlled by a Tailwind `.dark` class
on `<html>` (`darkMode: "class"` in `tailwind.config.js`), completely
independent of the OS-level color scheme. Because the app never declares a
`color-scheme` CSS property, Chrome/Edge on Windows falls back to the OS's
own dark/light preference for native form controls - so a Windows user with
OS dark mode on sees a native `<select>` popup rendered black-background/
white-text (matching Windows, not the page), regardless of which theme the
page itself is actually in. On macOS this mismatch is far less visible in
practice (confirmed - the reporting user's Mac shows no issue), which is why
it went unnoticed until a Windows screenshot surfaced it.

This exact problem was already solved once, for the checkout address
province/ward pickers: `frontend/src/components/shop/SearchableSelect.jsx`
replaces the native `<select>` with a fully custom, app-styled dropdown.
20 other native `<select>` elements across 10 files never got the same fix.

## Solution

Extend `SearchableSelect` to cover the remaining 20 sites, rather than
building a second component or reaching for the cheaper `color-scheme: light`
CSS-only fix (rejected: the user explicitly wants the fully custom,
themed-everywhere dropdown, not just a native-popup color correction).

### Component change

`SearchableSelect` moves from `frontend/src/components/shop/SearchableSelect.jsx`
to `frontend/src/components/SearchableSelect.jsx` (shared location - the
remaining call sites span both `components/shop/` and top-level `components/`
and `pages/`, so it no longer belongs under the shop-specific folder).

One new behavior: the search `<input>` inside the open dropdown only renders
when `options.length` is above a threshold. Below or at the threshold, the
dropdown opens straight to the option list - a 2-6 item list (sort order,
a yes/no filter, an order-status filter) doesn't need type-to-filter, and
showing a search box on every dropdown regardless of size would slow down
quick picks on admin pages used constantly during a workday.

```jsx
const SEARCH_THRESHOLD = 8

export default function SearchableSelect({ value, onChange, options, placeholder, disabled, label }) {
  // ...existing state/logic unchanged...
  const showSearch = options.length > SEARCH_THRESHOLD
  // ...search <input> only renders when showSearch is true...
}
```

The existing `{ code, name }` options shape is kept as-is - it's generic
enough (a stable value + a display label) that renaming it to `{ value,
label }` would be pure churn across every call site, address-picker
included, for no functional gain.

### Migration pattern

Every target site currently looks like:

```jsx
<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="...">
  <option value="">{t("shopFilterAllStatus")}</option>
  <option value="active">{t("shopFilterActive")}</option>
  <option value="closed">{t("shopFilterEnded")}</option>
</select>
```

and converts mechanically to:

```jsx
<SearchableSelect
  value={statusFilter}
  onChange={setStatusFilter}
  options={[
    { code: "", name: t("shopFilterAllStatus") },
    { code: "active", name: t("shopFilterActive") },
    { code: "closed", name: t("shopFilterEnded") },
  ]}
  placeholder={t("shopFilterAllStatus")}
/>
```

Same `value`/`onChange` contract, same options, same rendered choices - only
the popup rendering changes. `SearchableSelect`'s `onChange` already calls
back with the raw value (not an event), so every `onChange={(e) =>
setX(e.target.value)}` site simplifies to `onChange={setX}`.

### Target sites (20 selects, 10 files)

- `frontend/src/components/AdminSettings.jsx` (1)
- `frontend/src/components/AdminProducts.jsx` (3)
- `frontend/src/components/AdminOrders.jsx` (2)
- `frontend/src/components/AdminCollections.jsx` (3)
- `frontend/src/components/shipping/ShippingRoster.jsx` (1)
- `frontend/src/components/shipping/ShippingExport.jsx` (3)
- `frontend/src/components/stats/StatsDrop.jsx` (1)
- `frontend/src/components/stats/StatsRestock.jsx` (1)
- `frontend/src/pages/Collection.jsx` (2)
- `frontend/src/pages/Shop.jsx` (2)

Each site is an isolated, independently testable swap - no cross-site
dependencies.

### Out of scope

- `frontend/src/components/shop/AddressFields.jsx`'s two `SearchableSelect`
  usages (province/ward) - only their import path changes (component moved),
  no other change; these already exceed the search threshold in practice
  (63 provinces) so they keep showing the search box exactly as today.
- Any native `<select>` inside a third-party or generated markup (none
  found in this survey).
- The buyer-note feature raised in the same conversation turn - tracked
  separately, not part of this spec.

## Testing

`SearchableSelect`'s own existing behavior (open/close, filter, click-select,
click-outside-to-close, disabled state) is unit-tested today only indirectly
through `AddressFields.test.jsx`. This rollout adds direct tests for
`SearchableSelect` itself (the search-threshold behavior specifically -
confirm no search input renders at/under the threshold, confirm it does
above).

9 of the 10 target files already have a dedicated test file
(`AdminProducts.test.jsx`, `AdminOrders.test.jsx`,
`AdminCollections.test.jsx`, `ShippingExport.test.jsx`,
`ShippingRoster.test.jsx`, `StatsDrop.test.jsx`, `StatsRestock.test.jsx`,
`Collection.test.jsx`, `Shop.test.jsx`) - each gets updated to query the new
rendered markup (a button + conditionally-open list) instead of a native
`<select>`/`<option>` structure, verified via the existing full-suite run.
`AdminSettings.jsx` has no dedicated test file today (consistent with the
rest of that component); its single select migrates with no new test,
verified via the full-suite regression check only, matching how every other
change to that file has been handled this session.
