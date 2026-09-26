# Character/Series Tag + Collection Filter Implementation Plan

**Goal:** Add an optional `character_tag` free-text field to products, let
admins set it on the product form, and give buyers a filter control on the
collection page when a collection has 2+ distinct tags among its products.

**Architecture:** One additive nullable `VARCHAR(255)` column on
`products`. `catalogRepo.js`'s existing `SELECT *`/spread paths already
carry it through with no new SELECT list to edit; `copyCollection`'s
explicit per-product field list and `createProduct`/`updateProduct`'s
explicit column lists do need one field added each. Admin validation
mirrors the existing product-name length check. The public collection
payload gains the field with no route/query-param change. The frontend
filter is entirely client-side, following this page's existing fetch-
once-filter-client-side pattern (see the stock-filter/sort controls
already on `Collection.jsx`).

**Tech Stack:** Express/mysql2 (raw SQL), Knex migrations, React/Vite,
Vitest.

## Global Constraints

- Single plain-text column, not a many-to-many tags table (see design
  spec's YAGNI rationale).
- No new backend route or query param - the collection detail payload
  just gains one more product field.
- Untagged products (`character_tag: null`) only ever fall into the
  implicit "All" bucket - no separate "Untagged" filter option.
- Filter control renders only when a collection has 2+ distinct non-empty
  `character_tag` values among its products.
- The tag value itself is plain text, never `{ vi, en }`.
- Comments terse, single-line, only for non-obvious rationale, matching
  this codebase's existing style.

---

### Task 1: Migration for `products.character_tag`

**Files:**
- Create: `backend/migrations/051_add_product_character_tag.js`
- Modify: `backend/tests/schema.test.js`

**Interfaces:**
- Produces: `products.character_tag` (`VARCHAR(255) NULL`). All later
  tasks read/write this exact column name.

- [ ] **Step 1: Write `051_add_product_character_tag.js`**

```js
exports.up = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    // NULL/empty = untagged (today's behavior, unchanged). Length matches
    // NAME_MAX_LEN (products.name's own limit) in adminCatalog.js.
    table.string("character_tag", 255).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    table.dropColumn("character_tag")
  })
}
```

- [ ] **Step 2: Run the migration**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test npx knex migrate:latest`
Expected: `Batch N run: 1 migrations`.

- [ ] **Step 3: Add a failing schema assertion**

In `backend/tests/schema.test.js`, inside the existing `describe("catalog
schema", ...)` block, add near the `products` columns test:

```js
  it("creates products with a nullable character_tag column", async () => {
    const c = await columns("products")
    expect(Object.keys(c)).toEqual(expect.arrayContaining(["character_tag"]))
    expect(c.character_tag.IS_NULLABLE).toBe("YES")
  })
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/schema.test.js`

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/051_add_product_character_tag.js backend/tests/schema.test.js
git commit -m "feat(shop): add products.character_tag column"
```

---

### Task 2: `catalogRepo.js` - persist and carry through `character_tag`

**Files:**
- Modify: `backend/shop/catalogRepo.js`
- Modify: `backend/tests/catalogRepo.test.js`

**Interfaces:**
- Consumes: `products.character_tag` (Task 1).
- Produces: `createProduct`/`updateProduct` accept `character_tag` in
  their `data` argument (trimmed, `null` if empty/omitted).
  `getCollectionDetailById`/`getPublicCollectionBySlug` return it on every
  product. `copyCollection` carries it onto the copy.

- [ ] **Step 1: Write failing tests**

In `backend/tests/catalogRepo.test.js`, add a new `describe` block (near
the existing product-field tests):

```js
describe("character_tag", () => {
  it("stores character_tag on create and returns it in collection detail", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({
      collection_id: cid, name: "Card", price: 35000, character_tag: "Raiden Shogun",
    })

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.products.find((p) => p.id === pid).character_tag).toBe("Raiden Shogun")
  })

  it("defaults to null when character_tag is omitted or blank", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid1 = await repo.createProduct({ collection_id: cid, name: "Card A", price: 1000 })
    const pid2 = await repo.createProduct({ collection_id: cid, name: "Card B", price: 1000, character_tag: "   " })

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.products.find((p) => p.id === pid1).character_tag).toBeNull()
    expect(detail.products.find((p) => p.id === pid2).character_tag).toBeNull()
  })

  it("updates character_tag on an existing product", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 1000, character_tag: "A" })

    await repo.updateProduct(pid, { name: "Card", price: 1000, character_tag: "B" })

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.products.find((p) => p.id === pid).character_tag).toBe("B")
  })

  it("clears character_tag back to null on update when sent blank", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 1000, character_tag: "A" })

    await repo.updateProduct(pid, { name: "Card", price: 1000, character_tag: "" })

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.products.find((p) => p.id === pid).character_tag).toBeNull()
  })

  it("exposes character_tag on the public collection read path too", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    await repo.createProduct({ collection_id: cid, name: "Card", price: 1000, character_tag: "Raiden Shogun" })

    const detail = await repo.getPublicCollectionBySlug("drop")
    expect(detail.products[0].character_tag).toBe("Raiden Shogun")
  })

  it("carries character_tag over into a copied collection's products", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    await repo.createProduct({ collection_id: cid, name: "Card", price: 1000, character_tag: "Raiden Shogun" })

    const newId = await repo.copyCollection(cid)
    const copy = await repo.getCollectionDetailById(newId)
    expect(copy.products[0].character_tag).toBe("Raiden Shogun")
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/catalogRepo.test.js`

- [ ] **Step 3: Update `createProduct`**

In `createProduct`, add `character_tag` to the INSERT:

```js
async function createProduct(data) {
  const sortOrder = await nextSortOrder("products", "WHERE collection_id = ?", [data.collection_id])
  const type = ["digital", "gacha"].includes(data.type) ? data.type : "physical"
  const tag = data.character_tag && String(data.character_tag).trim() ? String(data.character_tag).trim() : null
  const [res] = await db.query(
    `INSERT INTO products (collection_id, name, description, price, images, type, sort_order, gacha_booth_only, character_tag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.collection_id,
      data.name,
      data.description || null,
      Number(data.price) || 0,
      JSON.stringify(data.images || []),
      type,
      sortOrder,
      Boolean(data.gacha_booth_only),
      tag,
    ]
  )
  ...
```

(Keep the rest of the function - the digital/gacha hidden-variant block -
unchanged.)

- [ ] **Step 4: Update `updateProduct`**

In `updateProduct`, add `character_tag` to `setClauses`/`params`,
unconditionally (unlike `gacha_booth_only`'s conditional add - this field
is on every product type, so always writing it, trimmed-or-null, is
simpler and matches how `name`/`description`/`price`/`images` are already
handled a few lines above):

```js
  const setClauses = ["name = ?", "description = ?", "price = ?", "images = ?", "character_tag = ?"]
  const tag = data.character_tag && String(data.character_tag).trim() ? String(data.character_tag).trim() : null
  const params = [data.name, data.description || null, Number(data.price) || 0, JSON.stringify(data.images || []), tag]
```

- [ ] **Step 5: Add `character_tag` to `copyCollection`'s per-product field list**

In `copyCollection`, add `character_tag: p.character_tag` to the
`createProduct({...})` call's object literal.

- [ ] **Step 6: Run to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/catalogRepo.test.js`
Expected: all pass, including every pre-existing test in the file.

- [ ] **Step 7: Commit**

```bash
git add backend/shop/catalogRepo.js backend/tests/catalogRepo.test.js
git commit -m "feat(shop): persist and carry through products.character_tag"
```

---

### Task 3: Admin route validation

**Files:**
- Modify: `backend/routes/adminCatalog.js`
- Modify: `backend/tests/adminCatalogRoutes.test.js`

**Interfaces:**
- Consumes: `createProduct`/`updateProduct` accepting `character_tag`
  (Task 2).
- Produces: `validateProduct(body)` rejects a `character_tag` over
  `NAME_MAX_LEN` (255) chars.

- [ ] **Step 1: Write failing tests**

In `backend/tests/adminCatalogRoutes.test.js`, inside the existing
`describe("products and variants", ...)` block, add near the existing
name-length tests:

```js
  it("accepts a character_tag at exactly the 255-char limit", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const tag = "a".repeat(255)
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Card", price: 1000, character_tag: tag })
    expect(res.status).toBe(201)
  })

  it("rejects a character_tag one character over the 255-char limit with 400, not 500", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const tag = "a".repeat(256)
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Card", price: 1000, character_tag: tag })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("creates a product with no character_tag at all, stored as null", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Card", price: 1000 })
    expect(res.status).toBe(201)

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.products.find((p) => p.id === res.body.id).character_tag).toBeNull()
  })
```

- [ ] **Step 2: Run to verify the length test fails**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/adminCatalogRoutes.test.js`

- [ ] **Step 3: Update `validateProduct`**

In `backend/routes/adminCatalog.js`, add to `validateProduct`, right
after the name-length check:

```js
  if (body.character_tag && String(body.character_tag).length > NAME_MAX_LEN) {
    return `Nhân vật/series không được quá ${NAME_MAX_LEN} ký tự`
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/adminCatalogRoutes.test.js`
Expected: all pass, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/adminCatalog.js backend/tests/adminCatalogRoutes.test.js
git commit -m "feat(shop): validate products.character_tag length in admin routes"
```

---

### Task 4: Public route exposure test

**Files:**
- Modify: `backend/tests/shopRoutes.test.js`

**Interfaces:**
- Consumes: `getPublicCollectionBySlug` returning `character_tag` (Task 2).

- [ ] **Step 1: Add a test in the existing `describe("GET /api/shop/collections/:slug", ...)` block**

```js
  it("exposes character_tag on a public product", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    await repo.createProduct({ collection_id: cid, name: "Card", price: 1000, character_tag: "Raiden Shogun" })

    const res = await request(app).get("/api/shop/collections/drop")
    expect(res.status).toBe(200)
    expect(res.body.products[0].character_tag).toBe("Raiden Shogun")
  })
```

- [ ] **Step 2: Run to verify it passes**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/shopRoutes.test.js`
Expected: passes without any production-code change (Task 2 already
wired it through) - this task is a coverage-only checkpoint.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/shopRoutes.test.js
git commit -m "test(shop): cover character_tag exposure on the public collection route"
```

---

### Task 5: Admin UI - tag field on the product form

**Files:**
- Modify: `frontend/src/components/AdminProducts.jsx`
- Modify: `frontend/src/components/AdminProducts.test.jsx` (create test
  coverage if the file doesn't already exist - check first)

**Interfaces:**
- Consumes: `adminCreateProduct`/`adminUpdateProduct` (unchanged
  signatures - forward whatever object they're given).
- Produces: a "Nhân vật / Series" text input on the product form; the
  compact product list row shows the tag as a small pill when set.

- [ ] **Step 1: Read the file's current test setup (if any) first**

Run: `ls frontend/src/components/AdminProducts.test.jsx` - if present,
read it fully to match its render/mock helper conventions before writing
new tests; if absent, model new tests on `AdminCollections.test.jsx`'s
conventions instead (same mocked-API-module, render-into-container style).

- [ ] **Step 2: Write failing tests**

Add a test that fills the tag field and asserts it's included in the
create-call payload, and a test that the compact list row shows the tag
pill when `character_tag` is set. Exact selectors depend on Step 1's
findings - mirror whatever selector convention the existing "creates a
product" test in that file uses for its other fields.

- [ ] **Step 3: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/AdminProducts.test.jsx`

- [ ] **Step 4: Update `AdminProducts.jsx`**

Add `character_tag: ""` to `blank`:

```js
const blank = {
  name: "", description: "", price: "", images: [], type: "physical", stock_qty: "", delivery_link: "",
  thumbnail_image: "", gacha_booth_only: false, character_tag: "",
}
```

Add the field to `edit(p)`:

```js
  const edit = (p) => {
    setEditingId(p.id)
    setDraft({
      name: p.name, description: p.description || "", price: p.price, images: p.images || [],
      type: p.type || "physical", stock_qty: p.stock_qty ?? "", delivery_link: p.delivery_link || "",
      thumbnail_image: p.thumbnail_image || "", gacha_booth_only: Boolean(p.gacha_booth_only),
      character_tag: p.character_tag || "",
    })
  }
```

Add the input in the form JSX, right after the name input:

```jsx
      <input
        value={draft.character_tag}
        onChange={(e) => setDraft({ ...draft, character_tag: e.target.value })}
        placeholder="Nhân vật / Series (tùy chọn)"
        className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
      />
```

Add a small pill to the compact row, next to the price, only when set:

```jsx
                <p className="text-sm opacity-70">
                  {formatVnd(p.price)}
                  {p.character_tag && (
                    <span className="ml-2 px-1.5 py-0.5 text-xs rounded-md border border-[var(--border-brand)] opacity-80">
                      {p.character_tag}
                    </span>
                  )}
                </p>
```

(Read the current surrounding JSX first - `p.name`/`formatVnd(p.price)`
sit inside a `<div>` a few lines into the component; match indentation
and don't disturb the drag-and-drop wrapper around it.)

- [ ] **Step 5: Run to verify they pass**

Run: `cd frontend && npx vitest run src/components/AdminProducts.test.jsx`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AdminProducts.jsx frontend/src/components/AdminProducts.test.jsx
git commit -m "feat(shop): add character/series tag field to the admin product form"
```

---

### Task 6: Public collection page - tag filter

**Files:**
- Modify: `frontend/src/pages/Collection.jsx`
- Modify: `frontend/src/i18n/translations.js`
- Modify (or create): `frontend/src/pages/Collection.test.jsx`

**Interfaces:**
- Consumes: `collection.products[].character_tag` (Task 2/4).
- Produces: a `SearchableSelect` tag filter above the product grid,
  rendered only when 2+ distinct non-empty tags exist; filters the
  visible product list client-side without disturbing the existing
  sold-out-last sort.

- [ ] **Step 1: Read `Collection.jsx`'s current test file (if any) first**

Run: `ls frontend/src/pages/Collection.test.jsx` - read it fully (or the
closest equivalent page test in `frontend/src/pages/`) to match its
mocking convention for `fetchCollection` before writing new tests.

- [ ] **Step 2: Add i18n keys**

In `frontend/src/i18n/translations.js`, add to both the `en` and `vi`
blocks, near the existing `shopFilterAllStock`/`shopSortDefault` keys:

```js
    // en block
    shopFilterAllTags: "All characters",
```

```js
    // vi block
    shopFilterAllTags: "Tất cả nhân vật",
```

- [ ] **Step 3: Write failing tests**

In `Collection.test.jsx`, add cases (mirroring the file's existing
`fetchCollection` mock pattern):

- A collection whose products all share one `character_tag` (or none at
  all) renders no tag filter control.
- A collection with products tagged `["A", "A", null, "B"]` renders a
  filter offering exactly `All`/`A`/`B` (no separate "untagged" option),
  and selecting `A` hides the `B`-tagged and null-tagged products.
- Combining the tag filter with the existing stock filter narrows further
  (both predicates apply together).

- [ ] **Step 4: Run to verify they fail**

Run: `cd frontend && npx vitest run src/pages/Collection.test.jsx`

- [ ] **Step 5: Implement in `Collection.jsx`**

Add state and a small `distinctTags` computation:

```js
  const [tagFilter, setTagFilter] = useState("")
```

After `collection` is resolved (so this only runs once loaded), compute
the distinct tags and decide whether to show the control:

```js
  const distinctTags = collection && collection !== null
    ? [...new Set(collection.products.map((p) => p.character_tag).filter(Boolean))]
    : []
  const showTagFilter = distinctTags.length >= 2
```

Add the tag predicate into the existing `.filter()` chain (before the
existing `sortProducts()` call, so sold-out-last sort still applies to
the filtered subset unchanged):

```js
      if (tagFilter && p.character_tag !== tagFilter) return false
```

Render the control next to the existing stock/sort `SearchableSelect`s,
only when `showTagFilter`:

```jsx
              {showTagFilter && (
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

(Read the current `<div className="grid grid-cols-2 gap-2 sm:flex ...">`
wrapper around the two existing `SearchableSelect`s first - a third
control likely needs `grid-cols-2` to become `grid-cols-3`-aware or wrap
to its own row on narrow screens; use your judgement on the exact
Tailwind classes based on what renders acceptably, this is a minor visual
call, not a strict spec.)

- [ ] **Step 6: Run to verify they pass**

Run: `cd frontend && npx vitest run src/pages/Collection.test.jsx`
Expected: all pass, including every pre-existing test in the file.

- [ ] **Step 7: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Collection.jsx frontend/src/i18n/translations.js frontend/src/pages/Collection.test.jsx
git commit -m "feat(shop): add character/series tag filter to the collection page"
```

---

### Task 7: Verification

**Files:** none (verification only).

- [ ] **Step 1: Attempt the full backend suite**

Try, in order: `docker compose up -d mysql redis minio`, then
`cd backend && npm run migrate && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npm test`.
If Docker isn't available in this environment, record that clearly rather
than retrying - this is a known, previously-confirmed sandbox limitation,
not a new failure to chase.

- [ ] **Step 2: Run the full frontend suite and iterate to green**

Run: `cd frontend && npx vitest run`
This must actually pass in this sandbox - iterate on any failures before
proceeding.

- [ ] **Step 3: Report**

Branch name, files changed, frontend pass/fail counts, backend
attempted-but-blocked-by-no-docker status (with the exact commands that
were written but could not run).
