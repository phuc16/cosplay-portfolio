# Recent Sales Badge Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Small, single-PR feature - one branch, a handful of ordered commits.

**Goal:** Show a "🔥 N sold in the last 24h" badge on a product card once a product has cleared a small threshold of committed sales in the last 24 hours - a social-proof signal computed from existing order data, no new schema.

**Architecture:** A new `attachRecentSalesCounts` helper in `backend/shop/catalogRepo.js` runs one grouped query over `order_items`/`orders`/`product_variants` and merges `recent_sales_count` onto each product returned by `getPublicCollectionBySlug`. `ProductCard.jsx` renders a badge when the count is truthy and the product isn't sold out.

**Tech Stack:** Express/mysql2 (backend), React/Vite (frontend), Vitest for both.

## Global Constraints

- No migration - derived entirely from existing tables.
- Threshold logic lives server-side only (`RECENT_SALES_BADGE_THRESHOLD`); the frontend renders on truthiness alone.
- Only `confirmed`/`shipped`/`completed` orders count as "sold".
- `UTC_TIMESTAMP()`, never `NOW()`, for the rolling window.
- Badge never shows on a sold-out product.
- New buyer-facing copy goes through `translations.js`'s `t()`.

---

### Task 1: Backend - compute `recent_sales_count`

**Files:**
- Modify: `backend/shop/catalogRepo.js`

- [x] Add `RECENT_SALES_WINDOW_HOURS` (24) and `RECENT_SALES_BADGE_THRESHOLD` (3) constants.
- [x] Add `attachRecentSalesCounts(products)`: one query grouped by `product_variants.product_id`, summing `order_items.qty` for `orders.status IN ('confirmed','shipped','completed')` within the window; returns each product with `recent_sales_count` (0 below threshold).
- [x] Call it from `getPublicCollectionBySlug`, after the existing gacha-booth filter/`delivery_link` strip.

### Task 2: Backend tests

**Files:**
- Modify: `backend/tests/catalogRepo.test.js`

- [x] Add `insertOrderWithQtyAt(variantId, { qty, status, hoursAgo, token })` test helper (qty/status/time all configurable, unlike the existing `insertOrderForVariant`).
- [x] Test: sums qty across confirmed+shipped orders within 24h.
- [x] Test: reports `0` below the threshold.
- [x] Test: excludes `pending`/`cancelled` orders.
- [x] Test: excludes orders older than 24h.

### Task 3: Frontend - badge

**Files:**
- Modify: `frontend/src/components/shop/ProductCard.jsx`
- Modify: `frontend/src/i18n/translations.js`

- [x] Add `shopRecentSales` key to both `en`/`vi` blocks.
- [x] Render the badge next to the existing digital-product badge, gated on `!isProductSoldOut(product) && product.recent_sales_count > 0`.

### Task 4: Frontend tests

**Files:**
- Modify: `frontend/src/components/shop/ProductCard.test.jsx`

- [x] Badge renders above threshold.
- [x] No badge at `0`.
- [x] No badge when the field is absent.
- [x] No badge on a sold-out product even with a high count.

### Task 5: Verify

- [x] `backend`: `npx vitest run tests/catalogRepo.test.js` - 88 passed.
- [x] `backend`: full suite - no new failures vs. baseline (6 pre-existing MinIO-dependent failures in `paymentProof.test.js`, unrelated).
- [x] `frontend`: `npx vitest run src/components/shop/ProductCard.test.jsx` - 59 passed.
- [x] `frontend`: full suite - 784 passed (up from 780), same pre-existing benign teardown warning in `AdminOrders.test.jsx`.
- [x] `frontend`: `npm run lint` - no new errors (pre-existing errors in unrelated files only).
