# Gacha Booth-Only Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin mark a gacha product "booth-only" so it disappears from the public
online shop and can never be bought through checkout, while staying fully usable at the
booth kiosk and via the free practice page.

**Architecture:** One new boolean column, `products.gacha_booth_only` (default `false`),
added by editing the existing `040_add_product_type_gacha.js` migration in place (this
feature has not shipped yet, so there is no production data to migrate - do NOT create a
new migration file). Two independent enforcement points read it: the public
collection-read path in `backend/shop/catalogRepo.js` excludes matching products from what
it returns, and `backend/shop/orders/orderRepo.js`'s `createOrder` rejects a cart line for
one by throwing the *existing* `VariantNotFoundError` (not a new error class - see spec
§5). Everything else - the booth kiosk, the prize editor, the free practice page, the
draw/session logic - is completely untouched.

**Tech Stack:** Node.js/Express backend, MySQL via Knex migrations + raw `mysql2` queries
(no ORM), React frontend, Vitest for both.

## Global Constraints

- Do NOT create a new migration file. Edit `backend/migrations/040_add_product_type_gacha.js`
  in place.
- `gacha_booth_only` is a plain `BOOLEAN NOT NULL DEFAULT false` column - no CHECK constraint
  tying it to `type = 'gacha'` (same convention as `delivery_link` only mattering for
  `type = 'digital'`).
- Flipping the flag must never retroactively affect an existing session/order - only new
  `createOrder` calls and new public reads are affected.
- The booth-only rejection in `createOrder` must reuse `VariantNotFoundError` verbatim - no
  new error class, no message that could tell a prober "this product exists but is
  booth-only" apart from "this product doesn't exist."
- Every task ends with its own tests passing. Run the backend suite with:
  `DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run <file>`
  (run from `backend/`). Frontend: `npx vitest run <file>` from `frontend/`.

---

### Task 1: Schema + admin create/update persistence

**Files:**
- Modify: `backend/migrations/040_add_product_type_gacha.js`
- Modify: `backend/shop/catalogRepo.js:467-500` (`createProduct`), `:502-535` (`updateProduct`)
- Test: `backend/tests/catalogRepo.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `products.gacha_booth_only` column, readable via `SELECT *` (already used
  everywhere in this file). `createProduct(data)` and `updateProduct(id, data)` both accept
  and persist `data.gacha_booth_only` (any falsy/missing value stores `false`).

- [ ] **Step 1: Edit the migration**

Replace the full contents of `backend/migrations/040_add_product_type_gacha.js` with:

```js
exports.up = async function (knex) {
  await knex.raw("ALTER TABLE products MODIFY COLUMN type ENUM('physical', 'digital', 'gacha') NOT NULL DEFAULT 'physical'")
  await knex.schema.alterTable("products", (table) => {
    table.boolean("gacha_booth_only").notNullable().defaultTo(false)
  })
}

exports.down = async function (knex) {
  await knex.schema.alterTable("products", (table) => {
    table.dropColumn("gacha_booth_only")
  })
  await knex.raw("ALTER TABLE products MODIFY COLUMN type ENUM('physical', 'digital') NOT NULL DEFAULT 'physical'")
}
```

- [ ] **Step 2: Rebuild the local test DB so the edited migration actually takes effect**

Knex tracks migrations by filename in its own table - editing an already-applied migration's
contents does nothing until it's re-run. Roll back everything and re-migrate:

```bash
cd backend
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test npx knex migrate:rollback --all
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test npx knex migrate:latest
```

Expected: both commands print `Batch 1 rolled back: N migrations` / `Batch 1 run: N migrations`
with no errors.

- [ ] **Step 3: Write the failing tests**

Add to `backend/tests/catalogRepo.test.js`, inside the existing `describe("gacha products", ...)`
block (find it - it starts around line 289 with `it("creates a gacha product with one hidden
unlimited-stock variant", ...)`):

```js
  it("defaults gacha_booth_only to false for a newly created gacha product", async () => {
    const cid = await repo.createCollection({ title: "Gacha Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })

    const detail = await repo.getCollectionDetailById(cid)
    const product = detail.products.find((p) => p.id === pid)
    expect(product.gacha_booth_only).toBe(false)
  })

  it("persists gacha_booth_only: true when set at creation", async () => {
    const cid = await repo.createCollection({ title: "Gacha Drop", status: "active" })
    const pid = await repo.createProduct({
      collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha", gacha_booth_only: true,
    })

    const detail = await repo.getCollectionDetailById(cid)
    const product = detail.products.find((p) => p.id === pid)
    expect(product.gacha_booth_only).toBe(true)
  })

  it("toggles gacha_booth_only via updateProduct", async () => {
    const cid = await repo.createCollection({ title: "Gacha Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })

    await repo.updateProduct(pid, {
      name: "Mystery Case", price: 20000, images: [], gacha_booth_only: true,
    })
    let detail = await repo.getCollectionDetailById(cid)
    expect(detail.products.find((p) => p.id === pid).gacha_booth_only).toBe(true)

    await repo.updateProduct(pid, {
      name: "Mystery Case", price: 20000, images: [], gacha_booth_only: false,
    })
    detail = await repo.getCollectionDetailById(cid)
    expect(detail.products.find((p) => p.id === pid).gacha_booth_only).toBe(false)
  })
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
cd backend
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/catalogRepo.test.js -t "gacha_booth_only"
```

Expected: FAIL - `product.gacha_booth_only` is `undefined`, not `false`/`true` (the column
exists from Step 2, but nothing selects or writes it yet).

- [ ] **Step 5: Make `createProduct` persist the field**

In `backend/shop/catalogRepo.js`, replace the `createProduct` function (currently
lines 467-500) with:

```js
async function createProduct(data) {
  const sortOrder = await nextSortOrder("products", "WHERE collection_id = ?", [data.collection_id])
  const type = ["digital", "gacha"].includes(data.type) ? data.type : "physical"
  const [res] = await db.query(
    `INSERT INTO products (collection_id, name, description, price, images, type, sort_order, gacha_booth_only)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.collection_id,
      data.name,
      data.description || null,
      Number(data.price) || 0,
      JSON.stringify(data.images || []),
      type,
      sortOrder,
      Boolean(data.gacha_booth_only),
    ]
  )
  const productId = res.insertId
  // Digital products have no admin-managed variant list - this single
  // hidden row (no label) carries stock_qty/delivery_link through the same
  // variant_id-based cart/order_items/stock-decrement pipeline unchanged.
  if (type === "digital" || type === "gacha") {
    await replaceVariants(productId, [{
      label: "",
      // A gacha product's turns are never stock-limited at the variant
      // level - the prize pool (gacha_prizes.quantity_remaining) is what
      // actually caps how many turns can be sold (see createOrder's pool
      // check). Unlimited here is intentional, not an oversight.
      stock_qty: type === "gacha" ? null : data.stock_qty,
      delivery_link: type === "gacha" ? null : data.delivery_link,
      thumbnail_image: data.thumbnail_image,
    }])
  }
  return productId
}
```

- [ ] **Step 6: Make `updateProduct` persist the field**

In the same file, in `updateProduct` (currently lines 502-535), replace only the `UPDATE`
query call:

```js
  const [res] = await db.query(
    "UPDATE products SET name = ?, description = ?, price = ?, images = ?, gacha_booth_only = ? WHERE id = ?",
    [
      data.name, data.description || null, Number(data.price) || 0, JSON.stringify(data.images || []),
      Boolean(data.gacha_booth_only), id,
    ]
  )
```

(Everything else in `updateProduct` - the variant-replacement block below it - is unchanged.)

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd backend
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/catalogRepo.test.js
```

Expected: PASS, full file (not just the new tests - confirms nothing else in this large
test file regressed).

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/040_add_product_type_gacha.js backend/shop/catalogRepo.js backend/tests/catalogRepo.test.js
git commit -m "feat(gacha): add gacha_booth_only column, persisted on create/update"
```

---

### Task 2: Exclude booth-only products from the public storefront

**Files:**
- Modify: `backend/shop/catalogRepo.js:124-197` (`nestCollectionDetail`), `:199-221`
  (`getPublicCollectionBySlug`)
- Test: `backend/tests/catalogRepo.test.js`

**Interfaces:**
- Consumes: `products.gacha_booth_only` from Task 1.
- Produces: `getPublicCollectionBySlug(slug).products` never contains a row where
  `type === 'gacha' && gacha_booth_only === true`. `getCollectionDetailById(id).products`
  (the admin path) is unaffected and still returns every product regardless of the flag.

- [ ] **Step 1: Write the failing tests**

Add to the `describe("gacha products", ...)` block in `backend/tests/catalogRepo.test.js`
(same block as Task 1's new tests):

```js
  it("excludes a booth-only gacha product from the public read path", async () => {
    const cid = await repo.createCollection({ title: "Gacha Drop", status: "active" })
    const boothOnlyId = await repo.createProduct({
      collection_id: cid, name: "Booth Exclusive", price: 20000, type: "gacha", gacha_booth_only: true,
    })
    const onlineId = await repo.createProduct({
      collection_id: cid, name: "Online Case", price: 20000, type: "gacha",
    })

    const publicDetail = await repo.getPublicCollectionBySlug("gacha-drop")
    const ids = publicDetail.products.map((p) => p.id)
    expect(ids).not.toContain(boothOnlyId)
    expect(ids).toContain(onlineId)
  })

  it("still shows a booth-only gacha product on the admin read path", async () => {
    const cid = await repo.createCollection({ title: "Gacha Drop", status: "active" })
    const boothOnlyId = await repo.createProduct({
      collection_id: cid, name: "Booth Exclusive", price: 20000, type: "gacha", gacha_booth_only: true,
    })

    const adminDetail = await repo.getCollectionDetailById(cid)
    expect(adminDetail.products.map((p) => p.id)).toContain(boothOnlyId)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/catalogRepo.test.js -t "booth-only"
```

Expected: FAIL on the first test - `ids` contains `boothOnlyId` (nothing filters it out yet).
The second test passes already (admin path was never filtered).

- [ ] **Step 3: Add the exclusion**

In `backend/shop/catalogRepo.js`, `getPublicCollectionBySlug` currently ends with (around
line 216-220):

```js
  return {
    ...detail,
    not_started_yet: notStartedYet,
    products: detail.products.map(({ delivery_link, ...rest }) => rest),
  }
```

Replace it with:

```js
  return {
    ...detail,
    not_started_yet: notStartedYet,
    // A booth-only gacha product is never meant to exist for an online buyer
    // at all - filtered out here, not just left unlinked, so it can't be
    // browsed via a shared/bookmarked collection URL either. The admin path
    // (getCollectionDetailById) shares nestCollectionDetail but never calls
    // this function, so it keeps showing every gacha product regardless.
    products: detail.products
      .filter((p) => !(p.type === "gacha" && p.gacha_booth_only))
      .map(({ delivery_link, ...rest }) => rest),
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/catalogRepo.test.js
```

Expected: PASS, full file.

- [ ] **Step 5: Commit**

```bash
git add backend/shop/catalogRepo.js backend/tests/catalogRepo.test.js
git commit -m "feat(gacha): hide booth-only gacha products from the public storefront"
```

---

### Task 3: Reject booth-only products in `createOrder`

**Files:**
- Modify: `backend/shop/orders/orderRepo.js:236-272` (`createOrder`'s product-row query and
  gacha guard block)
- Modify: `backend/tests/orderRepo.test.js:34-46` (`seedGachaVariant` helper), gacha `describe`
  block (currently starts line 1486)
- Modify: `docs/GACHA_ANTI_CHEAT.md`

**Interfaces:**
- Consumes: `products.gacha_booth_only` from Task 1.
- Produces: `createOrder({ items: [{ variant_id, qty }], ... })` throws
  `repo.VariantNotFoundError` (already exported) when any line item's product is
  `type === 'gacha' && gacha_booth_only === true` - same error, same shape, as an
  unknown/deleted variant_id.

- [ ] **Step 1: Extend the test helper so a test can request a booth-only gacha product**

In `backend/tests/orderRepo.test.js`, replace the `seedGachaVariant` function (currently
lines 34-46) with:

```js
async function seedGachaVariant(prizeQuantity, collectionOver = {}, { boothOnly = false } = {}) {
  const cid = await catalog.createCollection({ title: "Gacha Drop", status: "active", ...collectionOver })
  const pid = await catalog.createProduct({
    collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha", gacha_booth_only: boothOnly,
  })
  await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: prizeQuantity }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ? LIMIT 1", [pid])
  return { cid, pid, variantId: v.id }
}
```

(This also removes the stale "Temporary shim" comment and its now-redundant manual
`UPDATE products SET type = 'gacha'` / `replaceVariants` calls, since `createProduct`
has created gacha products correctly since the original build - the comment referenced a
long-resolved bootstrapping gap in an earlier version of this plan's ancestor.)

- [ ] **Step 2: Write the failing test**

Add to the `describe("createOrder - gacha", ...)` block (currently starts line 1486):

```js
  it("rejects a booth-only gacha product the same way it rejects an unknown variant", async () => {
    const { variantId } = await seedGachaVariant(10, {}, { boothOnly: true })
    await expect(repo.createOrder(order(variantId, 1, { payment_method: "bank", fulfillment_method: "ship" })))
      .rejects.toThrow(repo.VariantNotFoundError)
  })

  it("still allows a purchase once gacha_booth_only is turned back off", async () => {
    const { pid, variantId } = await seedGachaVariant(10, {}, { boothOnly: true })
    await catalog.updateProduct(pid, { name: "Mystery Case", price: 20000, images: [], gacha_booth_only: false })

    const result = await repo.createOrder(order(variantId, 1, { payment_method: "bank", fulfillment_method: "ship" }))
    expect(result.total).toBe(20000)
  })

  // The "never retroactive" invariant from the spec: flipping the flag on
  // must never strand a buyer who already paid and is mid-session.
  it("lets an already-active session keep drawing after its product is flipped booth-only", async () => {
    const { pid, variantId } = await seedGachaVariant(10)
    const result = await repo.createOrder(order(variantId, 2, { payment_method: "bank", fulfillment_method: "ship" }))
    await repo.transitionOrder(result.id, "confirmed")
    const session = await sessionRepo.getSessionByOrderId(result.id)

    await catalog.updateProduct(pid, { name: "Mystery Case", price: 20000, images: [], gacha_booth_only: true })

    const draw = await sessionRepo.drawForSession(session.id, { drawKey: "k1", ownerOrderId: result.id })
    expect(draw.prize).toBeDefined()
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd backend
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/orderRepo.test.js -t "booth-only"
```

Expected: FAIL on the first test - `createOrder` currently succeeds for a booth-only product
(nothing checks the flag yet). The second test passes already.

- [ ] **Step 4: Add the guard**

In `backend/shop/orders/orderRepo.js`, the product/variant row query (currently lines
236-248) needs `gacha_booth_only` added to its `SELECT`:

```js
    const [rows] = await conn.query(
      `SELECT v.id, v.label, v.stock_qty, v.delivery_link, v.thumbnail_image, v.image_url,
              p.id AS product_id, p.name AS product_name, p.type AS product_type, p.images AS product_images,
              p.price, p.collection_id, p.gacha_booth_only, c.status AS collection_status,
              c.start_at AS collection_start_at, c.end_at AS collection_end_at,
              c.allow_ship, c.allow_pickup, c.payment_deadline_hours
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         JOIN collections c ON c.id = p.collection_id
        WHERE v.id IN (${ids.map(() => "?").join(",")})
        ORDER BY v.id ASC
        FOR UPDATE OF v`,
      ids
    )
    if (rows.length !== ids.length) {
      const foundIds = new Set(rows.map((r) => r.id))
      throw new VariantNotFoundError(ids.filter((id) => !foundIds.has(id)))
    }
    // A booth-only gacha product must never be purchasable online - hidden
    // from the public storefront (see catalogRepo.getPublicCollectionBySlug),
    // but "hidden from the UI" is never treated as a security boundary on its
    // own in this codebase, so it's rejected here too, the same way an
    // unknown variant_id is: same error, same message, same 409 response -
    // deliberately NOT a distinguishing error, so a booth-only product can't
    // be told apart from a nonexistent one by probing.
    const boothOnlyRow = rows.find((r) => r.product_type === "gacha" && r.gacha_booth_only)
    if (boothOnlyRow) {
      throw new VariantNotFoundError([boothOnlyRow.id])
    }
```

(This block goes immediately after the existing `if (rows.length !== ids.length)` check and
before the `allDigital`/`anyDigital` lines that already follow it.)

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd backend
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/orderRepo.test.js
```

Expected: PASS, full file.

- [ ] **Step 6: Update the anti-cheat doc**

In `docs/GACHA_ANTI_CHEAT.md`, find the "## Can't get more turns than were paid for" section
and add a new bullet at the end of its list:

```markdown
- A gacha product an admin has marked `gacha_booth_only` is rejected by `createOrder` the
  same way an unknown variant_id is - it reuses `VariantNotFoundError` verbatim, never a
  distinguishing message, so a booth-only product can't be told apart from a nonexistent one
  by probing. It's also excluded from `getPublicCollectionBySlug`'s response entirely, but
  that's a UI convenience, not the actual boundary - "hidden from the UI" is never treated as
  a security control on its own in this codebase.
```

- [ ] **Step 7: Run the full backend suite**

```bash
cd backend
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run
```

Expected: PASS, every file (this task touches shared query shape in `createOrder` - a full
run is the only way to be sure nothing else that reads those row fields regressed).

- [ ] **Step 8: Commit**

```bash
git add backend/shop/orders/orderRepo.js backend/tests/orderRepo.test.js docs/GACHA_ANTI_CHEAT.md
git commit -m "feat(gacha): reject booth-only products in createOrder, reusing VariantNotFoundError"
```

---

### Task 4: Admin UI checkbox

**Files:**
- Modify: `frontend/src/components/AdminProducts.jsx`
- Test: `frontend/src/components/AdminProducts.test.jsx`

**Interfaces:**
- Consumes: `product.gacha_booth_only` (boolean) from the collection payload
  `adminGetCollection` already returns (Task 1-3 make the backend return/accept it; no new
  frontend API call needed - `adminCreateProduct`/`adminUpdateProduct` already forward their
  whole payload object, per `frontend/src/api/shop.js`).
- Produces: a checkbox in the product form, shown only when `draft.type === "gacha"`, that
  round-trips through `draft.gacha_booth_only` into the save payload.

- [ ] **Step 1: Write the failing tests**

Add to the `describe("AdminProducts - gacha products", ...)` block in
`frontend/src/components/AdminProducts.test.jsx` (starts around line 224):

```js
  it("shows the booth-only checkbox only for a gacha product being created", async () => {
    adminGetCollection.mockResolvedValue({ products: [] })
    const container = await renderProducts()
    await flush()

    expect(container.querySelector('input[type="checkbox"]')).toBeNull()

    const typeTrigger = container.querySelector('[aria-label="Vật lý"]')
    await act(async () => { typeTrigger.click() })
    const gachaOption = [...container.querySelectorAll("li button")].find((b) => b.textContent === "Gacha")
    await act(async () => { gachaOption.click() })

    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull()
    expect(container.textContent).toContain("Chỉ bán tại quầy")
  })

  it("saves gacha_booth_only: true when the checkbox is checked", async () => {
    adminGetCollection.mockResolvedValue({ products: [] })
    adminCreateProduct.mockResolvedValue({ id: 1 })
    const container = await renderProducts()
    await flush()

    const typeTrigger = container.querySelector('[aria-label="Vật lý"]')
    await act(async () => { typeTrigger.click() })
    const gachaOption = [...container.querySelectorAll("li button")].find((b) => b.textContent === "Gacha")
    await act(async () => { gachaOption.click() })

    const nameInput = container.querySelector('input[placeholder="Tên sản phẩm"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      setter.call(nameInput, "Booth Case")
      nameInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const checkbox = container.querySelector('input[type="checkbox"]')
    await act(async () => { checkbox.click() })

    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Thêm")
    await act(async () => { saveButton.click() })

    expect(adminCreateProduct).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ name: "Booth Case", type: "gacha", gacha_booth_only: true })
    )
  })

  it("pre-checks the checkbox when editing an existing booth-only product", async () => {
    adminGetCollection.mockResolvedValue({
      products: [{ id: 1, name: "Booth Case", price: 20000, type: "gacha", images: [], variants: [], gacha_booth_only: true }],
    })
    const container = await renderProducts()
    await flush()

    const editButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sửa")
    await act(async () => { editButton.click() })

    const checkbox = container.querySelector('input[type="checkbox"]')
    expect(checkbox.checked).toBe(true)
  })

  it("never shows the checkbox for a physical product", async () => {
    adminGetCollection.mockResolvedValue({
      products: [{ id: 1, name: "Card", price: 35000, type: "physical", images: [], variants: [] }],
    })
    const container = await renderProducts()
    await flush()

    const editButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sửa")
    await act(async () => { editButton.click() })

    expect(container.querySelector('input[type="checkbox"]')).toBeNull()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend
npx vitest run src/components/AdminProducts.test.jsx -t "booth-only|Chỉ bán tại quầy"
```

Expected: FAIL - no checkbox exists anywhere yet in the rendered form.

- [ ] **Step 3: Add `gacha_booth_only` to the draft's default shape**

In `frontend/src/components/AdminProducts.jsx`, the `blank` object (currently line 11-14):

```js
const blank = {
  name: "", description: "", price: "", images: [], type: "physical", stock_qty: "", delivery_link: "",
  thumbnail_image: "", gacha_booth_only: false,
}
```

- [ ] **Step 4: Populate it when editing an existing product**

The `edit` function (currently lines 119-126):

```js
  const edit = (p) => {
    setEditingId(p.id)
    setDraft({
      name: p.name, description: p.description || "", price: p.price, images: p.images || [],
      type: p.type || "physical", stock_qty: p.stock_qty ?? "", delivery_link: p.delivery_link || "",
      thumbnail_image: p.thumbnail_image || "", gacha_booth_only: Boolean(p.gacha_booth_only),
    })
  }
```

- [ ] **Step 5: Render the checkbox**

In the same file, the gacha-only prize/booth section doesn't exist yet - the form currently
goes straight from the description `<textarea>` (ends around line 230) into the
`{draft.type === "digital" && (...)}` block (starts line 231). Insert a new conditional block
between them:

```jsx
      {draft.type === "gacha" && (
        <label className="flex items-center gap-2 mb-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(draft.gacha_booth_only)}
            onChange={(e) => setDraft({ ...draft, gacha_booth_only: e.target.checked })}
          />
          Chỉ bán tại quầy (ẩn khỏi shop online)
        </label>
      )}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd frontend
npx vitest run src/components/AdminProducts.test.jsx
```

Expected: PASS, full file.

- [ ] **Step 7: Run the full frontend suite and lint**

```bash
cd frontend
npx vitest run
npx eslint src/components/AdminProducts.jsx src/components/AdminProducts.test.jsx
```

Expected: PASS on tests (any pre-existing `AdminOrders.jsx` debounce-timer teardown flake in
the "Errors" summary line is unrelated and pre-existing - ignore it, but every test file must
show 0 failed). Expected: no output from eslint (clean).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/AdminProducts.jsx frontend/src/components/AdminProducts.test.jsx
git commit -m "feat(gacha): add the booth-only checkbox to the admin product editor"
```

---

## Final check (after all 4 tasks)

- [ ] Run the entire backend suite once more from a clean slate and confirm the count only
  went up (no prior test broke): `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run`
- [ ] Run the entire frontend suite once more: `cd frontend && npx vitest run`
- [ ] Manually smoke-test locally (`docker compose up -d`, or `node server.js` +
  `npm run dev`): create a gacha product, check the booth-only box, confirm it disappears from
  `GET /api/shop/collections/:slug` but still appears in the admin collection editor and the
  kiosk's prize fetch (`GET /api/admin/gacha-products/:id/prizes`), and that
  `POST /api/orders` with its variant_id returns `409 variant_not_found`.
