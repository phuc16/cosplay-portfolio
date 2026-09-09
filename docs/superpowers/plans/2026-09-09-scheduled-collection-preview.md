# Scheduled Collection Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A collection with `status: 'active'` but a future `start_at` becomes visible and browsable on the public site (same treatment a `closed` collection already gets), instead of being invisible until the exact moment it goes live - while remaining fully blocked from ordering until `start_at` actually arrives.

**Architecture:** Two backend read paths (`listPublicCollections`, `getPublicCollectionBySlug`) drop their `start_at` visibility filter and instead attach a computed `not_started_yet` boolean, computed in JS (matching the existing `closeExpiredCollections` convention - `new Date()` compared against a DB-fetched Date, not a raw string), so three frontend consumers share one source of truth. The order-creation guard (`createOrder`'s `collectionNotStarted` check) needs no code change - it already independently re-verifies this server-side under a row lock, regardless of what the listing API shows.

**Tech Stack:** Node/Express backend (CommonJS), MySQL via mysql2, Vitest, React frontend.

## Global Constraints

- Every scheduled collection previews automatically - no admin opt-out/toggle.
- The banner/badge shows the exact open date/time, formatted via the existing `formatVnDateTime` helper (`frontend/src/utils/orderDeadline.js`) - do not build a new date formatter.
- `createOrder`'s `collectionNotStarted` guard (`backend/shop/orders/orderRepo.js`) is not modified except for its comment - a passing test already covers this exact scenario (`orderRepo.test.js`: `"rejects an order on a collection whose start_at hasn't arrived yet, even with a valid variant_id in hand"`).
- New field name: `not_started_yet` (boolean), present on both `listPublicCollections()`'s rows and `getPublicCollectionBySlug()`'s return value.
- Repo-wide style convention: comments/prose use plain hyphens (` - `), never em dashes (` — `).

---

### Task 1: Backend - stop hiding not-yet-started collections, add `not_started_yet`

**Files:**
- Modify: `backend/shop/catalogRepo.js`
- Modify: `backend/shop/orders/orderRepo.js` (comment only)
- Test: `backend/tests/catalogRepo.test.js`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `listPublicCollections()` rows and `getPublicCollectionBySlug()`'s return value both carry `not_started_yet: boolean`. `start_at` itself was already present (unstripped by `mapCollection`) - no new field for the raw timestamp. Later tasks (Shop.jsx, Collection.jsx, cartAvailability.js) all key off `not_started_yet` and read `start_at` directly for display.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/catalogRepo.test.js`, inside the existing `describe("listPublicCollections", ...)` block (after the `"flags has_digital_item..."` test, before its closing `})`):

```javascript
  it("includes a collection whose start_at hasn't arrived yet, flagged as not_started_yet", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Upcoming Drop", status: "active", start_at: future })

    const collections = await repo.listPublicCollections()
    const found = collections.find((c) => c.id === cid)
    expect(found).toBeDefined()
    expect(found.not_started_yet).toBe(true)
  })

  it("flags not_started_yet false for a collection that has already started", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Live Drop", status: "active", start_at: past })

    const collections = await repo.listPublicCollections()
    expect(collections.find((c) => c.id === cid).not_started_yet).toBe(false)
  })

  it("flags not_started_yet false for a collection with no start_at at all", async () => {
    const cid = await repo.createCollection({ title: "No Schedule", status: "active" })

    const collections = await repo.listPublicCollections()
    expect(collections.find((c) => c.id === cid).not_started_yet).toBe(false)
  })

  it("still hides a draft collection even with a future start_at - not_started_yet does not override status visibility", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await repo.createCollection({ title: "Draft Upcoming", status: "draft", start_at: future })

    const titles = (await repo.listPublicCollections()).map((c) => c.title)
    expect(titles).not.toContain("Draft Upcoming")
  })
```

Add to `backend/tests/catalogRepo.test.js`, inside the existing `describe("getPublicCollectionBySlug", ...)` block (after the `"returns null for a draft collection"` test):

```javascript
  it("returns a collection whose start_at hasn't arrived yet, flagged as not_started_yet, instead of null", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Upcoming Drop", status: "active", start_at: future })
    const pid = await repo.createProduct({ collection_id: cid, name: "Photocard", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])

    const detail = await repo.getPublicCollectionBySlug((await repo.listPublicCollections()).find((c) => c.id === cid).slug)
    expect(detail).not.toBeNull()
    expect(detail.not_started_yet).toBe(true)
    expect(detail.products).toHaveLength(1)
  })

  it("flags not_started_yet false once start_at has passed", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Live Drop", status: "active", start_at: past })
    const slug = (await repo.listPublicCollections()).find((c) => c.id === cid).slug

    const detail = await repo.getPublicCollectionBySlug(slug)
    expect(detail.not_started_yet).toBe(false)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/catalogRepo.test.js`

Expected: FAIL - the new `listPublicCollections` tests fail because a future-`start_at` collection is currently excluded entirely (`found` is `undefined`); the new `getPublicCollectionBySlug` tests fail because the function currently returns `null` for a not-yet-started collection.

- [ ] **Step 3: Implement**

In `backend/shop/catalogRepo.js`, find `listPublicCollections`:

```javascript
async function listPublicCollections() {
  const [rows] = await db.query(
    `SELECT c.*, COUNT(p.id) AS product_count,
            EXISTS (SELECT 1 FROM products dp WHERE dp.collection_id = c.id AND dp.type = 'digital') AS has_digital_item
       FROM collections c
       LEFT JOIN products p ON p.collection_id = c.id
      WHERE c.status IN (?, ?) AND (c.start_at IS NULL OR c.start_at <= UTC_TIMESTAMP())
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.id ASC`,
    PUBLIC_STATUSES
  )
  const updated = await closeExpiredCollections(rows)
  return updated.map((r) => ({
    ...mapCollection(r), product_count: Number(r.product_count), has_digital_item: Boolean(r.has_digital_item),
  }))
}
```

Replace with:

```javascript
async function listPublicCollections() {
  const [rows] = await db.query(
    `SELECT c.*, COUNT(p.id) AS product_count,
            EXISTS (SELECT 1 FROM products dp WHERE dp.collection_id = c.id AND dp.type = 'digital') AS has_digital_item
       FROM collections c
       LEFT JOIN products p ON p.collection_id = c.id
      WHERE c.status IN (?, ?)
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.id ASC`,
    PUBLIC_STATUSES
  )
  const updated = await closeExpiredCollections(rows)
  // A collection whose start_at hasn't arrived yet is now included (buyers
  // can preview it), flagged here so the frontend can hide ordering - same
  // JS "now" comparison closeExpiredCollections above already uses for
  // end_at, not a UTC_TIMESTAMP() SQL clause, since this is a display flag,
  // not the actual order-time gate (that's createOrder's own independent check).
  const now = new Date()
  return updated.map((r) => ({
    ...mapCollection(r), product_count: Number(r.product_count), has_digital_item: Boolean(r.has_digital_item),
    not_started_yet: Boolean(r.start_at) && new Date(r.start_at) > now,
  }))
}
```

Find `getPublicCollectionBySlug`:

```javascript
async function getPublicCollectionBySlug(slug) {
  const [[collection]] = await db.query(
    "SELECT * FROM collections WHERE slug = ? AND status IN (?, ?) AND (start_at IS NULL OR start_at <= UTC_TIMESTAMP()) LIMIT 1",
    [slug, ...PUBLIC_STATUSES]
  )
  if (!collection) return null
  const [updated] = await closeExpiredCollections([collection])
  const detail = await nestCollectionDetail(updated)
  // delivery_link is only trustworthy once an order is confirmed/shipped/completed
  // (see routes/orders.js and email templates.js) - nestCollectionDetail is shared
  // with the admin-only getCollectionDetailById, which legitimately needs the link,
  // so it is stripped here, on the public path only. stock_qty stays: buyers
  // legitimately need to see stock/sold-out state before ever placing an order.
  return {
    ...detail,
    products: detail.products.map(({ delivery_link, ...rest }) => rest),
  }
}
```

Replace with:

```javascript
async function getPublicCollectionBySlug(slug) {
  const [[collection]] = await db.query(
    "SELECT * FROM collections WHERE slug = ? AND status IN (?, ?) LIMIT 1",
    [slug, ...PUBLIC_STATUSES]
  )
  if (!collection) return null
  const [updated] = await closeExpiredCollections([collection])
  // Same not_started_yet flag as listPublicCollections, computed the same
  // way - see that function's comment for why this is a JS "now" comparison
  // rather than a SQL clause.
  const notStartedYet = Boolean(updated.start_at) && new Date(updated.start_at) > new Date()
  const detail = await nestCollectionDetail(updated)
  // delivery_link is only trustworthy once an order is confirmed/shipped/completed
  // (see routes/orders.js and email templates.js) - nestCollectionDetail is shared
  // with the admin-only getCollectionDetailById, which legitimately needs the link,
  // so it is stripped here, on the public path only. stock_qty stays: buyers
  // legitimately need to see stock/sold-out state before ever placing an order.
  return {
    ...detail,
    not_started_yet: notStartedYet,
    products: detail.products.map(({ delivery_link, ...rest }) => rest),
  }
}
```

In `backend/shop/orders/orderRepo.js`, find this comment (inside `createOrder`'s per-line validation loop):

```javascript
      // A collection whose end_at has already passed is rejected here even
      // if its stored status still says "active" - the real transition to
      // "closed" only happens lazily on a read path (see catalogRepo.js's
      // closeExpiredCollections), which this write path never calls. A
      // collection whose start_at hasn't arrived yet is rejected the same
      // way - catalogRepo hides it from listing/lookup, but a buyer who
      // already has the variant_id (an old cart, a stale page, a crafted
      // request) must not be able to check out before it's actually live.
```

Replace with:

```javascript
      // A collection whose end_at has already passed is rejected here even
      // if its stored status still says "active" - the real transition to
      // "closed" only happens lazily on a read path (see catalogRepo.js's
      // closeExpiredCollections), which this write path never calls. A
      // collection whose start_at hasn't arrived yet is rejected the same
      // way - this check is the primary defense against ordering early, not
      // just cleanup for a stale link: catalogRepo now deliberately shows a
      // not-yet-started collection on the public site as a browsable
      // preview, so its variant_ids are directly visible to anyone browsing,
      // not just someone with an old cart or a crafted request.
```

Do not change the code below this comment (the `collectionNotStarted`/`collectionExpired` check itself) - only the comment.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/catalogRepo.test.js`

Expected: PASS (all tests in the file).

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run`

Expected: PASS, including `tests/orderRepo.test.js`'s existing `"rejects an order on a collection whose start_at hasn't arrived yet, even with a valid variant_id in hand"` test - this confirms the order-creation guard is genuinely unaffected by the visibility change (it never depended on the collection being hidden).

- [ ] **Step 6: Commit**

```bash
cd /Users/phucth/vibes/cosplay-portfolio
git add backend/shop/catalogRepo.js backend/shop/orders/orderRepo.js backend/tests/catalogRepo.test.js
git commit -m "feat(shop): a not-yet-started collection is now publicly visible, flagged not_started_yet"
```

---

### Task 2: Frontend - preview badge + 3-tier sort on the collection list

**Files:**
- Modify: `frontend/src/pages/Shop.jsx`
- Modify: `frontend/src/i18n/translations.js`
- Test: `frontend/src/pages/Shop.test.jsx`

**Interfaces:**
- Consumes: `not_started_yet` (boolean) and `start_at` (ISO string), both from Task 1's backend response, on each collection object `visibleCollections.map((c) => ...)` already iterates.
- Produces: nothing consumed by other tasks - Task 3 and Task 4 read `not_started_yet` from their own API calls, not from this component.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/pages/Shop.test.jsx`, as a new `describe` block (place it after the existing `describe("Shop - digital badge", ...)` block):

```javascript
describe("Shop - not-started preview", () => {
  it("badges a not-yet-started collection with its open date, distinct from the closed overlay", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "upcoming", title: "Upcoming Drop", status: "active", product_count: 2, not_started_yet: true, start_at: "2026-12-25T13:00:00.000Z" },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    expect(container.textContent).toContain("Not started yet")
    expect(container.textContent).not.toContain("This drop has ended")
  })

  it("does not badge a started, active collection", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "live", title: "Live Drop", status: "active", product_count: 2, not_started_yet: false },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    expect(container.textContent).not.toContain("Not started yet")
  })

  it("sorts not-started collections between live and closed ones", async () => {
    fetchCollections.mockResolvedValue([
      { id: 1, slug: "ended", title: "Ended", status: "closed", product_count: 0, not_started_yet: false },
      { id: 2, slug: "live", title: "Live", status: "active", product_count: 1, not_started_yet: false },
      { id: 3, slug: "upcoming", title: "Upcoming", status: "active", product_count: 1, not_started_yet: true, start_at: "2026-12-25T13:00:00.000Z" },
    ])
    axios.get.mockResolvedValue({ data: {} })

    const container = await renderShop()
    await flush()

    const titles = [...container.querySelectorAll("h2")].map((h) => h.textContent)
    expect(titles).toEqual(["Live", "Upcoming", "Ended"])
  })
})
```

This test file already has `fetchCollections`, `axios`, `renderShop`, and `flush` set up (used by the existing `describe("Shop - digital badge", ...)` and `describe("Shop - collection ordering", ...)` blocks) - no new imports/mocks needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/Shop.test.jsx`

Expected: FAIL - the badge tests fail because nothing renders "Not started yet" yet (that translation key doesn't exist); the sort test fails because `not_started_yet` collections aren't given a middle sort tier yet (they'd currently sort as if `status !== "closed"`, i.e. same tier as "Live", so ordering happens to already pass by coincidence of only 2 real tiers existing - verify by reading the actual failure, not by assuming; if it passes prematurely, note this in your report but proceed, since Step 3 still needs the explicit 3-tier logic for correctness once a not-started item and a live item could otherwise tie under the current 2-tier comparator).

- [ ] **Step 3: Implement**

In `frontend/src/i18n/translations.js`, find (English section):

```javascript
    shopDigitalBadge: "Digital",
```

Replace with:

```javascript
    shopDigitalBadge: "Digital",
    shopNotStarted: "Not started yet",
    shopOpensAt: "Opens {date}",
```

Find (Vietnamese section):

```javascript
    shopDigitalBadge: "Sản phẩm số",
```

Replace with:

```javascript
    shopDigitalBadge: "Sản phẩm số",
    shopNotStarted: "Chưa mở bán",
    shopOpensAt: "Mở lúc {date}",
```

In `frontend/src/pages/Shop.jsx`, add the import (alongside the file's other imports at the top):

```javascript
import { formatVnDateTime } from "../utils/orderDeadline"
```

Find the sort function:

```javascript
function sortCollections(list, sortBy) {
  const sorted = [...list]
  if (sortBy === "name_asc") sorted.sort((a, b) => a.title.localeCompare(b.title, "vi"))
  else if (sortBy === "name_desc") sorted.sort((a, b) => b.title.localeCompare(a.title, "vi"))
  else if (sortBy === "newest") sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  else if (sortBy === "oldest") sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  sorted.sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed"))
  return sorted
}
```

Replace with:

```javascript
// Live/orderable first, then a not-yet-started preview, then closed (ended)
// last - an upcoming drop is still worth surfacing prominently (that's the
// whole point of previewing it), so it must not sink to the same tier as
// something that's already over.
function collectionTier(c) {
  if (c.status === "closed") return 2
  if (c.not_started_yet) return 1
  return 0
}

function sortCollections(list, sortBy) {
  const sorted = [...list]
  if (sortBy === "name_asc") sorted.sort((a, b) => a.title.localeCompare(b.title, "vi"))
  else if (sortBy === "name_desc") sorted.sort((a, b) => b.title.localeCompare(a.title, "vi"))
  else if (sortBy === "newest") sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  else if (sortBy === "oldest") sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  sorted.sort((a, b) => collectionTier(a) - collectionTier(b))
  return sorted
}
```

Find the collection card block:

```javascript
            {(c.thumbnail_image || c.cover_image) && (
              <div className="relative">
                <img
                  src={c.thumbnail_image || c.cover_image}
                  alt={c.title}
                  loading="lazy"
                  className="w-full aspect-[4/3] object-cover"
                />
                {c.status === "closed" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-white font-semibold">
                    {t("shopClosed")}
                  </span>
                )}
              </div>
            )}
            <div className="p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-semibold">{c.title}</h2>
                {c.has_digital_item && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--brand-soft)]">
                    {t("shopDigitalBadge")}
                  </span>
                )}
              </div>
              <p className="text-sm opacity-70">{t("productsCount", { n: c.product_count })}</p>
              {c.status === "closed" && (
                <p className="mt-2 text-xs uppercase tracking-wide opacity-60">{t("shopClosed")}</p>
              )}
```

Replace with:

```javascript
            {(c.thumbnail_image || c.cover_image) && (
              <div className="relative">
                <img
                  src={c.thumbnail_image || c.cover_image}
                  alt={c.title}
                  loading="lazy"
                  className="w-full aspect-[4/3] object-cover"
                />
                {c.status === "closed" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-white font-semibold">
                    {t("shopClosed")}
                  </span>
                )}
                {c.status !== "closed" && c.not_started_yet && (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 text-white font-semibold text-center px-2">
                    <span>{t("shopNotStarted")}</span>
                    {c.start_at && (
                      <span className="text-xs font-normal">{t("shopOpensAt", { date: formatVnDateTime(c.start_at) })}</span>
                    )}
                  </span>
                )}
              </div>
            )}
            <div className="p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-semibold">{c.title}</h2>
                {c.has_digital_item && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--brand-soft)]">
                    {t("shopDigitalBadge")}
                  </span>
                )}
              </div>
              <p className="text-sm opacity-70">{t("productsCount", { n: c.product_count })}</p>
              {c.status === "closed" && (
                <p className="mt-2 text-xs uppercase tracking-wide opacity-60">{t("shopClosed")}</p>
              )}
              {c.status !== "closed" && c.not_started_yet && (
                <p className="mt-2 text-xs uppercase tracking-wide opacity-60">{t("shopNotStarted")}</p>
              )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/Shop.test.jsx`

Expected: PASS (all tests in the file, including the pre-existing `"sinks closed (ended) collections after active ones..."` test - confirm it still passes since `collectionTier` for a plain active/closed pair reduces to the same two-tier behavior).

- [ ] **Step 5: Commit**

```bash
cd /Users/phucth/vibes/cosplay-portfolio
git add frontend/src/pages/Shop.jsx frontend/src/i18n/translations.js frontend/src/pages/Shop.test.jsx
git commit -m "feat(shop): badge and sort not-yet-started collections on the merchandise list"
```

---

### Task 3: Frontend - preview banner + disabled ordering on the collection detail page

**Files:**
- Modify: `frontend/src/pages/Collection.jsx`
- Modify: `frontend/src/components/shop/ProductCard.jsx`
- Modify: `frontend/src/i18n/translations.js`
- Test: `frontend/src/pages/Collection.test.jsx`
- Test: `frontend/src/components/shop/ProductCard.test.jsx`

**Interfaces:**
- Consumes: `not_started_yet` (boolean) and `start_at` (ISO string) from Task 1's `getPublicCollectionBySlug` response, read in `Collection.jsx`. The `shopNotStarted`/`shopOpensAt` i18n keys from Task 2 (already added to `translations.js`).
- Produces: `ProductCard` gains a new prop `unavailableLabel` (string or falsy) - when `orderable` is falsy, this text renders instead of the stock label, replacing the previous hardcoded `t("shopClosed")` fallback. `Collection.jsx` computes and passes it. No other component reads this prop (it is not exported/reused elsewhere in this plan).

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/pages/Collection.test.jsx`, as a new `describe` block (place it after any existing describe blocks, at the end of the file):

```javascript
describe("Collection - not-started preview", () => {
  it("shows a not-started banner with the open date, and still renders products", async () => {
    fetchCollection.mockResolvedValue(baseCollection({
      not_started_yet: true, start_at: "2026-12-25T13:00:00.000Z",
    }))

    const container = await renderCollection()

    expect(container.textContent).toContain("Chưa mở bán")
    expect(container.textContent).toContain("Card")
  })

  it("does not show the not-started banner for a started collection", async () => {
    fetchCollection.mockResolvedValue(baseCollection({ not_started_yet: false }))

    const container = await renderCollection()

    expect(container.textContent).not.toContain("Chưa mở bán")
  })

  it("disables add-to-cart for a not-yet-started collection's product", async () => {
    fetchCollection.mockResolvedValue(baseCollection({
      not_started_yet: true, start_at: "2026-12-25T13:00:00.000Z",
    }))

    const container = await renderCollection()
    const cover = container.querySelector("img")
    await act(async () => { cover?.click() })

    const addButton = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Thêm vào giỏ") || b.textContent.includes("Add to cart"))
    if (addButton) expect(addButton.disabled).toBe(true)
  })
})
```

This uses the file's existing `baseCollection`, `renderCollection`, and `fetchCollection` mock - no new setup needed. (Default language is Vietnamese per `LanguageProvider`'s default state - if the file's existing tests assert English strings instead, check `LanguageProvider`'s default and adjust the expected strings to match, but do not change the component's behavior to fit the test.)

Add to `frontend/src/components/shop/ProductCard.test.jsx`, as a new `describe` block:

```javascript
describe("unavailableLabel", () => {
  it("shows the custom unavailableLabel instead of the stock line when not orderable", async () => {
    const { container } = await renderCard({
      product: { id: 1, name: "Card", price: 35000, images: [], variants: [{ id: 1, label: "A1", stock_qty: 5 }] },
      orderable: false,
      unavailableLabel: "Chưa mở bán",
    })
    const cover = container.querySelector("img")
    await act(async () => { cover?.click() })

    expect(container.textContent).toContain("Chưa mở bán")
  })
})
```

Check this file's `renderCard` helper signature (it should already spread extra props onto `<ProductCard ... {...props} />`, matching the pattern the file's other tests already use to override `orderable`) before assuming this call shape - adjust only the test call, not `renderCard` itself, if the existing helper already supports passing arbitrary extra props.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/Collection.test.jsx src/components/shop/ProductCard.test.jsx`

Expected: FAIL - the Collection.jsx tests fail because no not-started banner exists yet; the ProductCard test fails because `unavailableLabel` isn't read yet (falls back to the current hardcoded `t("shopClosed")` text, which won't contain "Chưa mở bán" in Vietnamese - or "Not started yet"/whatever the default language renders - either way, not the passed-in `unavailableLabel` string).

- [ ] **Step 3: Implement**

In `frontend/src/components/shop/ProductCard.jsx`, find the function signature:

```javascript
export default function ProductCard({ product, collectionSlug, orderable, onAdded }) {
```

Replace with:

```javascript
export default function ProductCard({ product, collectionSlug, orderable, unavailableLabel, onAdded }) {
```

Find:

```javascript
              <p className="text-sm opacity-70">{orderable ? stockLabel(detail, t) : t("shopClosed")}</p>
```

Replace with:

```javascript
              <p className="text-sm opacity-70">{orderable ? stockLabel(detail, t) : (unavailableLabel || t("shopClosed"))}</p>
```

(The `t("shopClosed")` fallback stays as the default for any other caller that doesn't pass `unavailableLabel` - none exist in this codebase today outside `Collection.jsx`, but this keeps the prop optional rather than required.)

In `frontend/src/pages/Collection.jsx`, find:

```javascript
  const closed = collection.status === "closed"
```

Replace with:

```javascript
  const closed = collection.status === "closed"
  const notStartedYet = !closed && collection.not_started_yet
  const unavailableLabel = closed ? t("shopClosed") : notStartedYet ? t("shopNotStarted") : null
```

Find:

```javascript
      {closed && (
        <div className="mb-6 p-4 rounded-xl border border-red-500/50 bg-red-500/10">
          <p className="font-semibold text-red-500">{t("shopClosed")}</p>
          <p className="text-sm text-red-500/80">{t("shopClosedNote")}</p>
        </div>
      )}
```

Replace with:

```javascript
      {closed && (
        <div className="mb-6 p-4 rounded-xl border border-red-500/50 bg-red-500/10">
          <p className="font-semibold text-red-500">{t("shopClosed")}</p>
          <p className="text-sm text-red-500/80">{t("shopClosedNote")}</p>
        </div>
      )}

      {notStartedYet && (
        <div className="mb-6 p-4 rounded-xl border border-[var(--border-brand)] opacity-80">
          <p className="font-semibold">{t("shopNotStarted")}</p>
          {collection.start_at && (
            <p className="text-sm">{t("shopOpensAt", { date: formatVnDateTime(collection.start_at) })}</p>
          )}
        </div>
      )}
```

Add the import (alongside the file's other imports at the top, if not already present from a prior task - check first, since Task 2 added the same import to `Shop.jsx`, a different file, so this file needs its own import statement):

```javascript
import { formatVnDateTime } from "../utils/orderDeadline"
```

Find:

```javascript
                  orderable={!closed}
```

Replace with:

```javascript
                  orderable={!closed && !notStartedYet}
                  unavailableLabel={unavailableLabel}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/Collection.test.jsx src/components/shop/ProductCard.test.jsx`

Expected: PASS (all tests in both files).

- [ ] **Step 5: Commit**

```bash
cd /Users/phucth/vibes/cosplay-portfolio
git add frontend/src/pages/Collection.jsx frontend/src/components/shop/ProductCard.jsx frontend/src/i18n/translations.js frontend/src/pages/Collection.test.jsx frontend/src/components/shop/ProductCard.test.jsx
git commit -m "feat(shop): show a not-started banner and disable ordering on the collection detail page"
```

---

### Task 4: Frontend - cart-availability check gains a real "not_started" reason

**Files:**
- Modify: `frontend/src/shop/cartAvailability.js`
- Modify: `frontend/src/pages/Cart.jsx`
- Modify: `frontend/src/i18n/translations.js`
- Test: `frontend/src/shop/cartAvailability.test.js`
- Test: `frontend/src/pages/Cart.test.jsx`

**Interfaces:**
- Consumes: `not_started_yet` on the collection object `fetchCollection(slug)` resolves to (same shape Task 1's `getPublicCollectionBySlug` now returns - `cartAvailability.js` already calls this function, unchanged call site).
- Produces: `checkCartAvailability(cart)`'s returned `Map` can now contain the reason string `"not_started"` (alongside the existing `"unavailable"`, `"ended"`, `"sold_out"`) for a `variant_id` key. `Cart.jsx`'s `problemLabel` maps it to a rendered string - nothing else in this plan reads this reason.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/shop/cartAvailability.test.js`, inside the existing `describe("checkCartAvailability", ...)` block:

```javascript
  it("flags a line from a not-yet-started collection as not_started, not sold_out or unavailable", async () => {
    fetchCollection.mockResolvedValue(physicalCollection({ not_started_yet: true }))
    const cart = [{ variant_id: 1, collection_slug: "drop" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.get(1)).toBe("not_started")
  })

  it("does not flag a started collection's line as not_started", async () => {
    fetchCollection.mockResolvedValue(physicalCollection({ not_started_yet: false }))
    const cart = [{ variant_id: 1, collection_slug: "drop" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.has(1)).toBe(false)
  })
```

Add to `frontend/src/pages/Cart.test.jsx`, after the existing `"shows an ended badge for a closed collection's line"` test:

```javascript
  it("shows a not-started badge for a not-yet-started collection's line", async () => {
    fetchCollection.mockResolvedValue({ status: "active", not_started_yet: true, products: [] })
    addToCart({ variant_id: 23, qty: 1, product_name: "Upcoming Drop Item", variant_label: "Std", price: 10000, image_url: null, collection_slug: "upcoming" })

    const container = await renderCart()
    await act(async () => {})

    expect(container.textContent).toContain("Not started yet")
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/shop/cartAvailability.test.js src/pages/Cart.test.jsx`

Expected: FAIL - `checkCartAvailability` doesn't check `not_started_yet` yet, so `problems.get(1)` is `undefined` in the first new test; `Cart.jsx`'s `problemLabel` has no `not_started` case, so nothing renders "Not started yet" in the new Cart test.

- [ ] **Step 3: Implement**

In `frontend/src/i18n/translations.js`, find (English section, near the other `cartItem*` keys):

```javascript
    cartItemUnavailable: "No longer available",
```

Replace with:

```javascript
    cartItemUnavailable: "No longer available",
    cartItemNotStarted: "Not started yet",
```

Find (Vietnamese section):

```javascript
    cartItemUnavailable: "Không còn khả dụng",
```

Replace with:

```javascript
    cartItemUnavailable: "Không còn khả dụng",
    cartItemNotStarted: "Chưa mở bán",
```

In `frontend/src/shop/cartAvailability.js`, find:

```javascript
    if (collection.status === "closed") {
      problems.set(line.variant_id, "ended")
      continue
    }
```

Replace with:

```javascript
    if (collection.status === "closed") {
      problems.set(line.variant_id, "ended")
      continue
    }
    if (collection.not_started_yet) {
      problems.set(line.variant_id, "not_started")
      continue
    }
```

Also update the file's top-of-file doc comment, which currently says a 404 collapses "not-started, deleted, and archived" into one bucket - that's no longer accurate for not-started now that the public API returns real data for it instead of 404ing. Find:

```javascript
/**
 * Classifies every cart line into valid or one of three reasons a buyer
 * can't actually check out with it - a 404 collapses not-started, deleted,
 * and archived into one bucket since the public API deliberately can't
 * (and shouldn't) tell those apart from the outside.
 */
```

Replace with:

```javascript
/**
 * Classifies every cart line into valid or one of four reasons a buyer
 * can't actually check out with it. A 404 collapses deleted and archived
 * into one "unavailable" bucket, since the public API deliberately can't
 * (and shouldn't) tell those apart from the outside - but a not-yet-started
 * collection is now itself visible (see catalogRepo.js's not_started_yet),
 * so it gets its own distinct reason instead of falling into that bucket.
 */
```

In `frontend/src/pages/Cart.jsx`, find:

```javascript
  const problemLabel = (reason) => ({
    sold_out: t("cartItemSoldOut"),
    ended: t("cartItemEnded"),
    unavailable: t("cartItemUnavailable"),
  }[reason])
```

Replace with:

```javascript
  const problemLabel = (reason) => ({
    sold_out: t("cartItemSoldOut"),
    ended: t("cartItemEnded"),
    unavailable: t("cartItemUnavailable"),
    not_started: t("cartItemNotStarted"),
  }[reason])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/shop/cartAvailability.test.js src/pages/Cart.test.jsx`

Expected: PASS (all tests in both files).

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm test -- --run && npx eslint src/pages/Shop.jsx src/pages/Collection.jsx src/components/shop/ProductCard.jsx src/shop/cartAvailability.js src/pages/Cart.jsx src/i18n/translations.js`

Expected: PASS, no lint errors - confirms nothing from earlier tasks in this plan regressed.

- [ ] **Step 6: Commit**

```bash
cd /Users/phucth/vibes/cosplay-portfolio
git add frontend/src/shop/cartAvailability.js frontend/src/pages/Cart.jsx frontend/src/i18n/translations.js frontend/src/shop/cartAvailability.test.js frontend/src/pages/Cart.test.jsx
git commit -m "feat(shop): distinguish a not-yet-started collection's cart line from generic unavailability"
```

---

## Final Verification

After all four tasks:

1. Full backend suite: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run` - expect all files passing.
2. Full frontend suite: `cd frontend && npm test -- --run` - expect all files passing.
3. Update `docs/EDGE_CASE_CHECKLIST.md` with an entry describing this feature (not-yet-started collections previously invisible entirely, now browsable-but-not-orderable with an accurate open-date banner, matching this project's established convention of logging every fix/feature there).
4. `bash scripts/build-push.sh staging` to push the updated images, per this project's established workflow (never push to production).
