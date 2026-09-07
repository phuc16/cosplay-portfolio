# Cart Early Availability Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch a sold-out / closed / hidden cart line on the Cart page itself, before the buyer reaches checkout.

**Architecture:** A new pure-ish async module (`cartAvailability.js`) fetches each distinct collection a cart references (reusing the existing public `fetchCollection` API) and classifies every line into valid or one of three invalid reasons. `Cart.jsx` calls it on mount, shows an inline badge + disables quantity controls per bad line, and disables "Proceed to checkout" while any remain.

**Tech Stack:** React/Vite, Vitest (jsdom + `react-dom/client`).

## Global Constraints

- Validation runs on the Cart page only, once on mount — no polling, no Checkout-page duplication.
- Four states collapse to three detectable ones: 404/not-started/deleted/archived → `"unavailable"`; `status: "closed"` (manual close or real `end_at` expiry) → `"ended"`; found but sold out → `"sold_out"`.
- An invalid line stays visible with a reason badge and disabled quantity controls — never auto-removed.
- Comments terse, single-line, only for non-obvious rationale, matching this codebase's existing style.

---

### Task 1: `cartAvailability.js` module + `isSoldOut` export

**Files:**
- Create: `frontend/src/shop/cartAvailability.js`
- Create: `frontend/src/shop/cartAvailability.test.js`
- Modify: `frontend/src/components/shop/ProductCard.jsx`
- Modify: `frontend/src/components/shop/ProductCard.test.jsx`

**Interfaces:**
- Consumes: `fetchCollection(slug)` from `frontend/src/api/shop.js` (existing, unchanged).
- Produces: `checkCartAvailability(cart)` — async, returns `Map<number, "unavailable" | "ended" | "sold_out">` containing only the cart's invalid `variant_id`s. `isSoldOut(variant)` — now exported from `ProductCard.jsx` alongside the already-exported `isProductSoldOut`.

- [ ] **Step 1: Export `isSoldOut` from `ProductCard.jsx`**

In `frontend/src/components/shop/ProductCard.jsx`, change:

```js
const isSoldOut = (v) => v.stock_qty !== null && v.stock_qty !== undefined && v.stock_qty <= 0
```

to:

```js
export const isSoldOut = (v) => v.stock_qty !== null && v.stock_qty !== undefined && v.stock_qty <= 0
```

No other change in this file — every internal usage of `isSoldOut` already refers to the same identifier, exporting it doesn't change local behavior.

- [ ] **Step 2: Add one test confirming the export**

In `frontend/src/components/shop/ProductCard.test.jsx`, add near the existing `isProductSoldOut` tests:

```js
describe("isSoldOut (per-variant)", () => {
  it("is exported and reports true only for a variant whose stock_qty is a non-null number <= 0", () => {
    expect(isSoldOut({ stock_qty: 0 })).toBe(true)
    expect(isSoldOut({ stock_qty: 5 })).toBe(false)
    expect(isSoldOut({ stock_qty: null })).toBe(false)
    expect(isSoldOut({ stock_qty: undefined })).toBe(false)
  })
})
```

Add `isSoldOut` to this test file's existing import line for `ProductCard.jsx` (it already imports `isProductSoldOut` from the same file — add `isSoldOut` alongside it in the same import statement).

- [ ] **Step 3: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/shop/ProductCard.test.jsx`
Expected: all pass, including every pre-existing test.

- [ ] **Step 4: Write the failing tests for `cartAvailability.js`**

Create `frontend/src/shop/cartAvailability.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest"

const fetchCollection = vi.fn()

vi.mock("../api/shop", () => ({
  fetchCollection: (...args) => fetchCollection(...args),
}))

const { checkCartAvailability } = await import("./cartAvailability")

const physicalCollection = (overrides = {}) => ({
  status: "active",
  products: [
    { type: "physical", variants: [{ id: 1, stock_qty: 5 }, { id: 2, stock_qty: 0 }] },
  ],
  ...overrides,
})

const digitalCollection = (overrides = {}) => ({
  status: "active",
  products: [
    { type: "digital", variant_id: 10, stock_qty: 3 },
  ],
  ...overrides,
})

beforeEach(() => {
  fetchCollection.mockReset()
})

describe("checkCartAvailability", () => {
  it("returns an empty map when every line is valid", async () => {
    fetchCollection.mockResolvedValue(physicalCollection())
    const cart = [{ variant_id: 1, collection_slug: "drop" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.size).toBe(0)
  })

  it("flags a sold-out physical variant", async () => {
    fetchCollection.mockResolvedValue(physicalCollection())
    const cart = [{ variant_id: 2, collection_slug: "drop" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.get(2)).toBe("sold_out")
  })

  it("flags a sold-out digital product via its flattened stock_qty", async () => {
    fetchCollection.mockResolvedValue(digitalCollection({ products: [{ type: "digital", variant_id: 10, stock_qty: 0 }] }))
    const cart = [{ variant_id: 10, collection_slug: "drop" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.get(10)).toBe("sold_out")
  })

  it("does not flag an in-stock digital product", async () => {
    fetchCollection.mockResolvedValue(digitalCollection())
    const cart = [{ variant_id: 10, collection_slug: "drop" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.size).toBe(0)
  })

  it("flags a line as unavailable when the collection fetch fails (404 — hidden, deleted, or not started)", async () => {
    fetchCollection.mockRejectedValue(new Error("not found"))
    const cart = [{ variant_id: 1, collection_slug: "gone" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.get(1)).toBe("unavailable")
  })

  it("flags every line as ended when the collection's status is closed", async () => {
    fetchCollection.mockResolvedValue(physicalCollection({ status: "closed" }))
    const cart = [{ variant_id: 1, collection_slug: "drop" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.get(1)).toBe("ended")
  })

  it("flags a line as unavailable when its variant is no longer in the collection's products (deleted since added to cart)", async () => {
    fetchCollection.mockResolvedValue(physicalCollection())
    const cart = [{ variant_id: 999, collection_slug: "drop" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.get(999)).toBe("unavailable")
  })

  it("never flags a line with no collection_slug", async () => {
    const cart = [{ variant_id: 1, collection_slug: null }]

    const problems = await checkCartAvailability(cart)
    expect(problems.size).toBe(0)
    expect(fetchCollection).not.toHaveBeenCalled()
  })

  it("fetches each distinct collection_slug only once, even with multiple lines from it", async () => {
    fetchCollection.mockResolvedValue(physicalCollection())
    const cart = [
      { variant_id: 1, collection_slug: "drop" },
      { variant_id: 2, collection_slug: "drop" },
    ]

    await checkCartAvailability(cart)
    expect(fetchCollection).toHaveBeenCalledTimes(1)
  })

  it("handles a cart spanning two different collections independently", async () => {
    fetchCollection.mockImplementation((slug) =>
      slug === "a" ? Promise.resolve(physicalCollection()) : Promise.resolve(physicalCollection({ status: "closed" }))
    )
    const cart = [
      { variant_id: 1, collection_slug: "a" },
      { variant_id: 1, collection_slug: "b" },
    ]

    const problems = await checkCartAvailability(cart)
    expect(problems.size).toBe(1)
  })
})
```

- [ ] **Step 5: Run to verify they fail**

Run: `cd frontend && npx vitest run src/shop/cartAvailability.test.js`
Expected: FAIL — `./cartAvailability` doesn't exist yet.

- [ ] **Step 6: Implement `cartAvailability.js`**

Create `frontend/src/shop/cartAvailability.js`:

```js
import { fetchCollection } from "../api/shop"
import { isProductSoldOut, isSoldOut } from "../components/shop/ProductCard"

/** Finds this cart line's product within a fetched collection — digital products are flattened (variant_id lives on the product itself), physical products carry a real variants array. */
function findProduct(collection, variantId) {
  return collection.products.find((p) =>
    p.type === "digital" ? p.variant_id === variantId : p.variants?.some((v) => v.id === variantId)
  )
}

/**
 * Classifies every cart line into valid or one of three reasons a buyer
 * can't actually check out with it — a 404 collapses not-started, deleted,
 * and archived into one bucket since the public API deliberately can't
 * (and shouldn't) tell those apart from the outside.
 */
export async function checkCartAvailability(cart) {
  const slugs = [...new Set(cart.map((c) => c.collection_slug).filter(Boolean))]
  const entries = await Promise.all(
    slugs.map((slug) => fetchCollection(slug).then((data) => [slug, data]).catch(() => [slug, null]))
  )
  const bySlug = new Map(entries)

  const problems = new Map()
  for (const line of cart) {
    if (!line.collection_slug) continue

    const collection = bySlug.get(line.collection_slug)
    if (!collection) {
      problems.set(line.variant_id, "unavailable")
      continue
    }
    if (collection.status === "closed") {
      problems.set(line.variant_id, "ended")
      continue
    }

    const product = findProduct(collection, line.variant_id)
    if (!product) {
      problems.set(line.variant_id, "unavailable")
      continue
    }

    const soldOut = product.type === "digital"
      ? isProductSoldOut(product)
      : isSoldOut(product.variants.find((v) => v.id === line.variant_id))
    if (soldOut) problems.set(line.variant_id, "sold_out")
  }
  return problems
}
```

- [ ] **Step 7: Run to verify they pass**

Run: `cd frontend && npx vitest run src/shop/cartAvailability.test.js`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/shop/cartAvailability.js frontend/src/shop/cartAvailability.test.js frontend/src/components/shop/ProductCard.jsx frontend/src/components/shop/ProductCard.test.jsx
git commit -m "feat(shop): add cartAvailability module for early sold-out/closed/hidden detection"
```

---

### Task 2: Cart.jsx wiring, badges, and checkout gating

**Files:**
- Modify: `frontend/src/pages/Cart.jsx`
- Modify: `frontend/src/pages/Cart.test.jsx`
- Modify: `frontend/src/i18n/translations.js`

**Interfaces:**
- Consumes: `checkCartAvailability(cart)` from Task 1, returning `Map<variant_id, "unavailable" | "ended" | "sold_out">`.

- [ ] **Step 1: Add translation keys**

In `frontend/src/i18n/translations.js`, `en` block near the existing `cart*` keys:

```js
    cartItemSoldOut: "Sold out",
    cartItemEnded: "This drop has ended",
    cartItemUnavailable: "No longer available",
    cartResolveIssues: "Remove unavailable items to continue",
```

`vi` block, same location:

```js
    cartItemSoldOut: "Hết hàng",
    cartItemEnded: "Đợt mở bán đã kết thúc",
    cartItemUnavailable: "Không còn khả dụng",
    cartResolveIssues: "Xóa các sản phẩm không khả dụng để tiếp tục",
```

- [ ] **Step 2: Read the current `Cart.test.jsx` in full**

This file has no `vi.mock("../api/shop", ...)` today (`Cart.jsx` makes no API calls yet). Adding `checkCartAvailability` means every existing test that adds a cart item with a real `collection_slug` will now trigger a `fetchCollection` call on render. Before writing new tests, read every existing `it(...)` block in this file and note, for each one that sets a non-null `collection_slug`, the exact `variant_id`(s) it adds to the cart — you'll need this in Step 4.

- [ ] **Step 3: Write the failing tests for the new behavior**

Add near the top of `Cart.test.jsx`, alongside the existing imports:

```js
const fetchCollection = vi.fn()
vi.mock("../api/shop", () => ({
  fetchCollection: (...args) => fetchCollection(...args),
}))
```

Add `fetchCollection.mockReset()` to the existing `beforeEach`.

Add a new `describe` block:

```js
describe("Cart — early availability validation", () => {
  it("shows a sold-out badge, disables quantity controls, and disables checkout for a sold-out line", async () => {
    fetchCollection.mockResolvedValue({
      status: "active",
      products: [{ type: "physical", variants: [{ id: 20, stock_qty: 0 }] }],
    })
    addToCart({ variant_id: 20, qty: 1, product_name: "Sold Out Item", variant_label: "Std", price: 10000, image_url: null, collection_slug: "drop" })

    const container = await renderCart()
    await act(async () => {})

    expect(container.textContent).toContain("Sold out")
    const checkoutBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Proceed to checkout")
    expect(checkoutBtn.disabled).toBe(true)
  })

  it("shows an ended badge for a closed collection's line", async () => {
    fetchCollection.mockResolvedValue({ status: "closed", products: [] })
    addToCart({ variant_id: 21, qty: 1, product_name: "Ended Drop Item", variant_label: "Std", price: 10000, image_url: null, collection_slug: "ended" })

    const container = await renderCart()
    await act(async () => {})

    expect(container.textContent).toContain("This drop has ended")
  })

  it("shows an unavailable badge when the collection fetch fails", async () => {
    fetchCollection.mockRejectedValue(new Error("404"))
    addToCart({ variant_id: 22, qty: 1, product_name: "Hidden Item", variant_label: "Std", price: 10000, image_url: null, collection_slug: "hidden" })

    const container = await renderCart()
    await act(async () => {})

    expect(container.textContent).toContain("No longer available")
  })

  it("re-enables checkout after removing the only bad line", async () => {
    fetchCollection.mockResolvedValue({
      status: "active",
      products: [{ type: "physical", variants: [{ id: 23, stock_qty: 0 }] }],
    })
    addToCart({ variant_id: 23, qty: 1, product_name: "Sold Out Item", variant_label: "Std", price: 10000, image_url: null, collection_slug: "drop" })

    const container = await renderCart()
    await act(async () => {})

    const removeBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "✕")
    await act(async () => { removeBtn.click() })
    const confirmBtn = [...container.querySelector('[role="dialog"]').querySelectorAll("button")].find((b) => b.textContent === "Remove")
    await act(async () => { confirmBtn.click() })

    expect(readCart()).toHaveLength(0)
  })
})
```

Cross-check the exact button label text (`"Proceed to checkout"`, `"✕"`, `"Remove"`) against this file's own `t(...)`/English-mode rendering convention (the existing "removing an item" test already uses `"Cancel"`/`"Remove"` as literal English strings, confirming the test environment renders `en` translations) before relying on it — adjust only if it's actually different.

- [ ] **Step 4: Fix every pre-existing test's `fetchCollection` mock so they still pass**

For each pre-existing test noted in Step 2 that sets a non-null `collection_slug`, add (or extend) a `fetchCollection.mockResolvedValue(...)` — either as a shared default in `beforeEach` if every one of those tests can share the same shape, or per-test if their `variant_id`s differ — returning `{ status: "active", products: [{ type: "physical", variants: [{ id: <that test's own variant_id>, stock_qty: null }] }] }` (unlimited stock, always valid) so `checkCartAvailability` resolves those lines as fully valid and none of this task's new behavior (badges, disabled controls, disabled checkout) interferes with what those tests actually check. A test whose cart line has `collection_slug: null` needs no mock at all — `checkCartAvailability` skips it entirely (see Task 1's "never flags a line with no collection_slug" test).

- [ ] **Step 5: Run to verify the new tests fail and the pre-existing ones still pass once mocked**

Run: `cd frontend && npx vitest run src/pages/Cart.test.jsx`
Expected: the 4 new tests FAIL (no validation logic exists yet); every pre-existing test passes once its `fetchCollection` mock is in place from Step 4.

- [ ] **Step 6: Implement the `Cart.jsx` changes**

Add to the top of `Cart.jsx`:

```js
import { useEffect, useState } from "react"
import { checkCartAvailability } from "../shop/cartAvailability"
```

(merge with the existing `import { useState } from "react"` line rather than duplicating it).

Inside the component, after the existing `cart`/`pendingRemove` state:

```js
  const [problems, setProblems] = useState(new Map())
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let ignore = false
    checkCartAvailability(cart)
      .then((result) => { if (!ignore) setProblems(result) })
      .finally(() => { if (!ignore) setChecking(false) })
    return () => { ignore = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

Right after the `change`/`confirmRemove` functions, add:

```js
  // Recomputed from the current cart on every render (not pruned on
  // removal) — removing the one bad line already makes it disappear here
  // for free, no re-fetch needed.
  const activeProblems = cart.filter((c) => problems.has(c.variant_id))
  const hasProblems = checking || activeProblems.length > 0

  const problemLabel = (reason) => ({
    sold_out: t("cartItemSoldOut"),
    ended: t("cartItemEnded"),
    unavailable: t("cartItemUnavailable"),
  }[reason])
```

In the cart-line `.map()`, wrap the quantity controls block so they're disabled for a bad line, and add the badge. Replace:

```jsx
      {cart.map((c) => (
        <div key={c.variant_id} className="flex gap-3 items-center py-3 border-b border-[var(--border-brand)]">
          {c.collection_slug ? (
            <Link to={`/merchandise/${c.collection_slug}`} className="flex gap-3 items-center flex-1 min-w-0">
              {c.image_url && <img src={c.image_url} alt="" className="w-16 h-16 object-cover rounded-lg" />}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{c.product_name}</p>
                <p className="text-sm opacity-70">{c.variant_label} · {formatVnd(c.price)}</p>
              </div>
            </Link>
          ) : (
            <>
              {c.image_url && <img src={c.image_url} alt="" className="w-16 h-16 object-cover rounded-lg" />}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{c.product_name}</p>
                <p className="text-sm opacity-70">{c.variant_label} · {formatVnd(c.price)}</p>
              </div>
            </>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => change(c.variant_id, c.qty - 1)}
              disabled={c.qty <= 1}
              aria-label={t("shopQtyDecrease")}
              className="w-8 h-8 rounded-lg border border-[var(--border-brand)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              −
            </button>
            <input
              type="number" min="1" value={c.qty}
              onChange={(e) => change(c.variant_id, Number(e.target.value))}
              aria-label={t("cartQty")}
              className="w-14 text-center px-1 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
            />
            <button
              type="button"
              onClick={() => change(c.variant_id, c.qty + 1)}
              aria-label={t("shopQtyIncrease")}
              className="w-8 h-8 rounded-lg border border-[var(--border-brand)]"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={() => setPendingRemove({ variantId: c.variant_id, item: `${c.product_name} · ${c.variant_label}` })}
            className="px-2 opacity-70"
          >
            ✕
          </button>
        </div>
      ))}
```

with:

```jsx
      {cart.map((c) => {
        const reason = problems.get(c.variant_id)
        return (
        <div key={c.variant_id} className="flex gap-3 items-center py-3 border-b border-[var(--border-brand)]">
          {c.collection_slug ? (
            <Link to={`/merchandise/${c.collection_slug}`} className="flex gap-3 items-center flex-1 min-w-0">
              {c.image_url && <img src={c.image_url} alt="" className="w-16 h-16 object-cover rounded-lg" />}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{c.product_name}</p>
                <p className="text-sm opacity-70">{c.variant_label} · {formatVnd(c.price)}</p>
                {reason && <p className="text-xs text-[var(--text-error)] mt-0.5">{problemLabel(reason)}</p>}
              </div>
            </Link>
          ) : (
            <>
              {c.image_url && <img src={c.image_url} alt="" className="w-16 h-16 object-cover rounded-lg" />}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{c.product_name}</p>
                <p className="text-sm opacity-70">{c.variant_label} · {formatVnd(c.price)}</p>
                {reason && <p className="text-xs text-[var(--text-error)] mt-0.5">{problemLabel(reason)}</p>}
              </div>
            </>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => change(c.variant_id, c.qty - 1)}
              disabled={c.qty <= 1 || Boolean(reason)}
              aria-label={t("shopQtyDecrease")}
              className="w-8 h-8 rounded-lg border border-[var(--border-brand)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              −
            </button>
            <input
              type="number" min="1" value={c.qty}
              onChange={(e) => change(c.variant_id, Number(e.target.value))}
              disabled={Boolean(reason)}
              aria-label={t("cartQty")}
              className="w-14 text-center px-1 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent disabled:opacity-40"
            />
            <button
              type="button"
              onClick={() => change(c.variant_id, c.qty + 1)}
              disabled={Boolean(reason)}
              aria-label={t("shopQtyIncrease")}
              className="w-8 h-8 rounded-lg border border-[var(--border-brand)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={() => setPendingRemove({ variantId: c.variant_id, item: `${c.product_name} · ${c.variant_label}` })}
            className="px-2 opacity-70"
          >
            ✕
          </button>
        </div>
        )
      })}
```

Finally, update the checkout button block:

```jsx
      <div className="mt-6 flex justify-between items-center">
        <div>
          <p className="text-sm opacity-70">{t("cartTotal")}</p>
          <p className="text-xl font-bold text-[var(--brand)]">{formatVnd(cartTotal(cart))}</p>
        </div>
        <div className="text-right">
          <button
            type="button"
            onClick={() => navigate("/checkout")}
            disabled={hasProblems}
            className="px-5 py-2 rounded-xl bg-[var(--brand)] text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("cartCheckout")}
          </button>
          {activeProblems.length > 0 && (
            <p className="text-xs text-[var(--text-error)] mt-1">{t("cartResolveIssues")}</p>
          )}
        </div>
      </div>
```

- [ ] **Step 7: Run to verify all pass**

Run: `cd frontend && npx vitest run src/pages/Cart.test.jsx`
Expected: all pass, including every pre-existing test (now correctly mocked per Step 4).

- [ ] **Step 8: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all pass (known pre-existing `AdminOrders.test.jsx` debounce-timer flake aside).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/Cart.jsx frontend/src/pages/Cart.test.jsx frontend/src/i18n/translations.js
git commit -m "feat(shop): surface sold-out/closed/hidden cart lines before checkout"
```

---

### Task 3: Verification and staging build

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all pass.

- [ ] **Step 2: Build and push to `:staging`**

Run in the background:
```bash
cd /Users/phucth/vibes/cosplay-portfolio && bash scripts/build-push.sh staging > /tmp/build-push-cart-validation.log 2>&1; echo EXIT:$?
```

- [ ] **Step 3: Report to the user**

Confirm the suite passed and the staging push, and remind the user this is frontend-only (no migration, no backend change) — pulling/restarting the frontend container is enough to see it.
