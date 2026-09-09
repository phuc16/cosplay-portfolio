# Collection Start/End Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin schedule a collection to become visible at a specific date+time and, optionally, auto-close at a later one, with real (not virtual) status transitions and no new background job.

**Architecture:** Two new nullable `DATETIME` columns on `collections`. A not-yet-started collection is excluded by a `WHERE` clause on the public read paths (hidden like a draft). A collection past its `end_at` is transitioned to `status = 'closed'` for real, in the database, the first time ANY read path (admin or public) touches it - a single shared helper does this "lazy write-through" so no cron/worker is needed. The existing public-collections Redis cache is removed entirely rather than adapted, since it saves nothing at this shop's scale and would otherwise reintroduce staleness.

**Tech Stack:** Express/mysql2 (raw SQL), Knex migrations, React/Vite, Vitest.

## Global Constraints

- Scheduling layers on top of the existing manual `status` - draft/archived collections are unaffected.
- A not-yet-started collection (`start_at` in the future) is fully hidden from buyers (404 on direct link, absent from the list) - no "coming soon" page.
- Reaching `end_at` is a real, persisted `status = 'closed'` write, visible identically to admin and buyer - not a computed/virtual display value.
- The transition happens via lazy write-through on read (any read path can trigger it) - no periodic sweep, no cron, no worker tick.
- `catalogCache.js` (the public-collections Redis cache) is deleted entirely, not adapted.
- `copyCollection` never carries `start_at`/`end_at` into a duplicated collection.
- Comments terse, single-line, only for non-obvious rationale, matching this codebase's existing style.

---

### Task 1: Migration for `start_at`/`end_at`

**Files:**
- Create: `backend/migrations/033_add_collection_schedule.js`
- Modify: `backend/tests/schema.test.js`

**Interfaces:**
- Produces: `collections.start_at` (`DATETIME NULL`), `collections.end_at` (`DATETIME NULL`). All later tasks read/write these exact column names.

- [ ] **Step 1: Write `033_add_collection_schedule.js`**

```js
exports.up = function (knex) {
  return knex.schema.alterTable("collections", (table) => {
    // NULL means visible immediately (today's behavior, unchanged).
    table.datetime("start_at").nullable()
    // NULL means it never auto-closes (today's behavior, unchanged).
    table.datetime("end_at").nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("collections", (table) => {
    table.dropColumn("start_at")
    table.dropColumn("end_at")
  })
}
```

- [ ] **Step 2: Run the migration**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test npx knex migrate:latest`
Expected: `Batch N run: 1 migrations`.

- [ ] **Step 3: Add failing schema assertions**

In `backend/tests/schema.test.js`, inside the existing `describe("catalog schema", ...)` block, add after the `collections` test:

```js
  it("creates collections with nullable start_at/end_at scheduling columns", async () => {
    const c = await columns("collections")
    expect(Object.keys(c)).toEqual(expect.arrayContaining(["start_at", "end_at"]))
    expect(c.start_at.IS_NULLABLE).toBe("YES")
    expect(c.end_at.IS_NULLABLE).toBe("YES")
  })
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/schema.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/033_add_collection_schedule.js backend/tests/schema.test.js
git commit -m "feat(shop): add collections.start_at/end_at scheduling columns"
```

---

### Task 2: Catalog repo - hide before start, real close-on-read past end

**Files:**
- Modify: `backend/shop/catalogRepo.js`
- Modify: `backend/tests/catalogRepo.test.js`

**Interfaces:**
- Consumes: `collections.start_at`/`end_at` (Task 1).
- Produces: `createCollection`/`updateCollection` accept `start_at`/`end_at` in their `data` argument. `listAllCollections`, `getCollectionDetailById`, `listPublicCollections`, `getPublicCollectionBySlug` all return a collection's real, possibly-just-transitioned `status` (never a virtual override). A not-yet-started collection is absent from `listPublicCollections`'s result and `getPublicCollectionBySlug` returns `null` for it.

- [ ] **Step 1: Write failing tests**

In `backend/tests/catalogRepo.test.js`, add a new `describe` block:

```js
describe("collection scheduling", () => {
  it("hides a not-yet-started collection from the public list and slug lookup", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Future Drop", status: "active", start_at: future })

    const list = await repo.listPublicCollections()
    expect(list.find((c) => c.id === cid)).toBeUndefined()
    expect(await repo.getPublicCollectionBySlug((await repo.getCollectionDetailById(cid)).slug)).toBeNull()
  })

  it("still shows a not-yet-started collection to the admin", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Future Drop", status: "active", start_at: future })

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.status).toBe("active")
    expect(new Date(detail.start_at).getTime()).toBe(future.getTime())
  })

  it("shows a collection once its start_at has passed", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Live Drop", status: "active", start_at: past })

    const list = await repo.listPublicCollections()
    expect(list.find((c) => c.id === cid)).toBeTruthy()
  })

  it("really closes a collection past end_at, on the admin path, persisted to the DB row", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Ended Drop", status: "active", end_at: past })

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.status).toBe("closed")

    const [[row]] = await db.query("SELECT status FROM collections WHERE id = ?", [cid])
    expect(row.status).toBe("closed")
  })

  it("really closes a collection past end_at, on the public path too", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Ended Drop", status: "active", end_at: past })
    const slug = (await repo.getCollectionDetailById(cid)).slug

    const detail = await repo.getPublicCollectionBySlug(slug)
    expect(detail.status).toBe("closed")

    const [[row]] = await db.query("SELECT status FROM collections WHERE id = ?", [cid])
    expect(row.status).toBe("closed")
  })

  it("closes a collection past end_at when surfaced via listAllCollections/listPublicCollections too", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Ended Drop", status: "active", end_at: past })

    const adminList = await repo.listAllCollections()
    expect(adminList.find((c) => c.id === cid).status).toBe("closed")

    const publicList = await repo.listPublicCollections()
    expect(publicList.find((c) => c.id === cid).status).toBe("closed")
  })

  it("is idempotent - reading an already-closed-by-expiry collection again does not error or change anything", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Ended Drop", status: "active", end_at: past })

    await repo.getCollectionDetailById(cid)
    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.status).toBe("closed")
  })

  it("never auto-closes a collection with no end_at set", async () => {
    const cid = await repo.createCollection({ title: "Forever Drop", status: "active" })
    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.status).toBe("active")
  })

  it("does not carry start_at/end_at into a copyCollection duplicate", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Scheduled", status: "active", start_at: future, end_at: future })

    const newId = await repo.copyCollection(cid)
    const copy = await repo.getCollectionDetailById(newId)
    expect(copy.start_at).toBeNull()
    expect(copy.end_at).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/catalogRepo.test.js`
Expected: the new tests FAIL - no filtering or transition logic exists yet.

- [ ] **Step 3: Add the `closeExpiredCollections` helper**

In `backend/shop/catalogRepo.js`, add this function right after `mapCollection`:

```js
/**
 * Real, persisted transition - not a display-only computed value. Called by
 * every collection-read path below, so the first read after end_at (by
 * anyone - admin or a buyer) is what flips it; there is no separate
 * sweep/cron. The `AND status = 'active'` guard makes concurrent calls
 * from simultaneous requests safely idempotent.
 */
async function closeExpiredCollections(rows) {
  const now = new Date()
  const due = rows.filter((r) => r.status === "active" && r.end_at && new Date(r.end_at) <= now)
  if (!due.length) return rows

  const ids = due.map((r) => r.id)
  await db.query(
    `UPDATE collections SET status = 'closed' WHERE id IN (${ids.map(() => "?").join(",")}) AND status = 'active'`,
    ids
  )
  const dueIds = new Set(ids)
  return rows.map((r) => (dueIds.has(r.id) ? { ...r, status: "closed" } : r))
}
```

- [ ] **Step 4: Wire it into `listAllCollections` and `listPublicCollections`**

Replace `listAllCollections`:

```js
async function listAllCollections() {
  const [rows] = await db.query(
    "SELECT * FROM collections ORDER BY sort_order ASC, id ASC"
  )
  const updated = await closeExpiredCollections(rows)
  return updated.map(mapCollection)
}
```

Replace `listPublicCollections`:

```js
async function listPublicCollections() {
  const [rows] = await db.query(
    `SELECT c.*, COUNT(p.id) AS product_count
       FROM collections c
       LEFT JOIN products p ON p.collection_id = c.id
      WHERE c.status IN (?, ?) AND (c.start_at IS NULL OR c.start_at <= NOW())
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.id ASC`,
    PUBLIC_STATUSES
  )
  const updated = await closeExpiredCollections(rows)
  return updated.map((r) => ({ ...mapCollection(r), product_count: Number(r.product_count) }))
}
```

- [ ] **Step 5: Wire it into `getPublicCollectionBySlug` and `getCollectionDetailById`**

Replace `getPublicCollectionBySlug`:

```js
async function getPublicCollectionBySlug(slug) {
  const [[collection]] = await db.query(
    "SELECT * FROM collections WHERE slug = ? AND status IN (?, ?) AND (start_at IS NULL OR start_at <= NOW()) LIMIT 1",
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

/** Admin-only: full nested detail by id, regardless of status (draft/archived included). */
async function getCollectionDetailById(id) {
  const [[collection]] = await db.query(
    "SELECT * FROM collections WHERE id = ? LIMIT 1",
    [id]
  )
  if (!collection) return null
  const [updated] = await closeExpiredCollections([collection])
  return nestCollectionDetail(updated)
}
```

- [ ] **Step 6: Persist `start_at`/`end_at` on create/update**

In `insertCollection`, replace the query and params:

```js
async function insertCollection(data, slug, sortOrder) {
  const [res] = await db.query(
    `INSERT INTO collections
       (title, slug, description, cover_image, thumbnail_image, status,
        allow_ship, allow_pickup, pickup_location, pickup_note, payment_deadline_hours,
        start_at, end_at, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      data.payment_deadline_hours || null,
      data.start_at || null,
      data.end_at || null,
      sortOrder,
    ]
  )
  return res.insertId
}
```

In `updateCollection`, replace the `UPDATE` query and params (inside the `try` block - the existing function uses `db.query` directly, there is no `conn` here, unlike `replaceVariants` elsewhere in this file):

```js
    const [res] = await db.query(
      `UPDATE collections
          SET title = ?, slug = ?, description = ?, cover_image = ?, thumbnail_image = ?, status = ?,
              allow_ship = ?, allow_pickup = ?, pickup_location = ?, pickup_note = ?, payment_deadline_hours = ?,
              start_at = ?, end_at = ?
        WHERE id = ?`,
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
        data.payment_deadline_hours || null,
        data.start_at || null,
        data.end_at || null,
        id,
      ]
    )
```

- [ ] **Step 7: Confirm `copyCollection` does not forward `start_at`/`end_at`**

`copyCollection`'s `createCollection({...})` call already lists its fields explicitly (`title`, `description`, `cover_image`, `thumbnail_image`, `status: "draft"`, `allow_ship`, `allow_pickup`, `pickup_location`, `pickup_note`, `payment_deadline_hours`) - do NOT add `start_at`/`end_at` to that object. No code change needed here; this step is a verification checkpoint, not an edit.

- [ ] **Step 8: Run to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/catalogRepo.test.js`
Expected: all pass, including every pre-existing test in the file.

- [ ] **Step 9: Commit**

```bash
git add backend/shop/catalogRepo.js backend/tests/catalogRepo.test.js
git commit -m "feat(shop): hide not-yet-started collections, real close-on-read past end_at"
```

---

### Task 3: Order creation enforces the schedule

**Files:**
- Modify: `backend/shop/orders/orderRepo.js`
- Modify: `backend/tests/orderRepo.test.js`

**Interfaces:**
- Consumes: `collections.end_at` (Task 1).
- Produces: `createOrder` throws `CollectionNotActiveError` (existing error class, no new one needed) for a cart line whose collection's `end_at` has passed, even if the DB row's `status` still says `active` (i.e. before any read has triggered Task 2's write-through).

- [ ] **Step 1: Write failing tests**

In `backend/tests/orderRepo.test.js`, find the existing `seedVariant(stock, collectionOver = {})` helper - it already accepts a `collectionOver` object spread into `createCollection`. Add a new test near the existing `CollectionNotActiveError` coverage (search for that class name to find the right neighboring `describe` block):

```js
  it("rejects an order once the collection's end_at has passed, even if status is still 'active' in the DB", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const { variantId } = await seedVariant(5, { end_at: past })

    await expect(repo.createOrder(order(variantId, 1))).rejects.toThrow(repo.CollectionNotActiveError)

    const [[row]] = await db.query(
      "SELECT c.status FROM product_variants v JOIN products p ON p.id = v.product_id JOIN collections c ON c.id = p.collection_id WHERE v.id = ?",
      [variantId]
    )
    expect(row.status).toBe("active") // createOrder itself never writes the transition - see Task 2 for that
  })

  it("still allows an order when end_at is in the future", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000)
    const { variantId } = await seedVariant(5, { end_at: future })

    await expect(repo.createOrder(order(variantId, 1))).resolves.toMatchObject({ reused: false })
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/orderRepo.test.js`
Expected: the first new test FAILS (order currently succeeds because `collection_status` is still `active`).

- [ ] **Step 3: Update the SELECT and the check**

In `createOrder`, add `c.end_at` to the SELECT's column list:

```js
    const [rows] = await conn.query(
      `SELECT v.id, v.label, v.stock_qty, v.delivery_link, p.id AS product_id, p.name AS product_name, p.type AS product_type,
              p.price, p.collection_id, c.status AS collection_status, c.end_at AS collection_end_at,
              c.allow_ship, c.allow_pickup, c.payment_deadline_hours
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         JOIN collections c ON c.id = p.collection_id
        WHERE v.id IN (${ids.map(() => "?").join(",")})
        ORDER BY v.id ASC
        FOR UPDATE OF v`,
      ids
    )
```

Then change the per-row check loop:

```js
    for (const row of rows) {
      // A collection whose end_at has already passed is rejected here even
      // if its stored status still says "active" - the real transition to
      // "closed" only happens lazily on a read path (see catalogRepo.js's
      // closeExpiredCollections), which this write path never calls.
      const collectionExpired = row.collection_end_at && new Date(row.collection_end_at) <= new Date()
      if (row.collection_status !== "active" || collectionExpired) {
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

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/orderRepo.test.js`
Expected: all pass, including every pre-existing test in this ~840-line file (run the whole file, not a filter).

- [ ] **Step 5: Commit**

```bash
git add backend/shop/orders/orderRepo.js backend/tests/orderRepo.test.js
git commit -m "feat(shop): reject checkout on a collection past its end_at"
```

---

### Task 4: Remove the public-collections cache entirely

**Files:**
- Delete: `backend/shop/catalogCache.js`
- Delete: `backend/tests/catalogCache.test.js`
- Delete: `backend/tests/catalogCacheInvalidation.test.js`
- Modify: `backend/routes/shop.js`
- Modify: `backend/routes/adminCatalog.js`
- Modify: `backend/shop/orders/orderRepo.js`
- Modify: `backend/routes/orders.js`
- Modify: `backend/tests/shopRoutes.test.js`
- Modify: `backend/tests/adminCatalogRoutes.test.js`

**Interfaces:**
- Produces: `GET /api/shop/collections` and `GET /api/shop/collections/:slug` call `catalogRepo` directly. No code anywhere calls `catalogCache`/`cache.invalidate()` any longer.

- [ ] **Step 1: Delete the cache module and its dedicated tests**

```bash
git rm backend/shop/catalogCache.js backend/tests/catalogCache.test.js backend/tests/catalogCacheInvalidation.test.js
```

- [ ] **Step 2: Update `routes/shop.js` to read the repo directly**

Read the current file first - the two relevant handlers are `router.get("/collections", ...)` and `router.get("/collections/:slug", ...)`. Replace `require("../shop/catalogCache")` with `require("../shop/catalogRepo")`, and change the two call sites:

```js
const repo = require("../shop/catalogRepo")
```

```js
  router.get("/collections", async (req, res) => {
    try {
      res.json(await repo.listPublicCollections())
    } catch (err) {
      console.error("[SHOP] Lỗi lấy danh sách collection:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.get("/collections/:slug", async (req, res) => {
    try {
      const collection = await repo.getPublicCollectionBySlug(req.params.slug)
      if (!collection) {
        return res.status(404).json({ error: "not_found", message: "Không tìm thấy bộ sưu tập" })
      }
      res.json(collection)
    } catch (err) {
      console.error("[SHOP] Lỗi lấy collection:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })
```

If `routes/shop.js` already imports something named `repo` for a different module, pick a distinct local name (e.g. `catalogRepo`) and use that consistently in this file instead - check the current imports before pasting.

- [ ] **Step 3: Remove all `cache.invalidate()` call sites and their imports**

Run: `cd backend && grep -rn "catalogCache" routes/ shop/ --include=*.js`
For each match in `routes/adminCatalog.js`, `shop/orders/orderRepo.js`, and `routes/orders.js`:
- Remove the `const cache = require("../shop/catalogCache")` (or `require("./../catalogCache")`) import line.
- Remove every `await cache.invalidate()` / `await catalogCache.invalidate()` line - delete the line entirely, don't replace it with anything (there is nothing left to invalidate).

Re-run the grep afterward - expected: zero matches anywhere outside `node_modules`.

- [ ] **Step 4: Update the two test files' cleanup calls**

In `backend/tests/shopRoutes.test.js` and `backend/tests/adminCatalogRoutes.test.js`, remove the line `import cache from "../shop/catalogCache.js"` and every `await cache.invalidate()` call in their `beforeEach`/`afterAll` blocks. Do not remove the `redis` import/`redis.quit()` calls in the same blocks - those close the Redis connection pool for other reasons unrelated to this cache.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run`
Expected: all pass. If `tests/adminStatsRoutes.test.js`'s bookkeeping-date tests fail, re-run that file alone - it has a documented pre-existing UTC/Asia-Ho-Chi-Minh midnight-boundary flake unrelated to this change (see the comment at the top of that file); do not treat it as a regression from this task.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shop): remove the public-collections Redis cache entirely

At this shop's actual scale (fewer than 5 collections a year) the
underlying DB query costs nothing extra, and removing the cache
eliminates staleness as a concern - both for collection scheduling and
in general - rather than adding TTL-capping complexity for a scale
this shop doesn't operate at."
```

---

### Task 5: Admin validation for the schedule

**Files:**
- Modify: `backend/routes/adminCatalog.js`
- Modify: `backend/tests/adminCatalogRoutes.test.js`

**Interfaces:**
- Consumes: `createCollection`/`updateCollection` accepting `start_at`/`end_at` (Task 2).
- Produces: `validateCollection(body)` rejects `end_at <= start_at` when both are present.

- [ ] **Step 1: Write failing tests**

In `backend/tests/adminCatalogRoutes.test.js`, find the `describe("POST /api/admin/collections", ...)` block and add nearby, matching its existing `authed`/`request(app)` conventions:

```js
  it("rejects an end_at that is not after start_at", async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const end = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    const res = await authed(request(app).post("/api/admin/collections"))
      .send({ title: "Fes", status: "active", start_at: start, end_at: end })
    expect(res.status).toBe(400)
  })

  it("accepts start_at/end_at when end is after start", async () => {
    const start = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    const end = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const res = await authed(request(app).post("/api/admin/collections"))
      .send({ title: "Fes", status: "active", start_at: start, end_at: end })
    expect(res.status).toBe(201)
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/adminCatalogRoutes.test.js`
Expected: the first new test FAILS (no validation exists yet, so it currently returns 201).

- [ ] **Step 3: Update `validateCollection`**

Add this block to `validateCollection` in `backend/routes/adminCatalog.js`, after the existing `payment_deadline_hours` check:

```js
  if (body.start_at && body.end_at) {
    const start = new Date(body.start_at)
    const end = new Date(body.end_at)
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) {
      return "Thời gian kết thúc phải sau thời gian bắt đầu"
    }
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/adminCatalogRoutes.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/adminCatalog.js backend/tests/adminCatalogRoutes.test.js
git commit -m "feat(shop): validate that a collection's end_at is after its start_at"
```

---

### Task 6: Admin UI - schedule fields on the collection form

**Files:**
- Modify: `frontend/src/components/AdminCollections.jsx`
- Modify: `frontend/src/components/AdminCollections.test.jsx`

**Interfaces:**
- Consumes: `adminCreateCollection`/`adminUpdateCollection` (unchanged signatures - they already forward whatever object they're given, same as `AdminProducts.jsx`'s equivalents).
- Produces: two new `datetime-local` fields on the collection form, "Bắt đầu" (start) / "Kết thúc" (end), both optional.

- [ ] **Step 1: Write failing tests**

In `frontend/src/components/AdminCollections.test.jsx`, read the file's existing render/mock helpers first (the same pattern `AdminProducts.test.jsx` uses - `adminCreateCollection`/`adminUpdateCollection` mocks, a render helper). Add:

```js
describe("scheduling", () => {
  it("creates a collection with start_at and end_at", async () => {
    adminListCollections.mockResolvedValue([])
    adminCreateCollection.mockResolvedValue({ id: 1 })

    const container = await renderAdminCollections()

    const nameInput = container.querySelector('input[placeholder="Tên bộ sưu tập"], input[value=""]')
    // Use whatever selector this file's existing "creates a collection" test
    // uses for the title input - match that exactly rather than guessing here.

    const startInput = container.querySelector('input[type="datetime-local"]')
    expect(startInput).toBeTruthy()
  })

  it("rejects an end time before the start time, showing the server's error message", async () => {
    adminListCollections.mockResolvedValue([])
    adminCreateCollection.mockRejectedValue({ response: { data: { message: "Thời gian kết thúc phải sau thời gian bắt đầu" } } })

    const container = await renderAdminCollections()
    // ... fill title + both datetime-local inputs the same way the file's
    // existing save-flow test does, then click save ...

    expect(container.textContent).toContain("Thời gian kết thúc phải sau thời gian bắt đầu")
  })
})
```

(This step is intentionally light on exact DOM query strings for the surrounding form fields - read the file's existing "creates a collection"/save-flow test first and mirror its exact input-filling and save-click sequence; only the two new `datetime-local` inputs and their assertions are new.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/AdminCollections.test.jsx`
Expected: FAIL - no `datetime-local` input exists yet.

- [ ] **Step 3: Update `AdminCollections.jsx`**

Add to the `blank` constant:

```js
const blank = {
  title: "", description: "", status: "draft",
  allow_ship: true, allow_pickup: false,
  pickup_location: "", pickup_note: "",
  payment_deadline_hours: "",
  start_at: "", end_at: "",
  cover_image: "", thumbnail_image: "",
}
```

Add a small conversion helper near the top of the file (MySQL returns `DATETIME` as either a JS `Date` or an ISO-ish string depending on driver config - this normalizes either into the `datetime-local` input's required `YYYY-MM-DDTHH:mm` format, using LOCAL time components since that's what a `datetime-local` input displays and edits):

```js
/** MySQL DATETIME -> the `YYYY-MM-DDTHH:mm` shape a <input type="datetime-local"> needs, in local time. */
function toDatetimeLocal(value) {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
```

Update `edit(c)`:

```js
  const edit = (c) => {
    setEditingId(c.id)
    setDraft({
      title: c.title, description: c.description || "", status: c.status,
      allow_ship: c.allow_ship, allow_pickup: c.allow_pickup,
      pickup_location: c.pickup_location || "", pickup_note: c.pickup_note || "",
      payment_deadline_hours: c.payment_deadline_hours || "",
      start_at: toDatetimeLocal(c.start_at), end_at: toDatetimeLocal(c.end_at),
      cover_image: c.cover_image || "", thumbnail_image: c.thumbnail_image || "",
    })
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
```

In the form JSX, find the existing `payment_deadline_hours` input and add the two new fields right after it (read the current file to match the exact surrounding JSX structure/classes used by neighboring fields):

```jsx
        <label className="block mb-3">
          <span className="block text-sm mb-1">Bắt đầu (để trống = hiển thị ngay)</span>
          <input
            type="datetime-local"
            value={draft.start_at}
            onChange={(e) => setDraft({ ...draft, start_at: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
        </label>
        <label className="block mb-3">
          <span className="block text-sm mb-1">Kết thúc (để trống = không tự đóng)</span>
          <input
            type="datetime-local"
            value={draft.end_at}
            onChange={(e) => setDraft({ ...draft, end_at: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
        </label>
```

No change is needed to `save()` - it already spreads `draft` wholesale into the create/update call, so `start_at`/`end_at` are forwarded automatically once they exist on `draft`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run src/components/AdminCollections.test.jsx`
Expected: all pass, including every pre-existing test in the file.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all pass (known pre-existing `AdminOrders.test.jsx` debounce-timer flake aside).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AdminCollections.jsx frontend/src/components/AdminCollections.test.jsx
git commit -m "feat(shop): add start/end scheduling fields to the admin collection form"
```

---

### Task 7: Verification and staging build

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run`
Expected: all pass (the documented `adminStatsRoutes.test.js` midnight-boundary flake, if it recurs, is not a regression - re-run that file alone to confirm before treating it as one).

- [ ] **Step 2: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all pass.

- [ ] **Step 3: Build and push to `:staging`**

Run in the background:
```bash
cd /Users/phucth/vibes/cosplay-portfolio && bash scripts/build-push.sh staging > /tmp/build-push-collection-scheduling.log 2>&1; echo EXIT:$?
```

- [ ] **Step 4: Report to the user**

Confirm both suites passed, note the staging push, and remind the user that the public-collections Redis cache no longer exists at all (Task 4) - nothing to flush at deploy, no TTL to wait out - and that a collection whose `end_at` has already passed before this deploy will flip to `closed` for real the next time anyone views it (admin or buyer), not retroactively/immediately at deploy time.
