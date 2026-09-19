# Character/Series Tagging + Filter Implementation Plan

**Goal:** Let an admin tag a product with a character/series name and let
buyers filter a collection's product grid by that tag, per
`docs/superpowers/specs/2026-09-19-character-tag-filter-design.md`.

**Architecture:** One new nullable `products.character_tag` column. No new
API endpoints - the field flows through the existing `createProduct`/
`updateProduct`/`nestCollectionDetail` paths. Filtering is entirely
client-side in `Collection.jsx`, reusing its existing search/stock/sort
filter-bar pattern.

---

### Task 1: Migration + `catalogRepo.js`

**Files:**
- Create `backend/migrations/040_add_product_character_tag.js`
- Modify `backend/shop/catalogRepo.js` (`createProduct`, `updateProduct`)
- Modify `backend/tests/catalogRepo.test.js`

- [ ] Migration: `alterTable("products", t => t.string("character_tag", 191).nullable())`, down drops it.
- [ ] Run migrate against the test DB.
- [ ] `createProduct`: add `character_tag` to the `INSERT` column list,
      value `data.character_tag?.trim() || null`.
- [ ] `updateProduct`: add `character_tag` to the `UPDATE` - preserve the
      existing value when `data.character_tag === undefined` (matches the
      `delivery_link`/`stock_qty` omitted-field precedent already in this
      function for digital products' hidden variant; for the plain `UPDATE
      products SET ...` statement this means reading the existing row first
      when the field is omitted, the same way `name`/`description`/`price`
      already require *some* value - simplest correct approach: `const tag =
      data.character_tag === undefined ? existing.character_tag :
      (data.character_tag?.trim() || null)`, so `existing` (already
      selected at the top of `updateProduct` for `type`) also selects
      `character_tag`).
- [ ] Tests: create with tag, create without tag (null), update sets tag,
      update omits tag (preserved), update sends `""` (cleared to null),
      both `getPublicCollectionBySlug` and `getCollectionDetailById` expose
      `character_tag` on nested products.
- [ ] Run: `cd backend && npx vitest run tests/catalogRepo.test.js`
- [ ] Commit.

### Task 2: Admin UI (`AdminProducts.jsx`)

**Files:** Modify `frontend/src/components/AdminProducts.jsx`,
`frontend/src/components/AdminProducts.test.jsx` (if it exists and covers
the form round-trip cheaply)

- [ ] Add `character_tag: ""` to `blank`.
- [ ] Add a text input "Nhân vật / Series (tùy chọn)" in the form, same
      style as the existing name/price inputs.
- [ ] `edit()`: include `character_tag: p.character_tag || ""`.
- [ ] `save()`: payload already spreads `draft`, so `character_tag` is
      included automatically - no change needed there beyond the field
      existing in `draft`.
- [ ] Extend the existing `search` filter predicate to also match
      `p.character_tag`.
- [ ] Run `cd frontend && npx vitest run src/components/AdminProducts.test.jsx`
      if that file exists; otherwise a manual read-through is enough (this
      component's existing test coverage, if any, should be checked before
      assuming no test file is needed).

### Task 3: Storefront filter (`Collection.jsx`) + badge (`ProductCard.jsx`)

**Files:** Modify `frontend/src/pages/Collection.jsx`,
`frontend/src/pages/Collection.test.jsx`, `frontend/src/components/shop/ProductCard.jsx`,
`frontend/src/components/shop/ProductCard.test.jsx`, `frontend/src/i18n/translations.js`

- [ ] i18n keys (`en`/`vi`): `shopFilterAllCharacters` ("All characters" /
      "Tất cả nhân vật").
- [ ] `Collection.jsx`: add `characterFilter` state; compute distinct
      non-empty trimmed `character_tag` values from `collection.products`;
      when `>= 2`, render an additional `SearchableSelect` in the existing
      filter-bar row; add `characterFilter` to the `visibleProducts` filter
      predicate (AND-combined with the existing ones).
- [ ] `ProductCard.jsx`: render a small badge with `product.character_tag`
      (when present) next to the product name, both on the grid card and
      in the detail modal - same badge style as the existing
      `shopDigitalBadge`.
- [ ] Tests per the design doc's Testing section.
- [ ] Run: `cd frontend && npx vitest run src/pages/Collection.test.jsx src/components/shop/ProductCard.test.jsx`
- [ ] Run full suites: `cd backend && npx vitest run tests/catalogRepo.test.js tests/adminCatalogRoutes.test.js tests/shopRoutes.test.js` and `cd frontend && npm test`.
- [ ] Commit.
