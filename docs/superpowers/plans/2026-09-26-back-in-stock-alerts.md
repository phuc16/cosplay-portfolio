# Back-in-Stock Email Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buyers can sign up with an email on a sold-out (finite,
`stock_qty === 0`) product variant to be notified once it's back in
stock. An admin's stock edit that raises a variant from `0` to a
positive number queues one email per subscriber, exactly once per
restock event, sent by the background worker.

**Architecture:** Two new tables - `stock_alerts` (subscriptions,
upserted, unique per variant+email) and `stock_alert_queue` (its own
independent send queue, structurally unrelated to `email_queue`/`orders`
- fully snapshotted so it survives the subscription/variant/product
being deleted later). `catalogRepo.js::replaceVariants` detects the
0→positive transition using stock values it already locks, and inside
its own transaction queues+marks-notified. `worker.js` gains one more
dispatch function alongside `dispatchEmails()`. The public surface is a
small inline form in `ProductCard.jsx`'s existing sold-out detail view.

**Tech Stack:** Node/Express, MySQL via mysql2 + Knex migrations,
React/Vite, Vitest.

## Global Constraints

- A `stock_qty: null` (unlimited) variant is **never** eligible - it can
  never be "sold out" (see `docs/superpowers/specs/2026-09-26-back-in-stock-alerts-design.md`).
- The restock trigger is **exactly** `previousStock === 0 && newStock !==
  null && newStock > 0`. Any other transition (including `0 → null`)
  does not fire.
- `stock_alert_queue` has **no FK to `stock_alerts`, `product_variants`,
  or `orders`** - fully snapshotted at enqueue time.
- No synchronous send anywhere - always queue, dispatched by the worker.
- No admin-editable template for this email - a fixed string built in
  code.
- Plain hyphens (` - `), never em dashes, in all new code/comments/copy.
- Buyer-facing frontend strings go through the existing bilingual
  `t()`/`translations.js` mechanism; admin-facing labels are plain
  Vietnamese strings, matching every other admin form in this codebase.
- Do not touch `email_queue`, `email/queue.js`, `email/sender.js`'s
  order-email logic, or anything under `frontend/src/components/SearchableSelect.jsx`
  or a product character/series tag+filter feature - out of scope for
  this feature (sibling work is happening in parallel on those).

---

### Task 1: Migrations - `stock_alerts` + `stock_alert_queue`

**Files:**
- Create: `backend/migrations/049_create_stock_alerts.js`
- Create: `backend/migrations/050_create_stock_alert_queue.js`

**Interfaces:**
- Produces: `stock_alerts` table (`id, product_variant_id, email,
  created_at, notified_at`, unique `(product_variant_id, email)`).
  `stock_alert_queue` table (`id, product_variant_id, email,
  product_name_snapshot, variant_label_snapshot,
  collection_slug_snapshot, status, attempts, last_error, created_at,
  sent_at`, index `(status, attempts)`).

- [ ] **Step 1: Write `049_create_stock_alerts.js`**

```js
exports.up = function (knex) {
  return knex.schema.createTable("stock_alerts", (table) => {
    table.increments("id").primary()

    table.integer("product_variant_id").unsigned().notNullable()
      .references("id").inTable("product_variants").onDelete("CASCADE")

    table.string("email", 191).notNullable()

    table.timestamp("created_at").defaultTo(knex.fn.now())
    // NULL = still waiting for a restock. Set once queued for send, and
    // reset back to NULL on a resubscribe (see stockAlerts/repo.js::signUp) -
    // an already-notified subscriber who wants to hear about the *next*
    // restock has to sign up again, which this reset re-enables.
    table.timestamp("notified_at").nullable()

    // Resubscribing is an upsert (ON DUPLICATE KEY UPDATE notified_at = NULL)
    // against this constraint, not a second row.
    table.unique(["product_variant_id", "email"], "uniq_stock_alert_variant_email")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("stock_alerts")
}
```

- [ ] **Step 2: Write `050_create_stock_alert_queue.js`**

```js
exports.up = function (knex) {
  return knex.schema.createTable("stock_alert_queue", (table) => {
    table.increments("id").primary()

    // Deliberately NOT a foreign key, and deliberately not joined to
    // stock_alerts/product_variants at send time - every field this needs to
    // render and send is snapshotted below, same principle as
    // order_items' *_snapshot columns, so this row keeps working even if the
    // subscription, variant, or product is deleted after it's queued.
    table.integer("product_variant_id").unsigned().nullable()

    table.string("email", 191).notNullable()
    table.string("product_name_snapshot", 191).notNullable()
    table.string("variant_label_snapshot", 191).notNullable().defaultTo("")
    table.string("collection_slug_snapshot", 191).nullable()

    table.enu("status", ["pending", "sent", "failed"]).notNullable().defaultTo("pending")
    table.integer("attempts").unsigned().notNullable().defaultTo(0)
    table.text("last_error").nullable()

    table.timestamp("created_at").defaultTo(knex.fn.now())
    table.timestamp("sent_at").nullable()

    table.index(["status", "attempts"], "idx_stock_alert_queue_status")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("stock_alert_queue")
}
```

- [ ] **Step 3: Run migrations**

Run: `cd backend && npm run migrate`
Expected: both migrations report as run, no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/049_create_stock_alerts.js backend/migrations/050_create_stock_alert_queue.js
git commit -m "feat(shop): add stock_alerts and stock_alert_queue tables"
```

---

### Task 2: `stockAlerts` repo (signup/validation) + public route

**Files:**
- Create: `backend/shop/stockAlerts/repo.js`
- Modify: `backend/routes/shop.js` (add `POST /stock-alerts`)
- Test: `backend/tests/stockAlertsRepo.test.js`
- Test: `backend/tests/shopStockAlertRoute.test.js`

**Interfaces:**
- Produces: `repo.signUp({ variant_id, email })` → throws
  `VariantNotFoundError` / `VariantNotSoldOutError` / `InvalidEmailError`,
  or resolves after the upsert. `repo.listUnnotified(conn, variantId)`,
  `repo.markNotified(conn, ids)` - consumed by Task 4's
  `replaceVariants` change, so their signature (taking a `conn` so they
  run inside the same transaction) must not change later.
- Produces HTTP: `POST /api/shop/stock-alerts` (public, under the
  existing `/api/shop` mount's `publicLimiter`).

- [ ] **Step 1: Write the failing repo tests**

```js
// backend/tests/stockAlertsRepo.test.js
import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import repo from "../shop/stockAlerts/repo.js"
import { resetTables } from "./helpers/db.js"

async function seedVariant(stock_qty) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return v.id
}

beforeEach(async () => {
  await resetTables("stock_alerts", "product_variants", "products", "collections")
})

describe("signUp", () => {
  it("rejects a malformed email", async () => {
    const variantId = await seedVariant(0)
    await expect(repo.signUp({ variant_id: variantId, email: "not-an-email" }))
      .rejects.toThrow(repo.InvalidEmailError)
  })

  it("rejects a variant that does not exist", async () => {
    await expect(repo.signUp({ variant_id: 999999, email: "a@example.com" }))
      .rejects.toThrow(repo.VariantNotFoundError)
  })

  it("rejects a variant that still has stock", async () => {
    const variantId = await seedVariant(5)
    await expect(repo.signUp({ variant_id: variantId, email: "a@example.com" }))
      .rejects.toThrow(repo.VariantNotSoldOutError)
  })

  it("rejects an unlimited (stock_qty null) variant - it can never be sold out", async () => {
    const variantId = await seedVariant(null)
    await expect(repo.signUp({ variant_id: variantId, email: "a@example.com" }))
      .rejects.toThrow(repo.VariantNotSoldOutError)
  })

  it("stores a subscription for a sold-out variant", async () => {
    const variantId = await seedVariant(0)
    await repo.signUp({ variant_id: variantId, email: "a@example.com" })

    const [rows] = await db.query("SELECT * FROM stock_alerts WHERE product_variant_id = ?", [variantId])
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe("a@example.com")
    expect(rows[0].notified_at).toBeNull()
  })

  it("upserts on a repeat signup instead of duplicating the row", async () => {
    const variantId = await seedVariant(0)
    await repo.signUp({ variant_id: variantId, email: "a@example.com" })
    await repo.signUp({ variant_id: variantId, email: "a@example.com" })

    const [rows] = await db.query("SELECT * FROM stock_alerts WHERE product_variant_id = ?", [variantId])
    expect(rows).toHaveLength(1)
  })

  it("resets notified_at back to NULL on a resubscribe", async () => {
    const variantId = await seedVariant(0)
    await repo.signUp({ variant_id: variantId, email: "a@example.com" })
    await db.query("UPDATE stock_alerts SET notified_at = UTC_TIMESTAMP() WHERE product_variant_id = ?", [variantId])

    await repo.signUp({ variant_id: variantId, email: "a@example.com" })

    const [[row]] = await db.query("SELECT notified_at FROM stock_alerts WHERE product_variant_id = ?", [variantId])
    expect(row.notified_at).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run tests/stockAlertsRepo.test.js`
Expected: FAIL - `Cannot find module '../shop/stockAlerts/repo.js'`

- [ ] **Step 3: Write `backend/shop/stockAlerts/repo.js`**

```js
const db = require("../../db")

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

class InvalidEmailError extends Error {
  constructor() { super("Email không hợp lệ"); this.name = "InvalidEmailError" }
}
class VariantNotFoundError extends Error {
  constructor() { super("Không tìm thấy phân loại sản phẩm"); this.name = "VariantNotFoundError" }
}
class VariantNotSoldOutError extends Error {
  constructor() { super("Phân loại này chưa hết hàng"); this.name = "VariantNotSoldOutError" }
}

/** Sign up (or resubscribe) an email for a restock alert on one variant. */
async function signUp({ variant_id, email }) {
  if (!EMAIL_RE.test(String(email || "").trim())) throw new InvalidEmailError()

  const [[variant]] = await db.query(
    "SELECT id, stock_qty FROM product_variants WHERE id = ?",
    [variant_id]
  )
  if (!variant) throw new VariantNotFoundError()
  // Strictly 0 - NULL means unlimited and can never be "sold out" (same
  // rule ProductCard.jsx's isSoldOut already enforces on the frontend).
  if (variant.stock_qty !== 0) throw new VariantNotSoldOutError()

  await db.query(
    `INSERT INTO stock_alerts (product_variant_id, email)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE notified_at = NULL`,
    [variant_id, String(email).trim()]
  )
}

/** Still-waiting subscribers for one variant, locked for update - called
 *  from inside replaceVariants' own transaction on a restock event. */
async function listUnnotified(conn, variantId) {
  const [rows] = await conn.query(
    "SELECT * FROM stock_alerts WHERE product_variant_id = ? AND notified_at IS NULL FOR UPDATE",
    [variantId]
  )
  return rows
}

/** Marks the given stock_alerts rows as notified - called in the same
 *  transaction as the stock_alert_queue inserts for them, so a rollback
 *  undoes both together. */
async function markNotified(conn, ids) {
  if (!ids.length) return
  await conn.query(
    `UPDATE stock_alerts SET notified_at = UTC_TIMESTAMP() WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  )
}

module.exports = {
  signUp, listUnnotified, markNotified,
  InvalidEmailError, VariantNotFoundError, VariantNotSoldOutError,
}
```

- [ ] **Step 4: Run repo tests to verify they pass**

Run: `cd backend && npx vitest run tests/stockAlertsRepo.test.js`
Expected: PASS (7/7)

- [ ] **Step 5: Write the failing public route test**

```js
// backend/tests/shopStockAlertRoute.test.js
import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import { resetTables } from "./helpers/db.js"

async function seedVariant(stock_qty) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return v.id
}

beforeEach(async () => {
  await resetTables("stock_alerts", "product_variants", "products", "collections")
})

describe("POST /api/shop/stock-alerts", () => {
  it("signs up for a sold-out variant", async () => {
    const variantId = await seedVariant(0)
    const res = await request(app).post("/api/shop/stock-alerts").send({ variant_id: variantId, email: "a@example.com" })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it("rejects a variant that is not sold out", async () => {
    const variantId = await seedVariant(5)
    const res = await request(app).post("/api/shop/stock-alerts").send({ variant_id: variantId, email: "a@example.com" })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("variant_not_sold_out")
  })

  it("rejects an unlimited variant the same way", async () => {
    const variantId = await seedVariant(null)
    const res = await request(app).post("/api/shop/stock-alerts").send({ variant_id: variantId, email: "a@example.com" })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("variant_not_sold_out")
  })

  it("404s for an unknown variant", async () => {
    const res = await request(app).post("/api/shop/stock-alerts").send({ variant_id: 999999, email: "a@example.com" })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("variant_not_found")
  })

  it("400s for a malformed email", async () => {
    const variantId = await seedVariant(0)
    const res = await request(app).post("/api/shop/stock-alerts").send({ variant_id: variantId, email: "nope" })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_email")
  })

  it("does not duplicate a row on a second signup", async () => {
    const variantId = await seedVariant(0)
    await request(app).post("/api/shop/stock-alerts").send({ variant_id: variantId, email: "a@example.com" })
    await request(app).post("/api/shop/stock-alerts").send({ variant_id: variantId, email: "a@example.com" })
    const [rows] = await db.query("SELECT id FROM stock_alerts WHERE product_variant_id = ?", [variantId])
    expect(rows).toHaveLength(1)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd backend && npx vitest run tests/shopStockAlertRoute.test.js`
Expected: FAIL - 404 (route doesn't exist)

- [ ] **Step 7: Add the route to `backend/routes/shop.js`**

Add the import near the top:

```js
const stockAlerts = require("../shop/stockAlerts/repo")
```

Add the route (anywhere among the other public routes, e.g. right after `/gift-settings`):

```js
  // "Notify me when back in stock" signup for one sold-out variant. Upsert
  // semantics: a repeat signup by the same email resets notified_at rather
  // than erroring or duplicating (see stockAlerts/repo.js::signUp).
  router.post("/stock-alerts", async (req, res) => {
    try {
      await stockAlerts.signUp(req.body || {})
      res.json({ ok: true })
    } catch (err) {
      if (err instanceof stockAlerts.InvalidEmailError) {
        return res.status(400).json({ error: "invalid_email", message: err.message })
      }
      if (err instanceof stockAlerts.VariantNotFoundError) {
        return res.status(404).json({ error: "variant_not_found", message: err.message })
      }
      if (err instanceof stockAlerts.VariantNotSoldOutError) {
        return res.status(400).json({ error: "variant_not_sold_out", message: err.message })
      }
      console.error("[SHOP] Lỗi đăng ký thông báo còn hàng:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })
```

- [ ] **Step 8: Run route tests to verify they pass**

Run: `cd backend && npx vitest run tests/shopStockAlertRoute.test.js`
Expected: PASS (6/6)

- [ ] **Step 9: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all pass (no shared table/state touched by other tests).

- [ ] **Step 10: Commit**

```bash
git add backend/shop/stockAlerts/repo.js backend/routes/shop.js backend/tests/stockAlertsRepo.test.js backend/tests/shopStockAlertRoute.test.js
git commit -m "feat(shop): add back-in-stock signup repo and public endpoint"
```

---

### Task 3: `stock_alert_queue` queue module + sender

**Files:**
- Create: `backend/shop/stockAlerts/queue.js`
- Create: `backend/shop/stockAlerts/sender.js`
- Modify: `backend/shop/email/sender.js` (export `getTransport`)
- Test: `backend/tests/stockAlertQueue.test.js`
- Test: `backend/tests/stockAlertSender.test.js`

**Interfaces:**
- Produces: `queue.enqueueMany(conn, rows)` (consumed by Task 4),
  `queue.claimPending(limit)`, `queue.markSent(id)`,
  `queue.markFailed(id, error)`, `queue.listFailed()`,
  `queue.MAX_ATTEMPTS`. `sender.sendQueuedStockAlerts(limit)` (consumed
  by Task 5's `worker.js` change).
- Consumes: `email/sender.js`'s `getTransport`/`isConfigured` (not
  duplicating SMTP config).

- [ ] **Step 1: Export `getTransport` from `email/sender.js`**

Change the final `module.exports` line in `backend/shop/email/sender.js`
from:

```js
module.exports = { sendQueued, isConfigured, listFailed }
```

to:

```js
module.exports = { sendQueued, isConfigured, listFailed, getTransport }
```

This is an additive export - no existing caller is affected.

- [ ] **Step 2: Write the failing queue tests**

```js
// backend/tests/stockAlertQueue.test.js
import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import queue from "../shop/stockAlerts/queue.js"
import { resetTables } from "./helpers/db.js"

beforeEach(async () => {
  await resetTables("stock_alert_queue")
})

function row(over = {}) {
  return {
    product_variant_id: 1, email: "a@example.com",
    product_name_snapshot: "Card", variant_label_snapshot: "A1",
    collection_slug_snapshot: "drop", ...over,
  }
}

describe("enqueueMany", () => {
  it("inserts one pending row per subscriber", async () => {
    await queue.enqueueMany(db, [row({ email: "a@example.com" }), row({ email: "b@example.com" })])
    const [rows] = await db.query("SELECT * FROM stock_alert_queue ORDER BY id")
    expect(rows).toHaveLength(2)
    expect(rows[0].status).toBe("pending")
    expect(rows[1].email).toBe("b@example.com")
  })

  it("does nothing for an empty list", async () => {
    await queue.enqueueMany(db, [])
    const [rows] = await db.query("SELECT * FROM stock_alert_queue")
    expect(rows).toHaveLength(0)
  })
})

describe("claimPending / markSent / markFailed", () => {
  it("returns pending rows and ignores sent ones", async () => {
    await queue.enqueueMany(db, [row()])
    const [[r]] = await db.query("SELECT id FROM stock_alert_queue LIMIT 1")
    expect(await queue.claimPending(10)).toHaveLength(1)
    await queue.markSent(r.id)
    expect(await queue.claimPending(10)).toHaveLength(0)
  })

  it("stops retrying after MAX_ATTEMPTS", async () => {
    await queue.enqueueMany(db, [row()])
    const [[r]] = await db.query("SELECT id FROM stock_alert_queue LIMIT 1")
    for (let i = 0; i < queue.MAX_ATTEMPTS; i += 1) await queue.markFailed(r.id, "smtp down")
    expect(await queue.claimPending(10)).toHaveLength(0)
    const [[after]] = await db.query("SELECT status, attempts FROM stock_alert_queue WHERE id = ?", [r.id])
    expect(after.status).toBe("failed")
    expect(after.attempts).toBe(queue.MAX_ATTEMPTS)
  })

  it("keeps retrying below the cap", async () => {
    await queue.enqueueMany(db, [row()])
    const [[r]] = await db.query("SELECT id FROM stock_alert_queue LIMIT 1")
    await queue.markFailed(r.id, "temporary")
    expect(await queue.claimPending(10)).toHaveLength(1)
  })
})

describe("listFailed", () => {
  it("returns only failed rows", async () => {
    await queue.enqueueMany(db, [row()])
    const [[r]] = await db.query("SELECT id FROM stock_alert_queue LIMIT 1")
    for (let i = 0; i < queue.MAX_ATTEMPTS; i += 1) await queue.markFailed(r.id, "boom")
    const failed = await queue.listFailed()
    expect(failed).toHaveLength(1)
    expect(failed[0].last_error).toBe("boom")
  })
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd backend && npx vitest run tests/stockAlertQueue.test.js`
Expected: FAIL - module not found

- [ ] **Step 4: Write `backend/shop/stockAlerts/queue.js`**

```js
const db = require("./../../db")

const MAX_ATTEMPTS = 5

/**
 * `conn` is accepted explicitly (rather than always using the pool) so this
 * can be called from inside catalogRepo.replaceVariants' own transaction -
 * pass the plain `db` module when calling outside a transaction (see the
 * tests here, and sender.js below).
 */
async function enqueueMany(conn, rows) {
  if (!rows.length) return
  const placeholders = rows.map(() => "(?, ?, ?, ?, ?)").join(", ")
  const values = rows.flatMap((r) => [
    r.product_variant_id, r.email, r.product_name_snapshot,
    r.variant_label_snapshot, r.collection_slug_snapshot,
  ])
  await conn.query(
    `INSERT INTO stock_alert_queue
       (product_variant_id, email, product_name_snapshot, variant_label_snapshot, collection_slug_snapshot)
     VALUES ${placeholders}`,
    values
  )
}

async function claimPending(limit = 10) {
  const [rows] = await db.query(
    `SELECT * FROM stock_alert_queue
      WHERE status = 'pending' AND attempts < ?
      ORDER BY id ASC LIMIT ?`,
    [MAX_ATTEMPTS, limit]
  )
  return rows
}

async function markSent(id) {
  await db.query(
    "UPDATE stock_alert_queue SET status = 'sent', sent_at = NOW() WHERE id = ?", [id]
  )
}

/** Same post-increment CASE evaluation order as email/queue.js::markFailed -
 *  see that file's comment for why `attempts` (not `attempts + 1`) is
 *  compared against MAX_ATTEMPTS here. */
async function markFailed(id, error) {
  await db.query(
    `UPDATE stock_alert_queue
        SET attempts = attempts + 1,
            last_error = ?,
            status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END
      WHERE id = ?`,
    [String(error).slice(0, 1000), MAX_ATTEMPTS, id]
  )
}

async function listFailed() {
  const [rows] = await db.query(
    "SELECT * FROM stock_alert_queue WHERE status = 'failed' ORDER BY id DESC LIMIT 50"
  )
  return rows
}

module.exports = { enqueueMany, claimPending, markSent, markFailed, listFailed, MAX_ATTEMPTS }
```

- [ ] **Step 5: Run queue tests to verify they pass**

Run: `cd backend && npx vitest run tests/stockAlertQueue.test.js`
Expected: PASS (6/6)

- [ ] **Step 6: Write the failing sender tests**

Mirrors `backend/tests/sender.test.js`'s nodemailer-mocking approach -
read that file's header comment before copying the pattern; the same
"mutate the real `nodemailer.createTransport` before import" trick
applies here since `stockAlerts/sender.js` reuses `email/sender.js`'s
memoized transport singleton.

```js
// backend/tests/stockAlertSender.test.js
import { describe, it, expect, beforeEach, vi } from "vitest"
import nodemailer from "nodemailer"
import db from "../db.js"
import stockAlertQueue from "../shop/stockAlerts/queue.js"
import stockAlertSender from "../shop/stockAlerts/sender.js"
import { resetTables } from "./helpers/db.js"

let sendMailMock
nodemailer.createTransport = () => ({
  sendMail: (...args) => sendMailMock(...args),
})

beforeEach(async () => {
  await resetTables("stock_alert_queue")
  process.env.SMTP_HOST = "smtp.example.com"
  process.env.SMTP_USER = "user@example.com"
  process.env.SMTP_PASS = "secret"
  sendMailMock = vi.fn().mockResolvedValue({})
})

function row(over = {}) {
  return {
    product_variant_id: 1, email: "a@example.com",
    product_name_snapshot: "Card", variant_label_snapshot: "A1",
    collection_slug_snapshot: "drop", ...over,
  }
}

describe("sendQueuedStockAlerts", () => {
  it("no-ops when SMTP is not configured", async () => {
    delete process.env.SMTP_HOST
    await stockAlertQueue.enqueueMany(db, [row()])
    const result = await stockAlertSender.sendQueuedStockAlerts()
    expect(result).toEqual({ sent: 0, failed: 0, skipped: true })
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it("sends a queued alert and marks it sent", async () => {
    await stockAlertQueue.enqueueMany(db, [row()])
    const result = await stockAlertSender.sendQueuedStockAlerts()
    expect(result).toEqual({ sent: 1, failed: 0, skipped: false })
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const call = sendMailMock.mock.calls[0][0]
    expect(call.to).toBe("a@example.com")
    expect(call.subject).toContain("Card")
    expect(call.html).toContain("A1")
    expect(call.html).toContain("/merchandise/drop")
    const [[after]] = await db.query("SELECT status FROM stock_alert_queue LIMIT 1")
    expect(after.status).toBe("sent")
  })

  it("isolates a failing row from the rest of the batch", async () => {
    await stockAlertQueue.enqueueMany(db, [row({ email: "bad@example.com" }), row({ email: "good@example.com" })])
    sendMailMock.mockRejectedValueOnce(new Error("bad address")).mockResolvedValue({})

    const result = await stockAlertSender.sendQueuedStockAlerts()

    expect(result).toEqual({ sent: 1, failed: 1, skipped: false })
  })

  it("stops retrying a row once it exhausts MAX_ATTEMPTS", async () => {
    await stockAlertQueue.enqueueMany(db, [row()])
    sendMailMock.mockRejectedValue(new Error("smtp down"))

    for (let i = 0; i < stockAlertQueue.MAX_ATTEMPTS; i += 1) {
      const result = await stockAlertSender.sendQueuedStockAlerts()
      expect(result).toEqual({ sent: 0, failed: 1, skipped: false })
    }

    const again = await stockAlertSender.sendQueuedStockAlerts()
    expect(again).toEqual({ sent: 0, failed: 0, skipped: false })
    expect(sendMailMock).toHaveBeenCalledTimes(stockAlertQueue.MAX_ATTEMPTS)
  })

  it("omits the link when collection_slug_snapshot is null (deleted collection)", async () => {
    await stockAlertQueue.enqueueMany(db, [row({ collection_slug_snapshot: null })])
    await stockAlertSender.sendQueuedStockAlerts()
    const call = sendMailMock.mock.calls[0][0]
    expect(call.html).not.toContain("undefined")
    expect(call.html).not.toContain("null")
  })
})
```

- [ ] **Step 7: Run to verify they fail**

Run: `cd backend && npx vitest run tests/stockAlertSender.test.js`
Expected: FAIL - module not found

- [ ] **Step 8: Write `backend/shop/stockAlerts/sender.js`**

```js
const emailSender = require("../email/sender")
const { escapeHtml } = require("../email/templates")
const queue = require("./queue")

const SHOP_NAME = process.env.SHOP_NAME || "Shop"
const SITE_URL = process.env.SITE_URL || ""

function buildMessage(row) {
  const subject = `${row.product_name_snapshot}${row.variant_label_snapshot ? ` - ${row.variant_label_snapshot}` : ""} đã có hàng trở lại`
  const link = row.collection_slug_snapshot ? `${SITE_URL}/merchandise/${row.collection_slug_snapshot}` : SITE_URL
  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto">
      <p>Xin chào,</p>
      <p>
        <strong>${escapeHtml(row.product_name_snapshot)}${row.variant_label_snapshot ? ` - ${escapeHtml(row.variant_label_snapshot)}` : ""}</strong>
        mà bạn đăng ký nhận thông báo đã có hàng trở lại tại ${escapeHtml(SHOP_NAME)}.
      </p>
      <p><a href="${escapeHtml(link)}">Xem sản phẩm</a></p>
      <p style="margin-top:16px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#999">
        Đây là email tự động, vui lòng không trả lời email này.
      </p>
    </div>`
  return { subject, html }
}

/** Mirrors email/sender.js::sendQueued's shape/isolation guarantees, for the
 *  independent stock_alert_queue pipeline. Reuses the shared transport
 *  singleton/config check rather than re-deriving SMTP env vars. */
async function sendQueuedStockAlerts(limit = 10) {
  if (!emailSender.isConfigured()) return { sent: 0, failed: 0, skipped: true }

  const pending = await queue.claimPending(limit)
  let sent = 0
  let failed = 0

  for (const row of pending) {
    try {
      const { subject, html } = buildMessage(row)
      await emailSender.getTransport().sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: row.email,
        subject,
        html,
      })
      await queue.markSent(row.id)
      sent += 1
      console.log(`[STOCK-ALERT] Đã gửi thông báo còn hàng cho ${row.email}`)
    } catch (err) {
      await queue.markFailed(row.id, err.message)
      failed += 1
      console.warn(`[STOCK-ALERT] Gửi thất bại cho ${row.email}: ${err.message}`)
    }
  }

  return { sent, failed, skipped: false }
}

module.exports = { sendQueuedStockAlerts }
```

- [ ] **Step 9: Run sender tests to verify they pass**

Run: `cd backend && npx vitest run tests/stockAlertSender.test.js`
Expected: PASS (5/5)

- [ ] **Step 10: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add backend/shop/email/sender.js backend/shop/stockAlerts/queue.js backend/shop/stockAlerts/sender.js backend/tests/stockAlertQueue.test.js backend/tests/stockAlertSender.test.js
git commit -m "feat(shop): add the stock-alert queue and its dedicated sender"
```

---

### Task 4: Restock-trigger hook in `replaceVariants`

**Files:**
- Modify: `backend/shop/catalogRepo.js` (`replaceVariants`, ~line 621)
- Test: add a new `describe("stock alert restock trigger", ...)` block to `backend/tests/catalogRepo.test.js`

**Interfaces:**
- Consumes: `stockAlerts/repo.js`'s `listUnnotified`/`markNotified`,
  `stockAlerts/queue.js`'s `enqueueMany` (both Task 2/3).
- Produces: no new exported function - `replaceVariants`'s existing
  signature and return value (`undefined`) are unchanged; the new
  behavior is an internal side effect.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/catalogRepo.test.js` (needs `stock_alerts` and
`stock_alert_queue` added to the file's `resetTables(...)` call in
`beforeEach`, and new imports):

```js
// add to the top-of-file imports:
import stockAlertsRepo from "../shop/stockAlerts/repo.js"

// add "stock_alerts", "stock_alert_queue" to the existing resetTables(...) call in beforeEach
```

```js
describe("stock alert restock trigger", () => {
  async function seedSoldOutVariant() {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 0 }])
    const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
    return { pid, variantId: v.id }
  }

  it("queues and marks-notified every subscriber on a 0 -> positive restock", async () => {
    const { pid, variantId } = await seedSoldOutVariant()
    await stockAlertsRepo.signUp({ variant_id: variantId, email: "a@example.com" })
    await stockAlertsRepo.signUp({ variant_id: variantId, email: "b@example.com" })

    await repo.replaceVariants(pid, [{ id: variantId, label: "A1", stock_qty: 5 }])

    const [queued] = await db.query("SELECT * FROM stock_alert_queue ORDER BY email")
    expect(queued).toHaveLength(2)
    expect(queued[0].email).toBe("a@example.com")
    expect(queued[0].product_name_snapshot).toBe("Card")
    expect(queued[0].variant_label_snapshot).toBe("A1")
    expect(queued[0].status).toBe("pending")

    const [alerts] = await db.query("SELECT notified_at FROM stock_alerts WHERE product_variant_id = ?", [variantId])
    expect(alerts.every((a) => a.notified_at !== null)).toBe(true)
  })

  it("does not fire for a positive -> different positive edit (5 -> 8)", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
    await stockAlertsRepo.signUp({ variant_id: v.id, email: "a@example.com" }).catch(() => {})
    // (signUp above throws VariantNotSoldOutError since stock is 5 - that's
    // expected and fine; the point of this test is stock_alert_queue stays
    // empty regardless.)

    await repo.replaceVariants(pid, [{ id: v.id, label: "A1", stock_qty: 8 }])

    const [queued] = await db.query("SELECT * FROM stock_alert_queue")
    expect(queued).toHaveLength(0)
  })

  it("queues nothing and does not error when a restocked variant has zero subscribers", async () => {
    const { pid, variantId } = await seedSoldOutVariant()
    await expect(repo.replaceVariants(pid, [{ id: variantId, label: "A1", stock_qty: 5 }])).resolves.not.toThrow()
    const [queued] = await db.query("SELECT * FROM stock_alert_queue")
    expect(queued).toHaveLength(0)
  })

  it("does not fire when a sold-out variant goes to unlimited (0 -> null)", async () => {
    const { pid, variantId } = await seedSoldOutVariant()
    await stockAlertsRepo.signUp({ variant_id: variantId, email: "a@example.com" })

    await repo.replaceVariants(pid, [{ id: variantId, label: "A1", stock_qty: null }])

    const [queued] = await db.query("SELECT * FROM stock_alert_queue")
    expect(queued).toHaveLength(0)
  })

  it("does not crash when a variant is deleted instead of updated", async () => {
    const { pid, variantId } = await seedSoldOutVariant()
    await stockAlertsRepo.signUp({ variant_id: variantId, email: "a@example.com" })

    // Replacing with a brand new variant (no id) drops the old one entirely.
    await expect(repo.replaceVariants(pid, [{ label: "B1", stock_qty: 5 }])).resolves.not.toThrow()
    const [queued] = await db.query("SELECT * FROM stock_alert_queue")
    expect(queued).toHaveLength(0)
  })

  it("only queues once across repeated saves while stock stays positive", async () => {
    const { pid, variantId } = await seedSoldOutVariant()
    await stockAlertsRepo.signUp({ variant_id: variantId, email: "a@example.com" })

    await repo.replaceVariants(pid, [{ id: variantId, label: "A1", stock_qty: 5 }])
    await repo.replaceVariants(pid, [{ id: variantId, label: "A1", stock_qty: 6 }])
    await repo.replaceVariants(pid, [{ id: variantId, label: "A1", stock_qty: 7 }])

    const [queued] = await db.query("SELECT * FROM stock_alert_queue")
    expect(queued).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd backend && npx vitest run tests/catalogRepo.test.js -t "stock alert restock trigger"`
Expected: FAIL - `stock_alert_queue` stays empty on every case (no wiring yet).

- [ ] **Step 3: Modify `replaceVariants` in `backend/shop/catalogRepo.js`**

Add the import near the top of the file:

```js
const stockAlertsRepo = require("./stockAlerts/repo")
const stockAlertQueue = require("./stockAlerts/queue")
```

Change the initial lock query (currently `SELECT id FROM product_variants
... FOR UPDATE`) to also fetch `stock_qty`:

```js
    const [current] = await conn.query(
      "SELECT id, stock_qty FROM product_variants WHERE product_id = ? ORDER BY id ASC FOR UPDATE",
      [productId]
    )
    const prevStockById = new Map(current.map((r) => [r.id, r.stock_qty]))
    const keeping = new Set(keepIds)
```

(The existing `const keeping = new Set(keepIds)` line already there - just
insert `prevStockById` immediately before it, no other lines in this
section change.)

In the `for (const [index, v] of list.entries())` loop, track which
variants just restocked. Insert right after the existing `const stock = ...`
line and before the `if (v.id) { ... } else { ... }` branch:

```js
      // A restock event is exactly previousStock === 0 (a variant this
      // system considered sold out) crossing up to a real positive number.
      // 0 -> null (unlimited) is deliberately NOT a restock event in this
      // model - only a variant with a real previous row and a real new
      // ceiling counts, per the design doc.
      const previousStock = v.id ? prevStockById.get(v.id) : undefined
      if (previousStock === 0 && stock !== null && stock > 0) {
        restockedVariants.push({ id: v.id, label: v.label })
      }
```

Add `const restockedVariants = []` immediately before the `for (const
[index, v] of list.entries())` loop starts.

After the loop, before `await conn.commit()`, add the notification step:

```js
    if (restockedVariants.length) {
      const [[productRow]] = await conn.query(
        `SELECT p.name AS product_name, c.slug AS collection_slug
           FROM products p JOIN collections c ON c.id = p.collection_id
          WHERE p.id = ?`,
        [productId]
      )
      for (const { id: variantId, label } of restockedVariants) {
        const subscribers = await stockAlertsRepo.listUnnotified(conn, variantId)
        if (!subscribers.length) continue
        await stockAlertQueue.enqueueMany(conn, subscribers.map((s) => ({
          product_variant_id: variantId,
          email: s.email,
          product_name_snapshot: productRow?.product_name || "",
          variant_label_snapshot: label || "",
          collection_slug_snapshot: productRow?.collection_slug || null,
        })))
        await stockAlertsRepo.markNotified(conn, subscribers.map((s) => s.id))
      }
    }
```

This runs inside the same `try { ... } await conn.commit()` block
`replaceVariants` already has, so a failure anywhere in it rolls back
together with the stock update itself (via the existing `catch { await
conn.rollback(); throw err }`).

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cd backend && npx vitest run tests/catalogRepo.test.js -t "stock alert restock trigger"`
Expected: PASS (6/6)

- [ ] **Step 5: Run the FULL `catalogRepo.test.js` file to confirm no regression**

Run: `cd backend && npx vitest run tests/catalogRepo.test.js`
Expected: PASS - every pre-existing `replaceVariants` test (thumbnail,
description, live-order guard, cross-product isolation) still passes,
since `stock_alerts` is empty for all of them and `restockedVariants`
stays empty, making this a no-op for every test that predates this
feature.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/shop/catalogRepo.js backend/tests/catalogRepo.test.js
git commit -m "feat(shop): queue back-in-stock alerts on a 0 -> positive stock edit"
```

---

### Task 5: Worker dispatch + admin failed-queue visibility

**Files:**
- Modify: `backend/worker.js`
- Modify: `backend/routes/adminEmail.js`
- Modify: `frontend/src/api/shop.js`
- Modify: `frontend/src/components/AdminEmailTemplates.jsx`
- Test: `backend/tests/expirySweep.test.js` or a small new
  `backend/tests/workerStockAlerts.test.js` (whichever fits - see Step 1)

**Interfaces:**
- Consumes: `stockAlerts/sender.js::sendQueuedStockAlerts` (Task 3),
  `stockAlerts/queue.js::listFailed` (Task 3).
- Produces: `worker.js` exports `dispatchStockAlertEmails` (alongside its
  existing `dispatchEmails`), called from `run()`. `GET
  /api/admin/stock-alert-queue/failed`. Frontend
  `adminListFailedStockAlerts()`.

- [ ] **Step 1: Write the failing worker test**

```js
// backend/tests/workerStockAlerts.test.js
import { describe, it, expect, vi, beforeEach } from "vitest"
import db from "../db.js"
import worker from "../worker.js"
import { resetTables } from "./helpers/db.js"

beforeEach(async () => {
  await resetTables("stock_alert_queue")
})

describe("dispatchStockAlertEmails", () => {
  it("is exported and does not throw when the queue is empty", async () => {
    await expect(worker.dispatchStockAlertEmails()).resolves.not.toThrow()
  })

  it("delegates to stockAlerts/sender and returns the sent count", async () => {
    const stockAlertSender = await import("../shop/stockAlerts/sender.js")
    const spy = vi.spyOn(stockAlertSender.default, "sendQueuedStockAlerts")
      .mockResolvedValue({ sent: 2, failed: 0, skipped: false })

    const sent = await worker.dispatchStockAlertEmails()

    expect(spy).toHaveBeenCalled()
    expect(sent).toBe(2)
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run tests/workerStockAlerts.test.js`
Expected: FAIL - `worker.dispatchStockAlertEmails is not a function`

- [ ] **Step 3: Modify `backend/worker.js`**

Add the import near the top, next to the existing `emailSender` import:

```js
const emailSender = require("./shop/email/sender")
const stockAlertSender = require("./shop/stockAlerts/sender")
```

Add a new function right after the existing `dispatchEmails`:

```js
async function dispatchStockAlertEmails() {
  try {
    const { sent, failed } = await stockAlertSender.sendQueuedStockAlerts(10)
    if (sent || failed) {
      console.log(`[WORKER] Thông báo còn hàng: gửi ${sent}, lỗi ${failed}`)
    }
    return sent
  } catch (err) {
    console.error("[WORKER] Lỗi gửi thông báo còn hàng:", err.message)
    return 0
  }
}
```

In `run()`, change:

```js
    await sweepExpiredOrders()
    await dispatchEmails()
```

to:

```js
    await sweepExpiredOrders()
    await dispatchEmails()
    await dispatchStockAlertEmails()
```

(Same `running` guard already wraps this whole `try` block - no new
guard needed.)

Update the final `module.exports` line to include the new function:

```js
module.exports = { run, sweepExpiredOrders, dispatchEmails, dispatchStockAlertEmails, warnIfMailStuckUnconfigured, tick, lease }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run tests/workerStockAlerts.test.js`
Expected: PASS (2/2)

- [ ] **Step 5: Add the admin failed-queue route**

In `backend/routes/adminEmail.js`, add the import:

```js
const stockAlertQueue = require("../shop/stockAlerts/queue")
```

Add the route, right after the existing `/email-queue/failed` route:

```js
  // Same minimal surfacing as /email-queue/failed above, for the
  // independent stock-alert queue - a row that exhausted its retries
  // otherwise sits invisibly in stock_alert_queue.
  router.get("/stock-alert-queue/failed", async (req, res) => {
    try {
      const rows = await stockAlertQueue.listFailed()
      res.json(rows)
    } catch (err) {
      console.error("[ADMIN/EMAIL] Lỗi đọc thông báo còn hàng lỗi:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })
```

- [ ] **Step 6: Add the failing admin route test**

Add to `backend/tests/adminEmailRoutes.test.js` (or a new
`adminStockAlertRoutes.test.js` if that file doesn't already exist -
check first):

```js
describe("GET /api/admin/stock-alert-queue/failed", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/admin/stock-alert-queue/failed")
    expect(res.status).toBe(401)
  })

  it("returns failed rows", async () => {
    // seed via the real pipeline: enqueue then exhaust retries
    const stockAlertQueue = (await import("../shop/stockAlerts/queue.js")).default
    await stockAlertQueue.enqueueMany(db, [{
      product_variant_id: 1, email: "a@example.com",
      product_name_snapshot: "Card", variant_label_snapshot: "A1", collection_slug_snapshot: "drop",
    }])
    const [[row]] = await db.query("SELECT id FROM stock_alert_queue LIMIT 1")
    for (let i = 0; i < stockAlertQueue.MAX_ATTEMPTS; i += 1) await stockAlertQueue.markFailed(row.id, "boom")

    const res = await authed(request(app).get("/api/admin/stock-alert-queue/failed"))
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })
})
```

(Match whatever `db`/`authed`/`app` setup that test file already has at
the top - reuse it, don't redeclare.)

- [ ] **Step 7: Run to verify it passes**

Run: `cd backend && npx vitest run tests/adminEmailRoutes.test.js`
Expected: PASS (existing tests + the 2 new ones)

- [ ] **Step 8: Frontend - API wrapper**

In `frontend/src/api/shop.js`, add, near `adminListFailedEmails`:

```js
export const subscribeStockAlert = (data) =>
  api.post("/api/shop/stock-alerts", data).then((r) => r.data)

export const adminListFailedStockAlerts = () =>
  api.get("/api/admin/stock-alert-queue/failed").then((r) => r.data)
```

- [ ] **Step 9: Frontend - minimal admin surfacing**

In `frontend/src/components/AdminEmailTemplates.jsx`, add the import:

```js
import { adminListEmailTemplates, adminSaveEmailTemplate, adminListFailedEmails, adminListFailedStockAlerts } from "../api/shop"
```

Add a second component, modeled directly on the existing `FailedEmails`:

```jsx
function FailedStockAlerts() {
  const [failed, setFailed] = useState(null)

  useEffect(() => {
    adminListFailedStockAlerts().then(setFailed).catch(() => setFailed([]))
  }, [])

  if (!failed || failed.length === 0) return null

  return (
    <div className="mb-6 p-3 rounded-xl border border-red-400">
      <h4 className="font-semibold mb-2 text-red-600">
        Thông báo còn hàng gửi thất bại ({failed.length})
      </h4>
      <ul className="text-sm space-y-1">
        {failed.map((row) => (
          <li key={row.id} className="opacity-80">
            {row.product_name_snapshot} · {row.variant_label_snapshot} · {row.email}
            {row.last_error && <span className="opacity-60"> - {row.last_error}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

Render it right below `<FailedEmails />` in the default export:

```jsx
      <FailedEmails />
      <FailedStockAlerts />
```

- [ ] **Step 10: Run the full backend and frontend suites**

Run: `cd backend && npm test` and `cd frontend && npm test`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add backend/worker.js backend/routes/adminEmail.js backend/tests/workerStockAlerts.test.js backend/tests/adminEmailRoutes.test.js frontend/src/api/shop.js frontend/src/components/AdminEmailTemplates.jsx
git commit -m "feat(shop): dispatch queued stock alerts from the worker, surface failures in admin"
```

---

### Task 6: Buyer-facing signup form on the sold-out variant

**Files:**
- Modify: `frontend/src/components/shop/ProductCard.jsx`
- Modify: `frontend/src/components/shop/ProductCard.test.jsx`
- Modify: `frontend/src/i18n/translations.js`

**Interfaces:**
- Consumes: `subscribeStockAlert` (Task 5).
- Produces: nothing consumed by a later task - this is the last piece.

- [ ] **Step 1: Add i18n keys**

In `frontend/src/i18n/translations.js`, `en` block, near `shopSoldOut`:

```js
shopNotifyMeLabel: "Notify me when back in stock",
shopNotifyMeEmailPlaceholder: "Your email",
shopNotifyMeSubmit: "Notify me",
shopNotifyMeSuccess: "You're signed up - we'll email you when it's back.",
shopNotifyMeInvalidEmail: "Enter a valid email.",
shopNotifyMeError: "Something went wrong. Try again.",
```

`vi` block, near its own `shopSoldOut`:

```js
shopNotifyMeLabel: "Báo khi có hàng trở lại",
shopNotifyMeEmailPlaceholder: "Email của bạn",
shopNotifyMeSubmit: "Đăng ký",
shopNotifyMeSuccess: "Đã đăng ký - mình sẽ báo qua email khi có hàng.",
shopNotifyMeInvalidEmail: "Email không hợp lệ.",
shopNotifyMeError: "Có lỗi xảy ra, thử lại sau.",
```

- [ ] **Step 2: Write the failing component tests**

Add to `frontend/src/components/shop/ProductCard.test.jsx`. This file
currently has no `../../api/shop` mock at all - add one at the top,
alongside the existing imports:

```js
// at the top of the file, alongside the existing imports:
const subscribeStockAlert = vi.fn()
vi.mock("../../api/shop", () => ({
  subscribeStockAlert: (...args) => subscribeStockAlert(...args),
}))
```

```jsx
describe("ProductCard - back-in-stock signup", () => {
  beforeEach(() => { subscribeStockAlert.mockReset() })

  it("shows the notify-me form for a strictly sold-out (finite, zero) variant", async () => {
    const { container } = await renderCard()
    await openVariantDetail(container, "B2") // baseProduct's B2 has stock_qty: 0
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.querySelector('input[type="email"]')).toBeTruthy()
  })

  it("does not show the form for an unlimited (stock_qty null) variant", async () => {
    const product = baseProduct({ variants: [{ id: 1, label: "A1", stock_qty: null, image_url: null }] })
    const { container } = await renderCard({ product })
    await openVariantDetail(container, "A1")
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.querySelector('input[type="email"]')).toBeNull()
  })

  it("does not show the form for an in-stock variant", async () => {
    const { container } = await renderCard()
    await openVariantDetail(container, "A1") // stock_qty: 5
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.querySelector('input[type="email"]')).toBeNull()
  })

  it("submits variant_id and email, and shows a success message", async () => {
    subscribeStockAlert.mockResolvedValue({ ok: true })
    const { container } = await renderCard()
    await openVariantDetail(container, "B2")
    const dialog = container.querySelector('[role="dialog"]')

    const emailInput = dialog.querySelector('input[type="email"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    await act(async () => {
      setter.call(emailInput, "a@example.com")
      emailInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const submitBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Notify me")
    await act(async () => { submitBtn.click() })
    await act(async () => {})

    expect(subscribeStockAlert).toHaveBeenCalledWith({ variant_id: 2, email: "a@example.com" })
    expect(dialog.textContent).toContain("You're signed up")
  })

  it("shows the server's error message on failure", async () => {
    subscribeStockAlert.mockRejectedValue({ response: { data: { message: "Email không hợp lệ" } } })
    const { container } = await renderCard()
    await openVariantDetail(container, "B2")
    const dialog = container.querySelector('[role="dialog"]')

    const submitBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Notify me")
    await act(async () => { submitBtn.click() })
    await act(async () => {})

    expect(dialog.textContent).toContain("Email không hợp lệ")
  })
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/shop/ProductCard.test.jsx -t "back-in-stock signup"`
Expected: FAIL - no email input rendered yet.

- [ ] **Step 4: Modify `ProductCard.jsx`**

Add the import at the top:

```js
import { subscribeStockAlert } from "../../api/shop"
```

Add state, alongside the existing `addError`/`shareCopied` state:

```js
  const [alertEmail, setAlertEmail] = useState("")
  const [alertStatus, setAlertStatus] = useState("idle") // idle | submitting | done | error
  const [alertMessage, setAlertMessage] = useState("")
```

Reset it in `openDetail`, alongside the other resets already there:

```js
  const openDetail = (v) => {
    setQty(1)
    setActiveImage(0)
    setAddError("")
    setShareCopied(false)
    setAlertEmail("")
    setAlertStatus("idle")
    setAlertMessage("")
    setView(v)
  }
```

Add the submit handler, near `commitAdd`:

```js
  const submitStockAlert = async () => {
    setAlertStatus("submitting")
    setAlertMessage("")
    try {
      await subscribeStockAlert({ variant_id: detail.id, email: alertEmail })
      setAlertStatus("done")
      setAlertMessage(t("shopNotifyMeSuccess"))
    } catch (e) {
      setAlertStatus("error")
      setAlertMessage(e.response?.data?.message || t("shopNotifyMeError"))
    }
  }
```

In the detail modal's JSX, right where the qty stepper is currently
gated by `{!detailSoldOut && orderable && ( ... )}`, add a sibling block
gated the opposite way - strictly on `isSoldOut(detail)` (not
`detailSoldOut`, which also covers a gacha's empty prize pool - per the
design doc, this signup only ever applies to a real, finite,
zero-stock_qty variant):

```jsx
              {isSoldOut(detail) && (
                <div className="mt-2 p-3 rounded-xl border border-[var(--border-brand)]">
                  <p className="text-sm font-medium mb-2">{t("shopNotifyMeLabel")}</p>
                  {alertStatus === "done" ? (
                    <p className="text-sm text-[var(--brand)]">{alertMessage}</p>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={alertEmail}
                        onChange={(e) => setAlertEmail(e.target.value)}
                        placeholder={t("shopNotifyMeEmailPlaceholder")}
                        className="flex-1 px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent text-sm"
                      />
                      <button
                        type="button"
                        disabled={alertStatus === "submitting" || !alertEmail}
                        onClick={submitStockAlert}
                        className="px-3 py-2 rounded-lg bg-[var(--brand)] text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {t("shopNotifyMeSubmit")}
                      </button>
                    </div>
                  )}
                  {alertStatus === "error" && <p role="alert" className="text-sm text-[var(--text-error)] mt-1">{alertMessage}</p>}
                </div>
              )}
```

Place this block right after the stock-label paragraph (`<p
className="text-sm opacity-70">{orderable ? ...}</p>`) and before the
`{isGacha && (...)}` link, so it reads naturally under the "Sold out"
stock label.

- [ ] **Step 5: Run to verify they pass**

Run: `cd frontend && npx vitest run src/components/shop/ProductCard.test.jsx`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/shop/ProductCard.jsx frontend/src/components/shop/ProductCard.test.jsx frontend/src/i18n/translations.js
git commit -m "feat(shop): add a back-in-stock notify-me form to the sold-out variant detail"
```

---

### Task 7: Docs housekeeping

**Files:**
- Modify: `docs/AUTOMATED_FEATURES_LOG.md`

- [ ] **Step 1: Append the log entry (only after the PR URL is known - see the top-level task instructions for this run)**

```md
## 2026-09-26 - Back-in-stock email alerts (`back-in-stock-alerts`)

- Branch: `feature/auto-back-in-stock-alerts`
- PR: <fill in after opening>
- Trend angle: `Shopping/e-commerce`
- Description: Buyers can leave an email on a sold-out product variant
  and get notified once an admin's stock edit brings it back from 0 to
  a positive number - queued and sent by the background worker,
  structurally independent of the order-email pipeline.
```

- [ ] **Step 2: Commit**

```bash
git add docs/AUTOMATED_FEATURES_LOG.md
git commit -m "docs: log the back-in-stock-alerts automated feature run"
```
