# Custom Select Dropdown Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all 20 remaining native `<select>` elements (across 10 files) with the existing `SearchableSelect` component, so every dropdown renders app-themed everywhere instead of falling back to OS-native popup styling that ignores the site's dark theme on Windows.

**Architecture:** `SearchableSelect.jsx` moves from `frontend/src/components/shop/` to `frontend/src/components/` (shared location) and gains two small additions: a search-input threshold (hidden for short option lists) and an optional `dataTestId` prop (for the handful of call sites that need reliable test targeting among multiple dropdowns on one page). Every other file swaps its native `<select>`/`<option>` block for a `SearchableSelect` with an equivalent `options` array - same `value`/state, same choices, only the popup rendering changes.

**Tech Stack:** React, existing `SearchableSelect` component pattern (button trigger + conditional list), Vitest + `createRoot`/`act` for tests (matches this codebase's existing test style, not React Testing Library).

## Global Constraints

- `SearchableSelect`'s options shape stays `{ code, name }` (not renamed to `value`/`label`) - it's already generic enough, and renaming would touch the working address-picker call sites for no functional gain.
- The search `<input>` inside the open dropdown only renders when `options.length > 8` (the "SEARCH_THRESHOLD" from the spec).
- `SearchableSelect`'s `onChange` callback receives the raw value directly (not an event) - every `onChange={(e) => setX(e.target.value)}` site becomes `onChange={setX}`.
- No behavior change to what any dropdown does - same options, same selected value, same filtering/sorting logic downstream. Only the popup's rendering technology changes.
- Follow existing repo style: plain hyphens (` - `), never em dashes, in all comments/messages.
- This codebase's component tests use `createRoot`/`act` + manual DOM queries (not React Testing Library) - match that pattern in any new/changed test code.

---

### Task 1: Move and extend SearchableSelect

**Files:**
- Modify (move): `frontend/src/components/shop/SearchableSelect.jsx` → `frontend/src/components/SearchableSelect.jsx`
- Modify: `frontend/src/components/shop/AddressFields.jsx:4` (import path)
- Test: `frontend/src/components/SearchableSelect.test.jsx` (new)

**Interfaces:**
- Produces: `SearchableSelect({ value, onChange, options, placeholder, disabled, label, dataTestId })` - default export. `options` is `[{ code, name }, ...]`. Search input renders only when `options.length > 8`. `dataTestId` (optional) sets `data-testid` on the trigger `<button>`.

- [ ] **Step 1: Move the file**

```bash
git mv frontend/src/components/shop/SearchableSelect.jsx frontend/src/components/SearchableSelect.jsx
```

- [ ] **Step 2: Update AddressFields.jsx's import**

In `frontend/src/components/shop/AddressFields.jsx`, find (line 4):

```javascript
import SearchableSelect from "./SearchableSelect"
```

Replace with:

```javascript
import SearchableSelect from "../SearchableSelect"
```

- [ ] **Step 3: Write the failing test for the search threshold**

Create `frontend/src/components/SearchableSelect.test.jsx`:

```javascript
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/SearchableSelect.test.jsx`

Expected: FAIL - the search input always renders today regardless of option count, and there's no `dataTestId` prop yet (that assertion also fails).

- [ ] **Step 5: Implement the search threshold and dataTestId prop**

In `frontend/src/components/SearchableSelect.jsx`, find:

```javascript
export default function SearchableSelect({ value, onChange, options, placeholder, disabled, label }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef(null)
```

Replace with:

```javascript
// A short list (sort order, a yes/no filter, ~5 status values) doesn't need
// type-to-filter - showing a search box on every dropdown regardless of size
// slows down quick picks on admin pages used constantly during a workday.
const SEARCH_THRESHOLD = 8

export default function SearchableSelect({ value, onChange, options, placeholder, disabled, label, dataTestId }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef(null)
  const showSearch = options.length > SEARCH_THRESHOLD
```

Find:

```javascript
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-label={label || placeholder}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent text-left flex items-center justify-between gap-2 disabled:opacity-50"
      >
```

Replace with:

```javascript
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-label={label || placeholder}
        data-testid={dataTestId}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent text-left flex items-center justify-between gap-2 disabled:opacity-50"
      >
```

Find:

```javascript
      {open && (
        <div className="absolute z-20 w-full mt-1 rounded-lg border border-[var(--border-brand)] bg-[var(--surface-card)] shadow-lg overflow-hidden">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("checkoutSearchOption")}
            className="w-full px-3 py-2 border-b border-[var(--border-brand)] bg-transparent text-sm outline-none"
          />
          <ul className="max-h-56 overflow-y-auto">
```

Replace with:

```javascript
      {open && (
        <div className="absolute z-20 w-full mt-1 rounded-lg border border-[var(--border-brand)] bg-[var(--surface-card)] shadow-lg overflow-hidden">
          {showSearch && (
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("checkoutSearchOption")}
              className="w-full px-3 py-2 border-b border-[var(--border-brand)] bg-transparent text-sm outline-none"
            />
          )}
          <ul className="max-h-56 overflow-y-auto">
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/SearchableSelect.test.jsx`

Expected: PASS (4 tests)

- [ ] **Step 7: Run AddressFields tests to confirm the move didn't break anything**

Run: `cd frontend && npx vitest run src/components/shop/AddressFields.test.jsx`

Expected: PASS (all existing tests, unchanged - provinces (63 options) still exceed the 8-item threshold so the search box still renders there exactly as before)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/SearchableSelect.jsx frontend/src/components/shop/SearchableSelect.jsx frontend/src/components/shop/AddressFields.jsx frontend/src/components/SearchableSelect.test.jsx
git commit -m "feat(ui): move SearchableSelect to shared location, add search threshold + dataTestId

Short option lists (≤8 items) no longer show an unnecessary search
box - only genuinely long lists (provinces, wards) still do. Also
adds an optional dataTestId prop for pages with multiple dropdowns
that need reliable test targeting. Moved out of components/shop/
since upcoming call sites span admin pages and top-level pages too."
```

---

### Task 2: Migrate Shop.jsx

**Files:**
- Modify: `frontend/src/pages/Shop.jsx:1-89`

**Interfaces:**
- Consumes: `SearchableSelect` from Task 1 (`frontend/src/components/SearchableSelect.jsx`).

- [ ] **Step 1: Add the import**

Find (line 1-7):

```javascript
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { fetchCollections } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import ShopHeader from "../components/shop/ShopHeader"
import ShopFooter from "../components/shop/ShopFooter"
import { formatVnDateTime } from "../utils/orderDeadline"
```

Replace with:

```javascript
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { fetchCollections } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import ShopHeader from "../components/shop/ShopHeader"
import ShopFooter from "../components/shop/ShopFooter"
import SearchableSelect from "../components/SearchableSelect"
import { formatVnDateTime } from "../utils/orderDeadline"
```

- [ ] **Step 2: Replace both selects**

Find (line 69-90):

```javascript
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-[var(--border-brand)] bg-transparent"
            >
              <option value="">{t("shopFilterAllStatus")}</option>
              <option value="active">{t("shopFilterActive")}</option>
              <option value="closed">{t("shopFilterEnded")}</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-[var(--border-brand)] bg-transparent"
            >
              <option value="default">{t("shopSortDefault")}</option>
              <option value="name_asc">{t("shopSortNameAsc")}</option>
              <option value="name_desc">{t("shopSortNameDesc")}</option>
              <option value="newest">{t("shopSortNewest")}</option>
              <option value="oldest">{t("shopSortOldest")}</option>
            </select>
          </div>
```

Replace with:

```javascript
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
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
            <SearchableSelect
              value={sortBy}
              onChange={setSortBy}
              options={[
                { code: "default", name: t("shopSortDefault") },
                { code: "name_asc", name: t("shopSortNameAsc") },
                { code: "name_desc", name: t("shopSortNameDesc") },
                { code: "newest", name: t("shopSortNewest") },
                { code: "oldest", name: t("shopSortOldest") },
              ]}
              placeholder={t("shopSortDefault")}
            />
          </div>
```

- [ ] **Step 3: Run Shop.test.jsx**

Run: `cd frontend && npx vitest run src/pages/Shop.test.jsx`

Expected: PASS - no test in this file drives the status/sort dropdowns via `<select>` value-setting (confirmed via grep before writing this plan), so no test code changes needed here. If this run surfaces a failure the grep missed, read the failing assertion and update it to the SearchableSelect interaction pattern from Task 4/Task 9 below (click the trigger button, then click the matching `li button`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Shop.jsx
git commit -m "feat(ui): migrate Shop.jsx status/sort filters to SearchableSelect"
```

---

### Task 3: Migrate Collection.jsx

**Files:**
- Modify: `frontend/src/pages/Collection.jsx:1-189`

**Interfaces:**
- Consumes: `SearchableSelect` from Task 1.

- [ ] **Step 1: Add the import**

Find (line 1-10):

```javascript
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { fetchCollection } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import { renderMarkdown } from "../utils/markdown"
import ProductCard, { isProductSoldOut } from "../components/shop/ProductCard"
import ShopHeader from "../components/shop/ShopHeader"
import ShopFooter from "../components/shop/ShopFooter"
import FitTitle from "../components/shop/FitTitle"
import { formatVnDateTime } from "../utils/orderDeadline"
```

Replace with:

```javascript
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { fetchCollection } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import { renderMarkdown } from "../utils/markdown"
import ProductCard, { isProductSoldOut } from "../components/shop/ProductCard"
import ShopHeader from "../components/shop/ShopHeader"
import ShopFooter from "../components/shop/ShopFooter"
import FitTitle from "../components/shop/FitTitle"
import SearchableSelect from "../components/SearchableSelect"
import { formatVnDateTime } from "../utils/orderDeadline"
```

- [ ] **Step 2: Replace both selects**

Find (line 166-187):

```javascript
              <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                <select
                  value={stockFilter}
                  onChange={(e) => setStockFilter(e.target.value)}
                  className="px-2 py-1.5 rounded-lg border border-[var(--border-brand)] bg-transparent"
                >
                  <option value="">{t("shopFilterAllStock")}</option>
                  <option value="in_stock">{t("shopFilterInStock")}</option>
                  <option value="sold_out">{t("shopFilterSoldOut")}</option>
                </select>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-2 py-1.5 rounded-lg border border-[var(--border-brand)] bg-transparent"
                >
                  <option value="default">{t("shopSortDefault")}</option>
                  <option value="name_asc">{t("shopSortNameAsc")}</option>
                  <option value="name_desc">{t("shopSortNameDesc")}</option>
                  <option value="price_asc">{t("shopSortPriceAsc")}</option>
                  <option value="price_desc">{t("shopSortPriceDesc")}</option>
                </select>
              </div>
```

Replace with:

```javascript
              <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                <SearchableSelect
                  value={stockFilter}
                  onChange={setStockFilter}
                  options={[
                    { code: "", name: t("shopFilterAllStock") },
                    { code: "in_stock", name: t("shopFilterInStock") },
                    { code: "sold_out", name: t("shopFilterSoldOut") },
                  ]}
                  placeholder={t("shopFilterAllStock")}
                />
                <SearchableSelect
                  value={sortBy}
                  onChange={setSortBy}
                  options={[
                    { code: "default", name: t("shopSortDefault") },
                    { code: "name_asc", name: t("shopSortNameAsc") },
                    { code: "name_desc", name: t("shopSortNameDesc") },
                    { code: "price_asc", name: t("shopSortPriceAsc") },
                    { code: "price_desc", name: t("shopSortPriceDesc") },
                  ]}
                  placeholder={t("shopSortDefault")}
                />
              </div>
```

- [ ] **Step 3: Run Collection.test.jsx**

Run: `cd frontend && npx vitest run src/pages/Collection.test.jsx`

Expected: PASS - no test drives these dropdowns via `<select>` value-setting (confirmed via grep). If this run surfaces a failure, update the assertion to the click-trigger-then-click-option pattern.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Collection.jsx
git commit -m "feat(ui): migrate Collection.jsx stock/sort filters to SearchableSelect"
```

---

### Task 4: Migrate AdminOrders.jsx

**Files:**
- Modify: `frontend/src/components/AdminOrders.jsx:1-256`
- Test: `frontend/src/components/AdminOrders.test.jsx:35-100`

**Interfaces:**
- Consumes: `SearchableSelect` from Task 1.

This is the first task touching a file whose tests actually drive a `<select>` by value - `AdminOrders.test.jsx` grabs both selects positionally via `container.querySelectorAll("select")` and sets `.value` directly. After migration there are no native `<select>` elements, so this test needs rewriting to the click-trigger-then-click-option pattern, targeting each dropdown by its new `aria-label`.

- [ ] **Step 1: Add the import**

Find (line 1-9):

```javascript
import { useEffect, lazy, Suspense, useState } from "react"
import {
  adminListOrders, adminTransitionOrder, adminGetOrder, adminGetOrderPayment, adminFindOrderByToken,
  adminBulkCancelOrders, adminBulkCompleteOrders, adminListCollections,
} from "../api/shop"
import { formatVnd } from "../utils/money"
import OrderTimeline from "./OrderTimeline"
import StatusBadge from "./StatusBadge"
import { variantForStatus, variantForAction } from "../constants/statusVariant"
```

Replace with:

```javascript
import { useEffect, lazy, Suspense, useState } from "react"
import {
  adminListOrders, adminTransitionOrder, adminGetOrder, adminGetOrderPayment, adminFindOrderByToken,
  adminBulkCancelOrders, adminBulkCompleteOrders, adminListCollections,
} from "../api/shop"
import { formatVnd } from "../utils/money"
import OrderTimeline from "./OrderTimeline"
import StatusBadge from "./StatusBadge"
import SearchableSelect from "./SearchableSelect"
import { variantForStatus, variantForAction } from "../constants/statusVariant"
```

**Confirmed shape** - `STATUSES` (line 20) is a bare string array:

```javascript
const STATUSES = ["", "pending", "confirmed", "shipped", "completed", "cancelled"]
```

- [ ] **Step 2: Replace both selects**

Find (line 240-255):

```javascript
        <label className="flex flex-col text-xs gap-1">
          Trạng thái
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent">
            {STATUSES.map((s) => <option key={s} value={s}>{s ? labelFor(STATUS_LABELS, s) : "Tất cả"}</option>)}
          </select>
        </label>

        <label className="flex flex-col text-xs gap-1">
          Bộ sưu tập
          <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent">
            <option value="">Tất cả</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
```

Replace with:

```javascript
        <label className="flex flex-col text-xs gap-1">
          Trạng thái
          <SearchableSelect
            value={filter}
            onChange={setFilter}
            options={STATUSES.map((s) => ({ code: s, name: s ? labelFor(STATUS_LABELS, s) : "Tất cả" }))}
            placeholder="Tất cả"
            label="Trạng thái"
          />
        </label>

        <label className="flex flex-col text-xs gap-1">
          Bộ sưu tập
          <SearchableSelect
            value={collectionId}
            onChange={setCollectionId}
            options={[{ code: "", name: "Tất cả" }, ...collections.map((c) => ({ code: String(c.id), name: c.title }))]}
            placeholder="Tất cả"
            label="Bộ sưu tập"
          />
        </label>
```

- [ ] **Step 3: Update the failing test**

In `frontend/src/components/AdminOrders.test.jsx`, find (line 79-95):

```javascript
    const [statusSelect, collectionSelect] = container.querySelectorAll("select")
    const [dateFromInput, dateToInput] = container.querySelectorAll('input[type="date"]')

    await act(async () => {
      statusSelect.value = "pending"
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => {
      collectionSelect.value = "7"
      collectionSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => setInputValue(dateFromInput, "2026-08-01"))
    await act(async () => setInputValue(dateToInput, "2026-08-08"))
```

Replace with:

```javascript
    const [dateFromInput, dateToInput] = container.querySelectorAll('input[type="date"]')

    const pickOption = async (label, optionText) => {
      const trigger = container.querySelector(`[aria-label="${label}"]`)
      await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })))
      const optionBtn = [...container.querySelectorAll("li button")].find((b) => b.textContent === optionText)
      await act(async () => optionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    }

    await pickOption("Trạng thái", labelFor(STATUS_LABELS, "pending"))
    await pickOption("Bộ sưu tập", "Fes Drop")
    await act(async () => setInputValue(dateFromInput, "2026-08-01"))
    await act(async () => setInputValue(dateToInput, "2026-08-08"))
```

This test file already imports `STATUS_LABELS`/`labelFor` from `"../admin/orderLabels"` (used elsewhere in the file) - if that import isn't already present at the top of the test file, add it: `import { STATUS_LABELS, labelFor } from "../admin/orderLabels"`. The collection fixture in this test's `beforeEach` is `{ id: 7, title: "Fes Drop" }` (`adminListCollections.mockResolvedValue([{ id: 7, title: "Fes Drop" }])`), so `"Fes Drop"` is the correct visible option text to click.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/AdminOrders.test.jsx`

Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminOrders.jsx frontend/src/components/AdminOrders.test.jsx
git commit -m "feat(ui): migrate AdminOrders.jsx status/collection filters to SearchableSelect"
```

---

### Task 5: Migrate AdminCollections.jsx

**Files:**
- Modify: `frontend/src/components/AdminCollections.jsx:1-231`

**Interfaces:**
- Consumes: `SearchableSelect` from Task 1.

**Note:** this file already defines `STATUSES`/`SORTS` as `{ value, label }`-shaped arrays (not bare strings) - see lines 8-16. Map `value` → `code`, `label` → `name` when building `options`.

- [ ] **Step 1: Add the import**

Find (line 1-6):

```javascript
import { useEffect, useRef, useState } from "react"
import {
  adminListCollections, adminCreateCollection, adminUpdateCollection,
  adminDeleteCollection, adminCopyCollection, adminUploadImage,
} from "../api/shop"
import AdminProducts from "./AdminProducts"
```

Replace with:

```javascript
import { useEffect, useRef, useState } from "react"
import {
  adminListCollections, adminCreateCollection, adminUpdateCollection,
  adminDeleteCollection, adminCopyCollection, adminUploadImage,
} from "../api/shop"
import AdminProducts from "./AdminProducts"
import SearchableSelect from "./SearchableSelect"
```

- [ ] **Step 2: Replace the filter-bar selects**

Find (line 165-179):

```javascript
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          >
            <option value="">Tất cả trạng thái</option>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
```

Replace with:

```javascript
          <SearchableSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={[{ code: "", name: "Tất cả trạng thái" }, ...STATUSES.map((s) => ({ code: s.value, name: s.label }))]}
            placeholder="Tất cả trạng thái"
          />
          <SearchableSelect
            value={sortBy}
            onChange={setSortBy}
            options={SORTS.map((s) => ({ code: s.value, name: s.label }))}
            placeholder={SORTS[0]?.label}
          />
```

- [ ] **Step 3: Replace the create/edit form's status select**

Find (line 225-231):

```javascript
        <select
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          className="w-full mb-3 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        >
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
```

Replace with:

```javascript
        <SearchableSelect
          value={draft.status}
          onChange={(status) => setDraft({ ...draft, status })}
          options={STATUSES.map((s) => ({ code: s.value, name: s.label }))}
          placeholder={STATUSES[0]?.label}
        />
```

- [ ] **Step 4: Run AdminCollections.test.jsx**

Run: `cd frontend && npx vitest run src/components/AdminCollections.test.jsx`

Expected: PASS - no test drives these dropdowns via `<select>` value-setting (confirmed via grep). If a failure surfaces, update it to the click-trigger-then-click-option pattern from Task 4.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminCollections.jsx
git commit -m "feat(ui): migrate AdminCollections.jsx status/sort filters to SearchableSelect"
```

---

### Task 6: Migrate AdminProducts.jsx

**Files:**
- Modify: `frontend/src/components/AdminProducts.jsx:1-345`

**Interfaces:**
- Consumes: `SearchableSelect` from Task 1.

**Note:** this file defines its own `SORTS` array (separate from `AdminCollections.jsx`'s), confirmed `{ value, label }`-shaped:

```javascript
const SORTS = [
  { value: "default", label: "Thứ tự kéo thả" },
  { value: "name_asc", label: "Tên A-Z" },
  { value: "name_desc", label: "Tên Z-A" },
  { value: "price_asc", label: "Giá thấp-cao" },
  { value: "price_desc", label: "Giá cao-thấp" },
]
```

- [ ] **Step 1: Add the import**

Find (line 1-7):

```javascript
import { useCallback, useEffect, useState } from "react"
import {
  adminGetCollection, adminCreateProduct, adminUpdateProduct, adminDeleteProduct, adminUploadImage,
  adminReorderProducts,
} from "../api/shop"
import AdminVariants from "./AdminVariants"
import { formatVnd } from "../utils/money"
```

Replace with:

```javascript
import { useCallback, useEffect, useState } from "react"
import {
  adminGetCollection, adminCreateProduct, adminUpdateProduct, adminDeleteProduct, adminUploadImage,
  adminReorderProducts,
} from "../api/shop"
import AdminVariants from "./AdminVariants"
import SearchableSelect from "./SearchableSelect"
import { formatVnd } from "../utils/money"
```

- [ ] **Step 2: Replace the product-type select**

Find (line 188-198):

```javascript
      {!editingId && (
        <select
          name="product-type"
          value={draft.type}
          onChange={(e) => setDraft({ ...draft, type: e.target.value })}
          className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        >
          <option value="physical">Vật lý</option>
          <option value="digital">Số (digital)</option>
        </select>
      )}
```

Replace with:

```javascript
      {!editingId && (
        <SearchableSelect
          value={draft.type}
          onChange={(type) => setDraft({ ...draft, type })}
          options={[
            { code: "physical", name: "Vật lý" },
            { code: "digital", name: "Số (digital)" },
          ]}
          placeholder="Vật lý"
        />
      )}
```

- [ ] **Step 3: Replace the stock/sort filter selects**

Find (line 330-345):

```javascript
          <select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value)}
            className="px-2 py-1 text-sm rounded-lg border border-[var(--border-brand)] bg-transparent"
          >
            <option value="">Tất cả</option>
            <option value="in_stock">Còn hàng</option>
            <option value="sold_out">Hết hàng</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1 text-sm rounded-lg border border-[var(--border-brand)] bg-transparent"
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
```

Replace with:

```javascript
          <SearchableSelect
            value={stockFilter}
            onChange={setStockFilter}
            options={[
              { code: "", name: "Tất cả" },
              { code: "in_stock", name: "Còn hàng" },
              { code: "sold_out", name: "Hết hàng" },
            ]}
            placeholder="Tất cả"
          />
          <SearchableSelect
            value={sortBy}
            onChange={setSortBy}
            options={SORTS.map((s) => ({ code: s.value, name: s.label }))}
            placeholder={SORTS[0]?.label}
          />
```

- [ ] **Step 4: Run AdminProducts.test.jsx**

Run: `cd frontend && npx vitest run src/components/AdminProducts.test.jsx`

Expected: PASS - no test drives these dropdowns via `<select>` value-setting (confirmed via grep). If a failure surfaces, update it to the click-trigger-then-click-option pattern from Task 4.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminProducts.jsx
git commit -m "feat(ui): migrate AdminProducts.jsx type/stock/sort filters to SearchableSelect"
```

---

### Task 7: Migrate AdminSettings.jsx

**Files:**
- Modify: `frontend/src/components/AdminSettings.jsx:1-937`

**Interfaces:**
- Consumes: `SearchableSelect` from Task 1.

This is the only target file with no dedicated test file - verification is via manual dev-server testing (cannot be performed in this automated environment - note in the report) plus the full-suite regression check.

- [ ] **Step 1: Add the import**

Find (line 1-6):

```javascript
import { useState, useEffect, useRef, useCallback } from "react"
import { api } from "../api/api"
import { uploadImage } from "../api/upload"
import { useDropzone } from "react-dropzone"
import { toLocalizedObj } from "../utils/localize"
import { COLOR_SCHEMES, applyColorScheme } from "../config"
```

Replace with:

```javascript
import { useState, useEffect, useRef, useCallback } from "react"
import { api } from "../api/api"
import { uploadImage } from "../api/upload"
import { useDropzone } from "react-dropzone"
import SearchableSelect from "./SearchableSelect"
import { toLocalizedObj } from "../utils/localize"
import { COLOR_SCHEMES, applyColorScheme } from "../config"
```

- [ ] **Step 2: Replace the contact-link-type select**

Find (line 933):

```javascript
              <select value={item?.type ?? "zalo"} onChange={(e) => updateItem("contact.contactLinks", i, "type", e.target.value)} className={`${inputCls} w-32`}>
                <option value="zalo">Zalo</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="messenger">Messenger</option>
              </select>
```

Replace with:

```javascript
              <div className="w-32">
                <SearchableSelect
                  value={item?.type ?? "zalo"}
                  onChange={(type) => updateItem("contact.contactLinks", i, "type", type)}
                  options={[
                    { code: "zalo", name: "Zalo" },
                    { code: "whatsapp", name: "WhatsApp" },
                    { code: "messenger", name: "Messenger" },
                  ]}
                  placeholder="Zalo"
                />
              </div>
```

(Wrapped in a `w-32` div rather than passing a className prop directly - `SearchableSelect` doesn't accept a `className` override today, and this row is a `flex` container where the original `<select>` relied on `inputCls` plus a fixed `w-32` for sizing; the wrapper div reproduces the same fixed-width layout slot without needing to add a new prop to the shared component for one call site.)

- [ ] **Step 3: Verify manually**

`npm run dev`, log into `/admin` → Settings → Contact, add/edit a contact link, confirm the type picker (Zalo/WhatsApp/Messenger) opens, shows all three options, and selecting one updates the row correctly.

- [ ] **Step 4: Run the full frontend suite**

Run: `cd frontend && npx vitest run`

Expected: no new failures (this file has no dedicated test, so this is the only automated check)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminSettings.jsx
git commit -m "feat(ui): migrate AdminSettings.jsx contact-link-type select to SearchableSelect"
```

---

### Task 8: Migrate ShippingRoster.jsx

**Files:**
- Modify: `frontend/src/components/shipping/ShippingRoster.jsx:1-92`

**Interfaces:**
- Consumes: `SearchableSelect` from Task 1.

- [ ] **Step 1: Add the import**

Read the top of `frontend/src/components/shipping/ShippingRoster.jsx` (its existing imports, lines 1-5) with the Read tool first, then add `import SearchableSelect from "../SearchableSelect"` (this file is two directories deep from `components/`, under `components/shipping/`).

- [ ] **Step 2: Replace the collection select**

Find (line 84-91):

```javascript
          <select
            value={collectionId}
            onChange={(e) => selectCollection(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          >
            <option value="">- Chọn một bộ sưu tập -</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
```

Replace with:

```javascript
          <SearchableSelect
            value={collectionId}
            onChange={selectCollection}
            options={[{ code: "", name: "- Chọn một bộ sưu tập -" }, ...collections.map((c) => ({ code: String(c.id), name: c.title }))]}
            placeholder="- Chọn một bộ sưu tập -"
          />
```

- [ ] **Step 3: Run ShippingRoster.test.jsx**

Run: `cd frontend && npx vitest run src/components/shipping/ShippingRoster.test.jsx`

Expected: PASS - no test drives this dropdown via `<select>` value-setting (confirmed via grep). If a failure surfaces, update it to the click-trigger-then-click-option pattern from Task 4.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/shipping/ShippingRoster.jsx
git commit -m "feat(ui): migrate ShippingRoster.jsx collection filter to SearchableSelect"
```

---

### Task 9: Migrate ShippingExport.jsx

**Files:**
- Modify: `frontend/src/components/shipping/ShippingExport.jsx:1-340`
- Test: `frontend/src/components/shipping/ShippingExport.test.jsx:60-130`

**Interfaces:**
- Consumes: `SearchableSelect` from Task 1, including its `dataTestId` prop.

This file's tests drive its collection-filter select via a generic `container.querySelector("select")` and its two form selects via `data-testid`. All three need `dataTestId` set (for consistent, reliable targeting once no native `<select>` exists to query by tag name), and the test file's `setSelectValue` calls need rewriting to the click-trigger-then-click-option pattern.

- [ ] **Step 1: Add the import**

Read the top of `frontend/src/components/shipping/ShippingExport.jsx` (its existing imports, lines 1-6) with the Read tool first, then add `import SearchableSelect from "../SearchableSelect"`.

- [ ] **Step 2: Replace the collection-filter select**

Find (line 184-191):

```javascript
        <select
          value={collectionId}
          onChange={(e) => selectCollection(e.target.value)}
          className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        >
          <option value="">- Tất cả bộ sưu tập -</option>
          {collections.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
```

Replace with:

```javascript
        <SearchableSelect
          value={collectionId}
          onChange={selectCollection}
          options={[{ code: "", name: "- Tất cả bộ sưu tập -" }, ...collections.map((c) => ({ code: String(c.id), name: c.title }))]}
          placeholder="- Tất cả bộ sưu tập -"
          dataTestId="collection-filter"
        />
```

- [ ] **Step 3: Replace the "Loại hàng hóa" and "Thời gian hẹn lấy" selects**

Find (line 327-339):

```javascript
            <label className="flex flex-col text-xs gap-1">
              Loại hàng hóa
              <select data-testid="loai-hang-hoa" value={loaiHangHoa} onChange={(e) => setLoaiHangHoa(e.target.value)}
                className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent">
                {LOAI_HANG_HOA_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="flex flex-col text-xs gap-1">
              Thời gian hẹn lấy
              <select data-testid="thoi-gian-hen-lay" value={thoiGianHenLay} onChange={(e) => setThoiGianHenLay(e.target.value)}
                className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent">
                {THOI_GIAN_HEN_LAY_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
```

Replace with:

```javascript
            <label className="flex flex-col text-xs gap-1">
              Loại hàng hóa
              <SearchableSelect
                value={loaiHangHoa}
                onChange={setLoaiHangHoa}
                options={LOAI_HANG_HOA_OPTIONS.map((v) => ({ code: v, name: v }))}
                placeholder={LOAI_HANG_HOA_OPTIONS[0]}
                dataTestId="loai-hang-hoa"
              />
            </label>
            <label className="flex flex-col text-xs gap-1">
              Thời gian hẹn lấy
              <SearchableSelect
                value={thoiGianHenLay}
                onChange={setThoiGianHenLay}
                options={THOI_GIAN_HEN_LAY_OPTIONS.map((v) => ({ code: v, name: v }))}
                placeholder={THOI_GIAN_HEN_LAY_OPTIONS[0]}
                dataTestId="thoi-gian-hen-lay"
              />
            </label>
```

- [ ] **Step 4: Update the test file's `setSelectValue` calls**

In `frontend/src/components/shipping/ShippingExport.test.jsx`, find (line 61-65):

```javascript
function setSelectValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new Event("change", { bubbles: true }))
}
```

Replace with:

```javascript
async function pickOption(container, testId, optionText) {
  const trigger = container.querySelector(`[data-testid="${testId}"]`)
  await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })))
  const optionBtn = [...container.querySelectorAll("li button")].find((b) => b.textContent === optionText)
  await act(async () => optionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
}
```

Find (line 72):

```javascript
  await act(async () => setSelectValue(container.querySelector('[data-testid="thoi-gian-hen-lay"]'), "Ngày mai - Cả ngày"))
```

Replace with:

```javascript
  await pickOption(container, "thoi-gian-hen-lay", "Ngày mai - Cả ngày")
```

Find (line 124-127):

```javascript
    const collectionSelect = container.querySelector("select")
    await act(async () => setSelectValue(collectionSelect, "2"))
```

Replace with:

```javascript
    await pickOption(container, "collection-filter", "Drop 2")
```

(The `beforeEach` in this file sets `adminListCollections.mockResolvedValue([{ id: 1, title: "Drop" }, { id: 2, title: "Drop 2" }])` - `"Drop 2"` is the correct visible option text for `id: 2`.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/shipping/ShippingExport.test.jsx`

Expected: PASS (all tests in the file - search for any other `setSelectValue`/`querySelector("select")` usage in this test file beyond the two shown above and apply the same `pickOption` pattern if more exist; the plan's research pass found exactly these two, but re-grep `grep -n "setSelectValue\|querySelector(\"select\")" frontend/src/components/shipping/ShippingExport.test.jsx` before Step 4 to confirm no others were missed)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/shipping/ShippingExport.jsx frontend/src/components/shipping/ShippingExport.test.jsx
git commit -m "feat(ui): migrate ShippingExport.jsx filters to SearchableSelect"
```

---

### Task 10: Migrate StatsDrop.jsx

**Files:**
- Modify: `frontend/src/components/stats/StatsDrop.jsx:1-70`

**Interfaces:**
- Consumes: `SearchableSelect` from Task 1.

- [ ] **Step 1: Add the import**

Find (line 1-4):

```javascript
import { useEffect, useRef, useState } from "react"
import { adminListCollections, adminGetDropStats, adminDownloadDropStatsCsv } from "../../api/shop"
import { formatVnd } from "../../utils/money"
import { STATUS_LABELS } from "../../admin/orderLabels"
```

Replace with:

```javascript
import { useEffect, useRef, useState } from "react"
import { adminListCollections, adminGetDropStats, adminDownloadDropStatsCsv } from "../../api/shop"
import { formatVnd } from "../../utils/money"
import { STATUS_LABELS } from "../../admin/orderLabels"
import SearchableSelect from "../SearchableSelect"
```

- [ ] **Step 2: Replace the collection select**

Find (line 61-70):

```javascript
          <select
            value={collectionId}
            onChange={(e) => { setStats(null); setCollectionId(e.target.value) }}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          >
            <option value="">- Chọn một bộ sưu tập -</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
```

Replace with:

```javascript
          <SearchableSelect
            value={collectionId}
            onChange={(id) => { setStats(null); setCollectionId(id) }}
            options={[{ code: "", name: "- Chọn một bộ sưu tập -" }, ...collections.map((c) => ({ code: String(c.id), name: c.title }))]}
            placeholder="- Chọn một bộ sưu tập -"
          />
```

- [ ] **Step 3: Run StatsDrop.test.jsx**

Run: `cd frontend && npx vitest run src/components/stats/StatsDrop.test.jsx`

Expected: PASS - no test drives this dropdown via `<select>` value-setting (confirmed via grep). If a failure surfaces, update it to the click-trigger-then-click-option pattern from Task 4.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/stats/StatsDrop.jsx
git commit -m "feat(ui): migrate StatsDrop.jsx collection filter to SearchableSelect"
```

---

### Task 11: Migrate StatsRestock.jsx

**Files:**
- Modify: `frontend/src/components/stats/StatsRestock.jsx:1-70`

**Interfaces:**
- Consumes: `SearchableSelect` from Task 1.

- [ ] **Step 1: Add the import**

Find (line 1-2):

```javascript
import { useEffect, useState } from "react"
import { adminListCollections, adminGetRestockStats, adminDownloadRestockStatsCsv } from "../../api/shop"
```

Replace with:

```javascript
import { useEffect, useState } from "react"
import { adminListCollections, adminGetRestockStats, adminDownloadRestockStatsCsv } from "../../api/shop"
import SearchableSelect from "../SearchableSelect"
```

- [ ] **Step 2: Replace the collection select**

Find (line 60-69):

```javascript
          <select
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          >
            <option value="">- Tất cả bộ sưu tập -</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
```

Replace with:

```javascript
          <SearchableSelect
            value={collectionId}
            onChange={setCollectionId}
            options={[{ code: "", name: "- Tất cả bộ sưu tập -" }, ...collections.map((c) => ({ code: String(c.id), name: c.title }))]}
            placeholder="- Tất cả bộ sưu tập -"
          />
```

- [ ] **Step 3: Run StatsRestock.test.jsx**

Run: `cd frontend && npx vitest run src/components/stats/StatsRestock.test.jsx`

Expected: PASS - no test drives this dropdown via `<select>` value-setting (confirmed via grep). If a failure surfaces, update it to the click-trigger-then-click-option pattern from Task 4.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/stats/StatsRestock.jsx
git commit -m "feat(ui): migrate StatsRestock.jsx collection filter to SearchableSelect"
```

---

### Task 12: Full-branch verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend suite**

Run: `cd frontend && npx vitest run`

Expected: PASS, all files (0 regressions across all 10 migrated files plus the moved/extended `SearchableSelect`)

- [ ] **Step 2: Run frontend lint**

Run: `cd frontend && npm run lint`

Expected: no new errors (pre-existing unrelated warnings in other files, e.g. `Portfolio.jsx`, are expected to remain)

- [ ] **Step 3: Confirm no native `<select>` remains outside the address picker's own internals**

Run: `grep -rln "<select" frontend/src | grep -v test`

Expected: no matches at all - `SearchableSelect.jsx` itself never renders a native `<select>` (it's a `<button>`/`<ul>` structure), so once all 10 files are migrated this returns nothing.

- [ ] **Step 4: Manual smoke test**

`npm run dev`, open `/merchandise` (Shop.jsx), `/merchandise/<a-collection-slug>` (Collection.jsx), and `/admin` (Orders, Collections/Products, Settings, Shipping export/roster, Stats drop/restock tabs) - open every migrated dropdown, confirm it opens with app-matching styling (not a stark white/black OS popup), confirm search boxes only appear on genuinely long lists (the collection pickers, if you have several collections; province/ward), and confirm selecting an option actually updates the underlying filter/value. This is the direct regression test for the bug this plan exists to fix - if possible, test on a Windows machine (or force OS dark mode if testing on Windows) to directly confirm the original mismatch is gone.
