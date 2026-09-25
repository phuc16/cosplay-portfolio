# Shareable Product Cards Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Small, single-PR feature - one branch, a handful of ordered commits.

**Goal:** A buyer looking at a specific product + variant can share a link straight back to that exact item (native share sheet on mobile, copy-to-clipboard on desktop) - the collection page + a query param the detail modal reads on mount, no per-product route, no backend changes.

**Architecture:** A pure helper module (`frontend/src/shop/share.js`) builds the deep-link URL and the `{ title, text }` shared/copied - decoupled from any component so it's directly unit-testable. `ProductCard.jsx`'s existing single-variant detail modal gets a "Share" button that calls these helpers, then `navigator.share` (mobile) or `navigator.clipboard.writeText` + an inline "Link copied!" confirmation (desktop). `Collection.jsx` reads `?product=`/`?variant=` via `useSearchParams()` once at mount and passes a `deepLinkVariantId` prop to the one matching `ProductCard`, which resolves it against its own `variants` array to decide its initial `view` state - reusing the exact same `view` state machine a real click already drives.

**Tech Stack:** React/Vite, react-router-dom v7 (`useSearchParams`), Vitest (raw `createRoot`/`act`, no `@testing-library/react`).

## Global Constraints

- No new npm dependency - `navigator.share`/`navigator.clipboard` only.
- No backend changes - the deep-link param resolves against data the existing collection fetch already returns.
- No per-product route (`docs/DECISIONS.md`'s 2026-08-11 "Cart items link back to their product" constraint still holds).
- Share button only in the variant detail modal, never the bare grid card.
- `variant` query param only appended when the product has more than one variant.
- All buyer-facing strings go through the existing bilingual `t()`/`translations.js` mechanism.
- A deleted product/variant referenced by an old share link must fall back gracefully (plain collection view / the product's default open behavior), never crash or show a broken state.
- Plain hyphens (` - `), never em dashes, in all new code/comments/copy.

---

### Task 1: Pure share-link helpers

**Files:**
- Create: `frontend/src/shop/share.js`
- Create: `frontend/src/shop/share.test.js`

**Interfaces:**
- Produces: `buildShareUrl(collectionSlug, productId, variantId)` → absolute URL string (`variantId` `null`/`undefined` omits `&variant=`). `buildShareText(t, productName, variantLabel, price)` → `{ title, text }`.
- Consumed by: Task 2 (`ProductCard.jsx`).

- [ ] **Step 1: Write `frontend/src/shop/share.js`**

```js
import { formatVnd } from "../utils/money"

/**
 * Deep-link back to one specific product (and its variant, if it has more
 * than one) inside a collection - the closest thing this shop has to a
 * per-product page (see docs/DECISIONS.md's 2026-08-11 "Cart items link
 * back to their product": no per-product route exists by design).
 * Absolute, built from the running page's own origin - the frontend has no
 * SITE_URL-equivalent env var (only the backend reads one, for CORS).
 */
export function buildShareUrl(collectionSlug, productId, variantId) {
  const params = new URLSearchParams({ product: String(productId) })
  if (variantId !== null && variantId !== undefined) {
    params.set("variant", String(variantId))
  }
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  return `${origin}/merchandise/${collectionSlug}?${params.toString()}`
}

/**
 * { title, text } for navigator.share / shown alongside the copied link.
 * productName/variantLabel are buyer-supplied catalog data, never
 * translated; the connecting copy comes from translations.js via t() so it
 * stays bilingual, same convention as every other buyer-facing string.
 */
export function buildShareText(t, productName, variantLabel, price) {
  const product = variantLabel ? `${productName} · ${variantLabel}` : productName
  return {
    title: product,
    text: t("shopShareText", { product, price: formatVnd(price), shop: t("shopTitle") }),
  }
}
```

- [ ] **Step 2: Write `frontend/src/shop/share.test.js`**

```js
import { describe, it, expect } from "vitest"
import { buildShareUrl, buildShareText } from "./share"

describe("buildShareUrl", () => {
  it("includes product but omits variant when variantId is null", () => {
    const url = buildShareUrl("summer-drop", 5, null)
    expect(url).toContain("/merchandise/summer-drop?")
    expect(url).toContain("product=5")
    expect(url).not.toContain("variant=")
  })

  it("includes variant when provided", () => {
    const url = buildShareUrl("summer-drop", 5, 42)
    expect(url).toContain("product=5")
    expect(url).toContain("variant=42")
  })

  it("omits variant when variantId is undefined", () => {
    const url = buildShareUrl("summer-drop", 5)
    expect(url).not.toContain("variant=")
  })

  it("is an absolute URL", () => {
    const url = buildShareUrl("summer-drop", 5, null)
    expect(() => new URL(url)).not.toThrow()
  })
})

describe("buildShareText", () => {
  const t = (key, params = {}) => {
    const templates = {
      shopShareText: "Check out {product} - {price} on {shop}",
      shopTitle: "Merchandise",
    }
    let str = templates[key] ?? key
    Object.entries(params).forEach(([k, v]) => { str = str.replaceAll(`{${k}}`, String(v)) })
    return str
  }

  it("includes the variant label in title and text when given", () => {
    const { title, text } = buildShareText(t, "Poster", "A1", 35000)
    expect(title).toBe("Poster · A1")
    expect(text).toBe("Check out Poster · A1 - 35.000₫ on Merchandise")
  })

  it("omits the variant separator when there is no variant label", () => {
    const { title, text } = buildShareText(t, "Digital Album", "", 99000)
    expect(title).toBe("Digital Album")
    expect(text).toContain("Digital Album -")
    expect(text).not.toContain("·")
  })
})
```

- [ ] **Step 3: Run the new tests to verify they pass**

Run: `cd frontend && npx vitest run src/shop/share.test.js`
Expected: PASS (6/6)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shop/share.js frontend/src/shop/share.test.js
git commit -m "feat(shop): add pure helpers for building a product share link"
```

---

### Task 2: i18n keys

**Files:**
- Modify: `frontend/src/i18n/translations.js`

**Interfaces:**
- Produces: `shopShareButton`, `shopShareLinkCopied`, `shopShareText` in both `en`/`vi` blocks.
- Consumed by: Task 3 (`ProductCard.jsx`).

- [ ] **Step 1: Add keys to the `en` block**, immediately after `shopViewAll`/before `shopQtyDecrease` (same neighborhood as the other variant-modal action strings):

```js
shopViewAll: "View all",
shopShareButton: "Share",
shopShareLinkCopied: "Link copied!",
shopShareText: "Check out {product} - {price} on {shop}",
shopQtyDecrease: "Decrease quantity",
```

- [ ] **Step 2: Add the matching keys to the `vi` block**, same neighborhood:

```js
shopViewAll: "Xem tất cả",
shopShareButton: "Chia sẻ",
shopShareLinkCopied: "Đã sao chép liên kết!",
shopShareText: "Xem {product} - {price} tại {shop}",
shopQtyDecrease: "Giảm số lượng",
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/i18n/translations.js
git commit -m "feat(shop): add bilingual copy for the product share button"
```

---

### Task 3: Share button in `ProductCard.jsx`'s detail modal

**Files:**
- Modify: `frontend/src/components/shop/ProductCard.jsx`
- Modify: `frontend/src/components/shop/ProductCard.test.jsx`

**Interfaces:**
- Consumes: `buildShareUrl`/`buildShareText` (Task 1), `shopShareButton`/`shopShareLinkCopied`/`shopShareText` (Task 2).
- Produces: a "Share" button visible whenever the detail modal (`detail` truthy) is open; no prop/behavior change to the grid or picker views.

- [ ] **Step 1: Write the failing tests**

Add to `ProductCard.test.jsx`, alongside the other `describe` blocks:

```jsx
describe("ProductCard - share", () => {
  const originalShare = navigator.share
  const originalClipboard = navigator.clipboard

  afterEach(() => {
    if (originalShare === undefined) delete navigator.share
    else navigator.share = originalShare
    if (originalClipboard === undefined) delete navigator.clipboard
    else navigator.clipboard = originalClipboard
  })

  it("calls navigator.share with title/text/url when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    navigator.share = share
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    const shareBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Share")
    await act(async () => { shareBtn.click() })

    expect(share).toHaveBeenCalledTimes(1)
    const arg = share.mock.calls[0][0]
    expect(arg.title).toBe("Poster · A1")
    expect(arg.url).toContain("product=1")
    expect(arg.url).toContain("variant=1")
  })

  it("does not throw when the user cancels the native share sheet", async () => {
    navigator.share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"))
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    const shareBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Share")
    await expect(act(async () => { shareBtn.click() })).resolves.not.toThrow()
  })

  it("falls back to clipboard + shows a copied confirmation when navigator.share is unavailable", async () => {
    delete navigator.share
    const writeText = vi.fn().mockResolvedValue(undefined)
    navigator.clipboard = { writeText }
    const { container } = await renderCard()
    await openVariantDetail(container, "A1")

    const shareBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Share")
    await act(async () => { shareBtn.click() })

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain("product=1")
    expect(container.querySelector('[role="dialog"]').textContent).toContain("Link copied!")
  })

  it("omits the variant query param for a single-variant product", async () => {
    delete navigator.share
    const writeText = vi.fn().mockResolvedValue(undefined)
    navigator.clipboard = { writeText }
    const single = baseProduct({ variants: [{ id: 9, label: "Std", stock_qty: null, image_url: null }] })
    const { container } = await renderCard({ product: single })
    const cover = container.querySelector('img[src="https://x/cover.jpg"]')
    await act(async () => { cover.click() })

    const shareBtn = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Share")
    await act(async () => { shareBtn.click() })

    expect(writeText.mock.calls[0][0]).not.toContain("variant=")
  })
})
```

Add `afterEach` and `beforeEach` (if not already imported) to the top-of-file vitest import.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd frontend && npx vitest run src/components/shop/ProductCard.test.jsx -t "ProductCard - share"`
Expected: FAIL - no "Share" button exists yet.

- [ ] **Step 3: Add the Share button + handler to `ProductCard.jsx`**

Add the import at the top:

```js
import { buildShareUrl, buildShareText } from "../../shop/share"
```

Add a `shareCopied` state alongside the existing `qty`/`activeImage` state:

```js
const [shareCopied, setShareCopied] = useState(false)
```

Add the handler, near `commitAdd`/`openPicker`:

```js
// Only meaningful once a specific variant is pinned down - see openDetail.
// A multi-variant product needs `variant` in the link to disambiguate which
// code is being shared; a single-variant product's `product` id alone
// already fully determines the detail view, so the param is omitted.
const handleShare = async () => {
  const shareUrl = buildShareUrl(collectionSlug, product.id, variants.length > 1 ? detail.id : null)
  const { title, text } = buildShareText(t, product.name, detail.label, product.price)
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url: shareUrl })
    } catch {
      // Buyer dismissed the native share sheet - not an error, nothing to show.
    }
    return
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(shareUrl)
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
  }
}
```

Reset `shareCopied` in `openDetail` alongside `qty`/`activeImage` so it never carries over from a previously viewed variant:

```js
const openDetail = (v) => {
  setQty(1)
  setActiveImage(0)
  setShareCopied(false)
  setView(v)
}
```

In the detail modal's header row (the one containing the `<h3>` and the conditional "View all" button), add the Share button next to "View all":

```jsx
<div className="flex items-center gap-2 shrink-0">
  <button type="button" onClick={handleShare} className="text-xs text-[var(--text-link)]">
    {t("shopShareButton")}
  </button>
  {variants.length > 1 && (
    <button
      type="button"
      onClick={() => setView("grid")}
      className="text-xs text-[var(--text-link)]"
    >
      {t("shopViewAll")}
    </button>
  )}
</div>
```

(Replaces the existing bare `{variants.length > 1 && (...)}` block in that row - wrap both buttons in the new `<div>`.)

Add the inline confirmation right after that row (still inside the `<div className="p-4 flex flex-col gap-2">`):

```jsx
{shareCopied && <p className="text-xs opacity-70">{t("shopShareLinkCopied")}</p>}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `cd frontend && npx vitest run src/components/shop/ProductCard.test.jsx`
Expected: PASS, including every pre-existing test in this file (no regression).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shop/ProductCard.jsx frontend/src/components/shop/ProductCard.test.jsx
git commit -m "feat(shop): add a Share button to the product variant detail modal"
```

---

### Task 4: Deep-link auto-open in `Collection.jsx`

**Files:**
- Modify: `frontend/src/components/shop/ProductCard.jsx` (accept `deepLinkVariantId` prop)
- Modify: `frontend/src/pages/Collection.jsx`
- Modify: `frontend/src/pages/Collection.test.jsx`

**Interfaces:**
- Consumes: `useSearchParams()` (react-router-dom, already a dependency).
- Produces: `ProductCard` accepts an optional `deepLinkVariantId` prop (`undefined` = no deep link targets this card, `null` = targets this product with no specific/valid variant, a number = targets that exact variant) that seeds its initial `view` state.

- [ ] **Step 1: Write the failing tests**

Add to `Collection.test.jsx`:

```jsx
describe("Collection - share deep link", () => {
  function twoVariantProduct(over = {}) {
    return baseCollection({
      products: [
        {
          id: 7, name: "Photocard Set", price: 35000, description: null, images: ["https://x/cover.jpg"],
          variants: [
            { id: 71, label: "A1", stock_qty: 5, image_url: "https://x/a1.jpg" },
            { id: 72, label: "B1", stock_qty: 5, image_url: "https://x/b1.jpg" },
          ],
          ...over,
        },
      ],
    })
  }

  async function renderCollectionAt(path) {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <ThemeProvider>
            <LanguageProvider>
              <Routes>
                <Route path="/merchandise/:slug" element={<Collection />} />
              </Routes>
            </LanguageProvider>
          </ThemeProvider>
        </MemoryRouter>
      )
    })
    return container
  }

  it("auto-opens the specific variant's detail view when ?product=&variant= match", async () => {
    fetchCollection.mockResolvedValue(twoVariantProduct())
    const container = await renderCollectionAt("/merchandise/drop?product=7&variant=72")

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toContain("Photocard Set · B1")
  })

  it("opens the single-variant product's detail directly when ?product= matches but has only one variant", async () => {
    fetchCollection.mockResolvedValue(baseCollection())
    const container = await renderCollectionAt("/merchandise/drop?product=1")

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toContain("Card")
  })

  it("opens the full gallery when ?product= matches a multi-variant product with no/invalid variant param", async () => {
    fetchCollection.mockResolvedValue(twoVariantProduct())
    const container = await renderCollectionAt("/merchandise/drop?product=7")

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    const labels = [...dialog.querySelectorAll("span")].map((s) => s.textContent)
    expect(labels).toContain("A1")
    expect(labels).toContain("B1")
  })

  it("falls back to the plain grid, no crash, when ?product= matches no product in the collection", async () => {
    fetchCollection.mockResolvedValue(twoVariantProduct())
    const container = await renderCollectionAt("/merchandise/drop?product=999")

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).toContain("Photocard Set")
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd frontend && npx vitest run src/pages/Collection.test.jsx -t "share deep link"`
Expected: FAIL - the query param is not read yet, nothing auto-opens.

- [ ] **Step 3: Add `deepLinkVariantId` handling to `ProductCard.jsx`**

Change the `view` state's initializer (keep it right after `variants`/`hasVariants` are computed, since the initializer needs `variants`):

```js
const [view, setView] = useState(() => {
  if (deepLinkVariantId === undefined) return null
  if (deepLinkVariantId !== null) {
    const match = variants.find((v) => v.id === deepLinkVariantId)
    if (match) return match
    // Linked variant no longer exists (deleted) - fall through to the
    // product's own default open behavior below, same as deepLinkVariantId === null.
  }
  if (variants.length === 1) return variants[0]
  if (variants.length > 1) return "grid"
  return null
})
```

Add `deepLinkVariantId` to the component's prop list:

```js
export default function ProductCard({ product, collectionSlug, orderable, unavailableLabel, onAdded, deepLinkVariantId }) {
```

- [ ] **Step 4: Read the query param and pass the prop in `Collection.jsx`**

Add the import:

```js
import { Link, useParams, useSearchParams } from "react-router-dom"
```

Inside the component, alongside the other `useState`/`useParams` calls:

```js
const [searchParams] = useSearchParams()
const deepLinkProductId = searchParams.get("product")
const deepLinkVariantParam = searchParams.get("variant")
```

In the `visibleProducts.map(...)` render, add the prop:

```jsx
{visibleProducts.map((p) => (
  <ProductCard
    key={p.id}
    product={p}
    collectionSlug={collection.slug}
    orderable={!closed && !notStartedYet}
    unavailableLabel={unavailableLabel}
    onAdded={handleAdded}
    deepLinkVariantId={
      deepLinkProductId && String(p.id) === deepLinkProductId
        ? (deepLinkVariantParam && Number.isFinite(Number(deepLinkVariantParam)) ? Number(deepLinkVariantParam) : null)
        : undefined
    }
  />
))}
```

- [ ] **Step 5: Run to verify the tests pass**

Run: `cd frontend && npx vitest run src/pages/Collection.test.jsx`
Expected: PASS, including every pre-existing test in this file (no regression).

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/shop/ProductCard.jsx frontend/src/pages/Collection.jsx frontend/src/pages/Collection.test.jsx
git commit -m "feat(shop): auto-open the shared product/variant from a deep-link URL"
```

---

### Task 5: Automated-features log

**Files:**
- Create: `docs/AUTOMATED_FEATURES_LOG.md`

- [ ] **Step 1: Create the log** with the header, the abandoned scroll-reveal entry, and this feature's own entry (see the routine's own instructions for exact content).

- [ ] **Step 2: Commit**

```bash
git add docs/AUTOMATED_FEATURES_LOG.md
git commit -m "docs: add automated-features log with today's abandoned and shipped picks"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run the full frontend suite one more time**

Run: `cd frontend && npm test`
Expected: all pass, report the exact pass/fail counts observed.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feature/auto-shareable-product-cards
```

Open via `mcp__github__create_pull_request` per the routine's instructions.
