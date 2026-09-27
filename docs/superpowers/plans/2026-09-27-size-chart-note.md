# Size Chart / Fit Notes Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Small, single-PR feature - one branch, a handful of ordered commits.

**Goal:** Let a seller attach an optional free-text size/fit note to a physical product; buyers see it in the variant detail modal before adding to cart.

**Architecture:** One new nullable `TEXT` column on `products` (`size_chart_note`), read/written through the existing `createProduct`/`updateProduct`/`copyCollection` paths in `catalogRepo.js` - no new endpoint. `AdminProducts.jsx` gets a conditional textarea; `ProductCard.jsx` renders the note (markdown) in the detail modal.

**Tech Stack:** Express/mysql2 + Knex migration (backend), React/Vite (frontend), Vitest for both.

## Global Constraints

- No bilingual `{ vi, en }` structure - single free-text field, same convention as `description`.
- No validation beyond the existing TEXT-column precedent (`description` has none).
- Backend stores/returns the field for any product type; only the admin form's *display* is gated to `type === "physical"`.
- No order-item snapshot - this is pre-purchase content only.
- Rendered via the existing `renderMarkdown` pipeline, no new sanitization.

---

### Task 1: Migration

**Files:**
- Create: `backend/migrations/050_add_product_size_chart_note.js`

- [x] Add nullable `size_chart_note` TEXT column to `products`.
- [x] Verify: `npm run migrate` against a fresh `cosplay_test` DB applies cleanly.

### Task 2: Backend - repo wiring

**Files:**
- Modify: `backend/shop/catalogRepo.js`

- [x] `createProduct`: include `size_chart_note` in the INSERT.
- [x] `updateProduct`: include `size_chart_note` in the SET clause (empty string clears it, same as `description`).
- [x] `copyCollection`: carry `size_chart_note` through to the copied product.

### Task 3: Backend tests

**Files:**
- Modify: `backend/tests/catalogRepo.test.js`

- [x] Defaults to `null` when not submitted.
- [x] Stored at creation, visible on both admin (`getCollectionDetailById`) and public (`getPublicCollectionBySlug`) read paths.
- [x] `updateProduct` overwrites and (given an explicit empty string) clears it.
- [x] Carried through `copyCollection`.

### Task 4: Frontend - admin form

**Files:**
- Modify: `frontend/src/components/AdminProducts.jsx`
- Modify: `frontend/src/components/AdminProducts.test.jsx`

- [x] Add `size_chart_note` to `blank` and `edit()`'s draft mapping.
- [x] Textarea rendered only when `draft.type === "physical"`, wired into `draft`/`payload` like every other field.
- [x] Tests: shown + saved for a physical product, hidden for digital/gacha, pre-filled when editing.

### Task 5: Frontend - public rendering

**Files:**
- Modify: `frontend/src/components/shop/ProductCard.jsx`
- Modify: `frontend/src/components/shop/ProductCard.test.jsx`
- Modify: `frontend/src/i18n/translations.js`

- [x] Add `shopSizeChartLabel` to both `en`/`vi` blocks.
- [x] Render a labeled markdown block for `product.size_chart_note` in the single-variant detail modal, after the variant's own `description` block.
- [x] Tests: renders when set, absent when not, identical across different variants of the same product.

### Task 6: Verify

- [x] `backend`: `npx vitest run tests/catalogRepo.test.js` - 88 passed.
- [x] `backend`: full suite - 1194/1200 passed, same 6 pre-existing MinIO-dependent failures as baseline.
- [x] `frontend`: `npx vitest run src/components/AdminProducts.test.jsx src/components/shop/ProductCard.test.jsx` - all passed.
- [x] `frontend`: full suite - 787/787 passed.
- [x] `frontend`: `npm run lint` - no new errors (same pre-existing 9 problems as baseline).
