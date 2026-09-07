# Digital Album Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell digital albums as a distinct product type, sold through the existing cart/checkout, with a fixed delivery link surfaced in the "accepted" email and on the buyer's order-status page once the seller confirms the order.

**Architecture:** `products.type` (`'physical'|'digital'`) drives everything. A digital product has no admin-visible variant list - it uses the product's own `images`, plus a `stock_qty`/`delivery_link` pair carried on one auto-created, hidden `product_variants` row so cart/`order_items`/stock-decrement code (all built around `variant_id`) needs zero structural changes. `orderRepo.createOrder` rejects COD when any line is digital and auto-forces `fulfillment_method = 'digital'` (skipping address) when every line is digital. The delivery link is snapshotted onto `order_items` at order-creation time and surfaced (email + order page) only once the order reaches `confirmed`/`shipped`/`completed`.

**Tech Stack:** Express + mysql2 (raw SQL, no ORM) + Knex migrations on the backend; React + Vite on the frontend; Vitest (backend, Node env) and Vitest (frontend, jsdom + `react-dom/client`) for tests.

## Global Constraints

- Never edit a migration once it exists - this plan adds migrations `029`–`032`, additive only.
- `products.type` is set at creation and is **never editable afterward** - no admin UI ever offers to change it.
- Digital products have **no variant list in any UI** (admin or buyer) - no size/edition options.
- The delivery link is **fixed on the product**, never entered per-order.
- **No COD** on any order containing at least one digital line item (mixed or digital-only).
- The delivery link is exposed to the buyer (email body + order-status page) **only** once `order.status` is `confirmed`, `shipped`, or `completed` - never for `pending`/`cancelled`.
- Comments in this codebase are terse, single-line, and reserved for genuinely non-obvious rationale - match the existing style in every file touched, do not add narrative "just added X" comments.
- No git commit messages need a `Co-Authored-By:` trailer (this repo's convention); write detailed bodies.

---

### Task 1: Migrations for the digital-product schema

**Files:**
- Create: `backend/migrations/029_add_product_type.js`
- Create: `backend/migrations/030_add_variant_delivery_link.js`
- Create: `backend/migrations/031_add_order_item_delivery_link_snapshot.js`
- Create: `backend/migrations/032_add_order_fulfillment_digital.js`
- Modify: `backend/tests/schema.test.js`

**Interfaces:**
- Produces: `products.type` (`ENUM('physical','digital') NOT NULL DEFAULT 'physical'`), `product_variants.delivery_link` (`VARCHAR(2048) NULL`), `order_items.delivery_link_snapshot` (`VARCHAR(2048) NULL`), `orders.fulfillment_method` extended to `ENUM('ship','pickup','digital')`. All later tasks read/write these columns by these exact names.

- [ ] **Step 1: Write `029_add_product_type.js`**

```js
exports.up = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    // Every existing row backfills to 'physical' via the default - a
    // digital product is the new, explicit exception.
    table.enu("type", ["physical", "digital"]).notNullable().defaultTo("physical")
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    table.dropColumn("type")
  })
}
```

- [ ] **Step 2: Write `030_add_variant_delivery_link.js`**

```js
exports.up = function (knex) {
  return knex.schema.alterTable("product_variants", (table) => {
    // Only ever set on the single hidden variant of a digital product -
    // always NULL for a physical variant.
    table.string("delivery_link", 2048).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("product_variants", (table) => {
    table.dropColumn("delivery_link")
  })
}
```

- [ ] **Step 3: Write `031_add_order_item_delivery_link_snapshot.js`**

```js
exports.up = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    // Captured at order-creation time from the variant's delivery_link, so
    // a later edit to the product never changes what a past order was
    // already sent/shown - same snapshot pattern as product_name_snapshot.
    table.string("delivery_link_snapshot", 2048).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    table.dropColumn("delivery_link_snapshot")
  })
}
```

- [ ] **Step 4: Write `032_add_order_fulfillment_digital.js`**

Knex has no portable "add a value to an existing MySQL enum" helper, so this uses `raw()` directly (MySQL client, confirmed in `backend/knexfile.js`).

```js
exports.up = function (knex) {
  // Buyer never picks this value - orderRepo.createOrder sets it internally
  // when every cart line is digital (no address/shipping applies).
  return knex.raw("ALTER TABLE orders MODIFY COLUMN fulfillment_method ENUM('ship', 'pickup', 'digital') NOT NULL")
}

exports.down = function (knex) {
  return knex.raw("ALTER TABLE orders MODIFY COLUMN fulfillment_method ENUM('ship', 'pickup') NOT NULL")
}
```

- [ ] **Step 5: Run migrations**

Run (from `backend/`, with the test DB env vars this repo's suite already uses):
```bash
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test npx knex migrate:latest
```
Expected: `Batch N run: 4 migrations`, no errors.

- [ ] **Step 6: Add failing schema assertions**

In `backend/tests/schema.test.js`, inside the existing `describe("catalog schema", ...)` block, add after the `product_variants` test:

```js
  it("creates products with a type column defaulting to physical", async () => {
    const c = await columns("products")
    expect(Object.keys(c)).toEqual(expect.arrayContaining(["type"]))
    expect(c.type.COLUMN_TYPE).toContain("digital")
    expect(c.type.IS_NULLABLE).toBe("NO")
  })

  it("creates product_variants with a nullable delivery_link", async () => {
    const c = await columns("product_variants")
    expect(Object.keys(c)).toEqual(expect.arrayContaining(["delivery_link"]))
    expect(c.delivery_link.IS_NULLABLE).toBe("YES")
  })
```

Add a new top-level `describe` block for `order_items`/`orders`:

```js
describe("digital order schema", () => {
  it("creates order_items with a nullable delivery_link_snapshot", async () => {
    const c = await columns("order_items")
    expect(Object.keys(c)).toEqual(expect.arrayContaining(["delivery_link_snapshot"]))
    expect(c.delivery_link_snapshot.IS_NULLABLE).toBe("YES")
  })

  it("extends orders.fulfillment_method with 'digital'", async () => {
    const c = await columns("orders")
    expect(c.fulfillment_method.COLUMN_TYPE).toContain("digital")
  })
})
```

- [ ] **Step 7: Run the schema tests**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/schema.test.js`
Expected: all tests pass (existing ones plus the 4 new).

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/029_add_product_type.js backend/migrations/030_add_variant_delivery_link.js backend/migrations/031_add_order_item_delivery_link_snapshot.js backend/migrations/032_add_order_fulfillment_digital.js backend/tests/schema.test.js
git commit -m "feat(shop): add digital-product schema (products.type, variant delivery_link, order_items snapshot, orders.fulfillment_method)"
```

---

### Task 2: Catalog repo - digital product creation, update, and hidden-variant flattening

**Files:**
- Modify: `backend/shop/catalogRepo.js`
- Modify: `backend/tests/catalogRepo.test.js`

**Interfaces:**
- Consumes: `products.type`, `product_variants.delivery_link` (Task 1).
- Produces: `createProduct(data)` - `data.type` (`'physical'|'digital'`, defaults `'physical'`), `data.stock_qty`/`data.delivery_link` (used only when `type === 'digital'`) now accepted. `updateProduct(id, data)` - same `stock_qty`/`delivery_link` fields accepted, looked up product `type` itself (never trusts a `type` in `data`). `replaceVariants(productId, variants)` - each variant object may now carry `delivery_link`. Every product returned by `getCollectionDetailById`/`getPublicCollectionBySlug` has, when `type === 'digital'`: `variants: []`, `variant_id`, `stock_qty`, `delivery_link` flattened onto the product object directly (no frontend code needs variant-awareness for digital).

- [ ] **Step 1: Write failing catalogRepo tests**

In `backend/tests/catalogRepo.test.js`, add a new `describe` block (after the existing `describe("variant description", ...)` block):

```js
describe("digital products", () => {
  it("creates a digital product with a hidden variant carrying stock_qty and delivery_link", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({
      collection_id: cid, name: "Digital Album", price: 99000,
      images: ["https://x/cover.jpg"], type: "digital",
      stock_qty: 50, delivery_link: "https://drive.google.com/abc",
    })

    const detail = await repo.getCollectionDetailById(cid)
    const product = detail.products[0]
    expect(product.type).toBe("digital")
    expect(product.images).toEqual(["https://x/cover.jpg"])
    expect(product.variants).toEqual([])
    expect(product.stock_qty).toBe(50)
    expect(product.delivery_link).toBe("https://drive.google.com/abc")
    expect(typeof product.variant_id).toBe("number")

    const [[hidden]] = await db.query("SELECT label FROM product_variants WHERE product_id = ?", [pid])
    expect(hidden.label).toBe("")
  })

  it("defaults type to physical when not submitted, unchanged from before", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.products[0].type).toBe("physical")
    expect(detail.products[0].variants).toEqual([])

    const [rows] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    expect(rows).toHaveLength(0)
  })

  it("updates a digital product's hidden variant in place, keeping the same variant_id", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({
      collection_id: cid, name: "Digital Album", price: 99000, type: "digital",
      stock_qty: 10, delivery_link: "https://drive.google.com/v1",
    })
    const before = (await repo.getCollectionDetailById(cid)).products[0]

    await repo.updateProduct(pid, {
      name: "Digital Album v2", price: 120000, images: [],
      stock_qty: 5, delivery_link: "https://drive.google.com/v2",
    })

    const after = (await repo.getCollectionDetailById(cid)).products[0]
    expect(after.name).toBe("Digital Album v2")
    expect(after.stock_qty).toBe(5)
    expect(after.delivery_link).toBe("https://drive.google.com/v2")
    expect(after.variant_id).toBe(before.variant_id)
  })

  it("does not throw VariantInUseError when updating a digital product with a live order", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({
      collection_id: cid, name: "Digital Album", price: 99000, type: "digital", stock_qty: 10,
    })
    const variantId = (await repo.getCollectionDetailById(cid)).products[0].variant_id
    await db.query(
      `INSERT INTO orders (order_token, buyer_name, phone, email, fulfillment_method, status, payment_method, total, expires_at, access_pin_hash)
       VALUES ('tok1', 'A', '0900000000', 'a@example.com', 'digital', 'pending', 'bank', 99000, NOW(), 'x')`
    )
    const [[o]] = await db.query("SELECT id FROM orders WHERE order_token = 'tok1'")
    await db.query(
      "INSERT INTO order_items (order_id, product_variant_id, product_name_snapshot, variant_label_snapshot, unit_price_snapshot, qty) VALUES (?, ?, 'Digital Album', '', 99000, 1)",
      [o.id, variantId]
    )

    await expect(repo.updateProduct(pid, { name: "Digital Album", price: 99000, stock_qty: 10 })).resolves.toBe(true)
  })

  it("copyCollection carries a digital product's type, stock_qty, and delivery_link through", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    await repo.createProduct({
      collection_id: cid, name: "Digital Album", price: 99000, type: "digital",
      stock_qty: 3, delivery_link: "https://drive.google.com/orig",
    })

    const newId = await repo.copyCollection(cid)
    const copy = await repo.getCollectionDetailById(newId)
    expect(copy.products[0].type).toBe("digital")
    expect(copy.products[0].stock_qty).toBe(3)
    expect(copy.products[0].delivery_link).toBe("https://drive.google.com/orig")
  })
})
```

Add `import db from "../db.js"` to the top of the file if not already imported (check the existing import list first - `catalogRepo.test.js` already imports `db` per its header shown during planning; if present, skip this).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/catalogRepo.test.js`
Expected: the 5 new tests FAIL (product.type undefined, etc.); existing tests still pass.

- [ ] **Step 3: Implement `createProduct`**

In `backend/shop/catalogRepo.js`, replace the existing `createProduct` function:

```js
async function createProduct(data) {
  const sortOrder = await nextSortOrder("products", "WHERE collection_id = ?", [data.collection_id])
  const type = data.type === "digital" ? "digital" : "physical"
  const [res] = await db.query(
    `INSERT INTO products (collection_id, name, description, price, images, type, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.collection_id,
      data.name,
      data.description || null,
      Number(data.price) || 0,
      JSON.stringify(data.images || []),
      type,
      sortOrder,
    ]
  )
  const productId = res.insertId
  // Digital products have no admin-managed variant list - this single
  // hidden row (no label) carries stock_qty/delivery_link through the same
  // variant_id-based cart/order_items/stock-decrement pipeline unchanged.
  if (type === "digital") {
    await replaceVariants(productId, [{
      label: "",
      stock_qty: data.stock_qty,
      delivery_link: data.delivery_link,
    }])
  }
  return productId
}
```

- [ ] **Step 4: Implement `updateProduct`**

Replace the existing `updateProduct` function:

```js
async function updateProduct(id, data) {
  const [[existing]] = await db.query("SELECT type FROM products WHERE id = ?", [id])
  if (!existing) return false

  const [res] = await db.query(
    "UPDATE products SET name = ?, description = ?, price = ?, images = ? WHERE id = ?",
    [data.name, data.description || null, Number(data.price) || 0, JSON.stringify(data.images || []), id]
  )

  if (existing.type === "digital") {
    // Reuses the hidden variant's own id - replaceVariants must UPDATE it,
    // never delete-and-recreate: order_items.product_variant_id would SET
    // NULL on every edit, and a live order referencing it would make
    // replaceVariants throw VariantInUseError on an ordinary product edit.
    const [[currentVariant]] = await db.query(
      "SELECT id FROM product_variants WHERE product_id = ? LIMIT 1",
      [id]
    )
    await replaceVariants(id, [{
      id: currentVariant ? currentVariant.id : undefined,
      label: "",
      stock_qty: data.stock_qty,
      delivery_link: data.delivery_link,
    }])
  }

  return res.affectedRows > 0
}
```

- [ ] **Step 5: Add `delivery_link` to `replaceVariants`**

In `replaceVariants`, change the two SQL statements inside the `for (const [index, v] of list.entries())` loop:

```js
      if (v.id) {
        await conn.query(
          "UPDATE product_variants SET label = ?, image_url = ?, images = ?, thumbnail_image = ?, description = ?, stock_qty = ?, delivery_link = ?, sort_order = ? WHERE id = ? AND product_id = ?",
          [v.label, imageUrl, JSON.stringify(images), v.thumbnail_image || null, v.description || null, stock, v.delivery_link || null, index, v.id, productId]
        )
      } else {
        await conn.query(
          "INSERT INTO product_variants (product_id, label, image_url, images, thumbnail_image, description, stock_qty, delivery_link, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [productId, v.label, imageUrl, JSON.stringify(images), v.thumbnail_image || null, v.description || null, stock, v.delivery_link || null, index]
        )
      }
```

- [ ] **Step 6: Flatten the hidden variant in `nestCollectionDetail`**

Replace the `return { ...mapCollection(collection), products: ... }` block at the end of `nestCollectionDetail`:

```js
  return {
    ...mapCollection(collection),
    products: products.map((p) => {
      const productVariants = byProduct.get(p.id) || []
      // Digital products have no variant list in any UI - the one hidden
      // variant they do have is flattened onto the product itself here so
      // nothing downstream needs to know it secretly exists.
      if (p.type === "digital") {
        const hidden = productVariants[0] || null
        return {
          ...p,
          images: parseImages(p.images),
          variants: [],
          variant_id: hidden?.id ?? null,
          stock_qty: hidden?.stock_qty ?? null,
          delivery_link: hidden?.delivery_link ?? null,
        }
      }
      return {
        ...p,
        images: parseImages(p.images),
        variants: productVariants,
      }
    }),
  }
```

- [ ] **Step 7: Carry digital fields through `copyCollection`**

In `copyCollection`, replace the `for (const p of source.products) { ... }` loop body:

```js
  for (const p of source.products) {
    const newProductId = await createProduct({
      collection_id: newId,
      name: p.name,
      description: p.description,
      price: p.price,
      images: p.images,
      type: p.type,
      stock_qty: p.stock_qty,
      delivery_link: p.delivery_link,
    })
    if (p.type !== "digital" && p.variants.length) {
      await replaceVariants(
        newProductId,
        p.variants.map((v) => ({
          label: v.label, image_url: v.image_url, images: v.images,
          thumbnail_image: v.thumbnail_image, description: v.description, stock_qty: v.stock_qty,
          delivery_link: v.delivery_link,
        }))
      )
    }
  }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/catalogRepo.test.js`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add backend/shop/catalogRepo.js backend/tests/catalogRepo.test.js
git commit -m "feat(shop): digital product create/update with hidden variant, flattened for buyers"
```

---

### Task 3: Admin catalog route validation for digital products

**Files:**
- Modify: `backend/routes/adminCatalog.js`
- Modify: `backend/tests/adminCatalogRoutes.test.js`

**Interfaces:**
- Consumes: `catalogRepo.createProduct`/`updateProduct` (Task 2).
- Produces: `validateProduct(body)` now also rejects an invalid `type`, and - when `type === "digital"` - an invalid `stock_qty` or an over-length `delivery_link`.

- [ ] **Step 1: Write failing route tests**

In `backend/tests/adminCatalogRoutes.test.js`, find the existing `describe` block covering `POST /collections/:id/products` (search for `validateProduct`-adjacent tests, e.g. the invalid-price test) and add nearby:

```js
  it("rejects an invalid product type", async () => {
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Album", price: 99000, type: "cd" })
    expect(res.status).toBe(400)
  })

  it("creates a digital product with stock_qty and delivery_link", async () => {
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Digital Album", price: 99000, type: "digital", stock_qty: 20, delivery_link: "https://drive.google.com/x" })
    expect(res.status).toBe(201)

    const detail = await catalog.getCollectionDetailById(cid)
    const product = detail.products.find((p) => p.id === res.body.id)
    expect(product.type).toBe("digital")
    expect(product.stock_qty).toBe(20)
    expect(product.delivery_link).toBe("https://drive.google.com/x")
  })

  it("rejects a negative stock_qty on a digital product", async () => {
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Digital Album", price: 99000, type: "digital", stock_qty: -1 })
    expect(res.status).toBe(400)
  })
```

Match the file's existing `cid`/`authed`/`catalog` setup variables exactly as used by neighboring tests in the same file (read the file's top-level `beforeEach`/helpers before inserting - do not redeclare `cid` or `authed` if they already exist in an enclosing scope).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/adminCatalogRoutes.test.js`
Expected: the 3 new tests FAIL (type/stock_qty currently unvalidated, and the create succeeds but returns no digital fields).

- [ ] **Step 3: Update `validateProduct`**

In `backend/routes/adminCatalog.js`, replace `validateProduct`:

```js
function validateProduct(body) {
  if (!body.name || !String(body.name).trim()) return "Cần tên sản phẩm"
  if (String(body.name).length > NAME_MAX_LEN) return `Tên sản phẩm không được quá ${NAME_MAX_LEN} ký tự`
  const price = Number(body.price)
  if (!Number.isInteger(price) || price < 0) return "Giá phải là số nguyên không âm (VND)"
  if (body.type !== undefined && !["physical", "digital"].includes(body.type)) return "Loại sản phẩm không hợp lệ"
  if (body.type === "digital") {
    if (body.stock_qty !== null && body.stock_qty !== undefined && body.stock_qty !== "") {
      const stock = Number(body.stock_qty)
      if (!Number.isInteger(stock) || stock < 0) return "Số lượng phải là số nguyên không âm, hoặc để trống nếu không giới hạn"
    }
    if (body.delivery_link && String(body.delivery_link).length > 2048) return "Link tải về quá dài"
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/adminCatalogRoutes.test.js`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/adminCatalog.js backend/tests/adminCatalogRoutes.test.js
git commit -m "feat(shop): validate digital product type/stock_qty/delivery_link on admin catalog routes"
```

---

### Task 4: Order domain and repo - no COD with digital, auto fulfillment_method, delivery_link snapshot

**Files:**
- Modify: `backend/shop/orders/domain.js`
- Modify: `backend/shop/orders/orderRepo.js`
- Modify: `backend/tests/orderDomain.test.js`
- Modify: `backend/tests/orderRepo.test.js`

**Interfaces:**
- Consumes: `products.type`, `product_variants.delivery_link`, `order_items.delivery_link_snapshot`, `orders.fulfillment_method` (extended) from Task 1.
- Produces: `domain.canTransition(from, to, fulfillment)` also forbids `'digital'` orders from reaching `'shipped'`. `orderRepo.createOrder` throws `NoCodForDigitalError` (any digital line + `payment_method === 'cod'`) or `FulfillmentRequiredError` (a physical line present but `fulfillment_method` isn't `'ship'`/`'pickup'`); on success, all-digital carts get `fulfillment_method: 'digital'` persisted and no address; every `order_items` row gets `delivery_link_snapshot` populated for digital lines. Both new error classes are exported from `orderRepo.js` alongside the existing ones.

- [ ] **Step 1: Write a failing domain test**

In `backend/tests/orderDomain.test.js`, find the existing `describe("canTransition", ...)` (or equivalent) block covering the pickup-can't-ship rule, and add next to it:

```js
  it("never lets a digital order reach 'shipped' - there is nothing to ship", () => {
    expect(domain.canTransition("confirmed", "shipped", "digital")).toBe(false)
    expect(domain.canTransition("confirmed", "completed", "digital")).toBe(true)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/orderDomain.test.js`
Expected: FAIL (`canTransition("confirmed", "shipped", "digital")` currently returns `true`).

- [ ] **Step 3: Update `domain.canTransition`**

In `backend/shop/orders/domain.js`, replace:

```js
function canTransition(from, to, fulfillment) {
  const allowed = TRANSITIONS[from]
  if (!allowed || !allowed.includes(to)) return false
  if ((fulfillment === "pickup" || fulfillment === "digital") && to === "shipped") return false
  return true
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/orderDomain.test.js`
Expected: passes.

- [ ] **Step 5: Write failing orderRepo tests**

In `backend/tests/orderRepo.test.js`, add a helper next to `seedVariant` (same file, same conventions):

```js
async function seedDigitalVariant(stock, deliveryLink = "https://drive.google.com/x", collectionOver = {}) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active", ...collectionOver })
  const pid = await catalog.createProduct({
    collection_id: cid, name: "Digital Album", price: 99000, type: "digital",
    stock_qty: stock, delivery_link: deliveryLink,
  })
  const detail = await catalog.getCollectionDetailById(cid)
  return { cid, pid, variantId: detail.products[0].variant_id }
}
```

Add a new `describe` block:

```js
describe("createOrder - digital items", () => {
  it("rejects COD when the cart has any digital item", async () => {
    const { variantId } = await seedDigitalVariant(10)
    await expect(
      repo.createOrder(order(variantId, 1, { payment_method: "cod", fulfillment_method: "digital" }))
    ).rejects.toThrow(repo.NoCodForDigitalError)
  })

  it("rejects COD on a mixed cart (physical + digital)", async () => {
    const { variantId: digitalId } = await seedDigitalVariant(10)
    const { variantId: physicalId } = await seedVariant(5)
    await expect(
      repo.createOrder({
        items: [{ variant_id: digitalId, qty: 1 }, { variant_id: physicalId, qty: 1 }],
        buyer,
        fulfillment_method: "ship",
        payment_method: "cod",
      })
    ).rejects.toThrow(repo.NoCodForDigitalError)
  })

  it("forces fulfillment_method to 'digital' and skips address for an all-digital cart", async () => {
    const { variantId } = await seedDigitalVariant(10)
    const res = await repo.createOrder({
      items: [{ variant_id: variantId, qty: 1 }],
      buyer,
      payment_method: "bank",
    })

    const [[row]] = await db.query("SELECT fulfillment_method, address_raw FROM orders WHERE id = ?", [res.id])
    expect(row.fulfillment_method).toBe("digital")
    expect(row.address_raw).toBeNull()
  })

  it("still requires ship/pickup for a mixed cart", async () => {
    const { variantId: digitalId } = await seedDigitalVariant(10)
    const { variantId: physicalId } = await seedVariant(5)
    await expect(
      repo.createOrder({
        items: [{ variant_id: digitalId, qty: 1 }, { variant_id: physicalId, qty: 1 }],
        buyer,
        payment_method: "bank",
      })
    ).rejects.toThrow(repo.FulfillmentRequiredError)
  })

  it("snapshots delivery_link_snapshot on the digital line, null on physical lines", async () => {
    const { variantId: digitalId } = await seedDigitalVariant(10, "https://drive.google.com/y")
    const { variantId: physicalId } = await seedVariant(5)
    await repo.createOrder({
      items: [{ variant_id: digitalId, qty: 1 }, { variant_id: physicalId, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    const [rows] = await db.query(
      "SELECT product_variant_id, delivery_link_snapshot FROM order_items ORDER BY id ASC"
    )
    expect(rows.find((r) => r.product_variant_id === digitalId).delivery_link_snapshot).toBe("https://drive.google.com/y")
    expect(rows.find((r) => r.product_variant_id === physicalId).delivery_link_snapshot).toBeNull()
  })

  it("decrements a digital product's stock_qty like any other variant", async () => {
    const { variantId } = await seedDigitalVariant(3)
    await repo.createOrder({ items: [{ variant_id: variantId, qty: 2 }], buyer, payment_method: "bank" })

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(1)
  })
})
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/orderRepo.test.js`
Expected: the 6 new tests FAIL (`repo.NoCodForDigitalError`/`repo.FulfillmentRequiredError` don't exist yet; `fulfillment_method` isn't forced; snapshot column unused).

- [ ] **Step 7: Add the two new error classes**

In `backend/shop/orders/orderRepo.js`, add after the existing `class CollectionNotActiveError { ... }` block:

```js
/** COD collects cash at physical delivery - nothing to collect once a digital good has already been emailed out. */
class NoCodForDigitalError extends Error {
  constructor() {
    super("Không hỗ trợ thanh toán COD cho đơn có sản phẩm số")
    this.name = "NoCodForDigitalError"
  }
}

/** A cart with at least one physical line must pick ship/pickup - only an all-digital cart may omit it. */
class FulfillmentRequiredError extends Error {
  constructor() {
    super("Hình thức nhận hàng không hợp lệ")
    this.name = "FulfillmentRequiredError"
  }
}
```

- [ ] **Step 8: Rework `createOrder`'s type-aware logic**

In `createOrder`, change the SELECT to also fetch `p.type` and `v.delivery_link`:

```js
    const [rows] = await conn.query(
      `SELECT v.id, v.label, v.stock_qty, v.delivery_link, p.id AS product_id, p.name AS product_name, p.type AS product_type,
              p.price, p.collection_id, c.status AS collection_status,
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

    const allDigital = rows.every((r) => r.product_type === "digital")
    const anyDigital = rows.some((r) => r.product_type === "digital")

    if (anyDigital && input.payment_method === "cod") {
      throw new NoCodForDigitalError()
    }
    if (!allDigital && !["ship", "pickup"].includes(input.fulfillment_method)) {
      throw new FulfillmentRequiredError()
    }
    const fulfillmentMethod = allDigital ? "digital" : input.fulfillment_method

    // Every line's collection must still be open for ordering, and - for a
    // physical line - must actually offer the requested fulfillment method.
    // A digital line is never checked against allow_ship/allow_pickup: those
    // flags describe how a collection ships/hands over physical goods, and
    // have nothing to say about a line that was never going to be shipped.
    for (const row of rows) {
      if (row.collection_status !== "active") {
        throw new CollectionNotActiveError(row.label, row.product_name)
      }
      if (row.product_type !== "digital") {
        if (fulfillmentMethod === "ship" && !row.allow_ship) {
          throw new FulfillmentNotOfferedError("ship")
        }
        if (fulfillmentMethod === "pickup" && !row.allow_pickup) {
          throw new FulfillmentNotOfferedError("pickup")
        }
      }
    }
```

Then, in the `lines.push({...})` block a little further down, add the snapshot field:

```js
      lines.push({
        variant_id: id,
        qty,
        product_name_snapshot: variant.product_name,
        variant_label_snapshot: variant.label,
        unit_price_snapshot: variant.price,
        collection_id: variant.collection_id,
        delivery_link_snapshot: variant.product_type === "digital" ? variant.delivery_link : null,
      })
```

Next, replace the `isPickup`/address section:

```js
    const token = domain.generateOrderToken()
    const deadlineHours = byId.get(lines[0].variant_id).payment_deadline_hours || undefined
    const expiresAt = domain.computeExpiry(input.payment_method, new Date(), deadlineHours)
    const isPickup = fulfillmentMethod === "pickup"
    // Neither a pickup nor an all-digital order has anywhere to ship to.
    const skipAddress = isPickup || fulfillmentMethod === "digital"
    const pickupCode = isPickup ? domain.generatePickupCode() : null
    const accessPin = domain.generateAccessPin()
    const accessPinHash = domain.hashAccessPin(accessPin)

    const [res] = await conn.query(
      `INSERT INTO orders
         (order_token, request_key, buyer_name, phone, email, fulfillment_method,
          address_street, address_ward, address_district, address_province, address_raw,
          note, status, payment_method, total, cod_amount, collection_id, expires_at, pickup_code,
          access_pin_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      [
        token,
        input.request_key || null,
        buyer.buyer_name,
        buyer.phone,
        buyer.email,
        fulfillmentMethod,
        skipAddress ? null : buyer.address_street || null,
        skipAddress ? null : buyer.address_ward || null,
        skipAddress ? null : buyer.address_district || null,
        skipAddress ? null : buyer.address_province || null,
        skipAddress ? null : buyer.address_raw || null,
        input.note || null,
        input.payment_method,
        total,
        input.payment_method === "cod" ? total : null,
        lines[0].collection_id,
        expiresAt,
        pickupCode,
        accessPinHash,
      ]
    )

    for (const line of lines) {
      await conn.query(
        `INSERT INTO order_items
           (order_id, product_variant_id, product_name_snapshot,
            variant_label_snapshot, unit_price_snapshot, qty, delivery_link_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [res.insertId, line.variant_id, line.product_name_snapshot,
         line.variant_label_snapshot, line.unit_price_snapshot, line.qty, line.delivery_link_snapshot]
      )
    }
```

- [ ] **Step 9: Export the new error classes**

In the `module.exports` block at the bottom of `orderRepo.js`, add `NoCodForDigitalError` and `FulfillmentRequiredError` alongside the existing error exports.

- [ ] **Step 10: Run to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/orderRepo.test.js tests/orderDomain.test.js`
Expected: all tests pass (this file is ~840 lines - run the full file, not a `-t` filter, to catch any regression in the untouched physical-order tests too).

- [ ] **Step 11: Commit**

```bash
git add backend/shop/orders/domain.js backend/shop/orders/orderRepo.js backend/tests/orderDomain.test.js backend/tests/orderRepo.test.js
git commit -m "feat(shop): reject COD with digital items, auto fulfillment_method=digital, snapshot delivery_link"
```

---

### Task 5: Order routes - relax fulfillment validation, map new errors, gate delivery-link exposure

**Files:**
- Modify: `backend/routes/orders.js`
- Modify: `backend/tests/orderRoutes.test.js`

**Interfaces:**
- Consumes: `repo.NoCodForDigitalError`, `repo.FulfillmentRequiredError` (Task 4).
- Produces: `POST /api/orders` now accepts a request with `fulfillment_method` omitted (all-digital cart), maps both new errors to `400`. `GET /api/orders/:token` (`toPublicOrder`) exposes each item's `delivery_link_snapshot` only when `order.status` is `confirmed`/`shipped`/`completed`.

- [ ] **Step 1: Write failing route tests**

In `backend/tests/orderRoutes.test.js`, add a helper next to `seed` (same conventions as that file):

```js
async function seedDigital(stock = 5, deliveryLink = "https://drive.google.com/x") {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({
    collection_id: cid, name: "Digital Album", price: 99000, type: "digital",
    stock_qty: stock, delivery_link: deliveryLink,
  })
  const detail = await catalog.getCollectionDetailById(cid)
  return detail.products[0].variant_id
}
```

Add a new `describe` block:

```js
describe("POST /api/orders - digital items", () => {
  it("accepts an all-digital cart with no fulfillment_method or address", async () => {
    const v = await seedDigital()
    const res = await request(app).post("/api/orders").send({
      items: [{ variant_id: v, qty: 1 }],
      buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com" },
      payment_method: "bank",
    })
    expect(res.status).toBe(201)
  })

  it("rejects COD for an all-digital cart", async () => {
    const v = await seedDigital()
    const res = await request(app).post("/api/orders").send({
      items: [{ variant_id: v, qty: 1 }],
      buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com" },
      payment_method: "cod",
    })
    expect(res.status).toBe(400)
  })

  it("rejects a mixed cart with no fulfillment_method", async () => {
    const digital = await seedDigital()
    const physical = await seed(5)
    const res = await request(app).post("/api/orders").send({
      items: [{ variant_id: digital, qty: 1 }, { variant_id: physical, qty: 1 }],
      buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "1 ABC" },
      payment_method: "bank",
    })
    expect(res.status).toBe(400)
  })
})

describe("GET /api/orders/:token - digital delivery link exposure", () => {
  it("hides delivery_link_snapshot while pending", async () => {
    const v = await seedDigital(5, "https://drive.google.com/hidden")
    const created = await request(app).post("/api/orders").send({
      items: [{ variant_id: v, qty: 1 }],
      buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com" },
      payment_method: "bank",
    })
    const res = await authed(request(app).get(`/api/orders/${created.body.order_token}`))
    expect(res.body.items[0].delivery_link_snapshot).toBeFalsy()
  })

  it("shows delivery_link_snapshot once confirmed", async () => {
    const v = await seedDigital(5, "https://drive.google.com/shown")
    const created = await request(app).post("/api/orders").send({
      items: [{ variant_id: v, qty: 1 }],
      buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com" },
      payment_method: "bank",
    })
    const [[o]] = await db.query("SELECT id FROM orders WHERE order_token = ?", [created.body.order_token])
    await orders.transitionOrder(o.id, "confirmed")

    const res = await authed(request(app).get(`/api/orders/${created.body.order_token}`))
    expect(res.body.items[0].delivery_link_snapshot).toBe("https://drive.google.com/shown")
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/orderRoutes.test.js`
Expected: FAIL - `fulfillment_method` is still required by `validate()`, and `toPublicOrder` doesn't project `delivery_link_snapshot` at all yet.

- [ ] **Step 3: Relax `validate()`'s fulfillment check**

In `backend/routes/orders.js`, replace this line inside `validate`:

```js
  if (!FULFILLMENT.includes(fulfillment_method)) return "Hình thức nhận hàng không hợp lệ"
```

with:

```js
  // A physical line requires ship/pickup; an all-digital cart may omit it
  // entirely - orderRepo.createOrder is the only place that knows a cart's
  // item types, so it does the real requiredness check and throws
  // FulfillmentRequiredError if a physical line has none.
  if (fulfillment_method !== undefined && fulfillment_method !== null && !FULFILLMENT.includes(fulfillment_method)) {
    return "Hình thức nhận hàng không hợp lệ"
  }
```

- [ ] **Step 4: Map the two new errors in the route's catch block**

In the `router.post("/", ...)` handler's `catch` block, add right after the `FulfillmentNotOfferedError` check:

```js
      if (err instanceof repo.NoCodForDigitalError) return bad(res, err.message)
      if (err instanceof repo.FulfillmentRequiredError) return bad(res, err.message)
```

- [ ] **Step 5: Gate `delivery_link_snapshot` in `toPublicOrder`**

In `toPublicOrder`, right before the `return { ... }`, add:

```js
  // Same trust boundary as pickup_code above - a link that's fixed on the
  // product for every buyer is only worth showing once the seller has
  // actually accepted (confirmed) the order, never for pending/cancelled.
  const showDelivery = ["confirmed", "shipped", "completed"].includes(status)
  const publicItems = (items || []).map((i) => ({
    ...i,
    delivery_link_snapshot: showDelivery ? i.delivery_link_snapshot : null,
  }))
```

Then change the `items` key in the returned object from `items` to `publicItems` - i.e. in the two lines `id, order_token, status, total, fulfillment_method, tracking_code, created_at, items,` (destructure) and the `return { id, order_token, ..., items, ... }`, keep the destructure of `items` as-is (still needed to build `publicItems`) but change the final returned object's `items` field to `items: publicItems`:

```js
  return {
    id, order_token, status, total, fulfillment_method, tracking_code, created_at, items: publicItems,
    confirmed_at, shipped_at, completed_at, cancelled_at,
    pickup_location, pickup_note, expires_at, pickup_code: paidPickupCode,
    has_payment_proof: Boolean(payment_proof_url),
    payment_proof_url: payment_proof_url || null,
    buyer_name, phone, address_raw: address_raw || null,
    order_code: formatOrderCode(id, created_at),
    cancel_reason: cancel_reason || null,
  }
```

- [ ] **Step 6: Run to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/orderRoutes.test.js`
Expected: all pass, including every pre-existing test in this file (`fulfillment_method` is still required exactly as before for any cart with a physical item, since `FulfillmentRequiredError` catches that case).

- [ ] **Step 7: Commit**

```bash
git add backend/routes/orders.js backend/tests/orderRoutes.test.js
git commit -m "feat(shop): allow digital-only checkout with no fulfillment_method, gate delivery link exposure"
```

---

### Task 6: Email - digital delivery link in the "accepted" email

**Files:**
- Modify: `backend/shop/email/templates.js`
- Modify: `backend/tests/emailTemplates.test.js`

**Interfaces:**
- Consumes: `order.items[].delivery_link_snapshot`, `order.status`, `order.fulfillment_method` (Task 4/5).
- Produces: `itemsHtml(items, opts)` renders a "Tải về" link line under any item whose `delivery_link_snapshot` is present, when `opts.showDeliveryLink` is true. `buildVars(order)`'s `prep_note` mentions the digital link when relevant.

- [ ] **Step 1: Write failing template tests**

In `backend/tests/emailTemplates.test.js`, find the existing tests around `buildVars`/`itemsHtml` (search for `prep_note` or `itemsHtml`) and add:

```js
describe("digital delivery link", () => {
  const digitalOrder = (overrides = {}) => ({
    id: 1, order_token: "tok", buyer_name: "A", total: 99000, status: "confirmed",
    fulfillment_method: "digital", created_at: new Date(),
    items: [{ product_name_snapshot: "Digital Album", variant_label_snapshot: "", qty: 1, unit_price_snapshot: 99000, delivery_link_snapshot: "https://drive.google.com/x" }],
    ...overrides,
  })

  it("renders the download link in the items block once confirmed", () => {
    const vars = templates.buildVars(digitalOrder())
    expect(vars.items).toContain("https://drive.google.com/x")
  })

  it("never renders the link while pending", () => {
    const vars = templates.buildVars(digitalOrder({ status: "pending" }))
    expect(vars.items).not.toContain("https://drive.google.com/x")
  })

  it("never renders the link once cancelled", () => {
    const vars = templates.buildVars(digitalOrder({ status: "cancelled" }))
    expect(vars.items).not.toContain("https://drive.google.com/x")
  })

  it("mentions the digital link in prep_note for an all-digital order", () => {
    const vars = templates.buildVars(digitalOrder())
    expect(vars.prep_note).toContain("tải")
  })

  it("still mentions the digital link in prep_note for a mixed ship+digital order", () => {
    const vars = templates.buildVars(digitalOrder({
      fulfillment_method: "ship",
      items: [
        ...digitalOrder().items,
        { product_name_snapshot: "Card", variant_label_snapshot: "A1", qty: 1, unit_price_snapshot: 35000, delivery_link_snapshot: null },
      ],
    }))
    expect(vars.prep_note).toContain("tải")
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/emailTemplates.test.js`
Expected: FAIL - link never rendered, `prep_note` never mentions it.

- [ ] **Step 3: Update `itemsHtml` and `buildVars`**

In `backend/shop/email/templates.js`, replace `itemsHtml`:

```js
function itemsHtml(items = [], { showDeliveryLink = false } = {}) {
  const rows = items.map((i) => `
    <tr>
      <td style="padding:8px 8px 8px 0;border-bottom:1px solid #f0f0f0;width:44px">
        ${i.image_url
          ? `<img src="${escapeHtml(SITE_URL + i.image_url)}" width="44" height="44" style="width:44px;height:44px;object-fit:cover;border-radius:8px;display:block" />`
          : ""}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px">
        ${escapeHtml(i.product_name_snapshot)}${i.variant_label_snapshot ? ` · ${escapeHtml(i.variant_label_snapshot)}` : ""} × ${Number(i.qty)}
        ${showDeliveryLink && i.delivery_link_snapshot
          ? `<br/><a href="${escapeHtml(i.delivery_link_snapshot)}" style="color:${BRAND}">Tải về</a>`
          : ""}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-size:14px;white-space:nowrap">${formatVnd(i.unit_price_snapshot * i.qty)}</td>
    </tr>`).join("")
  return `<table style="width:100%;border-collapse:collapse;margin-top:12px">${rows}</table>`
}
```

Replace `buildVars`:

```js
function buildVars(order) {
  const showDeliveryLink = ["confirmed", "shipped", "completed"].includes(order.status)
  const hasDigitalItem = (order.items || []).some((i) => i.delivery_link_snapshot)
  const digitalNote = "Link tải sản phẩm số đã có trong danh sách bên dưới."

  return {
    order_id: escapeHtml(formatOrderCode(order.id, order.created_at)),
    order_token: escapeHtml(order.order_token),
    order_url: `${SITE_URL}/order/${order.order_token}`,
    buyer_name: escapeHtml(order.buyer_name),
    total: formatVnd(order.total),
    items: itemsHtml(order.items, { showDeliveryLink }),
    status: escapeHtml(order.status),
    payment_method: escapeHtml(order.payment_method),
    fulfillment_method: escapeHtml(order.fulfillment_method),
    tracking_code: escapeHtml(order.tracking_code || ""),
    payment_note: escapeHtml(order.payment_note || ""),
    shop_name: escapeHtml(SHOP_NAME),
    receiver_info: receiverInfoHtml(order),
    shipping_fee_note: order.fulfillment_method === "ship"
      ? `<p style="font-size:12px;color:#888;margin:12px 0 0">Phí ship trả cho shipper khi nhận hàng.</p>`
      : "",
    prep_note: order.fulfillment_method === "digital"
      ? digitalNote
      : order.fulfillment_method === "pickup"
        ? "sẽ chuẩn bị hàng - mang mã QR hoặc mã xác nhận nhận hàng đến sự kiện để nhận." + (hasDigitalItem ? ` ${digitalNote}` : "")
        : "sẽ chuẩn bị và gửi hàng sớm nhất có thể." + (hasDigitalItem ? ` ${digitalNote}` : ""),
  }
}
```

- [ ] **Step 4: Update `receiverInfoHtml` for the digital fulfillment value**

`receiverInfoHtml` currently only branches on `"ship"`/`"pickup"` - a `"digital"` order falls through both `if`s already and renders just name/phone, which is correct (no address, no pickup location). No code change needed here; add a one-line comment for clarity, right above the two existing `if` blocks in `receiverInfoHtml`:

```js
  // A 'digital' order falls through both branches below - name/phone only, no address or pickup info to show.
```

- [ ] **Step 5: Run to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/emailTemplates.test.js`
Expected: all pass, including pre-existing tests (the physical-only `variant_label_snapshot` is always truthy in those, so the new `? ... : ""` branch renders identically to the old hardcoded `· ${label}`).

- [ ] **Step 6: Check `sender.test.js` for any direct `itemsHtml`/`buildVars` call signature that needs updating**

Run: `grep -n "itemsHtml\|buildVars" backend/tests/sender.test.js`. If any call sites pass positional args matching the old `itemsHtml(items)` signature, they still work unchanged (the new second parameter is optional). No action needed unless a call constructs a full mocked `templates` module with a fixed function arity check (unlikely - confirm by running the file).

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/sender.test.js`
Expected: passes unchanged.

- [ ] **Step 7: Commit**

```bash
git add backend/shop/email/templates.js backend/tests/emailTemplates.test.js
git commit -m "feat(shop): render digital delivery link in the accepted email, gated to confirmed+"
```

---

### Task 7: Admin UI - digital product type and fields

**Files:**
- Modify: `frontend/src/components/AdminProducts.jsx`
- Modify: `frontend/src/components/AdminProducts.test.jsx`

**Interfaces:**
- Consumes: `adminCreateProduct`/`adminUpdateProduct` (`frontend/src/api/shop.js`, unchanged signatures - they already forward whatever object they're given).
- Produces: the product create/edit form gains a Physical/Digital type toggle (create-only) and, for digital, `Stock quantity`/`Delivery link` fields in place of the variant-list flow.

- [ ] **Step 1: Write failing tests**

In `frontend/src/components/AdminProducts.test.jsx`, add (matching the file's existing render/mock helpers - read the file's top-of-file `vi.mock`/render helper before inserting, and reuse it rather than redefining):

```js
describe("digital products", () => {
  it("creates a digital product with stock_qty and delivery_link, no variant button", async () => {
    adminGetCollection.mockResolvedValue({ products: [] })
    adminCreateProduct.mockResolvedValue({ id: 1 })

    const container = await renderAdminProducts()

    const typeSelect = container.querySelector('select[name="product-type"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
      setter.call(typeSelect, "digital")
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(container.querySelector('input[placeholder="Số lượng"]')).toBeTruthy()
    expect(container.querySelector('input[placeholder="Link tải về"]')).toBeTruthy()

    const nameInput = container.querySelector('input[placeholder="Tên sản phẩm"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      setter.call(nameInput, "Digital Album")
      nameInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Thêm")
    await act(async () => { saveButton.click() })

    expect(adminCreateProduct).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ name: "Digital Album", type: "digital" })
    )
  })

  it("hides the variant/Phân loại button for a digital product", async () => {
    adminGetCollection.mockResolvedValue({
      products: [{ id: 1, name: "Digital Album", price: 99000, type: "digital", images: [], stock_qty: 10, delivery_link: "https://x" }],
    })

    const container = await renderAdminProducts()

    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Phân loại")).toBe(false)
  })

  it("still shows the variant/Phân loại button for a physical product", async () => {
    adminGetCollection.mockResolvedValue({
      products: [{ id: 1, name: "Card", price: 35000, type: "physical", images: [], variants: [] }],
    })

    const container = await renderAdminProducts()

    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Phân loại")).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/AdminProducts.test.jsx`
Expected: FAIL - no `select[name="product-type"]` exists yet, "Phân loại" button always renders.

- [ ] **Step 3: Update `AdminProducts.jsx`**

Change the `blank` constant:

```js
const blank = { name: "", description: "", price: "", images: [], type: "physical", stock_qty: "", delivery_link: "" }
```

Change `save` to only send `type`/`stock_qty`/`delivery_link` on create (type is immutable - omit it from the update payload since the backend ignores it anyway, but still send `stock_qty`/`delivery_link` so edits to a digital product's own fields persist):

```js
  const save = async () => {
    setError("")
    try {
      const payload = { ...draft, price: Number(draft.price) || 0 }
      if (editingId) await adminUpdateProduct(editingId, payload)
      else await adminCreateProduct(collection.id, payload)

      setDraft(blank)
      setEditingId(null)
      await reload()
    } catch (e) {
      setError(e.response?.data?.message || "Lưu sản phẩm thất bại")
    }
  }
```

(No structural change needed here beyond what's already there - `draft` now simply carries the three new fields through unchanged, since `payload = { ...draft, ... }` already spreads everything.)

Change `edit`:

```js
  const edit = (p) => {
    setEditingId(p.id)
    setDraft({
      name: p.name, description: p.description || "", price: p.price, images: p.images || [],
      type: p.type || "physical", stock_qty: p.stock_qty ?? "", delivery_link: p.delivery_link || "",
    })
  }
```

In the `form` JSX, right after the `<p className="font-medium mb-2">...</p>` line, add the type toggle (create-only - hidden while editing, since type is immutable):

```jsx
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

Right after the existing `name`/`price`/`description` inputs and before the image `<input type="file" .../>`, add the digital-only fields:

```jsx
      {draft.type === "digital" && (
        <>
          <input
            value={draft.stock_qty}
            onChange={(e) => setDraft({ ...draft, stock_qty: e.target.value })}
            placeholder="Số lượng"
            inputMode="numeric"
            className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
          <input
            value={draft.delivery_link}
            onChange={(e) => setDraft({ ...draft, delivery_link: e.target.value })}
            placeholder="Link tải về"
            className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
        </>
      )}
```

Finally, in the products list render, hide the "Phân loại" (variant) button and the expanded `<AdminVariants>` block for a digital product:

```jsx
            <div className="flex gap-2 shrink-0">
              {p.type !== "digital" && (
                <button
                  type="button"
                  onClick={() => setExpandedProductId(expandedProductId === p.id ? null : p.id)}
                  className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]"
                >
                  {expandedProductId === p.id ? "Thu gọn" : "Phân loại"}
                </button>
              )}
              <button type="button" onClick={() => edit(p)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Sửa</button>
              <button type="button" onClick={() => remove(p.id)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Xóa</button>
            </div>
          </div>
          {p.type !== "digital" && expandedProductId === p.id && <AdminVariants product={p} onSaved={reload} />}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run src/components/AdminProducts.test.jsx`
Expected: all pass, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminProducts.jsx frontend/src/components/AdminProducts.test.jsx
git commit -m "feat(shop): digital product type toggle and stock/delivery-link fields in admin"
```

---

### Task 8: Admin UI - digital badge and link on order detail

**Files:**
- Modify: `frontend/src/components/AdminOrders.jsx`
- Modify: `frontend/src/components/AdminOrders.test.jsx`

**Interfaces:**
- Consumes: `order.items[].delivery_link_snapshot` (always present, unfiltered, on admin's `repo.getOrderById` - Task 4/5's gating only applies to the buyer-facing route).

- [ ] **Step 1: Write a failing test**

In `frontend/src/components/AdminOrders.test.jsx`, find the test(s) covering the order-detail item list (search for `product_name_snapshot`) and add nearby, matching that test's existing mock/render setup:

```js
  it("shows a digital badge and the delivery link for a digital line item", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    adminGetOrder.mockResolvedValue(order({
      id: 1, email: "a@b.com",
      items: [{ id: 1, product_name_snapshot: "Digital Album", variant_label_snapshot: "", qty: 1, unit_price_snapshot: 99000, delivery_link_snapshot: "https://drive.google.com/x" }],
    }))
    const { container } = await renderAdminOrders()
    await flush()

    const detailBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết")
    await act(async () => { detailBtn.click() })
    await flush()

    expect(container.textContent).toContain("Số")
    expect(container.querySelector('a[href="https://drive.google.com/x"]')).toBeTruthy()
  })

  it("shows no digital badge or link for a physical line item", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    adminGetOrder.mockResolvedValue(order({
      id: 1, email: "a@b.com",
      items: [{ id: 1, product_name_snapshot: "Card", variant_label_snapshot: "A1", qty: 1, unit_price_snapshot: 35000, delivery_link_snapshot: null }],
    }))
    const { container } = await renderAdminOrders()
    await flush()

    const detailBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết")
    await act(async () => { detailBtn.click() })
    await flush()

    expect(container.textContent).not.toContain("Số")
  })
```

(`order(...)`/`renderAdminOrders`/`flush` are this file's existing helpers, defined near the top - reuse them as-is, matching the exact click-to-expand sequence already used by the file's "collapses the detail panel" test.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/AdminOrders.test.jsx`
Expected: FAIL - no "Số" badge, link not rendered.

- [ ] **Step 3: Update the item list rendering**

In `frontend/src/components/AdminOrders.jsx`, replace:

```jsx
              <ul className="mt-2">
                {detail.items.map((i) => (
                  <li key={i.id}>
                    {i.product_name_snapshot} · {i.variant_label_snapshot} × {i.qty} -{" "}
                    {formatVnd(i.unit_price_snapshot * i.qty)}
                  </li>
                ))}
              </ul>
```

with:

```jsx
              <ul className="mt-2">
                {detail.items.map((i) => (
                  <li key={i.id}>
                    {i.product_name_snapshot}{i.variant_label_snapshot ? ` · ${i.variant_label_snapshot}` : ""} × {i.qty} -{" "}
                    {formatVnd(i.unit_price_snapshot * i.qty)}
                    {i.delivery_link_snapshot && (
                      <>
                        {" "}
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--brand-soft)]">Số</span>
                        {" - "}
                        <a href={i.delivery_link_snapshot} target="_blank" rel="noreferrer" className="text-[var(--text-link)]">
                          {i.delivery_link_snapshot}
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/AdminOrders.test.jsx`
Expected: all pass, including pre-existing tests (a physical line with an empty `variant_label_snapshot` never occurs today, so the new `? ... : ""` guard is a no-op for every existing fixture).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminOrders.jsx frontend/src/components/AdminOrders.test.jsx
git commit -m "feat(shop): show digital badge and delivery link on admin order detail"
```

---

### Task 9: Buyer UI - ProductCard renders digital products, no variant picker

**Files:**
- Modify: `frontend/src/components/shop/ProductCard.jsx`
- Modify: `frontend/src/components/shop/ProductCard.test.jsx`

**Interfaces:**
- Consumes: `product.type`, `product.variant_id`, `product.stock_qty`, `product.delivery_link` (flattened by Task 2) - note `delivery_link` is never read by `ProductCard` itself (buyer never sees it pre-purchase), only `variant_id`/`stock_qty`.
- Produces: `isProductSoldOut(p)` now handles digital products via `p.stock_qty`. A digital product's cart entry carries `is_digital: true` (consumed by Task 10).

- [ ] **Step 1: Write failing tests**

In `frontend/src/components/shop/ProductCard.test.jsx`, add a new `describe` block (matching the file's existing render helper/mocks):

```js
describe("digital products", () => {
  const digitalProduct = (overrides = {}) => ({
    id: 1, name: "Digital Album", price: 99000, type: "digital",
    images: ["https://x/cover.jpg"], variant_id: 42, stock_qty: 5,
    ...overrides,
  })

  it("has no variant picker - opens straight to add-to-cart", async () => {
    const container = await renderProductCard({ product: digitalProduct(), orderable: true })
    const card = container.querySelector('[role="button"]') || container.querySelector("article")
    await act(async () => { card.click() })

    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    expect(container.textContent).toContain("Digital Album")
  })

  it("adds to cart using the flattened variant_id", async () => {
    const container = await renderProductCard({ product: digitalProduct(), orderable: true })
    const card = container.querySelector('[role="button"]') || container.querySelector("article")
    await act(async () => { card.click() })

    const addButton = [...container.querySelectorAll("button")].find((b) => /add to cart/i.test(b.textContent))
    await act(async () => { addButton.click() })

    const cart = JSON.parse(localStorage.getItem("shop_cart"))
    expect(cart[0].variant_id).toBe(42)
    expect(cart[0].is_digital).toBe(true)
  })

  it("isProductSoldOut reads the flattened stock_qty for a digital product", () => {
    expect(isProductSoldOut(digitalProduct({ stock_qty: 0 }))).toBe(true)
    expect(isProductSoldOut(digitalProduct({ stock_qty: 5 }))).toBe(false)
    expect(isProductSoldOut(digitalProduct({ stock_qty: null }))).toBe(false)
  })

  it("shows the sold-out overlay on a digital product's cover when stock_qty is 0", async () => {
    const container = await renderProductCard({ product: digitalProduct({ stock_qty: 0 }), orderable: true })
    expect(container.textContent).toContain("Sold out")
  })
})
```

(Reuse the file's existing `renderProductCard`/`isProductSoldOut` import and localStorage-reset `beforeEach` - do not redeclare them.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/shop/ProductCard.test.jsx`
Expected: FAIL - a digital product currently renders with no click handler at all (`hasVariants` is `false` since `product.variants` is `[]`), so no dialog ever opens.

- [ ] **Step 3: Update `ProductCard.jsx`**

Replace `isProductSoldOut`:

```js
/** A digital product has no variant list - its stock lives on the flattened product.stock_qty instead. */
export const isProductSoldOut = (p) => {
  if (p.type === "digital") return p.stock_qty !== null && p.stock_qty !== undefined && p.stock_qty <= 0
  return p.variants?.length > 0 && p.variants.every(isSoldOut)
}
```

At the top of the component body, replace:

```js
  const { t } = useLanguage()
  const cover = product.images?.[0] || variantCover(product.variants?.find((v) => variantCover(v)) || {})
  const hasVariants = product.variants?.length > 0
```

with:

```js
  const { t } = useLanguage()
  const isDigital = product.type === "digital"
  // A digital product is treated exactly like a product with one variant -
  // the same single-variant code path below (no picker, straight to detail)
  // already does the right thing; this just supplies that one "variant".
  const variants = isDigital
    ? [{ id: product.variant_id, label: "", stock_qty: product.stock_qty, images: product.images }]
    : (product.variants || [])
  const cover = product.images?.[0] || variantCover(variants.find((v) => variantCover(v)) || {})
  const hasVariants = variants.length > 0
```

Then, everywhere else in the component that reads `product.variants`, replace with `variants` (the local computed value):

- `openPicker`'s body: `if (product.variants.length === 1) openDetail(product.variants[0])` → `if (variants.length === 1) openDetail(variants[0])`.
- the "grid" view's `galleryGridClasses(product.variants.length)` and its `.sort(...)` map over `product.variants` → both become `variants`.
- the detail view's `{product.variants.length > 1 && (...)}` "view all" button and its `onClick={() => setView("grid")}` → `variants.length > 1`.

Finally, fix the detail heading so an empty digital label doesn't render a trailing " · ":

```jsx
                <h3 className="font-semibold text-lg">{product.name}{detail.label ? ` · ${detail.label}` : ""}</h3>
```

And in `commitAdd`, add the `is_digital` flag to the cart entry:

```js
  const commitAdd = (v) => {
    addToCart({
      variant_id: v.id,
      qty,
      product_name: product.name,
      variant_label: v.label,
      price: product.price,
      image_url: variantCover(v) || product.images?.[0] || null,
      collection_slug: collectionSlug,
      is_digital: isDigital,
    })
    onAdded?.(v.label)
    setView(variants.length > 1 ? "grid" : null)
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run src/components/shop/ProductCard.test.jsx`
Expected: all pass, including every pre-existing physical-product test (`variants` equals `product.variants` unchanged for `type !== "digital"`, and `variant_label` for a physical variant is always truthy so the new `detail.label ? ... : ""` heading renders identically to before).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shop/ProductCard.jsx frontend/src/components/shop/ProductCard.test.jsx
git commit -m "feat(shop): render digital products in ProductCard via the single-variant path"
```

---

### Task 10: Buyer UI - Checkout hides address/fulfillment for all-digital, hides COD when any digital

**Files:**
- Modify: `frontend/src/pages/Checkout.jsx`
- Modify: `frontend/src/i18n/translations.js`
- Modify: `frontend/src/pages/Checkout.test.jsx`

**Interfaces:**
- Consumes: cart entries' `is_digital` flag (Task 9).
- Produces: new translation keys `checkoutCodUnavailableDigital` (en/vi). Checkout computes `allDigital`/`anyDigital` from the cart and adjusts the fulfillment fieldset, address block, and payment-method list accordingly; the submitted payload omits `fulfillment_method` entirely for an all-digital cart.

- [ ] **Step 1: Write failing tests**

In `frontend/src/pages/Checkout.test.jsx`, add (matching the file's existing cart-seeding/render helpers):

```js
describe("Checkout - digital cart", () => {
  const digitalCartItem = { variant_id: 1, qty: 1, price: 99000, product_name: "Digital Album", variant_label: "", is_digital: true }
  const physicalCartItem = { variant_id: 2, qty: 1, price: 35000, product_name: "Card", variant_label: "A1", is_digital: false }

  it("hides the fulfillment fieldset for an all-digital cart", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([digitalCartItem]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })

    const container = await renderCheckout()

    expect(container.querySelectorAll('input[name="fulfillment"]')).toHaveLength(0)
    expect(container.textContent).not.toContain("Delivery method")
  })

  it("hides cod for an all-digital cart", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([digitalCartItem]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank", "cod"] })

    const container = await renderCheckout()

    const options = [...container.querySelectorAll('[role="radio"]')].map((b) => b.textContent)
    expect(options).toEqual(["Bank transfer"])
  })

  it("hides cod for a mixed cart but still shows the fulfillment fieldset", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([digitalCartItem, physicalCartItem]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank", "cod"] })
    fetchCollection.mockResolvedValue({ allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null })

    const container = await renderCheckout()

    expect(container.querySelectorAll('input[name="fulfillment"]').length).toBeGreaterThan(0)
    const options = [...container.querySelectorAll('[role="radio"]')].map((b) => b.textContent)
    expect(options).toEqual(["Bank transfer"])
  })

  it("omits fulfillment_method from the submitted order for an all-digital cart", async () => {
    localStorage.setItem("shop_cart", JSON.stringify([digitalCartItem]))
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank"] })
    createOrder.mockResolvedValue({ order_token: "tok123", total: 99000 })

    const container = await renderCheckout()
    const placeOrderBtn = container.querySelector("button.w-full.rounded-xl")
    await act(async () => { placeOrderBtn.click() })

    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillment_method: undefined })
    )
  })
})
```

(`seedCart`/`renderCheckout`/`fetchPaymentMethods`/`fetchCollection`/`createOrder` are this file's existing top-of-file mocks and helpers - reuse them as-is. The submit-button selector and `[role="radio"]` assertions mirror the file's existing "Checkout - COD restricted to ship orders" and "order-page PIN bypass" blocks exactly.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/pages/Checkout.test.jsx`
Expected: FAIL - fulfillment fieldset and COD always render today regardless of cart contents.

- [ ] **Step 3: Add translation keys**

In `frontend/src/i18n/translations.js`, in the `en` block near `checkoutPayment`, add:

```js
    checkoutCodUnavailableDigital: "Cash on delivery isn't available for an order with a digital item.",
```

In the `vi` block near its `checkoutPayment` counterpart, add:

```js
    checkoutCodUnavailableDigital: "COD không áp dụng cho đơn có sản phẩm số.",
```

- [ ] **Step 4: Update `Checkout.jsx`**

Add, right after the `cart` state declaration:

```js
  const allDigital = cart.length > 0 && cart.every((c) => c.is_digital)
  const anyDigital = cart.some((c) => c.is_digital)
```

Change `loadFulfillmentFlags`'s effect to skip the fetch entirely for an all-digital cart (nothing to derive):

```js
  useEffect(() => {
    if (allDigital) return
    let ignore = false
    loadFulfillmentFlags(cart).then((f) => { if (!ignore) setFlags(f) })
    return () => { ignore = true }
  }, [cart, allDigital])
```

Change `offeredPayment` to also exclude COD whenever any cart line is digital:

```js
  const offeredPayment = useMemo(
    () => (methods || []).filter((m) => !(m === "cod" && (fulfillment === "pickup" || anyDigital))),
    [methods, fulfillment, anyDigital]
  )
```

Change `submit` to omit `fulfillment_method` and address for an all-digital cart:

```js
      const res = await createOrder({
        items: cart.map((c) => ({ variant_id: c.variant_id, qty: c.qty })),
        buyer: { ...buyer, ...(fulfillment === "ship" && !allDigital ? address : {}) },
        fulfillment_method: allDigital ? undefined : fulfillment,
        payment_method: payment,
        note,
        request_key: requestKey,
      })
```

Wrap the fulfillment `<fieldset>` block (and the two blocks right after it - the ship address block and the pickup-location block) in `{!allDigital && ( ... )}`:

```jsx
      {!allDigital && (
        <>
          <fieldset className="mb-4">
            <legend className="text-sm mb-1">{t("checkoutFulfillment")}</legend>
            {offered.map((m) => (
              <label key={m} className="mr-4 text-sm">
                <input type="radio" name="fulfillment" checked={fulfillment === m}
                  onChange={() => setFulfillment(m)} className="mr-1" />
                {m === "ship" ? t("checkoutShip") : t("checkoutPickup")}
              </label>
            ))}
            {flags.loaded && offered.length === 0 && (
              <p className="text-sm text-[var(--text-error)]">{t("checkoutNoFulfillment")}</p>
            )}
          </fieldset>

          {fulfillment === "ship" && (
            <div className="mb-4">
              <AddressFields value={address} onChange={setAddress} />
              <p className="text-xs opacity-70 mt-1">{t("checkoutShippingNote")}</p>
            </div>
          )}

          {fulfillment === "pickup" && (flags.pickup_location || flags.pickup_note) && (
            <div className="mb-4 p-3 rounded-xl border border-[var(--border-brand)] opacity-80 text-sm">
              {flags.pickup_location && (
                <p className="font-semibold">{t("shopPickupLocation")}: {flags.pickup_location}</p>
              )}
              {flags.pickup_note && <p>{t("shopPickupNote")}: {flags.pickup_note}</p>}
            </div>
          )}
        </>
      )}
```

Finally, in the payment-method block, add the "why is COD missing" note right after the `{methods && methods.length === 0 && ...}` block:

```jsx
        {anyDigital && (methods || []).includes("cod") && (
          <p className="text-xs opacity-70 mt-1">{t("checkoutCodUnavailableDigital")}</p>
        )}
```

- [ ] **Step 5: Run to verify they pass**

Run: `cd frontend && npx vitest run src/pages/Checkout.test.jsx`
Expected: all pass, including every pre-existing physical-cart test (`allDigital`/`anyDigital` are both `false` when no cart line sets `is_digital`, so every new conditional degrades to the exact old behavior).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Checkout.jsx frontend/src/i18n/translations.js frontend/src/pages/Checkout.test.jsx
git commit -m "feat(shop): hide address/fulfillment for all-digital checkout, hide COD when any digital item"
```

---

### Task 11: Buyer UI - order-status page shows the download link

**Files:**
- Modify: `frontend/src/pages/Order.jsx`
- Modify: `frontend/src/i18n/translations.js`
- Modify: `frontend/src/pages/Order.test.jsx`

**Interfaces:**
- Consumes: `order.items[].delivery_link_snapshot`, already gated server-side to `confirmed`/`shipped`/`completed` (Task 5) - the frontend does not need to re-check `order.status` itself, it only needs to render the field when present.
- Produces: new translation key `orderDownloadLink` (en/vi).

- [ ] **Step 1: Write a failing test**

In `frontend/src/pages/Order.test.jsx`, add near the existing item-list test (matching that test's mock-order/render conventions):

```js
  it("shows a download button for a digital item once the order is confirmed", async () => {
    fetchOrder.mockResolvedValue({
      ...baseOrder, // reuse whatever base fixture the neighboring test uses
      status: "confirmed",
      items: [{ id: 1, product_name_snapshot: "Digital Album", variant_label_snapshot: "", qty: 1, unit_price_snapshot: 99000, delivery_link_snapshot: "https://drive.google.com/x" }],
    })
    const container = await renderOrder()

    const link = container.querySelector('a[href="https://drive.google.com/x"]')
    expect(link).toBeTruthy()
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/pages/Order.test.jsx`
Expected: FAIL - no such link is rendered today.

- [ ] **Step 3: Add the translation key**

In `frontend/src/i18n/translations.js`, `en` block near `orderItems`:

```js
    orderDownloadLink: "Download",
```

`vi` block:

```js
    orderDownloadLink: "Tải về",
```

- [ ] **Step 4: Update the item list in `Order.jsx`**

Replace:

```jsx
      {order.items.map((i) => (
        <div key={i.id} className="flex justify-between items-center gap-3 py-2 border-b border-[var(--border-brand)]">
          <div className="flex items-center gap-3 min-w-0">
            {i.image_url
              ? <img src={i.image_url} alt="" className="w-12 h-12 object-cover rounded-lg shrink-0" />
              : <div className="w-12 h-12 rounded-lg bg-[var(--surface-neutral)] shrink-0" />}
            <span className="truncate">{i.product_name_snapshot} · {i.variant_label_snapshot} × {i.qty}</span>
          </div>
          <span className="shrink-0">{formatVnd(i.unit_price_snapshot * i.qty)}</span>
        </div>
      ))}
```

with:

```jsx
      {order.items.map((i) => (
        <div key={i.id} className="flex justify-between items-center gap-3 py-2 border-b border-[var(--border-brand)]">
          <div className="flex items-center gap-3 min-w-0">
            {i.image_url
              ? <img src={i.image_url} alt="" className="w-12 h-12 object-cover rounded-lg shrink-0" />
              : <div className="w-12 h-12 rounded-lg bg-[var(--surface-neutral)] shrink-0" />}
            <div className="min-w-0">
              <span className="truncate block">
                {i.product_name_snapshot}{i.variant_label_snapshot ? ` · ${i.variant_label_snapshot}` : ""} × {i.qty}
              </span>
              {i.delivery_link_snapshot && (
                <a href={i.delivery_link_snapshot} target="_blank" rel="noreferrer" className="text-sm text-[var(--text-link)] underline">
                  {t("orderDownloadLink")}
                </a>
              )}
            </div>
          </div>
          <span className="shrink-0">{formatVnd(i.unit_price_snapshot * i.qty)}</span>
        </div>
      ))}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run src/pages/Order.test.jsx`
Expected: all pass, including pre-existing tests (a physical item's `variant_label_snapshot` is always truthy, so the heading text renders identically to before; no item has `delivery_link_snapshot` in those fixtures, so the download link never appears for them).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Order.jsx frontend/src/i18n/translations.js frontend/src/pages/Order.test.jsx
git commit -m "feat(shop): show digital delivery link on the buyer order-status page"
```

---

### Task 12: Full-suite verification and staging build

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run`
Expected: all tests pass (the pre-existing `AdminOrders.test.jsx`-adjacent backend flake, if any, is a frontend-side debounce timer issue documented separately - it does not appear in the backend suite; any backend failure here is a real regression and must be fixed before continuing).

- [ ] **Step 2: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all tests pass. A known pre-existing flake in `AdminOrders.test.jsx` (a debounce `setTimeout` firing after test-environment teardown) may appear - if it does, re-run just that file in isolation (`npx vitest run src/components/AdminOrders.test.jsx`) to confirm it passes alone before treating the full-run failure as harmless noise, not a new regression.

- [ ] **Step 3: Build and push to `:staging`**

Run in the background (this can exceed a normal tool timeout):
```bash
cd /Users/phucth/vibes/cosplay-portfolio && bash scripts/build-push.sh staging > /tmp/build-push-digital-album.log 2>&1; echo EXIT:$?
```
Expected (after it completes): `Done: phuc16/cosplay-backend:staging, phuc16/cosplay-frontend:staging`.

- [ ] **Step 4: Report to the user**

State plainly which suites passed, note the staging image push, and remind the user (as this project's established convention) that they pull/restart both containers on their staging VPS to see the change, and that they self-verify the buyer/admin flows there - no proactive git push, no production deploy.
