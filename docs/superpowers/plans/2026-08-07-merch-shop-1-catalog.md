# Merch Shop — Plan 1: Foundations & Catalog

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sellers can create merch collections with products and per-variant stock in the admin, and buyers can browse them on a public shop page — no cart or checkout yet.

**Architecture:** Adds three tables (`collections`, `products`, `product_variants`) via Knex migrations, a small catalog module (`backend/shop/`) holding slug generation, SQL access, and Redis caching, and two Express routers mounted by `server.js` (public read, admin write). The frontend gains `/shop` and `/shop/:slug` routes plus an admin catalog tab, reusing the existing axios instance, `LanguageContext`, and Tailwind styling.

**Tech Stack:** Node 20 / Express 5, mysql2 raw pool (Knex for migrations only), ioredis, MinIO via `@aws-sdk/client-s3`, sharp, React 19 + react-router-dom 7 + Tailwind 3, Vitest + Supertest (new).

## Global Constraints

- **Source spec:** `docs/superpowers/specs/2026-08-07-merch-shop-design.md`. Everything here implements Plan 1's slice of it.
- **Queries use the raw mysql2 pool** from `backend/db.js` — `const [rows] = await db.query(sql, params)`. Knex is used **only** for migrations. Never import knex in request-handling code.
- **All API error responses** use the existing shape `{ error: "<snake_case_code>", message: "<Vietnamese message>" }`. HTTP codes follow existing usage: 400 `invalid_input`, 401 `unauthorized`, 403 `forbidden`, 404 `not_found`, 429 `too_many_requests`, 500 `server_error`.
- **Log lines** follow the existing bracketed-prefix convention, e.g. `console.warn("[SHOP] ...")`, `console.error("[ADMIN/CATALOG] ...")`.
- **Money is stored as `int unsigned` in VND** (e.g. `35000`). Never use float or decimal — VND has no minor unit and floats introduce rounding bugs.
- **Images** are processed by the existing pipeline: `sharp().rotate()`, resize to max width 1920 with `withoutEnlargement`, encode `.webp({ quality: 82, effort: 4 })`. The spec's mention of "JPEG ~85%" is outdated — WebP is what `server.js` actually does. Stored in MinIO, served via `/api/storage/{key}`.
- **Redis cache keys** for this plan: `shop:collections` (list) and `shop:collection:<slug>` (detail), both `EX 3600`, matching the existing 1-hour gallery/settings TTL.
- **Public routes** are mounted behind the existing `publicLimiter`. **Admin routes** are mounted behind the existing `auth` middleware.
- **UI chrome is bilingual** via `frontend/src/i18n/translations.js` (`en` and `vi` keys, accessed with `t("key")`). **Seller-authored content** (collection/product names and descriptions) is stored and displayed in one language only — never duplicated per locale.
- **Markdown descriptions are sanitized before render.** Never use `dangerouslySetInnerHTML` with unsanitized HTML.
- **No new containers, processes, or services.** Everything runs inside the existing backend/frontend/worker.
- **Commit after every task** using Conventional Commits with a descriptive body. Do **not** add a `Co-Authored-By` trailer.

---

### Task 1: Test infrastructure and testable server

Stands up Vitest + Supertest, which do not exist yet (`backend/package.json` still has the default `"test": "echo \"Error: no test specified\" && exit 1"`). Also fixes two blockers: `server.js` calls `app.listen` without exporting `app`, and `db.js`/`knexfile.js` ignore `DB_PORT` even though Docker MySQL is published on `127.0.0.1:3307`.

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/db.js`
- Modify: `backend/knexfile.js`
- Modify: `backend/server.js:729-734` (the trailing `app.listen` block)
- Create: `backend/vitest.config.js`
- Create: `backend/tests/globalSetup.js`
- Create: `backend/tests/helpers/db.js`
- Test: `backend/tests/smoke.test.js`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `backend/server.js` exports the Express `app` via `module.exports = app`.
  - `backend/tests/helpers/db.js` exports `resetTables(...names: string[]): Promise<void>` and `closeDb(): Promise<void>`.
  - `npm test` (in `backend/`) runs Vitest against database `cosplay_test`.

- [ ] **Step 1: Install test dependencies**

Run:
```bash
cd backend && npm install --save-dev vitest@^3.2.4 supertest@^7.1.1
```
Expected: both appear under `devDependencies` in `backend/package.json`.

- [ ] **Step 2: Add DB_PORT support so tests can reach Docker MySQL on 3307**

Replace the whole of `backend/db.js` with:

```js
const mysql = require("mysql2/promise")

module.exports = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "cosplay"
})
```

In `backend/knexfile.js`, add the same `port` line to the `connection` object so it reads:

```js
const connection = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "cosplay"
}
```

- [ ] **Step 3: Export the app so Supertest can drive it without binding a port**

In `backend/server.js`, replace the final `app.listen(...)` block (currently the last 8 lines of the file) with:

```js
if (require.main === module) {
  app.listen(5000, () => {
    storage.ensureBucket().then(() => {
      console.log(`[SERVER] MinIO bucket ready: ${storage.BUCKET}`)
    }).catch((e) => {
      console.warn("[SERVER] MinIO init failed:", e.message, "- uploads may fail")
    })
    console.log(`[SERVER] Backend listening on :5000, body limit ${UPLOAD_LIMIT}`)
  })
}

module.exports = app
```

This keeps `node server.js` and the Docker entrypoint behaving identically, while allowing `require("./server")` in tests to get the app without listening.

- [ ] **Step 4: Create the Vitest config**

Create `backend/vitest.config.js`:

```js
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    globalSetup: ["./tests/globalSetup.js"],
    include: ["tests/**/*.test.js"],
    // DB-backed tests share one MySQL schema, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 20000,
  },
})
```

- [ ] **Step 5: Create the global setup that builds the test schema**

Create `backend/tests/globalSetup.js`:

```js
require("dotenv").config()
const mysql = require("mysql2/promise")

// Creates the test database (if absent) and brings it to the latest migration.
// DB_NAME is pinned to cosplay_test by the npm script, so this never touches dev data.
module.exports = async function setup() {
  const database = process.env.DB_NAME
  if (database !== "cosplay_test") {
    throw new Error(`Refusing to run tests against DB_NAME="${database}". Use npm test.`)
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
  })
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``)
  await conn.end()

  const knex = require("knex")({
    client: "mysql2",
    connection: {
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASS || "",
      database,
    },
    migrations: { directory: `${__dirname}/../migrations` },
  })
  await knex.migrate.latest()
  await knex.destroy()
}
```

- [ ] **Step 6: Create the per-test database helper**

Create `backend/tests/helpers/db.js`:

```js
const db = require("../../db")

/** Truncate the given tables, ignoring FK order. Call in beforeEach. */
async function resetTables(...names) {
  await db.query("SET FOREIGN_KEY_CHECKS = 0")
  for (const name of names) {
    await db.query(`TRUNCATE TABLE \`${name}\``)
  }
  await db.query("SET FOREIGN_KEY_CHECKS = 1")
}

/** Close the shared pool so Vitest can exit. Call in afterAll. */
async function closeDb() {
  await db.end()
}

module.exports = { resetTables, closeDb }
```

- [ ] **Step 7: Add the test script**

In `backend/package.json`, replace the `"test"` script so the `scripts` block reads:

```json
"scripts": {
  "test": "DB_NAME=cosplay_test vitest run",
  "test:watch": "DB_NAME=cosplay_test vitest",
  "migrate": "knex migrate:latest",
  "seed": "knex seed:run",
  "rollback": "knex migrate:rollback"
}
```

- [ ] **Step 8: Write the failing smoke test**

Create `backend/tests/smoke.test.js`:

```js
const { describe, it, expect, afterAll } = require("vitest")
const request = require("supertest")
const app = require("../server")
const { closeDb } = require("./helpers/db")

afterAll(async () => {
  await closeDb()
})

describe("server", () => {
  it("returns the standard error shape for unknown routes", async () => {
    const res = await request(app).get("/api/definitely-not-a-route")
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: "not_found", message: "Không tìm thấy" })
  })
})
```

- [ ] **Step 9: Run the test to verify the harness works**

Ensure MySQL is up first (`docker compose up -d mysql redis`), then run:
```bash
cd backend && DB_PORT=3307 npm test
```
Expected: PASS, 1 test. If `server.js` was not exported correctly the run hangs or errors with `app.get is not a function` — fix Step 3 before continuing.

- [ ] **Step 10: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/db.js backend/knexfile.js \
        backend/server.js backend/vitest.config.js backend/tests
git commit -F - <<'EOF'
test(backend): add vitest + supertest harness

The backend had no test infrastructure at all — npm test was still the default
error stub. This adds Vitest and Supertest so the merch shop work can be built
test-first, plus the two changes that were blocking testability:

- server.js now exports the Express app and only calls listen when run
  directly, so Supertest can drive it without binding a port
- db.js and knexfile.js read DB_PORT, which is required to reach the
  dockerised MySQL published on 127.0.0.1:3307

Tests run against a dedicated cosplay_test database, created and migrated by
a global setup that refuses to run against any other schema name. DB-backed
files run serially since they share that schema.
EOF
```

---

### Task 2: Catalog schema migrations

Creates the three catalog tables. `fulfillment_methods` from the spec is encoded concretely as two booleans (`allow_ship`, `allow_pickup`) — simpler to query and validate than a JSON array.

**Files:**
- Create: `backend/migrations/007_create_collections.js`
- Create: `backend/migrations/008_create_products.js`
- Create: `backend/migrations/009_create_product_variants.js`
- Test: `backend/tests/schema.test.js`

**Interfaces:**
- Consumes: test harness from Task 1.
- Produces: tables `collections`, `products`, `product_variants` with the exact columns listed below. All later tasks query these names.

```
collections        id, title, slug (unique), description, cover_image, thumbnail_image,
                   status ENUM(draft|active|closed|archived), allow_ship, allow_pickup,
                   pickup_location, pickup_note, sort_order, created_at
products           id, collection_id FK→collections CASCADE, name, description,
                   price INT UNSIGNED, images JSON, sort_order, created_at
product_variants   id, product_id FK→products CASCADE, label, image_url,
                   stock_qty INT UNSIGNED NULL (NULL = unlimited), sort_order, created_at
```

- [ ] **Step 1: Write the failing schema test**

Create `backend/tests/schema.test.js`:

```js
const { describe, it, expect, afterAll } = require("vitest")
const db = require("../db")
const { closeDb } = require("./helpers/db")

afterAll(async () => {
  await closeDb()
})

async function columns(table) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  )
  return Object.fromEntries(rows.map((r) => [r.COLUMN_NAME, r]))
}

describe("catalog schema", () => {
  it("creates collections with status and fulfillment flags", async () => {
    const c = await columns("collections")
    expect(Object.keys(c)).toEqual(
      expect.arrayContaining([
        "id", "title", "slug", "description", "cover_image", "thumbnail_image",
        "status", "allow_ship", "allow_pickup", "pickup_location", "pickup_note",
        "sort_order", "created_at",
      ])
    )
    expect(c.status.COLUMN_TYPE).toContain("draft")
    expect(c.status.COLUMN_TYPE).toContain("archived")
  })

  it("creates products with integer VND price", async () => {
    const c = await columns("products")
    expect(Object.keys(c)).toEqual(
      expect.arrayContaining([
        "id", "collection_id", "name", "description", "price", "images", "sort_order", "created_at",
      ])
    )
    expect(c.price.COLUMN_TYPE).toBe("int unsigned")
  })

  it("creates product_variants with nullable stock_qty meaning unlimited", async () => {
    const c = await columns("product_variants")
    expect(Object.keys(c)).toEqual(
      expect.arrayContaining([
        "id", "product_id", "label", "image_url", "stock_qty", "sort_order", "created_at",
      ])
    )
    expect(c.stock_qty.IS_NULLABLE).toBe("YES")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- schema`
Expected: FAIL — all three tests fail because the tables do not exist, so `columns()` returns `{}`.

- [ ] **Step 3: Create the collections migration**

Create `backend/migrations/007_create_collections.js`:

```js
exports.up = function (knex) {
  return knex.schema.createTable("collections", (table) => {
    table.increments("id").primary()

    table.string("title").notNullable()
    table.string("slug", 191).notNullable().unique()
    table.text("description")

    table.string("cover_image", 512).nullable()
    table.string("thumbnail_image", 512).nullable()

    table.enu("status", ["draft", "active", "closed", "archived"]).notNullable().defaultTo("draft")

    table.boolean("allow_ship").notNullable().defaultTo(true)
    table.boolean("allow_pickup").notNullable().defaultTo(false)
    table.string("pickup_location", 512).nullable()
    table.text("pickup_note").nullable()

    table.integer("sort_order").unsigned().notNullable().defaultTo(0)
    table.timestamp("created_at").defaultTo(knex.fn.now())

    table.index(["status", "sort_order"], "idx_collections_status_sort")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("collections")
}
```

- [ ] **Step 4: Create the products migration**

Create `backend/migrations/008_create_products.js`:

```js
exports.up = function (knex) {
  return knex.schema.createTable("products", (table) => {
    table.increments("id").primary()

    table.integer("collection_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("collections")
      .onDelete("CASCADE")

    table.string("name").notNullable()
    table.text("description")

    // VND has no minor unit — integer avoids float rounding entirely.
    table.integer("price").unsigned().notNullable().defaultTo(0)

    // Array of storage proxy URLs, e.g. ["/api/storage/shop/products/1/abc.webp"]
    table.json("images")

    table.integer("sort_order").unsigned().notNullable().defaultTo(0)
    table.timestamp("created_at").defaultTo(knex.fn.now())

    table.index(["collection_id", "sort_order"], "idx_products_collection_sort")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("products")
}
```

- [ ] **Step 5: Create the product_variants migration**

Create `backend/migrations/009_create_product_variants.js`:

```js
exports.up = function (knex) {
  return knex.schema.createTable("product_variants", (table) => {
    table.increments("id").primary()

    table.integer("product_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("products")
      .onDelete("CASCADE")

    // "S" / "M" for sizes, "A1" / "B2" for photocard codes.
    table.string("label", 191).notNullable()

    // Per-variant art (photocards). NULL falls back to the product's images.
    table.string("image_url", 512).nullable()

    // NULL means unlimited / made-to-order. 0 means sold out.
    table.integer("stock_qty").unsigned().nullable()

    table.integer("sort_order").unsigned().notNullable().defaultTo(0)
    table.timestamp("created_at").defaultTo(knex.fn.now())

    table.index(["product_id", "sort_order"], "idx_variants_product_sort")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("product_variants")
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && DB_PORT=3307 npm test -- schema`
Expected: PASS, 3 tests. The global setup applies the new migrations before the suite runs.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/007_create_collections.js \
        backend/migrations/008_create_products.js \
        backend/migrations/009_create_product_variants.js \
        backend/tests/schema.test.js
git commit -F - <<'EOF'
feat(shop): add collections, products and product_variants tables

Schema for the merch catalog, per the phase 1-3 design doc.

- collections.status is a four-value enum rather than a boolean, so "not ready
  yet" (draft) and "the drop is over" (closed/archived) stay distinct
- the spec's fulfillment_methods is encoded as allow_ship / allow_pickup
  booleans, which are simpler to query and validate than a JSON array
- products.price is int unsigned because VND has no minor unit; float or
  decimal would only introduce rounding bugs
- product_variants.stock_qty is nullable, where NULL means unlimited, since
  posters are made-to-order while photocards are a fixed print run
- product_variants.image_url covers the photocard case where each variant is
  a different piece of art rather than a different size of the same item
EOF
```

---

### Task 3: Slug generation for Vietnamese titles

Collection URLs are `/shop/:slug`. Titles are Vietnamese with diacritics (`Bộ sưu tập Hè 2026`), which must become clean ASCII slugs. Pure function, no dependencies, easy to test exhaustively.

**Files:**
- Create: `backend/shop/slug.js`
- Test: `backend/tests/slug.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `backend/shop/slug.js` exporting `slugify(input: string): string` and `uniqueSlug(base: string, existing: string[]): string`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/slug.test.js`:

```js
const { describe, it, expect } = require("vitest")
const { slugify, uniqueSlug } = require("../shop/slug")

describe("slugify", () => {
  it("lowercases and hyphenates plain text", () => {
    expect(slugify("Summer Collection 2026")).toBe("summer-collection-2026")
  })

  it("strips Vietnamese diacritics", () => {
    expect(slugify("Bộ sưu tập Hè")).toBe("bo-suu-tap-he")
  })

  it("converts đ and Đ to d", () => {
    expect(slugify("Đặt trước Đồ")).toBe("dat-truoc-do")
  })

  it("drops punctuation and collapses separators", () => {
    expect(slugify("[PRE-ORD] KAMI's MERCH!! @ HH2026")).toBe("pre-ord-kami-s-merch-hh2026")
  })

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  --hello--  ")).toBe("hello")
  })

  it("falls back to 'collection' when nothing survives", () => {
    expect(slugify("!!!")).toBe("collection")
  })
})

describe("uniqueSlug", () => {
  it("returns the base when unused", () => {
    expect(uniqueSlug("summer", [])).toBe("summer")
  })

  it("appends a counter when taken", () => {
    expect(uniqueSlug("summer", ["summer"])).toBe("summer-2")
  })

  it("skips over multiple collisions", () => {
    expect(uniqueSlug("summer", ["summer", "summer-2", "summer-3"])).toBe("summer-4")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- slug`
Expected: FAIL with `Cannot find module '../shop/slug'`.

- [ ] **Step 3: Implement the slug helper**

Create `backend/shop/slug.js`:

```js
/**
 * Turn a title into a URL-safe slug. Vietnamese diacritics are stripped via
 * NFD normalisation; đ/Đ needs an explicit pass because it is a distinct
 * letter rather than a base letter plus a combining mark.
 */
function slugify(input) {
  const slug = String(input || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug || "collection"
}

/** Append -2, -3, ... until the slug is not present in `existing`. */
function uniqueSlug(base, existing) {
  const taken = new Set(existing)
  if (!taken.has(base)) return base

  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

module.exports = { slugify, uniqueSlug }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- slug`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/shop/slug.js backend/tests/slug.test.js
git commit -F - <<'EOF'
feat(shop): add Vietnamese-aware slug generation

Collection URLs are /shop/:slug and titles are Vietnamese, so slugs need
diacritic stripping. NFD normalisation handles the combining marks, but đ/Đ
needs an explicit pass since it is a distinct letter rather than a base letter
plus a mark. uniqueSlug resolves collisions with a numeric suffix.
EOF
```

---

### Task 4: Catalog repository

All SQL for the catalog lives here so routes stay thin and the queries are testable without HTTP.

**Files:**
- Create: `backend/shop/catalogRepo.js`
- Test: `backend/tests/catalogRepo.test.js`

**Interfaces:**
- Consumes: `backend/db.js`, `slugify`/`uniqueSlug` from Task 3.
- Produces: `backend/shop/catalogRepo.js` exporting exactly:
  - `listPublicCollections(): Promise<Collection[]>` — status `active` or `closed`, ordered by `sort_order, id`, each with `product_count`.
  - `getPublicCollectionBySlug(slug: string): Promise<CollectionDetail|null>` — status `active` or `closed`, with nested `products[].variants[]`.
  - `listAllCollections(): Promise<Collection[]>` — every status, for admin.
  - `createCollection(data): Promise<number>` — returns new id, generates a unique slug from `data.title`.
  - `updateCollection(id, data): Promise<boolean>`
  - `deleteCollection(id): Promise<boolean>`
  - `createProduct(data): Promise<number>`
  - `updateProduct(id, data): Promise<boolean>`
  - `deleteProduct(id): Promise<boolean>`
  - `replaceVariants(productId, variants): Promise<void>` — deletes variants absent from the list, updates existing by id, inserts new ones.

  `Collection` fields: `id, title, slug, description, cover_image, thumbnail_image, status, allow_ship, allow_pickup, pickup_location, pickup_note, sort_order, created_at`. `allow_ship`/`allow_pickup` are returned as booleans, not 0/1.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/catalogRepo.test.js`:

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest")
const repo = require("../shop/catalogRepo")
const { resetTables, closeDb } = require("./helpers/db")

beforeEach(async () => {
  await resetTables("product_variants", "products", "collections")
})

afterAll(async () => {
  await closeDb()
})

describe("createCollection", () => {
  it("generates a slug from the Vietnamese title", async () => {
    const id = await repo.createCollection({ title: "Bộ sưu tập Hè", status: "active" })
    const all = await repo.listAllCollections()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(id)
    expect(all[0].slug).toBe("bo-suu-tap-he")
  })

  it("de-duplicates slugs across collections with the same title", async () => {
    await repo.createCollection({ title: "Summer", status: "active" })
    await repo.createCollection({ title: "Summer", status: "active" })
    const slugs = (await repo.listAllCollections()).map((c) => c.slug).sort()
    expect(slugs).toEqual(["summer", "summer-2"])
  })

  it("returns fulfillment flags as booleans", async () => {
    await repo.createCollection({ title: "Fes", status: "active", allow_ship: true, allow_pickup: true })
    const [c] = await repo.listAllCollections()
    expect(c.allow_ship).toBe(true)
    expect(c.allow_pickup).toBe(true)
  })
})

describe("listPublicCollections", () => {
  it("hides draft and archived collections but shows active and closed", async () => {
    await repo.createCollection({ title: "Draft one", status: "draft" })
    await repo.createCollection({ title: "Active one", status: "active" })
    await repo.createCollection({ title: "Closed one", status: "closed" })
    await repo.createCollection({ title: "Archived one", status: "archived" })

    const titles = (await repo.listPublicCollections()).map((c) => c.title).sort()
    expect(titles).toEqual(["Active one", "Closed one"])
  })

  it("includes a product count", async () => {
    const cid = await repo.createCollection({ title: "Has products", status: "active" })
    await repo.createProduct({ collection_id: cid, name: "Photocard", price: 35000 })
    await repo.createProduct({ collection_id: cid, name: "Poster", price: 90000 })

    const [c] = await repo.listPublicCollections()
    expect(c.product_count).toBe(2)
  })
})

describe("getPublicCollectionBySlug", () => {
  it("returns null for a draft collection", async () => {
    await repo.createCollection({ title: "Secret", status: "draft" })
    expect(await repo.getPublicCollectionBySlug("secret")).toBeNull()
  })

  it("nests products and their variants", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Photocard", price: 35000 })
    await repo.replaceVariants(pid, [
      { label: "A1", stock_qty: 3, image_url: "/api/storage/a1.webp" },
      { label: "A2", stock_qty: null, image_url: null },
    ])

    const detail = await repo.getPublicCollectionBySlug("drop")
    expect(detail.title).toBe("Drop")
    expect(detail.products).toHaveLength(1)
    expect(detail.products[0].price).toBe(35000)
    expect(detail.products[0].variants.map((v) => v.label)).toEqual(["A1", "A2"])
    expect(detail.products[0].variants[0].stock_qty).toBe(3)
    expect(detail.products[0].variants[1].stock_qty).toBeNull()
  })
})

describe("replaceVariants", () => {
  it("inserts, updates and deletes to match the given list", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 1 }, { label: "A2", stock_qty: 2 }])

    let detail = await repo.getPublicCollectionBySlug("drop")
    const a1 = detail.products[0].variants.find((v) => v.label === "A1")

    // Keep A1 (restocked), drop A2, add A3.
    await repo.replaceVariants(pid, [
      { id: a1.id, label: "A1", stock_qty: 9 },
      { label: "A3", stock_qty: 5 },
    ])

    detail = await repo.getPublicCollectionBySlug("drop")
    const byLabel = Object.fromEntries(detail.products[0].variants.map((v) => [v.label, v.stock_qty]))
    expect(byLabel).toEqual({ A1: 9, A3: 5 })
  })
})

describe("deleteCollection", () => {
  it("cascades to products and variants", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 1 }])

    await repo.deleteCollection(cid)

    const db = require("../db")
    const [products] = await db.query("SELECT id FROM products")
    const [variants] = await db.query("SELECT id FROM product_variants")
    expect(products).toHaveLength(0)
    expect(variants).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- catalogRepo`
Expected: FAIL with `Cannot find module '../shop/catalogRepo'`.

- [ ] **Step 3: Implement the repository**

Create `backend/shop/catalogRepo.js`:

```js
const db = require("./../db")
const { slugify, uniqueSlug } = require("./slug")

const PUBLIC_STATUSES = ["active", "closed"]

/** MySQL returns tinyint(1) as 0/1; the API contract is booleans. */
function mapCollection(row) {
  if (!row) return null
  return {
    ...row,
    allow_ship: Boolean(row.allow_ship),
    allow_pickup: Boolean(row.allow_pickup),
  }
}

/** products.images is a JSON column; mysql2 may hand back a string or an array. */
function parseImages(value) {
  if (Array.isArray(value)) return value
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

async function nextSortOrder(table, whereSql = "", params = []) {
  const [[{ next }]] = await db.query(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM \`${table}\` ${whereSql}`,
    params
  )
  return next
}

async function listAllCollections() {
  const [rows] = await db.query(
    "SELECT * FROM collections ORDER BY sort_order ASC, id ASC"
  )
  return rows.map(mapCollection)
}

async function listPublicCollections() {
  const [rows] = await db.query(
    `SELECT c.*, COUNT(p.id) AS product_count
       FROM collections c
       LEFT JOIN products p ON p.collection_id = c.id
      WHERE c.status IN (?, ?)
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.id ASC`,
    PUBLIC_STATUSES
  )
  return rows.map((r) => ({ ...mapCollection(r), product_count: Number(r.product_count) }))
}

async function getPublicCollectionBySlug(slug) {
  const [[collection]] = await db.query(
    "SELECT * FROM collections WHERE slug = ? AND status IN (?, ?) LIMIT 1",
    [slug, ...PUBLIC_STATUSES]
  )
  if (!collection) return null

  const [products] = await db.query(
    "SELECT * FROM products WHERE collection_id = ? ORDER BY sort_order ASC, id ASC",
    [collection.id]
  )

  let variants = []
  if (products.length) {
    const ids = products.map((p) => p.id)
    const [rows] = await db.query(
      `SELECT * FROM product_variants
        WHERE product_id IN (${ids.map(() => "?").join(",")})
        ORDER BY sort_order ASC, id ASC`,
      ids
    )
    variants = rows
  }

  const byProduct = new Map()
  for (const v of variants) {
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, [])
    byProduct.get(v.product_id).push(v)
  }

  return {
    ...mapCollection(collection),
    products: products.map((p) => ({
      ...p,
      images: parseImages(p.images),
      variants: byProduct.get(p.id) || [],
    })),
  }
}

async function createCollection(data) {
  const [rows] = await db.query("SELECT slug FROM collections")
  const slug = uniqueSlug(slugify(data.title), rows.map((r) => r.slug))
  const sortOrder = await nextSortOrder("collections")

  const [res] = await db.query(
    `INSERT INTO collections
       (title, slug, description, cover_image, thumbnail_image, status,
        allow_ship, allow_pickup, pickup_location, pickup_note, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.title,
      slug,
      data.description || null,
      data.cover_image || null,
      data.thumbnail_image || null,
      data.status || "draft",
      data.allow_ship === undefined ? true : Boolean(data.allow_ship),
      Boolean(data.allow_pickup),
      data.pickup_location || null,
      data.pickup_note || null,
      sortOrder,
    ]
  )
  return res.insertId
}

async function updateCollection(id, data) {
  const [res] = await db.query(
    `UPDATE collections
        SET title = ?, description = ?, cover_image = ?, thumbnail_image = ?, status = ?,
            allow_ship = ?, allow_pickup = ?, pickup_location = ?, pickup_note = ?
      WHERE id = ?`,
    [
      data.title,
      data.description || null,
      data.cover_image || null,
      data.thumbnail_image || null,
      data.status || "draft",
      data.allow_ship === undefined ? true : Boolean(data.allow_ship),
      Boolean(data.allow_pickup),
      data.pickup_location || null,
      data.pickup_note || null,
      id,
    ]
  )
  return res.affectedRows > 0
}

async function deleteCollection(id) {
  const [res] = await db.query("DELETE FROM collections WHERE id = ?", [id])
  return res.affectedRows > 0
}

async function createProduct(data) {
  const sortOrder = await nextSortOrder("products", "WHERE collection_id = ?", [data.collection_id])
  const [res] = await db.query(
    `INSERT INTO products (collection_id, name, description, price, images, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.collection_id,
      data.name,
      data.description || null,
      Number(data.price) || 0,
      JSON.stringify(data.images || []),
      sortOrder,
    ]
  )
  return res.insertId
}

async function updateProduct(id, data) {
  const [res] = await db.query(
    "UPDATE products SET name = ?, description = ?, price = ?, images = ? WHERE id = ?",
    [data.name, data.description || null, Number(data.price) || 0, JSON.stringify(data.images || []), id]
  )
  return res.affectedRows > 0
}

async function deleteProduct(id) {
  const [res] = await db.query("DELETE FROM products WHERE id = ?", [id])
  return res.affectedRows > 0
}

/**
 * Make the product's variants match `variants` exactly: update those carrying
 * an id, insert those without, delete any existing row not in the list.
 * stock_qty === null is preserved as NULL (unlimited), not coerced to 0.
 */
async function replaceVariants(productId, variants) {
  const list = Array.isArray(variants) ? variants : []
  const keepIds = list.map((v) => v.id).filter(Boolean)

  if (keepIds.length) {
    await db.query(
      `DELETE FROM product_variants
        WHERE product_id = ? AND id NOT IN (${keepIds.map(() => "?").join(",")})`,
      [productId, ...keepIds]
    )
  } else {
    await db.query("DELETE FROM product_variants WHERE product_id = ?", [productId])
  }

  for (const [index, v] of list.entries()) {
    const stock = v.stock_qty === null || v.stock_qty === undefined || v.stock_qty === ""
      ? null
      : Number(v.stock_qty)

    if (v.id) {
      await db.query(
        "UPDATE product_variants SET label = ?, image_url = ?, stock_qty = ?, sort_order = ? WHERE id = ? AND product_id = ?",
        [v.label, v.image_url || null, stock, index, v.id, productId]
      )
    } else {
      await db.query(
        "INSERT INTO product_variants (product_id, label, image_url, stock_qty, sort_order) VALUES (?, ?, ?, ?, ?)",
        [productId, v.label, v.image_url || null, stock, index]
      )
    }
  }
}

module.exports = {
  listAllCollections,
  listPublicCollections,
  getPublicCollectionBySlug,
  createCollection,
  updateCollection,
  deleteCollection,
  createProduct,
  updateProduct,
  deleteProduct,
  replaceVariants,
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && DB_PORT=3307 npm test -- catalogRepo`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/shop/catalogRepo.js backend/tests/catalogRepo.test.js
git commit -F - <<'EOF'
feat(shop): add catalog repository

All catalog SQL lives here so the routes stay thin and the queries are
testable without going through HTTP.

- listPublicCollections exposes only active and closed collections, so drafts
  stay hidden and archived drops disappear while their rows survive for order
  history later
- getPublicCollectionBySlug nests products and variants in one extra query
  rather than N+1 per product
- replaceVariants reconciles a whole variant list in one call: update by id,
  insert the new, delete anything missing. Photocard sheets are edited as a
  set, not one row at a time
- stock_qty of null is preserved rather than coerced to 0, since null means
  unlimited and 0 means sold out
- tinyint fulfillment flags are mapped back to real booleans at the boundary
EOF
```

---

### Task 5: Catalog cache

Wraps the repository with the same Redis pattern the gallery already uses, plus explicit invalidation on writes.

**Files:**
- Create: `backend/shop/catalogCache.js`
- Test: `backend/tests/catalogCache.test.js`

**Interfaces:**
- Consumes: `catalogRepo` from Task 4, `backend/redis.js`.
- Produces: `backend/shop/catalogCache.js` exporting `getCollections()`, `getCollection(slug)`, and `invalidate()`. `invalidate()` clears `shop:collections` and every `shop:collection:*` key.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/catalogCache.test.js`:

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest")
const cache = require("../shop/catalogCache")
const repo = require("../shop/catalogRepo")
const redis = require("../redis")
const { resetTables, closeDb } = require("./helpers/db")

beforeEach(async () => {
  await resetTables("product_variants", "products", "collections")
  await cache.invalidate()
})

afterAll(async () => {
  await cache.invalidate()
  await redis.quit()
  await closeDb()
})

describe("getCollections", () => {
  it("serves the second call from cache", async () => {
    await repo.createCollection({ title: "Drop one", status: "active" })

    const first = await cache.getCollections()
    expect(first).toHaveLength(1)

    // Write directly to the DB, bypassing invalidation.
    await repo.createCollection({ title: "Drop two", status: "active" })

    const second = await cache.getCollections()
    expect(second).toHaveLength(1) // still the cached copy
  })

  it("reflects new data after invalidate", async () => {
    await repo.createCollection({ title: "Drop one", status: "active" })
    await cache.getCollections()

    await repo.createCollection({ title: "Drop two", status: "active" })
    await cache.invalidate()

    expect(await cache.getCollections()).toHaveLength(2)
  })
})

describe("getCollection", () => {
  it("caches a detail page and clears it on invalidate", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })

    const first = await cache.getCollection("drop")
    expect(first.products).toHaveLength(1)

    await repo.createProduct({ collection_id: cid, name: "Poster", price: 90000 })
    expect((await cache.getCollection("drop")).products).toHaveLength(1)

    await cache.invalidate()
    expect((await cache.getCollection("drop")).products).toHaveLength(2)
  })

  it("returns null for an unknown slug without caching a bogus entry", async () => {
    expect(await cache.getCollection("nope")).toBeNull()
    expect(await redis.get("shop:collection:nope")).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- catalogCache`
Expected: FAIL with `Cannot find module '../shop/catalogCache'`.

- [ ] **Step 3: Implement the cache**

Create `backend/shop/catalogCache.js`:

```js
const redis = require("./../redis")
const repo = require("./catalogRepo")

const LIST_KEY = "shop:collections"
const DETAIL_PREFIX = "shop:collection:"
const TTL_SECONDS = 3600 // matches the existing gallery/settings TTL

async function getCollections() {
  const cached = await redis.get(LIST_KEY)
  if (cached) return JSON.parse(cached)

  const data = await repo.listPublicCollections()
  await redis.set(LIST_KEY, JSON.stringify(data), "EX", TTL_SECONDS)
  return data
}

async function getCollection(slug) {
  const key = `${DETAIL_PREFIX}${slug}`
  const cached = await redis.get(key)
  if (cached) return JSON.parse(cached)

  const data = await repo.getPublicCollectionBySlug(slug)
  // Misses are not cached: a slug that does not exist yet may be published
  // moments later, and caching null would hide it for an hour.
  if (!data) return null

  await redis.set(key, JSON.stringify(data), "EX", TTL_SECONDS)
  return data
}

/** Clear the list and every cached detail page. Call after any catalog write. */
async function invalidate() {
  const keys = await redis.keys(`${DETAIL_PREFIX}*`)
  await redis.del(LIST_KEY, ...keys)
}

module.exports = { getCollections, getCollection, invalidate, LIST_KEY, DETAIL_PREFIX }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && DB_PORT=3307 npm test -- catalogCache`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/shop/catalogCache.js backend/tests/catalogCache.test.js
git commit -F - <<'EOF'
feat(shop): cache the public catalog in redis

Mirrors the existing gallery/settings caching: 1 hour TTL, explicit
invalidation on write rather than short expiry.

Cache misses are deliberately not cached. A slug that 404s today may be
published minutes later, and storing the null would hide the new collection
for a full hour.
EOF
```

---

### Task 6: Public shop routes

**Files:**
- Create: `backend/routes/shop.js`
- Modify: `backend/server.js` (mount the router)
- Test: `backend/tests/shopRoutes.test.js`

**Interfaces:**
- Consumes: `catalogCache` from Task 5.
- Produces: mounted routes
  - `GET /api/shop/collections` → `200 [Collection & {product_count}]`
  - `GET /api/shop/collections/:slug` → `200 CollectionDetail` or `404 {error:"not_found"}`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/shopRoutes.test.js`:

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest")
const request = require("supertest")
const app = require("../server")
const repo = require("../shop/catalogRepo")
const cache = require("../shop/catalogCache")
const redis = require("../redis")
const { resetTables, closeDb } = require("./helpers/db")

beforeEach(async () => {
  await resetTables("product_variants", "products", "collections")
  await cache.invalidate()
})

afterAll(async () => {
  await cache.invalidate()
  await redis.quit()
  await closeDb()
})

describe("GET /api/shop/collections", () => {
  it("returns only publicly visible collections", async () => {
    await repo.createCollection({ title: "Draft", status: "draft" })
    await repo.createCollection({ title: "Live", status: "active" })

    const res = await request(app).get("/api/shop/collections")
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe("Live")
    expect(res.body[0].allow_ship).toBe(true)
  })
})

describe("GET /api/shop/collections/:slug", () => {
  it("returns the collection with nested products and variants", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 2 }])

    const res = await request(app).get("/api/shop/collections/drop")
    expect(res.status).toBe(200)
    expect(res.body.products[0].variants[0].label).toBe("A1")
  })

  it("404s for a draft collection", async () => {
    await repo.createCollection({ title: "Secret", status: "draft" })
    const res = await request(app).get("/api/shop/collections/secret")
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("not_found")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- shopRoutes`
Expected: FAIL — both collection routes return the catch-all 404, so the first test gets `404` instead of `200`.

- [ ] **Step 3: Create the router**

Create `backend/routes/shop.js`:

```js
const express = require("express")
const cache = require("../shop/catalogCache")

/**
 * Public storefront routes. `publicLimiter` is applied by the caller so the
 * rate-limit configuration stays in one place in server.js.
 */
module.exports = function shopRoutes() {
  const router = express.Router()

  router.get("/collections", async (req, res) => {
    try {
      res.json(await cache.getCollections())
    } catch (err) {
      console.error("[SHOP] Lỗi lấy danh sách collection:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.get("/collections/:slug", async (req, res) => {
    try {
      const collection = await cache.getCollection(req.params.slug)
      if (!collection) {
        return res.status(404).json({ error: "not_found", message: "Không tìm thấy bộ sưu tập" })
      }
      res.json(collection)
    } catch (err) {
      console.error("[SHOP] Lỗi lấy collection:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  return router
}
```

- [ ] **Step 4: Mount the router in server.js**

In `backend/server.js`, find the line `const invalidateGallery = () => redis.del("gallery")` (around line 185) and insert immediately **above** it:

```js
// ── SHOP: public storefront ──
app.use(`${API_PREFIX}/shop`, publicLimiter, require("./routes/shop")())
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && DB_PORT=3307 npm test -- shopRoutes`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/shop.js backend/server.js backend/tests/shopRoutes.test.js
git commit -F - <<'EOF'
feat(shop): add public storefront routes

GET /api/shop/collections and /api/shop/collections/:slug, both served from
the redis-cached catalog and mounted behind the existing publicLimiter.

These live in routes/shop.js rather than inline in server.js, which is already
734 lines and would only get harder to navigate as the shop grows.
EOF
```

---

### Task 7: Admin catalog routes

**Files:**
- Create: `backend/routes/adminCatalog.js`
- Modify: `backend/server.js` (mount the router)
- Test: `backend/tests/adminCatalogRoutes.test.js`

**Interfaces:**
- Consumes: `catalogRepo` (Task 4), `catalogCache` (Task 5), existing `backend/auth.js`.
- Produces: mounted routes, all requiring `Authorization: Bearer <jwt>`:
  - `GET    /api/admin/collections`
  - `POST   /api/admin/collections` → `201 {id}`
  - `PUT    /api/admin/collections/:id`
  - `DELETE /api/admin/collections/:id`
  - `POST   /api/admin/collections/:id/products` → `201 {id}`
  - `PUT    /api/admin/products/:id`
  - `DELETE /api/admin/products/:id`
  - `PUT    /api/admin/products/:id/variants` — body `{ variants: [{id?, label, image_url?, stock_qty?}] }`

  Every mutating route calls `cache.invalidate()` before responding.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/adminCatalogRoutes.test.js`:

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest")
const request = require("supertest")
const jwt = require("jsonwebtoken")
const app = require("../server")
const repo = require("../shop/catalogRepo")
const cache = require("../shop/catalogCache")
const redis = require("../redis")
const { resetTables, closeDb } = require("./helpers/db")

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET || "change-me-in-production")
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

beforeEach(async () => {
  await resetTables("product_variants", "products", "collections")
  await cache.invalidate()
})

afterAll(async () => {
  await cache.invalidate()
  await redis.quit()
  await closeDb()
})

describe("auth", () => {
  it("rejects unauthenticated access", async () => {
    const res = await request(app).get("/api/admin/collections")
    expect(res.status).toBe(401)
    expect(res.body.error).toBe("unauthorized")
  })
})

describe("POST /api/admin/collections", () => {
  it("creates a collection and returns its id", async () => {
    const res = await authed(request(app).post("/api/admin/collections"))
      .send({ title: "Bộ sưu tập Hè", status: "active", allow_pickup: true })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeGreaterThan(0)

    const [c] = await repo.listAllCollections()
    expect(c.slug).toBe("bo-suu-tap-he")
    expect(c.allow_pickup).toBe(true)
  })

  it("rejects a missing title", async () => {
    const res = await authed(request(app).post("/api/admin/collections")).send({ status: "active" })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects an unknown status", async () => {
    const res = await authed(request(app).post("/api/admin/collections"))
      .send({ title: "X", status: "published" })
    expect(res.status).toBe(400)
  })

  it("invalidates the public cache", async () => {
    await request(app).get("/api/shop/collections") // warm the cache
    await authed(request(app).post("/api/admin/collections")).send({ title: "New", status: "active" })

    const res = await request(app).get("/api/shop/collections")
    expect(res.body).toHaveLength(1)
  })
})

describe("products and variants", () => {
  it("creates a product under a collection", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Photocard", price: 35000, description: "6x9cm" })

    expect(res.status).toBe(201)
    const detail = await repo.getPublicCollectionBySlug("drop")
    expect(detail.products[0].name).toBe("Photocard")
    expect(detail.products[0].price).toBe(35000)
  })

  it("rejects a negative price", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const res = await authed(request(app).post(`/api/admin/collections/${cid}/products`))
      .send({ name: "Bad", price: -1 })
    expect(res.status).toBe(400)
  })

  it("bulk replaces variants, preserving null stock as unlimited", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })

    const res = await authed(request(app).put(`/api/admin/products/${pid}/variants`))
      .send({ variants: [{ label: "A1", stock_qty: 3 }, { label: "A2", stock_qty: null }] })

    expect(res.status).toBe(200)
    const detail = await repo.getPublicCollectionBySlug("drop")
    const v = detail.products[0].variants
    expect(v.map((x) => x.label)).toEqual(["A1", "A2"])
    expect(v[1].stock_qty).toBeNull()
  })

  it("rejects a variant without a label", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    const res = await authed(request(app).put(`/api/admin/products/${pid}/variants`))
      .send({ variants: [{ stock_qty: 1 }] })
    expect(res.status).toBe(400)
  })

  it("deletes a collection and its products", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })

    const res = await authed(request(app).delete(`/api/admin/collections/${cid}`))
    expect(res.status).toBe(200)
    expect(await repo.listAllCollections()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- adminCatalogRoutes`
Expected: FAIL — the admin routes 404, so the auth test gets `404` instead of `401`.

- [ ] **Step 3: Create the admin router**

Create `backend/routes/adminCatalog.js`:

```js
const express = require("express")
const repo = require("../shop/catalogRepo")
const cache = require("../shop/catalogCache")

const STATUSES = ["draft", "active", "closed", "archived"]

const bad = (res, message) => res.status(400).json({ error: "invalid_input", message })
const oops = (res, err, where) => {
  console.error(`[ADMIN/CATALOG] ${where}:`, err)
  res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
}

function validateCollection(body) {
  if (!body.title || !String(body.title).trim()) return "Cần tên bộ sưu tập"
  if (body.status && !STATUSES.includes(body.status)) return "Trạng thái không hợp lệ"
  if (body.allow_ship === false && body.allow_pickup === false) {
    return "Phải chọn ít nhất một hình thức nhận hàng"
  }
  return null
}

function validateProduct(body) {
  if (!body.name || !String(body.name).trim()) return "Cần tên sản phẩm"
  const price = Number(body.price)
  if (!Number.isInteger(price) || price < 0) return "Giá phải là số nguyên không âm (VND)"
  return null
}

function validateVariants(variants) {
  if (!Array.isArray(variants)) return "Danh sách phân loại không hợp lệ"
  for (const v of variants) {
    if (!v.label || !String(v.label).trim()) return "Mỗi phân loại cần có mã/tên"
    if (v.stock_qty !== null && v.stock_qty !== undefined && v.stock_qty !== "") {
      const n = Number(v.stock_qty)
      if (!Number.isInteger(n) || n < 0) return "Số lượng phải là số nguyên không âm, hoặc để trống nếu không giới hạn"
    }
  }
  const labels = variants.map((v) => String(v.label).trim())
  if (new Set(labels).size !== labels.length) return "Mã phân loại bị trùng"
  return null
}

/** `auth` is applied by the caller in server.js. */
module.exports = function adminCatalogRoutes() {
  const router = express.Router()

  router.get("/collections", async (req, res) => {
    try {
      res.json(await repo.listAllCollections())
    } catch (err) { oops(res, err, "Lỗi liệt kê collection") }
  })

  router.post("/collections", async (req, res) => {
    try {
      const invalid = validateCollection(req.body)
      if (invalid) return bad(res, invalid)

      const id = await repo.createCollection(req.body)
      await cache.invalidate()
      res.status(201).json({ id })
    } catch (err) { oops(res, err, "Lỗi tạo collection") }
  })

  router.put("/collections/:id", async (req, res) => {
    try {
      const invalid = validateCollection(req.body)
      if (invalid) return bad(res, invalid)

      const ok = await repo.updateCollection(req.params.id, req.body)
      if (!ok) return res.status(404).json({ error: "not_found", message: "Không tìm thấy bộ sưu tập" })

      await cache.invalidate()
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi sửa collection") }
  })

  router.delete("/collections/:id", async (req, res) => {
    try {
      const ok = await repo.deleteCollection(req.params.id)
      if (!ok) return res.status(404).json({ error: "not_found", message: "Không tìm thấy bộ sưu tập" })

      await cache.invalidate()
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi xóa collection") }
  })

  router.post("/collections/:id/products", async (req, res) => {
    try {
      const invalid = validateProduct(req.body)
      if (invalid) return bad(res, invalid)

      const id = await repo.createProduct({ ...req.body, collection_id: Number(req.params.id) })
      await cache.invalidate()
      res.status(201).json({ id })
    } catch (err) { oops(res, err, "Lỗi tạo sản phẩm") }
  })

  router.put("/products/:id", async (req, res) => {
    try {
      const invalid = validateProduct(req.body)
      if (invalid) return bad(res, invalid)

      const ok = await repo.updateProduct(req.params.id, req.body)
      if (!ok) return res.status(404).json({ error: "not_found", message: "Không tìm thấy sản phẩm" })

      await cache.invalidate()
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi sửa sản phẩm") }
  })

  router.delete("/products/:id", async (req, res) => {
    try {
      const ok = await repo.deleteProduct(req.params.id)
      if (!ok) return res.status(404).json({ error: "not_found", message: "Không tìm thấy sản phẩm" })

      await cache.invalidate()
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi xóa sản phẩm") }
  })

  router.put("/products/:id/variants", async (req, res) => {
    try {
      const { variants } = req.body
      const invalid = validateVariants(variants)
      if (invalid) return bad(res, invalid)

      await repo.replaceVariants(Number(req.params.id), variants)
      await cache.invalidate()
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi lưu phân loại") }
  })

  return router
}
```

- [ ] **Step 4: Mount the admin router in server.js**

In `backend/server.js`, immediately below the shop router line added in Task 6, insert:

```js
app.use(`${API_PREFIX}/admin`, auth, require("./routes/adminCatalog")())
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && DB_PORT=3307 npm test -- adminCatalogRoutes`
Expected: PASS, 9 tests.

- [ ] **Step 6: Run the whole suite to catch regressions**

Run: `cd backend && DB_PORT=3307 npm test`
Expected: PASS, all tests across every file.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/adminCatalog.js backend/server.js backend/tests/adminCatalogRoutes.test.js
git commit -F - <<'EOF'
feat(shop): add admin catalog routes

CRUD for collections and products plus bulk variant replacement, all behind
the existing JWT auth middleware, all invalidating the public catalog cache
before responding.

Variants are saved as a whole list rather than row by row, because a photocard
sheet is edited as a set — 40-odd codes at once — and per-row endpoints would
mean 40 requests to publish one product.

Validation rejects blank titles and labels, non-integer or negative prices,
duplicate variant codes, and a collection offering neither shipping nor
pickup. Blank stock is preserved as null (unlimited) rather than coerced to 0,
which would wrongly mean sold out.
EOF
```

---

### Task 8: Product image upload

Reuses the existing WebP pipeline. Product images and per-variant photocard art both go through this one endpoint.

**Files:**
- Create: `backend/shop/images.js`
- Modify: `backend/routes/adminCatalog.js` (add the upload route)
- Modify: `backend/server.js:24-29` (extend the large-body regex)
- Test: `backend/tests/shopImages.test.js`

**Interfaces:**
- Consumes: existing `backend/storage.js`, `sharp`.
- Produces:
  - `backend/shop/images.js` exporting `processShopImage(buffer: Buffer): Promise<Buffer>` (WebP, max width 1920) and `uploadShopImage(folder: string, buffer: Buffer): Promise<string>` returning a `/api/storage/...` proxy URL.
  - Route `POST /api/admin/shop/image` — body `{ base64, folder }` → `201 { url }`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/shopImages.test.js`:

```js
const { describe, it, expect } = require("vitest")
const sharp = require("sharp")
const { processShopImage } = require("../shop/images")

async function pngFixture(width, height) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 120 } },
  }).png().toBuffer()
}

describe("processShopImage", () => {
  it("re-encodes to webp", async () => {
    const out = await processShopImage(await pngFixture(400, 400))
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe("webp")
  })

  it("downscales images wider than 1920", async () => {
    const out = await processShopImage(await pngFixture(3000, 1000))
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(1920)
  })

  it("leaves smaller images at their original width", async () => {
    const out = await processShopImage(await pngFixture(800, 600))
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(800)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- shopImages`
Expected: FAIL with `Cannot find module '../shop/images'`.

- [ ] **Step 3: Implement the image helper**

Create `backend/shop/images.js`:

```js
const sharp = require("sharp")
const storage = require("./../storage")

const MAX_WIDTH = 1920
const WEBP_QUALITY = 82

/**
 * Same pipeline as the portfolio uploads in server.js: auto-orient from EXIF,
 * cap the width, and encode WebP (smaller than JPEG and keeps alpha).
 */
async function processShopImage(buffer) {
  const meta = await sharp(buffer).metadata()
  let pipeline = sharp(buffer).rotate()

  if (meta.width > MAX_WIDTH) {
    pipeline = pipeline.resize(MAX_WIDTH, null, { withoutEnlargement: true })
  }
  return pipeline.webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer()
}

/** Process and store under shop/<folder>/, returning the proxy URL. */
async function uploadShopImage(folder, buffer) {
  const processed = await processShopImage(buffer)
  const safeFolder = String(folder || "misc").replace(/[^a-z0-9/_-]/gi, "")
  const key = `shop/${safeFolder}/${Date.now()}-${Math.round(Math.random() * 1e6)}.webp`

  await storage.upload(key, processed, "image/webp")
  return storage.proxyUrl(key)
}

module.exports = { processShopImage, uploadShopImage }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && DB_PORT=3307 npm test -- shopImages`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the upload route**

In `backend/routes/adminCatalog.js`, add the import at the top, below the existing requires:

```js
const { uploadShopImage } = require("../shop/images")
```

Then add this route just before the closing `return router`:

```js
  router.post("/shop/image", async (req, res) => {
    try {
      const { base64, folder } = req.body
      if (!base64) return bad(res, "Cần ảnh (base64)")

      const buffer = Buffer.from(base64, "base64")
      console.log(`[ADMIN/CATALOG] upload ảnh shop size≈${Math.round(buffer.length / 1024)}KB`)

      const url = await uploadShopImage(folder || "misc", buffer)
      res.status(201).json({ url })
    } catch (err) { oops(res, err, "Lỗi upload ảnh") }
  })
```

- [ ] **Step 6: Allow large bodies on the shop upload path**

In `backend/server.js`, the body-parser selector currently matches only `/api/image` and `/api/upload/`. Replace that middleware (around lines 24-29) with:

```js
app.use((req, res, next) => {
  if (req.method === "POST" && /^\/api\/(image$|upload\/|admin\/shop\/image$)/.test(req.path)) {
    return largeJson(req, res, next)
  }
  return smallJson(req, res, next)
})
```

Without this, a base64 product photo over 1mb is rejected by the small-body parser before the route sees it.

- [ ] **Step 7: Run the whole suite**

Run: `cd backend && DB_PORT=3307 npm test`
Expected: PASS, all tests.

- [ ] **Step 8: Commit**

```bash
git add backend/shop/images.js backend/routes/adminCatalog.js backend/server.js \
        backend/tests/shopImages.test.js
git commit -F - <<'EOF'
feat(shop): add product and variant image upload

One endpoint serves both product photos and per-variant photocard art, reusing
the portfolio's existing pipeline: EXIF auto-orient, cap at 1920px, encode
WebP. Files land in MinIO under shop/<folder>/ and are served through the
existing storage proxy rather than exposing MinIO directly.

The body-parser selector in server.js also had to learn about this path —
base64 photos exceed the 1mb small-body limit and would otherwise be rejected
with a 413 before reaching the route.
EOF
```

---

### Task 9: Frontend shop API client and markdown renderer

**Files:**
- Modify: `frontend/package.json` (add `marked`, `dompurify`)
- Create: `frontend/src/api/shop.js`
- Create: `frontend/src/utils/markdown.js`
- Create: `frontend/src/utils/money.js`

**Interfaces:**
- Consumes: existing `frontend/src/api/api.js` axios instance.
- Produces:
  - `frontend/src/api/shop.js` exporting `fetchCollections()`, `fetchCollection(slug)`, `adminListCollections()`, `adminCreateCollection(data)`, `adminUpdateCollection(id, data)`, `adminDeleteCollection(id)`, `adminCreateProduct(collectionId, data)`, `adminUpdateProduct(id, data)`, `adminDeleteProduct(id)`, `adminSaveVariants(productId, variants)`, `adminUploadImage(base64, folder)`. All return the response body directly.
  - `frontend/src/utils/markdown.js` exporting `renderMarkdown(text: string): string` — sanitized HTML.
  - `frontend/src/utils/money.js` exporting `formatVnd(n: number): string` → `"35.000₫"`.

- [ ] **Step 1: Install the markdown dependencies**

Run:
```bash
cd frontend && npm install marked@^15.0.7 dompurify@^3.2.4
```

- [ ] **Step 2: Create the money formatter**

Create `frontend/src/utils/money.js`:

```js
/** Format an integer VND amount, e.g. 35000 -> "35.000₫". */
export function formatVnd(n) {
  const value = Number(n) || 0
  return `${value.toLocaleString("vi-VN")}₫`
}
```

- [ ] **Step 3: Create the sanitized markdown renderer**

Create `frontend/src/utils/markdown.js`:

```js
import { marked } from "marked"
import DOMPurify from "dompurify"

marked.setOptions({ breaks: true, gfm: true })

/**
 * Render seller-authored markdown to HTML that is safe to inject.
 * Authors are admin-only, but sanitising costs nothing and closes the hole
 * if those credentials are ever compromised.
 */
export function renderMarkdown(text) {
  if (!text) return ""
  return DOMPurify.sanitize(marked.parse(String(text)), {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "del", "a", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "blockquote", "code", "pre", "hr",
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
  })
}
```

- [ ] **Step 4: Create the shop API client**

Create `frontend/src/api/shop.js`:

```js
import { api } from "./api"

// ── Public storefront ──
export const fetchCollections = () =>
  api.get("/api/shop/collections").then((r) => r.data)

export const fetchCollection = (slug) =>
  api.get(`/api/shop/collections/${slug}`).then((r) => r.data)

// ── Admin catalog (JWT is set globally on axios by Admin.jsx) ──
export const adminListCollections = () =>
  api.get("/api/admin/collections").then((r) => r.data)

export const adminCreateCollection = (data) =>
  api.post("/api/admin/collections", data).then((r) => r.data)

export const adminUpdateCollection = (id, data) =>
  api.put(`/api/admin/collections/${id}`, data).then((r) => r.data)

export const adminDeleteCollection = (id) =>
  api.delete(`/api/admin/collections/${id}`).then((r) => r.data)

export const adminCreateProduct = (collectionId, data) =>
  api.post(`/api/admin/collections/${collectionId}/products`, data).then((r) => r.data)

export const adminUpdateProduct = (id, data) =>
  api.put(`/api/admin/products/${id}`, data).then((r) => r.data)

export const adminDeleteProduct = (id) =>
  api.delete(`/api/admin/products/${id}`).then((r) => r.data)

export const adminSaveVariants = (productId, variants) =>
  api.put(`/api/admin/products/${productId}/variants`, { variants }).then((r) => r.data)

export const adminUploadImage = (base64, folder) =>
  api.post("/api/admin/shop/image", { base64, folder }).then((r) => r.data)
```

- [ ] **Step 5: Verify the frontend still builds**

Run: `cd frontend && npm run build && npm run lint`
Expected: build succeeds, lint reports no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json \
        frontend/src/api/shop.js frontend/src/utils/markdown.js frontend/src/utils/money.js
git commit -F - <<'EOF'
feat(shop): add frontend shop API client and helpers

- api/shop.js wraps every storefront and admin catalog endpoint on the shared
  axios instance, so components never build URLs themselves
- utils/markdown.js renders seller-authored markdown through marked and then
  sanitises with DOMPurify against an explicit tag allowlist. The authors are
  admins, but sanitising costs nothing and contains the damage if those
  credentials leak
- utils/money.js formats integer VND with vi-VN grouping
EOF
```

---

### Task 10: Storefront pages

**Files:**
- Create: `frontend/src/pages/Shop.jsx`
- Create: `frontend/src/pages/Collection.jsx`
- Create: `frontend/src/components/shop/ProductCard.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/i18n/translations.js`

**Interfaces:**
- Consumes: `fetchCollections`, `fetchCollection` (Task 9), `renderMarkdown`, `formatVnd`, `useLanguage`.
- Produces: routes `/shop` and `/shop/:slug`. `ProductCard` takes props `{ product }` where `product` is `{ id, name, description, price, images, variants }`.

- [ ] **Step 1: Add the translation keys**

In `frontend/src/i18n/translations.js`, add these keys inside the `en` object (alongside the existing nav keys):

```js
    // Shop
    shop: "Shop",
    shopTitle: "Merch",
    shopDesc: "Pick what you like, then place an order.",
    shopEmpty: "No collections yet.",
    shopLoading: "Loading...",
    shopBack: "Back to shop",
    shopClosed: "This drop has ended",
    shopClosedNote: "You can still browse, but ordering is closed.",
    shopSoldOut: "Sold out",
    shopInStock: "{n} left",
    shopUnlimited: "Available",
    shopNoProducts: "No products in this collection yet.",
    shopPickup: "Pickup at event",
    shopShip: "Nationwide shipping",
    shopNotFound: "Collection not found.",
```

Then add the matching keys inside the `vi` object:

```js
    // Shop
    shop: "Shop",
    shopTitle: "Merch",
    shopDesc: "Chọn món bạn thích rồi đặt hàng.",
    shopEmpty: "Chưa có bộ sưu tập nào.",
    shopLoading: "Đang tải...",
    shopBack: "Về shop",
    shopClosed: "Đợt mở bán đã kết thúc",
    shopClosedNote: "Bạn vẫn xem được, nhưng không đặt hàng được nữa.",
    shopSoldOut: "Hết hàng",
    shopInStock: "Còn {n}",
    shopUnlimited: "Còn hàng",
    shopNoProducts: "Bộ sưu tập này chưa có sản phẩm.",
    shopPickup: "Nhận tại sự kiện",
    shopShip: "Giao toàn quốc",
    shopNotFound: "Không tìm thấy bộ sưu tập.",
```

- [ ] **Step 2: Create the product card**

Create `frontend/src/components/shop/ProductCard.jsx`:

```jsx
import { useLanguage } from "../../contexts/LanguageContext"
import { renderMarkdown } from "../../utils/markdown"
import { formatVnd } from "../../utils/money"

/** stock_qty null = unlimited, 0 = sold out, n = n remaining. */
function stockLabel(variant, t) {
  if (variant.stock_qty === null || variant.stock_qty === undefined) return t("shopUnlimited")
  if (variant.stock_qty <= 0) return t("shopSoldOut")
  return t("shopInStock", { n: variant.stock_qty })
}

export default function ProductCard({ product }) {
  const { t } = useLanguage()
  const cover = product.images?.[0] || product.variants?.find((v) => v.image_url)?.image_url

  return (
    <article className="rounded-2xl border border-[var(--border-brand)] bg-[var(--bg-card)] overflow-hidden flex flex-col">
      {cover && (
        <img
          src={cover}
          alt={product.name}
          loading="lazy"
          className="w-full aspect-square object-cover"
        />
      )}

      <div className="p-4 flex flex-col gap-2 flex-1">
        <h3 className="font-semibold text-lg">{product.name}</h3>
        <p className="text-[var(--brand)] font-bold">{formatVnd(product.price)}</p>

        {product.description && (
          <div
            className="prose prose-sm max-w-none opacity-80"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(product.description) }}
          />
        )}

        {product.variants?.length > 0 && (
          <ul className="mt-auto pt-3 flex flex-wrap gap-2">
            {product.variants.map((v) => {
              const soldOut = v.stock_qty !== null && v.stock_qty !== undefined && v.stock_qty <= 0
              return (
                <li
                  key={v.id}
                  title={stockLabel(v, t)}
                  className={
                    "px-2 py-1 rounded-lg text-xs border " +
                    (soldOut
                      ? "opacity-40 line-through border-current"
                      : "border-[var(--border-brand)]")
                  }
                >
                  {v.label}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </article>
  )
}
```

- [ ] **Step 3: Create the shop index page**

Create `frontend/src/pages/Shop.jsx`:

```jsx
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { fetchCollections } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"

export default function Shop() {
  const { t } = useLanguage()
  const [collections, setCollections] = useState(null)

  useEffect(() => {
    fetchCollections()
      .then(setCollections)
      .catch(() => setCollections([]))
  }, [])

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-1">{t("shopTitle")}</h1>
      <p className="opacity-70 mb-8">{t("shopDesc")}</p>

      {collections === null && <p className="opacity-60">{t("shopLoading")}</p>}
      {collections?.length === 0 && <p className="opacity-60">{t("shopEmpty")}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {collections?.map((c) => (
          <Link
            key={c.id}
            to={`/shop/${c.slug}`}
            className="rounded-2xl border border-[var(--border-brand)] overflow-hidden hover:shadow-[var(--shadow-pink-hover)] transition"
          >
            {(c.thumbnail_image || c.cover_image) && (
              <img
                src={c.thumbnail_image || c.cover_image}
                alt={c.title}
                loading="lazy"
                className="w-full aspect-[4/3] object-cover"
              />
            )}
            <div className="p-4">
              <h2 className="font-semibold">{c.title}</h2>
              <p className="text-sm opacity-70">{t("photosCount", { n: c.product_count })}</p>
              {c.status === "closed" && (
                <p className="mt-2 text-xs uppercase tracking-wide opacity-60">{t("shopClosed")}</p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Create the collection detail page**

Create `frontend/src/pages/Collection.jsx`:

```jsx
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { fetchCollection } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import { renderMarkdown } from "../utils/markdown"
import ProductCard from "../components/shop/ProductCard"

export default function Collection() {
  const { slug } = useParams()
  const { t } = useLanguage()
  const [collection, setCollection] = useState(undefined)

  useEffect(() => {
    setCollection(undefined)
    fetchCollection(slug)
      .then(setCollection)
      .catch(() => setCollection(null))
  }, [slug])

  if (collection === undefined) {
    return <main className="max-w-5xl mx-auto px-4 py-10 opacity-60">{t("shopLoading")}</main>
  }

  if (collection === null) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-10">
        <p className="opacity-70 mb-4">{t("shopNotFound")}</p>
        <Link to="/shop" className="text-[var(--text-link)]">{t("shopBack")}</Link>
      </main>
    )
  }

  const closed = collection.status === "closed"

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <Link to="/shop" className="text-sm text-[var(--text-link)]">← {t("shopBack")}</Link>

      {collection.cover_image && (
        <img
          src={collection.cover_image}
          alt={collection.title}
          className="w-full rounded-2xl mt-4 mb-6"
        />
      )}

      <h1 className="text-3xl font-bold mb-2">{collection.title}</h1>

      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        {collection.allow_ship && (
          <span className="px-2 py-1 rounded-lg border border-[var(--border-brand)]">{t("shopShip")}</span>
        )}
        {collection.allow_pickup && (
          <span className="px-2 py-1 rounded-lg border border-[var(--border-brand)]">{t("shopPickup")}</span>
        )}
      </div>

      {closed && (
        <div className="mb-6 p-4 rounded-xl border border-[var(--border-brand)] opacity-80">
          <p className="font-semibold">{t("shopClosed")}</p>
          <p className="text-sm">{t("shopClosedNote")}</p>
        </div>
      )}

      {collection.description && (
        <div
          className="prose max-w-none mb-8"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(collection.description) }}
        />
      )}

      {collection.products.length === 0 ? (
        <p className="opacity-60">{t("shopNoProducts")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {collection.products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 5: Register the routes**

Replace `frontend/src/App.jsx` with:

```jsx
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { ThemeProvider } from "./contexts/ThemeContext"
import { LanguageProvider } from "./contexts/LanguageContext"
import Portfolio from "./pages/Portfolio"
import Admin from "./pages/Admin"
import Shop from "./pages/Shop"
import Collection from "./pages/Collection"

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Portfolio />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/shop/:slug" element={<Collection />} />
          </Routes>
        </BrowserRouter>
      </LanguageProvider>
    </ThemeProvider>
  )
}
```

- [ ] **Step 6: Verify the build and lint pass**

Run: `cd frontend && npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 7: Verify manually in the browser**

Start the stack (`docker compose up -d`), run `cd frontend && npm run dev`, then:
1. Visit `http://localhost:5173/shop` — expect the empty-state text (no collections yet).
2. Confirm the page is readable at a 375px-wide viewport (single column, no horizontal scroll).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Shop.jsx frontend/src/pages/Collection.jsx \
        frontend/src/components/shop/ProductCard.jsx frontend/src/App.jsx \
        frontend/src/i18n/translations.js
git commit -F - <<'EOF'
feat(shop): add storefront pages

/shop lists visible collections and /shop/:slug shows one with its products
and variants. Mobile-first single column that grows to three, since buyers
arrive from social links on phones.

Closed collections stay browsable behind a "this drop has ended" notice rather
than disappearing, so past merch remains visible. Sold-out variants render
struck through and dimmed; unlimited variants show no stock number at all.

UI strings go through the existing translations.js so chrome is bilingual,
while seller-authored names and descriptions stay in whichever language they
were written.
EOF
```

---

### Task 11: Admin catalog UI

**Files:**
- Create: `frontend/src/components/AdminCollections.jsx`
- Create: `frontend/src/components/AdminProducts.jsx`
- Create: `frontend/src/components/AdminVariants.jsx`
- Modify: `frontend/src/pages/Admin.jsx`

**Interfaces:**
- Consumes: every `admin*` function from `frontend/src/api/shop.js` (Task 9).
- Produces: an "Shop" tab in the admin. `AdminProducts` takes `{ collection }`; `AdminVariants` takes `{ product, onSaved }`.

- [ ] **Step 1: Read the existing admin layout to match its conventions**

Run: `sed -n '1,120p' frontend/src/pages/Admin.jsx`
Note how tabs, the `token` state, and the existing `AdminAlbums`/`AdminSettings` components are wired. Follow that structure exactly rather than inventing a new one.

- [ ] **Step 2: Create the variant editor**

Create `frontend/src/components/AdminVariants.jsx`:

```jsx
import { useState } from "react"
import { adminSaveVariants } from "../api/shop"

/**
 * Variants are edited as a whole list and saved in one request, because a
 * photocard sheet is 40-odd codes entered at once.
 */
export default function AdminVariants({ product, onSaved }) {
  const [rows, setRows] = useState(
    product.variants?.length ? product.variants : [{ label: "", stock_qty: "" }]
  )
  const [bulk, setBulk] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const update = (i, field, value) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))

  const addRow = () => setRows([...rows, { label: "", stock_qty: "" }])
  const removeRow = (i) => setRows(rows.filter((_, idx) => idx !== i))

  // "A1, A2, B1" or one code per line -> one row each.
  const applyBulk = () => {
    const labels = bulk.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
    if (!labels.length) return
    setRows([...rows.filter((r) => r.label.trim()), ...labels.map((label) => ({ label, stock_qty: "" }))])
    setBulk("")
  }

  const save = async () => {
    setError("")
    setSaving(true)
    try {
      const payload = rows
        .filter((r) => String(r.label).trim())
        .map((r) => ({
          id: r.id,
          label: String(r.label).trim(),
          image_url: r.image_url || null,
          // Empty means unlimited, which the API expects as null rather than 0.
          stock_qty: r.stock_qty === "" || r.stock_qty === null ? null : Number(r.stock_qty),
        }))
      await adminSaveVariants(product.id, payload)
      onSaved?.()
    } catch (e) {
      setError(e.response?.data?.message || "Lưu phân loại thất bại")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 p-3 rounded-xl border border-[var(--border-brand)]">
      <p className="font-medium mb-2">Phân loại (size / mã ảnh)</p>

      <div className="flex gap-2 mb-3">
        <input
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          placeholder="Dán nhiều mã: A1, A2, B1..."
          className="flex-1 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        />
        <button type="button" onClick={applyBulk} className="px-3 py-1 rounded-lg border border-[var(--border-brand)]">
          Thêm hàng loạt
        </button>
      </div>

      {rows.map((r, i) => (
        <div key={r.id || i} className="flex gap-2 mb-2">
          <input
            value={r.label}
            onChange={(e) => update(i, "label", e.target.value)}
            placeholder="Mã (A1) hoặc size (M)"
            className="flex-1 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
          <input
            value={r.stock_qty ?? ""}
            onChange={(e) => update(i, "stock_qty", e.target.value)}
            placeholder="SL (trống = không giới hạn)"
            inputMode="numeric"
            className="w-48 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
          <button type="button" onClick={() => removeRow(i)} className="px-2 opacity-70">✕</button>
        </div>
      ))}

      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={addRow} className="px-3 py-1 rounded-lg border border-[var(--border-brand)]">
          + Thêm dòng
        </button>
        <button type="button" onClick={save} disabled={saving} className="px-3 py-1 rounded-lg bg-[var(--brand)] text-white disabled:opacity-50">
          {saving ? "Đang lưu..." : "Lưu phân loại"}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create the product editor**

Create `frontend/src/components/AdminProducts.jsx`:

```jsx
import { useEffect, useState } from "react"
import {
  fetchCollection, adminCreateProduct, adminUpdateProduct, adminDeleteProduct, adminUploadImage,
} from "../api/shop"
import AdminVariants from "./AdminVariants"
import { formatVnd } from "../utils/money"

const blank = { name: "", description: "", price: "", images: [] }

export default function AdminProducts({ collection }) {
  const [products, setProducts] = useState([])
  const [draft, setDraft] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState("")

  const reload = async () => {
    // Draft collections are not exposed publicly, so nothing to list until published.
    if (collection.status === "draft") return setProducts([])
    const data = await fetchCollection(collection.slug)
    setProducts(data.products)
  }

  useEffect(() => { reload().catch(() => setProducts([])) }, [collection.id, collection.status])

  const pickImage = async (file) => {
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(",")[1])
      reader.readAsDataURL(file)
    })
    const { url } = await adminUploadImage(base64, `products/${collection.id}`)
    setDraft((d) => ({ ...d, images: [...(d.images || []), url] }))
  }

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

  const edit = (p) => {
    setEditingId(p.id)
    setDraft({ name: p.name, description: p.description || "", price: p.price, images: p.images || [] })
  }

  const remove = async (id) => {
    if (!confirm("Xóa sản phẩm này?")) return
    await adminDeleteProduct(id)
    await reload()
  }

  return (
    <div className="mt-4 pl-4 border-l border-[var(--border-brand)]">
      <h4 className="font-semibold mb-2">Sản phẩm</h4>

      {collection.status === "draft" && (
        <p className="text-sm opacity-70 mb-3">
          Đổi trạng thái sang &quot;active&quot; để xem và thêm sản phẩm.
        </p>
      )}

      {products.map((p) => (
        <div key={p.id} className="mb-4 p-3 rounded-xl border border-[var(--border-brand)]">
          <div className="flex justify-between items-start gap-2">
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-sm opacity-70">{formatVnd(p.price)}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={() => edit(p)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Sửa</button>
              <button type="button" onClick={() => remove(p.id)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Xóa</button>
            </div>
          </div>
          <AdminVariants product={p} onSaved={reload} />
        </div>
      ))}

      <div className="p-3 rounded-xl border border-dashed border-[var(--border-brand)]">
        <p className="font-medium mb-2">{editingId ? "Sửa sản phẩm" : "Thêm sản phẩm"}</p>

        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Tên sản phẩm"
          className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        />
        <input
          value={draft.price}
          onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          placeholder="Giá (VND, ví dụ 35000)"
          inputMode="numeric"
          className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        />
        <textarea
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="Mô tả (markdown)"
          rows={3}
          className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        />
        <input
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])}
          className="mb-2 text-sm"
        />

        {draft.images?.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {draft.images.map((url) => (
              <img key={url} src={url} alt="" className="w-16 h-16 object-cover rounded-lg" />
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

        <button type="button" onClick={save} className="px-3 py-1 rounded-lg bg-[var(--brand)] text-white">
          {editingId ? "Cập nhật" : "Thêm"}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create the collection editor**

Create `frontend/src/components/AdminCollections.jsx`:

```jsx
import { useEffect, useState } from "react"
import {
  adminListCollections, adminCreateCollection, adminUpdateCollection,
  adminDeleteCollection, adminUploadImage,
} from "../api/shop"
import AdminProducts from "./AdminProducts"

const STATUSES = [
  { value: "draft", label: "Nháp (ẩn)" },
  { value: "active", label: "Đang mở bán" },
  { value: "closed", label: "Đã đóng (vẫn xem được)" },
  { value: "archived", label: "Lưu trữ (ẩn hẳn)" },
]

const blank = {
  title: "", description: "", status: "draft",
  allow_ship: true, allow_pickup: false,
  pickup_location: "", pickup_note: "",
  cover_image: "", thumbnail_image: "",
}

export default function AdminCollections() {
  const [collections, setCollections] = useState([])
  const [draft, setDraft] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [error, setError] = useState("")

  const reload = () => adminListCollections().then(setCollections)

  useEffect(() => { reload().catch(() => setCollections([])) }, [])

  const upload = async (file, field) => {
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(",")[1])
      reader.readAsDataURL(file)
    })
    const { url } = await adminUploadImage(base64, "collections")
    setDraft((d) => ({ ...d, [field]: url }))
  }

  const save = async () => {
    setError("")
    try {
      if (editingId) await adminUpdateCollection(editingId, draft)
      else await adminCreateCollection(draft)

      setDraft(blank)
      setEditingId(null)
      await reload()
    } catch (e) {
      setError(e.response?.data?.message || "Lưu bộ sưu tập thất bại")
    }
  }

  const edit = (c) => {
    setEditingId(c.id)
    setDraft({
      title: c.title, description: c.description || "", status: c.status,
      allow_ship: c.allow_ship, allow_pickup: c.allow_pickup,
      pickup_location: c.pickup_location || "", pickup_note: c.pickup_note || "",
      cover_image: c.cover_image || "", thumbnail_image: c.thumbnail_image || "",
    })
  }

  const remove = async (id) => {
    if (!confirm("Xóa bộ sưu tập này? Toàn bộ sản phẩm bên trong cũng bị xóa.")) return
    await adminDeleteCollection(id)
    await reload()
  }

  return (
    <div>
      <h3 className="text-xl font-semibold mb-4">Bộ sưu tập</h3>

      {collections.map((c) => (
        <div key={c.id} className="mb-4 p-4 rounded-2xl border border-[var(--border-brand)]">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{c.title}</p>
              <p className="text-sm opacity-70">/{c.slug} · {STATUSES.find((s) => s.value === c.status)?.label}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={() => setExpandedId(expandedId === c.id ? null : c.id)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">
                {expandedId === c.id ? "Ẩn" : "Sản phẩm"}
              </button>
              <button type="button" onClick={() => edit(c)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Sửa</button>
              <button type="button" onClick={() => remove(c.id)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Xóa</button>
            </div>
          </div>

          {expandedId === c.id && <AdminProducts collection={c} />}
        </div>
      ))}

      <div className="p-4 rounded-2xl border border-dashed border-[var(--border-brand)]">
        <p className="font-medium mb-3">{editingId ? "Sửa bộ sưu tập" : "Tạo bộ sưu tập"}</p>

        <input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="Tên bộ sưu tập"
          className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        />
        <textarea
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="Mô tả (markdown: **đậm**, - danh sách, [link](url))"
          rows={4}
          className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        />

        <select
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          className="w-full mb-3 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        >
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <div className="flex gap-4 mb-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.allow_ship} onChange={(e) => setDraft({ ...draft, allow_ship: e.target.checked })} />
            Giao toàn quốc
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.allow_pickup} onChange={(e) => setDraft({ ...draft, allow_pickup: e.target.checked })} />
            Nhận tại sự kiện
          </label>
        </div>

        {draft.allow_pickup && (
          <>
            <input
              value={draft.pickup_location}
              onChange={(e) => setDraft({ ...draft, pickup_location: e.target.value })}
              placeholder="Địa điểm nhận (tên sự kiện, gian hàng)"
              className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
            />
            <textarea
              value={draft.pickup_note}
              onChange={(e) => setDraft({ ...draft, pickup_note: e.target.value })}
              placeholder="Ghi chú nhận hàng (ngày, giờ)"
              rows={2}
              className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
            />
          </>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 text-sm">
          <label>
            Ảnh bìa (banner)
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "cover_image")} className="block mt-1" />
            {draft.cover_image && <img src={draft.cover_image} alt="" className="mt-2 w-full h-24 object-cover rounded-lg" />}
          </label>
          <label>
            Ảnh thumbnail (danh sách, không bắt buộc)
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "thumbnail_image")} className="block mt-1" />
            {draft.thumbnail_image && <img src={draft.thumbnail_image} alt="" className="mt-2 w-full h-24 object-cover rounded-lg" />}
          </label>
        </div>

        {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

        <button type="button" onClick={save} className="px-4 py-2 rounded-lg bg-[var(--brand)] text-white">
          {editingId ? "Cập nhật" : "Tạo"}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Add the Shop tab to the admin page**

In `frontend/src/pages/Admin.jsx`, add the import alongside the other component imports:

```jsx
import AdminCollections from "../components/AdminCollections"
```

Then add a "Shop" entry to the existing tab list and render `<AdminCollections />` when it is selected, following exactly the pattern the existing `AdminAlbums` / `AdminSettings` tabs use in that file.

- [ ] **Step 6: Verify the build and lint pass**

Run: `cd frontend && npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 7: Verify the full loop manually**

With the stack running and logged into `/admin`:
1. Shop tab → create a collection titled `Bộ sưu tập Hè` with status `active`.
2. Confirm it appears at `/shop` with slug `bo-suu-tap-he`.
3. Expand it → add a product `Photocard` priced `35000`, upload an image.
4. Add variants in bulk by pasting `A1, A2, B1`, set A1 stock to `2`, leave A2 blank.
5. Reload `/shop/bo-suu-tap-he` — expect the product, `35.000₫`, and three variant chips.
6. Set A1 stock to `0`, save, reload — expect A1 struck through.
7. Set the collection to `draft` — expect it to disappear from `/shop`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/AdminCollections.jsx \
        frontend/src/components/AdminProducts.jsx \
        frontend/src/components/AdminVariants.jsx \
        frontend/src/pages/Admin.jsx
git commit -F - <<'EOF'
feat(shop): add admin catalog UI

A Shop tab for managing collections, their products, and per-variant stock,
following the existing AdminAlbums/AdminSettings structure.

The variant editor takes a bulk paste of codes ("A1, A2, B1") and expands them
into rows, because a photocard sheet is 40-odd codes and entering them one at
a time is the tedium this whole feature exists to remove. Blank quantity is
sent as null (unlimited) rather than 0, which would mean sold out.

Pickup location and note only appear once a collection actually offers pickup,
so a ship-only drop is not cluttered with fields it will never use.
EOF
```

---

## Self-Review

**Spec coverage for Plan 1's slice:**

| Spec requirement | Task |
|---|---|
| `collections` with title, slug, markdown description, cover + optional thumbnail | 2, 4, 11 |
| Four-value status (draft/active/closed/archived) with correct visibility | 2, 4, 6, 10 |
| Per-collection fulfillment (ship / pickup) + pickup location and note | 2, 4, 7, 11 |
| `products` with integer VND price and images | 2, 4, 7 |
| `product_variants` with label, optional per-variant image, nullable stock | 2, 4, 7 |
| Unlimited stock (`NULL`) never sells out | 2, 4, 10, 11 |
| Redis catalog caching with invalidation on write | 5, 7 |
| Storage proxy for images, existing sharp pipeline | 8 |
| Markdown sanitized on render | 9, 10 |
| Bilingual UI chrome, single-language seller content | 10 |
| Mobile-first storefront | 10 |
| Admin CRUD incl. fast bulk variant entry | 11 |

**Deferred to later plans (correctly out of scope here):** cart, checkout, orders, stock reservation and locking, checkout idempotency, order-creation rate limiting, payment settings and proof upload, email templates and async sending, order QR and admin scanner, nightly backups, `noindex` on order pages, Goong.io address autocomplete.

**Type consistency:** `stock_qty` is `null`-or-integer at every layer (DB nullable, repo preserves null, API validates blank→null, UI sends null for empty). `allow_ship`/`allow_pickup` are booleans from `mapCollection` onward, never 0/1. `price` is an integer VND everywhere. `replaceVariants(productId, variants)` is called with the same signature in Tasks 4, 7, and via `adminSaveVariants` in 9/11.

**Known spec correction made here:** the spec says payment proofs and images are "JPEG ~85%", but `server.js` actually encodes WebP at quality 82. This plan follows the code. The spec should be updated when Plan 3 touches proof upload.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-merch-shop-1-catalog.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.
