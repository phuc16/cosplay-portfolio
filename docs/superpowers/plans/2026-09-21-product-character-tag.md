# Product Character/Series Tag + Filter - Implementation Plan

**Goal:** Let the admin tag a product with a free-text character/series
name (`products.character_tag`), show it as a small badge on the buyer-
facing product card, and let a buyer filter a collection's product grid by
it when the collection has 2+ distinct tags.

**Architecture:** One additive migration + two small `catalogRepo.js`
writes (`createProduct`/`updateProduct`) on the backend; a new form field
in `AdminProducts.jsx`, a badge in `ProductCard.jsx`, and a third
`SearchableSelect` filter in `Collection.jsx` on the frontend. No new
tables, no new routes - `character_tag` rides through the existing nested
collection/product read paths unchanged.

**Tech Stack:** Node/Express, Knex migrations, mysql2, React/Vite, Vitest.

---

### Task 1: Migration + `catalogRepo.js`

**Files:**
- Create: `backend/migrations/040_add_product_character_tag.js`
- Modify: `backend/shop/catalogRepo.js` (`createProduct`, `updateProduct`)
- Test: `backend/tests/catalogRepo.test.js`

- [ ] **Step 1: Write the migration**

```js
exports.up = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    // Free text, e.g. "Genshin Impact - Raiden Shogun" - not a bilingual
    // {vi, en} object (a character/series name is a proper noun, same
    // non-translation precedent as collections.pickup_note). NULL/unset
    // means untagged - the product behaves exactly as it does today.
    table.string("character_tag", 191).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    table.dropColumn("character_tag")
  })
}
```

- [ ] **Step 2: Run migrations**

Run: `cd backend && npm run migrate`
Expected: migration reports as run, no errors. Confirm with:
`mysql -h 127.0.0.1 -P 3307 -uroot -proot cosplay_test -e "DESCRIBE products;"`
- `character_tag` present, nullable.

- [ ] **Step 3: Write the failing repo tests**

Add to `backend/tests/catalogRepo.test.js` (near the existing
`createProduct`/`updateProduct` coverage):

```js
describe("products.character_tag", () => {
  it("defaults to null when not submitted", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.products[0].character_tag).toBeNull()
  })

  it("persists a character/series tag set at creation", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({
      collection_id: cid, name: "Card", price: 35000, character_tag: "Genshin Impact - Raiden Shogun",
    })
    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.products[0].character_tag).toBe("Genshin Impact - Raiden Shogun")
  })

  it("can be set and cleared via updateProduct", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })

    await repo.updateProduct(pid, { name: "Card", price: 35000, images: [], character_tag: "Series A" })
    let detail = await repo.getCollectionDetailById(cid)
    expect(detail.products[0].character_tag).toBe("Series A")

    await repo.updateProduct(pid, { name: "Card", price: 35000, images: [], character_tag: "" })
    detail = await repo.getCollectionDetailById(cid)
    expect(detail.products[0].character_tag).toBeNull()
  })
})
```

- [ ] **Step 4: Run to verify failures**

Run: `cd backend && npx vitest run tests/catalogRepo.test.js -t "character_tag"`
Expected: FAIL - column doesn't exist / value always undefined.

- [ ] **Step 5: Wire it into `createProduct`/`updateProduct`**

In `backend/shop/catalogRepo.js`:

```js
async function createProduct(data) {
  const sortOrder = await nextSortOrder("products", "WHERE collection_id = ?", [data.collection_id])
  const type = data.type === "digital" ? "digital" : "physical"
  const [res] = await db.query(
    `INSERT INTO products (collection_id, name, description, price, images, type, sort_order, character_tag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.collection_id,
      data.name,
      data.description || null,
      Number(data.price) || 0,
      JSON.stringify(data.images || []),
      type,
      sortOrder,
      data.character_tag || null,
    ]
  )
  // ...unchanged digital-hidden-variant block below
```

```js
async function updateProduct(id, data) {
  const [[existing]] = await db.query("SELECT type FROM products WHERE id = ?", [id])
  if (!existing) return false

  const [res] = await db.query(
    "UPDATE products SET name = ?, description = ?, price = ?, images = ?, character_tag = ? WHERE id = ?",
    [data.name, data.description || null, Number(data.price) || 0, JSON.stringify(data.images || []), data.character_tag || null, id]
  )
  // ...unchanged digital-hidden-variant block below
```

- [ ] **Step 6: Run to verify tests pass**

Run: `cd backend && npx vitest run tests/catalogRepo.test.js -t "character_tag"`
Expected: PASS (3/3)

- [ ] **Step 7: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/040_add_product_character_tag.js backend/shop/catalogRepo.js backend/tests/catalogRepo.test.js
git commit -m "feat(shop): add products.character_tag for character/series tagging"
```

---

### Task 2: Admin form field

**Files:**
- Modify: `frontend/src/components/AdminProducts.jsx`
- Modify: `frontend/src/components/AdminProducts.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/components/AdminProducts.test.jsx` (check its existing
mock/render helper names before writing - match its established pattern for
mocking `../api/shop` and driving the form, same as every other component
test in this codebase: raw `createRoot`/`act`/`querySelector`):

```jsx
describe("AdminProducts - character_tag", () => {
  it("includes character_tag in the create payload", async () => {
    // ...render, fill name/price, type the tag field, click Thêm...
    expect(adminCreateProduct).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ character_tag: "Raiden Shogun" })
    )
  })

  it("pre-fills the tag field when editing an existing product", async () => {
    // ...render with a product carrying character_tag: "Series A", click Sửa...
    // assert the input's value is "Series A"
  })
})
```

(Fill in exact setup by matching this file's existing `save`/`edit` test
cases line-for-line - do not invent a different render/mock pattern.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/AdminProducts.test.jsx -t "character_tag"`
Expected: FAIL - no such field/behavior yet.

- [ ] **Step 3: Implement**

In `frontend/src/components/AdminProducts.jsx`:

- `blank` gains `character_tag: ""`.
- `edit(p)` gains `character_tag: p.character_tag || ""` in the object it
  builds.
- `save()`'s payload is already `{ ...draft, price: ... }`, so
  `character_tag` is included automatically - no change needed there.
- New input, placed between the name `<input>` and the price `<input>`:

```jsx
<input
  value={draft.character_tag}
  onChange={(e) => setDraft({ ...draft, character_tag: e.target.value })}
  placeholder="Nhân vật / Series (tùy chọn)"
  className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
/>
```

- [ ] **Step 4: Run to verify tests pass**

Run: `cd frontend && npx vitest run src/components/AdminProducts.test.jsx`
Expected: PASS (all pre-existing + new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminProducts.jsx frontend/src/components/AdminProducts.test.jsx
git commit -m "feat(admin): add character/series tag field to the product form"
```

---

### Task 3: Buyer-facing badge + collection filter

**Files:**
- Modify: `frontend/src/components/shop/ProductCard.jsx`
- Modify: `frontend/src/components/shop/ProductCard.test.jsx`
- Modify: `frontend/src/pages/Collection.jsx`
- Modify: `frontend/src/pages/Collection.test.jsx`
- Modify: `frontend/src/i18n/translations.js`

- [ ] **Step 1: Add i18n keys**

`en` block, near `shopDigitalBadge`:
```js
shopFilterAllTags: "All characters/series",
```
`vi` block, near its own `shopDigitalBadge`:
```js
shopFilterAllTags: "Tất cả nhân vật/series",
```
(No new key needed for the badge itself - it renders the raw
`product.character_tag` text, not a translated label, same as how the
digital badge's *label* is translated but a character name is proper-noun
free text with nothing to translate.)

- [ ] **Step 2: Write the failing `ProductCard` test**

Add to `frontend/src/components/shop/ProductCard.test.jsx`:

```jsx
it("shows the character/series tag as a badge when set", async () => {
  const container = await renderCard({ product: { ...baseProduct, character_tag: "Raiden Shogun" } })
  expect(container.textContent).toContain("Raiden Shogun")
})

it("shows no tag badge when character_tag is unset", async () => {
  const container = await renderCard({ product: { ...baseProduct, character_tag: null } })
  // No stray empty badge element - check no unexpected extra pill renders
  // (adapt the exact assertion to however this file's existing
  // digital-badge-absent test already checks for "badge not present").
})
```

(Match this file's existing render helper and `baseProduct` fixture - do
not invent a new one.)

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/shop/ProductCard.test.jsx -t "tag"`
Expected: FAIL.

- [ ] **Step 4: Implement the badge in `ProductCard.jsx`**

Immediately after the existing `isDigital &&` badge span (both places it
appears - the grid card and the detail-modal header, per the file's
existing duplicated badge markup):

```jsx
{product.character_tag && (
  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold border border-[var(--border-brand)]">
    {product.character_tag}
  </span>
)}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/shop/ProductCard.test.jsx`
Expected: PASS.

- [ ] **Step 6: Write the failing `Collection` filter tests**

Add to `frontend/src/pages/Collection.test.jsx`:

```jsx
describe("Collection - character/series tag filter", () => {
  it("does not render the tag filter with fewer than 2 distinct tags", async () => {
    fetchCollection.mockResolvedValue(baseCollection({
      products: [
        { id: 1, name: "A", price: 1000, description: null, images: [], character_tag: "Series A", variants: [{ id: 1, label: "A1", stock_qty: 5 }] },
        { id: 2, name: "B", price: 1000, description: null, images: [], character_tag: "Series A", variants: [{ id: 2, label: "B1", stock_qty: 5 }] },
      ],
    }))
    const container = await renderCollection()
    expect(container.textContent).not.toContain("All characters/series")
  })

  it("renders and narrows by tag with 2+ distinct tags", async () => {
    fetchCollection.mockResolvedValue(baseCollection({
      products: [
        { id: 1, name: "Card A", price: 1000, description: null, images: [], character_tag: "Series A", variants: [{ id: 1, label: "A1", stock_qty: 5 }] },
        { id: 2, name: "Card B", price: 1000, description: null, images: [], character_tag: "Series B", variants: [{ id: 2, label: "B1", stock_qty: 5 }] },
      ],
    }))
    const container = await renderCollection()
    expect(container.textContent).toContain("Series A")
    expect(container.textContent).toContain("Series B")
    // Pick "Series A" via the SearchableSelect trigger for the tag filter,
    // then assert only Card A renders and Card B doesn't - adapt the exact
    // interaction to this file's existing SearchableSelect-driving pattern
    // (see how it already drives the stock-filter/sort selects, if any
    // existing test does).
  })
})
```

- [ ] **Step 7: Run to verify it fails**

Run: `cd frontend && npx vitest run src/pages/Collection.test.jsx -t "tag filter"`
Expected: FAIL.

- [ ] **Step 8: Implement in `Collection.jsx`**

Add state: `const [tagFilter, setTagFilter] = useState("")`.

Compute distinct tags and extend the filter predicate:

```js
const distinctTags = [...new Set(collection.products.map((p) => p.character_tag).filter(Boolean))].sort()

const visibleProducts = sortProducts(
  collection.products.filter((p) => {
    if (search.trim() && !p.name.toLowerCase().includes(search.trim().toLowerCase())) return false
    if (stockFilter === "in_stock" && isProductSoldOut(p)) return false
    if (stockFilter === "sold_out" && !isProductSoldOut(p)) return false
    if (tagFilter && p.character_tag !== tagFilter) return false
    return true
  }),
  sortBy
)
```

Add the third `SearchableSelect`, inside the existing
`grid grid-cols-2 gap-2 sm:flex sm:shrink-0` filter wrapper, after the sort
select, gated on `distinctTags.length > 1`:

```jsx
{distinctTags.length > 1 && (
  <SearchableSelect padding="px-2 py-1.5" height="h-[38px]"
    value={tagFilter}
    onChange={setTagFilter}
    options={[
      { code: "", name: t("shopFilterAllTags") },
      ...distinctTags.map((tag) => ({ code: tag, name: tag })),
    ]}
    placeholder={t("shopFilterAllTags")}
  />
)}
```

- [ ] **Step 9: Run to verify tests pass**

Run: `cd frontend && npx vitest run src/pages/Collection.test.jsx`
Expected: PASS.

- [ ] **Step 10: Run the full frontend suite + lint**

Run: `cd frontend && npx vitest run`
Expected: all pass.

Run: `cd frontend && npx eslint src/components/AdminProducts.jsx src/components/shop/ProductCard.jsx src/pages/Collection.jsx src/i18n/translations.js`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/shop/ProductCard.jsx frontend/src/components/shop/ProductCard.test.jsx frontend/src/pages/Collection.jsx frontend/src/pages/Collection.test.jsx frontend/src/i18n/translations.js
git commit -m "feat(shop): show character/series tag badge and add a collection tag filter"
```
