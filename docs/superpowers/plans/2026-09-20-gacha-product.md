# Gacha Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "gacha" product type: sellers configure a weighted prize pool; buyers spend turns to draw either online (checkout → draw on their own order page → prizes ship) or at a festival booth (staff enters a paid turn count on a kiosk tablet → buyer draws in person → prizes handed over immediately). A public, unauthenticated practice mode lets anyone try the mechanic for free with real odds and zero stakes.

**Architecture:** A new `type: 'gacha'` on `products` reuses the existing single-hidden-variant trick from digital products so gacha turns flow through the *unmodified* cart/checkout/payment/order pipeline. Three new tables (`gacha_prizes`, `gacha_sessions`, `gacha_draws`) hold the prize pool and draw history. All real draws happen inside one server-side transactional function (`sessionRepo.drawForSession`) that both picks the winner (crypto RNG, live quantity-weighted odds) and writes the resulting `order_items` row — the client never influences or reports a draw result. A single `GachaMachine` React component is reused for the buyer's own order page, the booth kiosk, and the public practice page.

**Tech Stack:** Node.js/Express, MySQL via `mysql2` (no ORM), Knex migrations, Redis (rate limiting), React/Vite frontend, Vitest for both frontend and backend tests.

## Global Constraints

- Follow existing snapshot philosophy: anything a placed order needs to stay historically accurate is captured once, never re-derived live (see `docs/superpowers/specs/2026-09-20-gacha-product-design.md`, Data model section).
- All draws are server-authoritative — the client never sends or is trusted for a draw result (spec's Anti-cheat section).
- Odds are live and quantity-weighted; tier is display-only.
- Every real session (online or booth-cash) creates a genuine `orders` row.
- The booth kiosk reuses the full admin JWT (no scoped-down token) — accepted risk per the spec.
- Structured logs in this repo use snake_case field names (`correlation_id`, `order_id`, etc.) when logging is added.
- No inline comments on self-documenting code; comments only for non-obvious WHY, matching the codebase's existing comment style (see `shop/orders/domain.js`/`orderRepo.js` for the target voice).
- Backend tests run via `npm test` (vitest run) against `DB_NAME=cosplay_test`; every new test file must call `resetTables(...)` in `beforeEach` for every table it touches, per `tests/helpers/db.js`.

---

## File Structure

New backend files:
- `backend/migrations/040_add_product_type_gacha.js` … `046_add_order_item_gacha_snapshot.js` — schema.
- `backend/shop/gacha/domain.js` — pure odds/weighted-pick math.
- `backend/shop/gacha/prizeRepo.js` — prize CRUD.
- `backend/shop/gacha/sessionRepo.js` — session lifecycle + the transactional draw.
- `backend/routes/adminGacha.js` — admin prize editor + booth kiosk routes.

Modified backend files:
- `backend/shop/orders/domain.js` — `canTransition` treats `booth` like `pickup`/`digital`.
- `backend/shop/orders/orderRepo.js` — `createOrder` gacha guards; `transitionOrder` triggers online session creation.
- `backend/shop/catalogRepo.js` — gacha hidden-variant creation; delete guard.
- `backend/routes/adminCatalog.js` — `validateProduct` accepts `gacha`.
- `backend/routes/orders.js` — buyer-facing session status + draw endpoints.
- `backend/routes/shop.js` — public practice endpoints.
- `backend/server.js` — mount `adminGacha`, new rate limiters.

New frontend files:
- `frontend/src/shop/gacha/api.js` — all gacha HTTP calls.
- `frontend/src/shop/gacha/GachaMachine.jsx` — shared reel/reveal component.
- `frontend/src/components/AdminGachaPrizeEditor.jsx` — admin prize table.
- `frontend/src/pages/GachaKiosk.jsx` — booth Staff Panel + machine.
- `frontend/src/pages/GachaPractice.jsx` — public practice page.

Modified frontend files:
- `frontend/src/pages/Order.jsx` — renders the gacha section when a session exists.
- `frontend/src/App.jsx` — new routes.

---

### Task 1: Database migrations

**Files:**
- Create: `backend/migrations/040_add_product_type_gacha.js`
- Create: `backend/migrations/041_create_gacha_prizes.js`
- Create: `backend/migrations/042_create_gacha_sessions.js`
- Create: `backend/migrations/043_create_gacha_draws.js`
- Create: `backend/migrations/044_add_order_fulfillment_booth.js`
- Create: `backend/migrations/045_add_order_payment_method_cash.js`
- Create: `backend/migrations/046_add_order_item_gacha_snapshot.js`

**Interfaces:**
- Produces: tables/columns every later backend task queries directly by name (see column lists below — later tasks assume these exact names).

- [ ] **Step 1: Write `040_add_product_type_gacha.js`**

```js
// backend/migrations/040_add_product_type_gacha.js
exports.up = function (knex) {
  return knex.raw("ALTER TABLE products MODIFY COLUMN type ENUM('physical', 'digital', 'gacha') NOT NULL DEFAULT 'physical'")
}

exports.down = function (knex) {
  return knex.raw("ALTER TABLE products MODIFY COLUMN type ENUM('physical', 'digital') NOT NULL DEFAULT 'physical'")
}
```

- [ ] **Step 2: Write `041_create_gacha_prizes.js`**

```js
// backend/migrations/041_create_gacha_prizes.js
exports.up = function (knex) {
  return knex.schema.createTable("gacha_prizes", (table) => {
    table.increments("id").primary()
    table.integer("product_id").unsigned().notNullable()
      .references("id").inTable("products").onDelete("CASCADE")

    table.string("name", 191).notNullable()
    table.text("description").nullable()
    table.string("image_url", 512).nullable()
    // Display-only grouping (badge color + summed odds) - never an
    // independent weight. Odds are always quantity_remaining-driven.
    table.enu("tier", ["common", "rare", "epic", "legendary", "ancient"]).notNullable().defaultTo("common")
    // VND. Shown as the prize's "value" card - informational only, a prize
    // is never sold individually.
    table.integer("display_price").unsigned().notNullable().defaultTo(0)

    table.integer("quantity_total").unsigned().notNullable()
    // Decremented atomically on each real draw; never touched by practice
    // draws. quantity_total - quantity_remaining = lifetime drawn count,
    // which prizeRepo.replacePrizes treats as immutable history.
    table.integer("quantity_remaining").unsigned().notNullable()

    table.integer("sort_order").notNullable().defaultTo(0)

    table.index(["product_id", "sort_order"], "idx_gacha_prizes_product_sort")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("gacha_prizes")
}
```

- [ ] **Step 3: Write `042_create_gacha_sessions.js`**

```js
// backend/migrations/042_create_gacha_sessions.js
exports.up = function (knex) {
  return knex.schema.createTable("gacha_sessions", (table) => {
    table.increments("id").primary()
    table.integer("product_id").unsigned().notNullable()
      .references("id").inTable("products").onDelete("CASCADE")
    // Nullable only in the sense that practice sessions never get a row at
    // all - every persisted session row (online or booth_cash) always has
    // one. One order can have at most one gacha session.
    table.integer("order_id").unsigned().nullable().unique()
      .references("id").inTable("orders").onDelete("CASCADE")

    table.string("buyer_name", 191).nullable()
    table.integer("turns_total").unsigned().notNullable()
    table.integer("turns_used").unsigned().notNullable().defaultTo(0)
    table.enu("status", ["active", "completed"]).notNullable().defaultTo("active")
    table.enu("source", ["online", "booth_cash", "practice"]).notNullable()

    // Idempotency for the draw endpoint: a retried/double-tapped draw
    // request carrying the same draw_key returns the already-recorded
    // result instead of drawing again. NULL until the first draw.
    table.string("last_draw_key", 64).nullable()
    table.integer("last_draw_id").unsigned().nullable()

    table.timestamp("created_at").defaultTo(knex.fn.now())
    table.timestamp("completed_at").nullable()

    table.index(["product_id", "status"], "idx_gacha_sessions_product_status")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("gacha_sessions")
}
```

- [ ] **Step 4: Write `043_create_gacha_draws.js`**

```js
// backend/migrations/043_create_gacha_draws.js
exports.up = function (knex) {
  return knex.schema.createTable("gacha_draws", (table) => {
    table.increments("id").primary()
    table.integer("session_id").unsigned().notNullable()
      .references("id").inTable("gacha_sessions").onDelete("CASCADE")
    table.integer("gacha_prize_id").unsigned().notNullable()
      .references("id").inTable("gacha_prizes").onDelete("RESTRICT")
    table.timestamp("drawn_at").defaultTo(knex.fn.now())

    table.index(["session_id"], "idx_gacha_draws_session")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("gacha_draws")
}
```

- [ ] **Step 5: Write `044_add_order_fulfillment_booth.js`**

```js
// backend/migrations/044_add_order_fulfillment_booth.js
// 'booth' is a booth-cash gacha order: handed over on the spot, no address,
// no shipping step - distinct from 'pickup', which drags in
// pickup-location/QR copy that doesn't apply to an on-the-spot handover.
exports.up = function (knex) {
  return knex.raw("ALTER TABLE orders MODIFY COLUMN fulfillment_method ENUM('ship', 'pickup', 'digital', 'booth') NOT NULL")
}

exports.down = function (knex) {
  return knex.raw("ALTER TABLE orders MODIFY COLUMN fulfillment_method ENUM('ship', 'pickup', 'digital') NOT NULL")
}
```

- [ ] **Step 6: Write `045_add_order_payment_method_cash.js`**

```js
// backend/migrations/045_add_order_payment_method_cash.js
// 'cash' is a booth-cash gacha sale: staff already collected payment in
// person before creating the order, so it starts life already confirmed.
exports.up = function (knex) {
  return knex.raw("ALTER TABLE orders MODIFY COLUMN payment_method ENUM('bank', 'momo', 'paypal', 'cod', 'cash') NOT NULL")
}

exports.down = function (knex) {
  return knex.raw("ALTER TABLE orders MODIFY COLUMN payment_method ENUM('bank', 'momo', 'paypal', 'cod') NOT NULL")
}
```

- [ ] **Step 7: Write `046_add_order_item_gacha_snapshot.js`**

```js
// backend/migrations/046_add_order_item_gacha_snapshot.js
exports.up = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    // Traceability back to the exact draw that produced this line - lets
    // admin views join back to gacha_draws/gacha_prizes when needed,
    // without every read path needing to know that join exists.
    table.integer("gacha_draw_id").unsigned().nullable()
      .references("id").inTable("gacha_draws").onDelete("SET NULL")
    // Snapshotted like every other *_snapshot column on this table, so a
    // later prize-pool edit never changes how an already-drawn item's tier
    // badge renders.
    table.string("gacha_tier_snapshot", 32).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    table.dropColumn("gacha_draw_id")
    table.dropColumn("gacha_tier_snapshot")
  })
}
```

- [ ] **Step 8: Run migrations up and down to verify**

Run: `cd backend && npm run migrate`
Expected: all 7 migrations apply with no error.

Run: `npx knex migrate:rollback --all && npm run migrate`
Expected: full down/up round-trip succeeds (proves every `down` is correct), ending back on the latest migration.

- [ ] **Step 9: Commit**

```bash
cd backend
git add migrations/040_add_product_type_gacha.js migrations/041_create_gacha_prizes.js \
  migrations/042_create_gacha_sessions.js migrations/043_create_gacha_draws.js \
  migrations/044_add_order_fulfillment_booth.js migrations/045_add_order_payment_method_cash.js \
  migrations/046_add_order_item_gacha_snapshot.js
git commit -m "feat(gacha): add schema for gacha products, prizes, sessions and draws"
```

---

### Task 2: Gacha odds domain logic

**Files:**
- Create: `backend/shop/gacha/domain.js`
- Test: `backend/tests/gachaDomain.test.js`

**Interfaces:**
- Consumes: nothing (pure functions, no DB).
- Produces: `weightedPick(prizes)` and `tierOdds(prizes)`, both consumed by `sessionRepo.js` (Task 4).
  - `weightedPick(prizes: Array<{id, quantity_remaining}>) => prize` (one element of the input array, or throws)
  - `tierOdds(prizes: Array<{tier, quantity_remaining}>) => Array<{tier, weight, rate}>`

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/gachaDomain.test.js
import { describe, it, expect } from "vitest"
import { weightedPick, tierOdds } from "../shop/gacha/domain.js"

describe("weightedPick", () => {
  it("always returns the only prize with remaining stock", () => {
    const prizes = [
      { id: 1, quantity_remaining: 0 },
      { id: 2, quantity_remaining: 5 },
      { id: 3, quantity_remaining: 0 },
    ]
    for (let i = 0; i < 50; i++) {
      expect(weightedPick(prizes).id).toBe(2)
    }
  })

  it("throws when the whole pool is empty", () => {
    const prizes = [{ id: 1, quantity_remaining: 0 }, { id: 2, quantity_remaining: 0 }]
    expect(() => weightedPick(prizes)).toThrow()
  })

  it("distributes roughly proportional to remaining quantity over many draws", () => {
    const prizes = [{ id: 1, quantity_remaining: 90 }, { id: 2, quantity_remaining: 10 }]
    const counts = { 1: 0, 2: 0 }
    for (let i = 0; i < 5000; i++) counts[weightedPick(prizes).id]++
    const rate1 = counts[1] / 5000
    expect(rate1).toBeGreaterThan(0.8)
    expect(rate1).toBeLessThan(0.98)
  })
})

describe("tierOdds", () => {
  it("sums remaining quantity per tier and computes a live rate", () => {
    const prizes = [
      { tier: "common", quantity_remaining: 80 },
      { tier: "common", quantity_remaining: 10 },
      { tier: "legendary", quantity_remaining: 10 },
    ]
    const odds = tierOdds(prizes)
    const common = odds.find((o) => o.tier === "common")
    const legendary = odds.find((o) => o.tier === "legendary")
    expect(common.weight).toBe(90)
    expect(common.rate).toBeCloseTo(0.9, 5)
    expect(legendary.rate).toBeCloseTo(0.1, 5)
  })

  it("returns rate 0 for every tier when the pool is empty, without dividing by zero", () => {
    const odds = tierOdds([{ tier: "common", quantity_remaining: 0 }])
    expect(odds[0].rate).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/gachaDomain.test.js`
Expected: FAIL with "Cannot find module '../shop/gacha/domain.js'"

- [ ] **Step 3: Write the implementation**

```js
// backend/shop/gacha/domain.js
const crypto = require("crypto")

/**
 * Groups prizes by tier and sums each tier's live share of the pool - for
 * display only (the "what's in the case" tier badges/percentages). The
 * actual draw never uses this; it always walks individual prizes.
 */
function tierOdds(prizes) {
  const totalWeight = prizes.reduce((sum, p) => sum + p.quantity_remaining, 0)
  const byTier = new Map()
  for (const p of prizes) {
    byTier.set(p.tier, (byTier.get(p.tier) || 0) + p.quantity_remaining)
  }
  return [...byTier.entries()].map(([tier, weight]) => ({
    tier,
    weight,
    rate: totalWeight > 0 ? weight / totalWeight : 0,
  }))
}

/**
 * Picks one prize weighted by remaining quantity, using crypto-quality
 * randomness that is never client-seedable (see the design's Anti-cheat
 * section) - this is the one place in the whole feature that decides a
 * draw's outcome. Callers must run this inside the same row-locked
 * transaction that will decrement the winner's quantity_remaining, so the
 * pool this function sees can't go stale between pick and decrement.
 */
function weightedPick(prizes) {
  const totalWeight = prizes.reduce((sum, p) => sum + p.quantity_remaining, 0)
  if (totalWeight <= 0) throw new Error("Không thể quay: kho quà đã hết")
  let r = crypto.randomInt(0, totalWeight)
  for (const p of prizes) {
    if (r < p.quantity_remaining) return p
    r -= p.quantity_remaining
  }
  return prizes[prizes.length - 1]
}

module.exports = { tierOdds, weightedPick }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/gachaDomain.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd backend
git add shop/gacha/domain.js tests/gachaDomain.test.js
git commit -m "feat(gacha): add pure odds/weighted-pick domain logic"
```

---

### Task 3: Prize repository (admin CRUD)

**Files:**
- Create: `backend/shop/gacha/prizeRepo.js`
- Test: `backend/tests/gachaPrizeRepo.test.js`

**Interfaces:**
- Consumes: `db` (`backend/db.js`, existing mysql2 pool).
- Produces:
  - `listPrizes(productId) => Promise<Array<prize row>>`
  - `replacePrizes(productId, prizes: Array<{id?, name, description?, image_url?, tier, display_price, quantity_total}>) => Promise<void>`
  - `class GachaPrizeQuantityError extends Error` (`.name === "GachaPrizeQuantityError"`)
  - Consumed by: `routes/adminGacha.js` (Task 8), `shop/gacha/sessionRepo.js` (Task 4, read-only via `listPrizes`).

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/gachaPrizeRepo.test.js
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import prizeRepo from "../shop/gacha/prizeRepo.js"
import { resetTables, closeDb } from "./helpers/db.js"

async function seedGachaProduct() {
  const cid = await catalog.createCollection({ title: "Festival Gacha", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
  return pid
}

beforeEach(async () => {
  await resetTables("gacha_draws", "gacha_sessions", "gacha_prizes", "order_items", "orders", "product_variants", "products", "collections")
})

afterAll(closeDb)

describe("replacePrizes", () => {
  it("inserts new prizes with quantity_remaining seeded to quantity_total", async () => {
    const pid = await seedGachaProduct()
    await prizeRepo.replacePrizes(pid, [
      { name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 },
      { name: "Figure", tier: "legendary", display_price: 500000, quantity_total: 1 },
    ])
    const rows = await prizeRepo.listPrizes(pid)
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.name === "Sticker").quantity_remaining).toBe(10)
    expect(rows.find((r) => r.name === "Figure").quantity_remaining).toBe(1)
  })

  it("updates an existing prize in place by id, preserving quantity_remaining minus any drawn", async () => {
    const pid = await seedGachaProduct()
    await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }])
    const [prize] = await prizeRepo.listPrizes(pid)
    // Simulate one draw having happened.
    await db.query("UPDATE gacha_prizes SET quantity_remaining = 9 WHERE id = ?", [prize.id])

    await prizeRepo.replacePrizes(pid, [{ id: prize.id, name: "Sticker v2", tier: "rare", display_price: 6000, quantity_total: 20 }])

    const [updated] = await prizeRepo.listPrizes(pid)
    expect(updated.name).toBe("Sticker v2")
    expect(updated.tier).toBe("rare")
    // 20 total - 10 original = +10 added to whatever remained (9) = 19.
    expect(updated.quantity_remaining).toBe(19)
  })

  it("rejects reducing quantity_total below what has already been drawn", async () => {
    const pid = await seedGachaProduct()
    await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }])
    const [prize] = await prizeRepo.listPrizes(pid)
    await db.query("UPDATE gacha_prizes SET quantity_remaining = 2 WHERE id = ?", [prize.id])

    await expect(
      prizeRepo.replacePrizes(pid, [{ id: prize.id, name: "Sticker", tier: "common", display_price: 5000, quantity_total: 5 }])
    ).rejects.toThrow(prizeRepo.GachaPrizeQuantityError)
  })

  it("rejects deleting (omitting) a prize that has already had draws against it", async () => {
    const pid = await seedGachaProduct()
    await prizeRepo.replacePrizes(pid, [
      { name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 },
      { name: "Figure", tier: "legendary", display_price: 500000, quantity_total: 1 },
    ])
    const rows = await prizeRepo.listPrizes(pid)
    const figure = rows.find((r) => r.name === "Figure")
    await db.query("UPDATE gacha_prizes SET quantity_remaining = 0 WHERE id = ?", [figure.id])

    const sticker = rows.find((r) => r.name === "Sticker")
    await expect(
      prizeRepo.replacePrizes(pid, [{ id: sticker.id, name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }])
    ).rejects.toThrow(prizeRepo.GachaPrizeQuantityError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/gachaPrizeRepo.test.js`
Expected: FAIL with "Cannot find module '../shop/gacha/prizeRepo.js'"

- [ ] **Step 3: Write the implementation**

```js
// backend/shop/gacha/prizeRepo.js
const db = require("./../../db")

class GachaPrizeQuantityError extends Error {
  constructor(name) {
    super(`Không thể lưu: "${name}" có số lượng thấp hơn số đã quay, hoặc đã có lượt quay nhưng bị xóa khỏi danh sách`)
    this.name = "GachaPrizeQuantityError"
  }
}

async function listPrizes(productId) {
  const [rows] = await db.query(
    "SELECT * FROM gacha_prizes WHERE product_id = ? ORDER BY sort_order ASC, id ASC",
    [productId]
  )
  return rows
}

/**
 * Replaces a product's full prize list, mirroring catalogRepo's
 * replaceVariants contract: rows carrying an id are updated in place (so
 * gacha_draws' FK and drawn history survive), rows without an id are
 * inserted, and any existing row missing from the new list is deleted -
 * but only if nothing has ever been drawn from it (quantity_total -
 * quantity_remaining === 0), matching the delete-guard philosophy already
 * used for variants with live orders. Editable at any time otherwise,
 * including increasing quantity_total on a prize that already has draws.
 */
async function replacePrizes(productId, prizes) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [existingRows] = await conn.query(
      "SELECT id, name, quantity_total, quantity_remaining FROM gacha_prizes WHERE product_id = ? FOR UPDATE",
      [productId]
    )
    const existingById = new Map(existingRows.map((r) => [r.id, r]))
    const keepIds = new Set(prizes.filter((p) => p.id).map((p) => Number(p.id)))

    for (const row of existingRows) {
      if (keepIds.has(row.id)) continue
      if (row.quantity_total - row.quantity_remaining > 0) {
        throw new GachaPrizeQuantityError(row.name)
      }
      await conn.query("DELETE FROM gacha_prizes WHERE id = ?", [row.id])
    }

    let sortOrder = 0
    for (const p of prizes) {
      const quantityTotal = Number(p.quantity_total)
      const existing = p.id ? existingById.get(Number(p.id)) : null
      if (existing) {
        const drawn = existing.quantity_total - existing.quantity_remaining
        if (quantityTotal < drawn) throw new GachaPrizeQuantityError(existing.name)
        const newRemaining = existing.quantity_remaining + (quantityTotal - existing.quantity_total)
        await conn.query(
          `UPDATE gacha_prizes
             SET name = ?, description = ?, image_url = ?, tier = ?, display_price = ?,
                 quantity_total = ?, quantity_remaining = ?, sort_order = ?
           WHERE id = ?`,
          [p.name, p.description || null, p.image_url || null, p.tier, Number(p.display_price) || 0,
            quantityTotal, newRemaining, sortOrder, existing.id]
        )
      } else {
        await conn.query(
          `INSERT INTO gacha_prizes
             (product_id, name, description, image_url, tier, display_price, quantity_total, quantity_remaining, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [productId, p.name, p.description || null, p.image_url || null, p.tier, Number(p.display_price) || 0,
            quantityTotal, quantityTotal, sortOrder]
        )
      }
      sortOrder += 1
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

module.exports = { listPrizes, replacePrizes, GachaPrizeQuantityError }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/gachaPrizeRepo.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd backend
git add shop/gacha/prizeRepo.js tests/gachaPrizeRepo.test.js
git commit -m "feat(gacha): add prize repository with quantity-history guard"
```

---

### Task 4: Session repository — booth/online session lifecycle and the transactional draw

**Files:**
- Create: `backend/shop/gacha/sessionRepo.js`
- Test: `backend/tests/gachaSessionRepo.test.js`

**Interfaces:**
- Consumes: `db`, `shop/orders/domain.js` (`generateOrderToken`), `shop/gacha/domain.js` (`weightedPick`).
- Produces (consumed by Task 5's `orderRepo.js` hook, Task 8's admin routes, Task 9's buyer routes, Task 10's practice route):
  - `getPoolRemaining(productId) => Promise<number>`
  - `startOnlineSessionIfNeeded(orderId) => Promise<void>`
  - `startBoothSession({ productId, buyerName, turnsTotal }) => Promise<{ orderId, sessionId, orderToken }>`
  - `getSessionByOrderId(orderId) => Promise<session row | null>`
  - `getSessionById(id) => Promise<session row | null>`
  - `getDropsForSession(sessionId) => Promise<Array<draw+prize row>>`
  - `drawForSession(sessionId, { drawKey, ownerOrderId }) => Promise<{ prize, turnsUsed, turnsTotal, sessionCompleted, orderId }>`
  - `practiceDraw(productId) => Promise<{ prize }>`
  - `class GachaSoldOutError`, `class GachaProductNotFoundError`, `class GachaSessionNotFoundError`, `class GachaSessionCompleteError`

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/gachaSessionRepo.test.js
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import prizeRepo from "../shop/gacha/prizeRepo.js"
import sessionRepo from "../shop/gacha/sessionRepo.js"
import { resetTables, closeDb } from "./helpers/db.js"

async function seedGachaProduct(prizes) {
  const cid = await catalog.createCollection({ title: "Festival Gacha", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
  await prizeRepo.replacePrizes(pid, prizes)
  return pid
}

beforeEach(async () => {
  await resetTables("gacha_draws", "gacha_sessions", "gacha_prizes", "order_items", "orders", "product_variants", "products", "collections")
})

afterAll(closeDb)

describe("startBoothSession", () => {
  it("creates a confirmed cash order and an active session together", async () => {
    const pid = await seedGachaProduct([{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }])
    const { orderId, sessionId } = await sessionRepo.startBoothSession({ productId: pid, buyerName: "Phuc", turnsTotal: 3 })

    const [[order]] = await db.query("SELECT status, payment_method, fulfillment_method FROM orders WHERE id = ?", [orderId])
    expect(order.status).toBe("confirmed")
    expect(order.payment_method).toBe("cash")
    expect(order.fulfillment_method).toBe("booth")

    const session = await sessionRepo.getSessionById(sessionId)
    expect(session.turns_total).toBe(3)
    expect(session.turns_used).toBe(0)
    expect(session.status).toBe("active")
    expect(session.source).toBe("booth_cash")
  })

  it("refuses to start a session larger than the remaining pool", async () => {
    const pid = await seedGachaProduct([{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 2 }])
    await expect(
      sessionRepo.startBoothSession({ productId: pid, buyerName: null, turnsTotal: 3 })
    ).rejects.toThrow(sessionRepo.GachaSoldOutError)
  })
})

describe("drawForSession", () => {
  it("decrements the winning prize, records the draw and an order_items row, and increments turns_used", async () => {
    const pid = await seedGachaProduct([{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 1 }])
    const { orderId, sessionId } = await sessionRepo.startBoothSession({ productId: pid, buyerName: null, turnsTotal: 1 })

    const result = await sessionRepo.drawForSession(sessionId, { drawKey: "tap-1" })

    expect(result.prize.name).toBe("Sticker")
    expect(result.turnsUsed).toBe(1)
    expect(result.sessionCompleted).toBe(true)

    const [[prizeRow]] = await db.query("SELECT quantity_remaining FROM gacha_prizes WHERE product_id = ?", [pid])
    expect(prizeRow.quantity_remaining).toBe(0)

    const [items] = await db.query("SELECT product_name_snapshot, gacha_tier_snapshot FROM order_items WHERE order_id = ?", [orderId])
    expect(items).toHaveLength(1)
    expect(items[0].product_name_snapshot).toBe("Sticker")
    expect(items[0].gacha_tier_snapshot).toBe("common")

    const [[order]] = await db.query("SELECT status FROM orders WHERE id = ?", [orderId])
    expect(order.status).toBe("completed")
  })

  it("is idempotent: replaying the same draw_key returns the original result without drawing again", async () => {
    const pid = await seedGachaProduct([
      { name: "Common", tier: "common", display_price: 1000, quantity_total: 100 },
    ])
    const { sessionId } = await sessionRepo.startBoothSession({ productId: pid, buyerName: null, turnsTotal: 2 })

    const first = await sessionRepo.drawForSession(sessionId, { drawKey: "tap-1" })
    const replay = await sessionRepo.drawForSession(sessionId, { drawKey: "tap-1" })

    expect(replay.prize.id).toBe(first.prize.id)
    expect(replay.turnsUsed).toBe(1)

    const session = await sessionRepo.getSessionById(sessionId)
    expect(session.turns_used).toBe(1)
  })

  it("refuses to draw past turns_total", async () => {
    const pid = await seedGachaProduct([{ name: "Common", tier: "common", display_price: 1000, quantity_total: 100 }])
    const { sessionId } = await sessionRepo.startBoothSession({ productId: pid, buyerName: null, turnsTotal: 1 })

    await sessionRepo.drawForSession(sessionId, { drawKey: "tap-1" })
    await expect(sessionRepo.drawForSession(sessionId, { drawKey: "tap-2" })).rejects.toThrow(sessionRepo.GachaSessionCompleteError)
  })
})

describe("practiceDraw", () => {
  it("never touches quantity_remaining or writes a session/draw row", async () => {
    const pid = await seedGachaProduct([{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 5 }])

    for (let i = 0; i < 10; i++) await sessionRepo.practiceDraw(pid)

    const [[prizeRow]] = await db.query("SELECT quantity_remaining FROM gacha_prizes WHERE product_id = ?", [pid])
    expect(prizeRow.quantity_remaining).toBe(5)
    const [[{ count }]] = await db.query("SELECT COUNT(*) AS count FROM gacha_sessions WHERE product_id = ?", [pid])
    expect(count).toBe(0)
    const [[{ drawCount }]] = await db.query(
      "SELECT COUNT(*) AS drawCount FROM gacha_draws d JOIN gacha_prizes p ON p.id = d.gacha_prize_id WHERE p.product_id = ?",
      [pid]
    )
    expect(drawCount).toBe(0)
  })
})

describe("startOnlineSessionIfNeeded", () => {
  it("creates a session from a confirmed order's gacha order_items, and is a no-op if called twice", async () => {
    const pid = await seedGachaProduct([{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 5 }])
    const detail = await catalog.getCollectionDetailById(await db.query("SELECT collection_id FROM products WHERE id = ?", [pid]).then(([[r]]) => r.collection_id))
    const variantId = detail.products.find((p) => p.id === pid).variant_id

    const [orderRes] = await db.query(
      `INSERT INTO orders (order_token, buyer_name, phone, email, fulfillment_method, status, payment_method, total, cod_amount, collection_id, access_pin_hash)
       VALUES ('tok123', 'A', '090', 'a@a.com', 'ship', 'confirmed', 'bank', 40000, NULL, NULL, 'x')`
    )
    const orderId = orderRes.insertId
    await db.query(
      `INSERT INTO order_items (order_id, product_variant_id, product_name_snapshot, variant_label_snapshot, unit_price_snapshot, qty, is_gift, stock_reserved)
       VALUES (?, ?, 'Mystery Case', '', 20000, 2, false, false)`,
      [orderId, variantId]
    )

    await sessionRepo.startOnlineSessionIfNeeded(orderId)
    await sessionRepo.startOnlineSessionIfNeeded(orderId)

    const [[{ count }]] = await db.query("SELECT COUNT(*) AS count FROM gacha_sessions WHERE order_id = ?", [orderId])
    expect(count).toBe(1)
    const session = await sessionRepo.getSessionByOrderId(orderId)
    expect(session.turns_total).toBe(2)
    expect(session.source).toBe("online")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/gachaSessionRepo.test.js`
Expected: FAIL with "Cannot find module '../shop/gacha/sessionRepo.js'"

- [ ] **Step 3: Write the implementation**

```js
// backend/shop/gacha/sessionRepo.js
const db = require("./../../db")
const orderDomain = require("./../orders/domain")
const gachaDomain = require("./domain")

class GachaSoldOutError extends Error {
  constructor() {
    super("Kho quà không đủ cho số lượt yêu cầu")
    this.name = "GachaSoldOutError"
  }
}
class GachaProductNotFoundError extends Error {
  constructor() {
    super("Không tìm thấy sản phẩm gacha")
    this.name = "GachaProductNotFoundError"
  }
}
class GachaSessionNotFoundError extends Error {
  constructor() {
    super("Không tìm thấy phiên quay")
    this.name = "GachaSessionNotFoundError"
  }
}
class GachaSessionCompleteError extends Error {
  constructor() {
    super("Phiên quay đã hết lượt")
    this.name = "GachaSessionCompleteError"
  }
}

async function getPoolRemaining(productId) {
  const [[row]] = await db.query(
    "SELECT COALESCE(SUM(quantity_remaining), 0) AS total FROM gacha_prizes WHERE product_id = ?",
    [productId]
  )
  return Number(row.total)
}

async function getSessionByOrderId(orderId) {
  const [[row]] = await db.query("SELECT * FROM gacha_sessions WHERE order_id = ?", [orderId])
  return row || null
}

async function getSessionById(id) {
  const [[row]] = await db.query("SELECT * FROM gacha_sessions WHERE id = ?", [id])
  return row || null
}

async function getDropsForSession(sessionId) {
  const [rows] = await db.query(
    `SELECT d.id, d.drawn_at, p.name, p.tier, p.display_price, p.image_url
       FROM gacha_draws d
       JOIN gacha_prizes p ON p.id = d.gacha_prize_id
      WHERE d.session_id = ?
      ORDER BY d.id ASC`,
    [sessionId]
  )
  return rows
}

/**
 * Called from orderRepo.transitionOrder right after an order reaches
 * 'confirmed'. Sums the qty of every gacha order_item on this order into a
 * single session - createOrder (see Task 5) already refuses to mix a gacha
 * item with any other product or a second gacha product in one cart, so
 * this sum is always against exactly one gacha product. Idempotent via the
 * unique index on gacha_sessions.order_id - a re-entrant call (there should
 * never be one, since an order can't be confirmed twice, but this mirrors
 * the codebase's existing defense-in-depth style) is a silent no-op.
 */
async function startOnlineSessionIfNeeded(orderId) {
  const [items] = await db.query(
    `SELECT oi.qty, p.id AS product_id, p.type AS product_type
       FROM order_items oi
       JOIN product_variants v ON v.id = oi.product_variant_id
       JOIN products p ON p.id = v.product_id
      WHERE oi.order_id = ?`,
    [orderId]
  )
  const gachaItems = items.filter((i) => i.product_type === "gacha")
  if (!gachaItems.length) return

  const productId = gachaItems[0].product_id
  const turnsTotal = gachaItems.reduce((sum, i) => sum + i.qty, 0)
  try {
    await db.query(
      `INSERT INTO gacha_sessions (product_id, order_id, turns_total, turns_used, status, source)
       VALUES (?, ?, ?, 0, 'active', 'online')`,
      [productId, orderId, turnsTotal]
    )
  } catch (err) {
    if (err.code !== "ER_DUP_ENTRY") throw err
  }
}

/** Staff Panel's "Start session" - creates the cash order and its session together, in one transaction. */
async function startBoothSession({ productId, buyerName, turnsTotal }) {
  if (!Number.isInteger(turnsTotal) || turnsTotal <= 0) {
    throw new Error("Số lượt quay không hợp lệ")
  }
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [[product]] = await conn.query(
      "SELECT id, price FROM products WHERE id = ? AND type = 'gacha' FOR UPDATE",
      [productId]
    )
    if (!product) throw new GachaProductNotFoundError()

    const [[pool]] = await conn.query(
      "SELECT COALESCE(SUM(quantity_remaining), 0) AS total FROM gacha_prizes WHERE product_id = ? FOR UPDATE",
      [productId]
    )
    if (Number(pool.total) < turnsTotal) throw new GachaSoldOutError()

    const token = orderDomain.generateOrderToken()
    const total = product.price * turnsTotal
    const [orderRes] = await conn.query(
      `INSERT INTO orders
         (order_token, buyer_name, phone, email, fulfillment_method, status, payment_method, total, cod_amount, collection_id, confirmed_at)
       VALUES (?, ?, '', '', 'booth', 'confirmed', 'cash', ?, NULL, NULL, NOW())`,
      [token, buyerName || "Khách tại quầy", total]
    )
    const orderId = orderRes.insertId

    const [sessionRes] = await conn.query(
      `INSERT INTO gacha_sessions (product_id, order_id, buyer_name, turns_total, turns_used, status, source)
       VALUES (?, ?, ?, ?, 0, 'active', 'booth_cash')`,
      [productId, orderId, buyerName || null, turnsTotal]
    )

    await conn.commit()
    return { orderId, sessionId: sessionRes.insertId, orderToken: token }
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/**
 * The one function that decides a real draw's outcome. Runs entirely
 * inside one transaction: row-locks the product's prizes, picks the
 * winner server-side, decrements it, records the draw + its order_items
 * row, advances turns_used, and completes the session/order if this was
 * the last turn. drawKey makes a retried/double-tapped request idempotent:
 * if it matches the session's last_draw_key, the original result is
 * returned without drawing again.
 */
async function drawForSession(sessionId, { drawKey }) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [[session]] = await conn.query("SELECT * FROM gacha_sessions WHERE id = ? FOR UPDATE", [sessionId])
    if (!session) throw new GachaSessionNotFoundError()

    if (drawKey && session.last_draw_key === drawKey && session.last_draw_id) {
      const [[replay]] = await conn.query(
        `SELECT p.* FROM gacha_draws d JOIN gacha_prizes p ON p.id = d.gacha_prize_id WHERE d.id = ?`,
        [session.last_draw_id]
      )
      await conn.commit()
      return {
        prize: replay,
        turnsUsed: session.turns_used,
        turnsTotal: session.turns_total,
        sessionCompleted: session.status === "completed",
        orderId: session.order_id,
      }
    }

    if (session.status === "completed" || session.turns_used >= session.turns_total) {
      throw new GachaSessionCompleteError()
    }

    const [prizes] = await conn.query(
      "SELECT * FROM gacha_prizes WHERE product_id = ? ORDER BY id ASC FOR UPDATE",
      [session.product_id]
    )
    const winner = gachaDomain.weightedPick(prizes)

    await conn.query("UPDATE gacha_prizes SET quantity_remaining = quantity_remaining - 1 WHERE id = ?", [winner.id])

    const [drawRes] = await conn.query(
      "INSERT INTO gacha_draws (session_id, gacha_prize_id) VALUES (?, ?)",
      [sessionId, winner.id]
    )

    await conn.query(
      `INSERT INTO order_items
         (order_id, product_variant_id, product_name_snapshot, variant_label_snapshot, unit_price_snapshot, qty,
          image_url_snapshot, is_gift, stock_reserved, gacha_draw_id, gacha_tier_snapshot)
       VALUES (?, NULL, ?, '', ?, 1, ?, false, false, ?, ?)`,
      [session.order_id, winner.name, winner.display_price, winner.image_url, drawRes.insertId, winner.tier]
    )

    const turnsUsed = session.turns_used + 1
    const sessionCompleted = turnsUsed >= session.turns_total
    await conn.query(
      `UPDATE gacha_sessions
         SET turns_used = ?, status = ?, completed_at = ?, last_draw_key = ?, last_draw_id = ?
       WHERE id = ?`,
      [turnsUsed, sessionCompleted ? "completed" : "active", sessionCompleted ? new Date() : null,
        drawKey || null, drawRes.insertId, sessionId]
    )

    if (sessionCompleted) {
      const [[order]] = await conn.query("SELECT status, fulfillment_method FROM orders WHERE id = ? FOR UPDATE", [session.order_id])
      // Booth-cash: handed over on the spot, nothing to ship - completes
      // immediately. Online: stays confirmed so the normal
      // confirmed -> shipped -> completed admin pipeline packs/ships
      // whatever ended up drawn, unchanged from any physical order.
      if (order.fulfillment_method === "booth" && order.status === "confirmed") {
        await conn.query("UPDATE orders SET status = 'completed', completed_at = NOW() WHERE id = ?", [session.order_id])
      }
    }

    await conn.commit()
    return { prize: winner, turnsUsed, turnsTotal: session.turns_total, sessionCompleted, orderId: session.order_id }
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/**
 * Structurally separate from drawForSession, on purpose: this function has
 * no write transaction at all, so it is provably incapable of touching
 * quantity_remaining or writing a gacha_draws/order_items row, rather than
 * relying on every future edit to remember to check a "is this practice"
 * flag deep inside the real draw path.
 */
async function practiceDraw(productId) {
  const [prizes] = await db.query("SELECT * FROM gacha_prizes WHERE product_id = ?", [productId])
  const winner = gachaDomain.weightedPick(prizes)
  return { prize: winner }
}

module.exports = {
  getPoolRemaining,
  startOnlineSessionIfNeeded,
  startBoothSession,
  getSessionByOrderId,
  getSessionById,
  getDropsForSession,
  drawForSession,
  practiceDraw,
  GachaSoldOutError,
  GachaProductNotFoundError,
  GachaSessionNotFoundError,
  GachaSessionCompleteError,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/gachaSessionRepo.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
cd backend
git add shop/gacha/sessionRepo.js tests/gachaSessionRepo.test.js
git commit -m "feat(gacha): add session repo with transactional server-authoritative draw"
```

---

### Task 5: Wire gacha into the order lifecycle (`createOrder`, `transitionOrder`, `canTransition`)

**Files:**
- Modify: `backend/shop/orders/domain.js`
- Modify: `backend/shop/orders/orderRepo.js`
- Test: `backend/tests/orderDomain.test.js` (add cases)
- Test: `backend/tests/orderRepo.test.js` (add cases)

**Interfaces:**
- Consumes: `shop/gacha/sessionRepo.js` (`startOnlineSessionIfNeeded`, `getPoolRemaining`) from Task 4.
- Produces: `orderRepo.MixedGachaCartError`, `orderRepo.NoCodForGachaError`, `orderRepo.GachaPoolSoldOutError` — consumed by `routes/orders.js` (Task 9, error-to-HTTP mapping, mirroring the existing `NoCodForDigitalError` mapping).

- [ ] **Step 1: Write the failing domain test**

```js
// Add to backend/tests/orderDomain.test.js
it("booth fulfillment goes confirmed -> completed directly, like pickup and digital", () => {
  expect(domain.canTransition("confirmed", "completed", "booth")).toBe(true)
  expect(domain.canTransition("confirmed", "shipped", "booth")).toBe(false)
})
```

(Import path/`domain` alias must match whatever this file already uses — check the top of `orderDomain.test.js` before adding; it imports `../shop/orders/domain.js`.)

- [ ] **Step 2: Write the failing orderRepo tests**

```js
// Add to backend/tests/orderRepo.test.js
async function seedGachaVariant(prizeQuantity, collectionOver = {}) {
  const cid = await catalog.createCollection({ title: "Gacha Drop", status: "active", ...collectionOver })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
  const prizeRepo = require("../shop/gacha/prizeRepo.js")
  await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: prizeQuantity }])
  const detail = await catalog.getCollectionDetailById(cid)
  return { cid, pid, variantId: detail.products[0].variant_id }
}

describe("createOrder - gacha", () => {
  it("rejects COD for a gacha cart", async () => {
    const { variantId } = await seedGachaVariant(10)
    await expect(repo.createOrder(order(variantId, 2, { payment_method: "cod" }))).rejects.toThrow(repo.NoCodForGachaError)
  })

  it("rejects mixing a gacha item with a non-gacha item in the same cart", async () => {
    const { variantId: gachaVariantId } = await seedGachaVariant(10)
    const { variantId: physicalVariantId } = await seedVariant(10)
    const mixed = {
      items: [{ variant_id: gachaVariantId, qty: 1 }, { variant_id: physicalVariantId, qty: 1 }],
      buyer, payment_method: "bank", fulfillment_method: "ship",
    }
    await expect(repo.createOrder(mixed)).rejects.toThrow(repo.MixedGachaCartError)
  })

  it("rejects buying more turns than the prize pool has remaining", async () => {
    const { variantId } = await seedGachaVariant(2)
    await expect(repo.createOrder(order(variantId, 3, { payment_method: "bank", fulfillment_method: "ship" })))
      .rejects.toThrow(repo.GachaPoolSoldOutError)
  })

  it("creates a normal ship-fulfilled order for a valid gacha cart", async () => {
    const { variantId } = await seedGachaVariant(10)
    const result = await repo.createOrder(order(variantId, 3, { payment_method: "bank", fulfillment_method: "ship" }))
    expect(result.total).toBe(60000)
  })
})

describe("transitionOrder - gacha", () => {
  it("creates a gacha session once the order is confirmed", async () => {
    const sessionRepo = require("../shop/gacha/sessionRepo.js")
    const { variantId } = await seedGachaVariant(10)
    const result = await repo.createOrder(order(variantId, 2, { payment_method: "bank", fulfillment_method: "ship" }))
    await repo.transitionOrder(result.id, "confirmed")

    const session = await sessionRepo.getSessionByOrderId(result.id)
    expect(session).not.toBeNull()
    expect(session.turns_total).toBe(2)
    expect(session.source).toBe("online")
  })
})
```

(`order(...)` and `seedVariant(...)` already exist in this file per the head shown at plan-writing time — reuse them; do not redefine.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/orderDomain.test.js tests/orderRepo.test.js`
Expected: FAIL — `domain.canTransition` case fails (booth not yet special-cased); `repo.NoCodForGachaError`/`MixedGachaCartError`/`GachaPoolSoldOutError` are undefined; gacha createOrder cases throw generic errors instead.

- [ ] **Step 4: Modify `shop/orders/domain.js`**

```js
// In shop/orders/domain.js, replace canTransition's body:
/**
 * Pickup, digital, and booth (a gacha handed over on the spot) orders go
 * confirmed -> completed directly: there is nothing to ship and no
 * tracking code to give.
 */
function canTransition(from, to, fulfillment) {
  const allowed = TRANSITIONS[from]
  if (!allowed || !allowed.includes(to)) return false
  if (["pickup", "digital", "booth"].includes(fulfillment) && to === "shipped") return false
  return true
}
```

- [ ] **Step 5: Modify `shop/orders/orderRepo.js`**

Add new error classes near the existing ones (after `NoCodForDigitalError`, around line 100):

```js
class NoCodForGachaError extends Error {
  constructor() {
    super("Không hỗ trợ thanh toán COD cho lượt quay gacha")
    this.name = "NoCodForGachaError"
  }
}

/** A gacha turn can only ever be the sole item in its cart - see the design's decision to drop buy-online-redeem-at-booth in favor of one order = one gacha session. */
class MixedGachaCartError extends Error {
  constructor() {
    super("Không thể mua lượt gacha cùng lúc với sản phẩm khác trong một đơn")
    this.name = "MixedGachaCartError"
  }
}

class GachaPoolSoldOutError extends Error {
  constructor() {
    super("Kho quà gacha không đủ cho số lượt bạn muốn mua")
    this.name = "GachaPoolSoldOutError"
  }
}
```

Add `NoCodForGachaError`, `MixedGachaCartError`, `GachaPoolSoldOutError` to the `module.exports` block at the bottom of the file (alongside `NoCodForDigitalError` etc).

Add `const sessionRepo = require("./../gacha/sessionRepo")` to the top requires.

In `createOrder`, immediately after the existing `const allDigital = ...` / `const anyDigital = ...` lines (around line 230-231):

```js
    const anyGacha = rows.some((r) => r.product_type === "gacha")
    if (anyGacha) {
      const gachaProductIds = new Set(rows.filter((r) => r.product_type === "gacha").map((r) => r.product_id))
      const nonGachaCount = rows.filter((r) => r.product_type !== "gacha").length
      if (nonGachaCount > 0 || gachaProductIds.size > 1) {
        throw new MixedGachaCartError()
      }
      if (input.payment_method === "cod") {
        throw new NoCodForGachaError()
      }
    }
```

Then, right after the `anyDigital && input.payment_method === "cod"` check (which stays exactly as-is), before the collection-open/scheduled loop, insert the pool-availability check (needs the open transaction's `conn`, so it must run inside the same try block, using the single gacha row already resolved above):

```js
    if (anyGacha) {
      const gachaRow = rows.find((r) => r.product_type === "gacha")
      const requestedTurns = wanted.get(gachaRow.id)
      const [[pool]] = await conn.query(
        "SELECT COALESCE(SUM(quantity_remaining), 0) AS total FROM gacha_prizes WHERE product_id = ? FOR UPDATE",
        [gachaRow.product_id]
      )
      if (Number(pool.total) < requestedTurns) throw new GachaPoolSoldOutError()
    }
```

In `transitionOrder`, inside the `try` block, right after the successful `await conn.query(\`UPDATE orders SET ${sets.join(", ")} WHERE id = ?\`, params)` / `await conn.commit(); ok = true` lines and before the function's `finally`, add the online-session trigger. It must run **after** commit (it's not part of the order's own atomic state change) but can still run before the connection is released:

```js
    if (toStatus === "confirmed") {
      await sessionRepo.startOnlineSessionIfNeeded(id)
    }
```

Place this line immediately after `ok = true` and before the email-type resolution that follows it, so it runs on the same code path but doesn't affect the email logic below it.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/orderDomain.test.js tests/orderRepo.test.js`
Expected: PASS (all existing + new cases)

- [ ] **Step 7: Run the full backend suite to check for regressions**

Run: `cd backend && npm test`
Expected: PASS, no regressions in unrelated order/digital/gift tests.

- [ ] **Step 8: Commit**

```bash
cd backend
git add shop/orders/domain.js shop/orders/orderRepo.js tests/orderDomain.test.js tests/orderRepo.test.js
git commit -m "feat(gacha): wire gacha carts into createOrder/transitionOrder lifecycle"
```

---

### Task 6: Gacha product creation (hidden turn variant) in the catalog

**Files:**
- Modify: `backend/shop/catalogRepo.js`
- Modify: `backend/routes/adminCatalog.js`
- Test: `backend/tests/catalogRepo.test.js` (add cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: a `products.type = 'gacha'` product always has exactly one hidden `product_variants` row (no `label`, `stock_qty: null` — unlimited; the real limiting factor is the prize pool, enforced in Task 5's `createOrder` check), reusable by `getCollectionDetailById`'s existing `p.type === "digital"` branch pattern.

- [ ] **Step 1: Write the failing test**

```js
// Add to backend/tests/catalogRepo.test.js
it("creates a gacha product with one hidden unlimited-stock variant", async () => {
  const cid = await repo.createCollection({ title: "Gacha Drop", status: "active" })
  const pid = await repo.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })

  const detail = await repo.getCollectionDetailById(cid)
  const product = detail.products.find((p) => p.id === pid)
  expect(product.variant_id).not.toBeNull()
  expect(product.stock_qty).toBeNull()
})
```

(Match this test's exact import/setup style to whatever `catalogRepo.test.js` already uses at its top — it already has an equivalent digital-product test to copy the shape from.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/catalogRepo.test.js -t "gacha"`
Expected: FAIL — `product.variant_id` is `null` (no hidden variant created for an unrecognized type, since `createProduct` currently only special-cases `"digital"`).

- [ ] **Step 3: Modify `shop/catalogRepo.js`**

In `mapCollection`'s caller — find the existing block (around line 155-167) that reads:

```js
      if (p.type === "digital") {
```

Change to:

```js
      if (p.type === "digital" || p.type === "gacha") {
```

(Everything inside that branch — reading `hidden.id`/`stock_qty`/`delivery_link`/`thumbnail_image` — is already generic enough to reuse unchanged; a gacha hidden variant simply has `delivery_link: null`.)

In `createProduct`, change:

```js
  const type = data.type === "digital" ? "digital" : "physical"
```

to:

```js
  const type = ["digital", "gacha"].includes(data.type) ? data.type : "physical"
```

and change:

```js
  if (type === "digital") {
    await replaceVariants(productId, [{
      label: "",
      stock_qty: data.stock_qty,
      delivery_link: data.delivery_link,
      thumbnail_image: data.thumbnail_image,
    }])
  }
```

to:

```js
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
```

In `updateProduct`, change:

```js
  if (existing.type === "digital") {
```

to:

```js
  if (existing.type === "digital" || existing.type === "gacha") {
```

and inside that block, change the `replaceVariants` call's `stock_qty`/`delivery_link` fields:

```js
    await replaceVariants(id, [{
      id: currentVariant ? currentVariant.id : undefined,
      label: "",
      stock_qty: existing.type === "gacha" ? null : (data.stock_qty !== undefined ? data.stock_qty : currentVariant?.stock_qty),
      delivery_link: existing.type === "gacha" ? null : (data.delivery_link !== undefined ? data.delivery_link : currentVariant?.delivery_link),
      thumbnail_image: data.thumbnail_image !== undefined ? data.thumbnail_image : currentVariant?.thumbnail_image,
    }])
```

- [ ] **Step 4: Modify `routes/adminCatalog.js`'s `validateProduct`**

Change:

```js
  if (body.type !== undefined && !["physical", "digital"].includes(body.type)) return "Loại sản phẩm không hợp lệ"
```

to:

```js
  if (body.type !== undefined && !["physical", "digital", "gacha"].includes(body.type)) return "Loại sản phẩm không hợp lệ"
```

Leave the existing `if (body.type === "digital") { ... }` block untouched — a gacha product has no `delivery_link`/`stock_qty` fields to validate here (its prize pool is a separate save step, handled by Task 8's `adminGacha.js`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/catalogRepo.test.js`
Expected: PASS (all existing + new case)

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
cd backend
git add shop/catalogRepo.js routes/adminCatalog.js tests/catalogRepo.test.js
git commit -m "feat(gacha): create a hidden unlimited-turn variant for gacha products"
```

---

### Task 7: Delete guard for gacha products/prizes with active sessions

**Files:**
- Modify: `backend/shop/catalogRepo.js`
- Test: `backend/tests/catalogRepo.test.js` (add case)

**Interfaces:**
- Consumes: `gacha_sessions` table (Task 1).
- Produces: `deleteProduct` throws the existing `VariantInUseError` (reused, not a new error type) when an active gacha session references the product.

- [ ] **Step 1: Write the failing test**

```js
// Add to backend/tests/catalogRepo.test.js
it("refuses to delete a gacha product with an active session", async () => {
  const cid = await repo.createCollection({ title: "Gacha Drop", status: "active" })
  const pid = await repo.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
  const prizeRepo = require("../shop/gacha/prizeRepo.js")
  await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 5 }])
  const sessionRepo = require("../shop/gacha/sessionRepo.js")
  await sessionRepo.startBoothSession({ productId: pid, buyerName: null, turnsTotal: 1 })

  await expect(repo.deleteProduct(pid)).rejects.toThrow(repo.VariantInUseError)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/catalogRepo.test.js -t "active session"`
Expected: FAIL — `deleteProduct` currently only checks `order_items`/variants, not `gacha_sessions`, so it deletes successfully instead of throwing.

- [ ] **Step 3: Modify `deleteProduct` in `shop/catalogRepo.js`**

Inside `deleteProduct`'s existing transaction (find the block that currently does the `variantsWithLiveOrders` check and throws `VariantInUseError`), add a gacha-specific check right after the product/variant existence is confirmed and before the delete actually runs:

```js
    const [activeGachaSessions] = await conn.query(
      "SELECT id FROM gacha_sessions WHERE product_id = ? AND status = 'active' FOR UPDATE",
      [id]
    )
    if (activeGachaSessions.length) {
      await conn.rollback()
      throw new VariantInUseError(["phiên gacha đang hoạt động"])
    }
```

(Exact placement: this must run inside the same `conn.beginTransaction()` block `deleteProduct` already uses, after the existing variant-lock query and before any `DELETE` statement executes, mirroring how the existing `VariantInUseError` check is structured in that function.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/catalogRepo.test.js`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
cd backend
git add shop/catalogRepo.js tests/catalogRepo.test.js
git commit -m "feat(gacha): block deleting a gacha product with an active session"
```

---

### Task 8: Admin routes — prize editor + booth kiosk

**Files:**
- Create: `backend/routes/adminGacha.js`
- Modify: `backend/server.js` (mount + rate limiter)
- Test: `backend/tests/adminGachaRoutes.test.js`

**Interfaces:**
- Consumes: `shop/gacha/prizeRepo.js`, `shop/gacha/sessionRepo.js` (Tasks 3-4).
- Produces HTTP:
  - `GET /api/admin/gacha-products/:productId/prizes`
  - `PUT /api/admin/gacha-products/:productId/prizes`
  - `POST /api/admin/gacha-products/:productId/booth-sessions` → `{ orderId, sessionId, orderToken }`
  - `GET /api/admin/gacha-sessions/:sessionId` → `{ session, drops }`
  - `POST /api/admin/gacha-sessions/:sessionId/draw` → `{ prize, turns_used, turns_total, session_completed }`
  - All mounted behind the existing `auth` (admin JWT) middleware, same as every other `/api/admin/*` router.

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/adminGachaRoutes.test.js
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import express from "express"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import adminGachaRoutes from "../routes/adminGacha.js"
import { resetTables, closeDb } from "./helpers/db.js"

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use("/api/admin", (req, res, next) => { req.headers.authorization = req.headers.authorization; next() }, adminGachaRoutes())
  return app
}

const adminToken = () => jwt.sign({ role: "admin" }, process.env.JWT_SECRET, { algorithm: "HS256" })

async function seedGachaProduct() {
  const cid = await catalog.createCollection({ title: "Gacha Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
  return pid
}

beforeEach(async () => {
  await resetTables("gacha_draws", "gacha_sessions", "gacha_prizes", "order_items", "orders", "product_variants", "products", "collections")
})

afterAll(closeDb)

describe("PUT /gacha-products/:id/prizes", () => {
  it("saves the prize list", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    const res = await request(app)
      .put(`/api/admin/gacha-products/${pid}/prizes`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ prizes: [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }] })
    expect(res.status).toBe(200)

    const list = await request(app).get(`/api/admin/gacha-products/${pid}/prizes`).set("Authorization", `Bearer ${adminToken()}`)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].name).toBe("Sticker")
  })

  it("rejects a prize with a non-positive quantity_total", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    const res = await request(app)
      .put(`/api/admin/gacha-products/${pid}/prizes`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ prizes: [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 0 }] })
    expect(res.status).toBe(400)
  })
})

describe("POST /gacha-products/:id/booth-sessions", () => {
  it("starts a booth session and returns its order/session ids", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await request(app).put(`/api/admin/gacha-products/${pid}/prizes`).set("Authorization", `Bearer ${adminToken()}`)
      .send({ prizes: [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }] })

    const res = await request(app)
      .post(`/api/admin/gacha-products/${pid}/booth-sessions`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ buyer_name: "Phuc", turns_total: 2 })
    expect(res.status).toBe(201)
    expect(res.body.session_id).toBeTypeOf("number")
  })
})

describe("POST /gacha-sessions/:id/draw", () => {
  it("draws and returns the winning prize", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await request(app).put(`/api/admin/gacha-products/${pid}/prizes`).set("Authorization", `Bearer ${adminToken()}`)
      .send({ prizes: [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }] })
    const start = await request(app).post(`/api/admin/gacha-products/${pid}/booth-sessions`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ turns_total: 1 })

    const draw = await request(app)
      .post(`/api/admin/gacha-sessions/${start.body.session_id}/draw`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ draw_key: "tap-1" })
    expect(draw.status).toBe(200)
    expect(draw.body.prize.name).toBe("Sticker")
    expect(draw.body.session_completed).toBe(true)
  })

  it("requires draw_key", async () => {
    const pid = await seedGachaProduct()
    const app = makeApp()
    await request(app).put(`/api/admin/gacha-products/${pid}/prizes`).set("Authorization", `Bearer ${adminToken()}`)
      .send({ prizes: [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }] })
    const start = await request(app).post(`/api/admin/gacha-products/${pid}/booth-sessions`)
      .set("Authorization", `Bearer ${adminToken()}`).send({ turns_total: 1 })

    const res = await request(app)
      .post(`/api/admin/gacha-sessions/${start.body.session_id}/draw`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({})
    expect(res.status).toBe(400)
  })
})
```

(Check whether `supertest` is already a dev dependency — grep `package.json`; every other `*Routes.test.js` file in `backend/tests/` already exercises a router this way, so match whichever request-mocking helper those files actually use instead of assuming `supertest` if it turns out something else is already standard.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/adminGachaRoutes.test.js`
Expected: FAIL with "Cannot find module '../routes/adminGacha.js'"

- [ ] **Step 3: Write the implementation**

```js
// backend/routes/adminGacha.js
const express = require("express")
const prizeRepo = require("../shop/gacha/prizeRepo")
const sessionRepo = require("../shop/gacha/sessionRepo")

const bad = (res, message) => res.status(400).json({ error: "invalid_input", message })
const oops = (res, err, where) => {
  console.error(`[ADMIN/GACHA] ${where}:`, err.message, err.code || "")
  res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
}

const TIERS = ["common", "rare", "epic", "legendary", "ancient"]
const NAME_MAX_LEN = 191

function validatePrizes(prizes) {
  if (!Array.isArray(prizes) || !prizes.length) return "Cần ít nhất một phần thưởng"
  for (const p of prizes) {
    if (!p.name || !String(p.name).trim()) return "Mỗi phần thưởng cần có tên"
    if (String(p.name).length > NAME_MAX_LEN) return `Tên phần thưởng không được quá ${NAME_MAX_LEN} ký tự`
    if (!TIERS.includes(p.tier)) return "Độ hiếm không hợp lệ"
    const qty = Number(p.quantity_total)
    if (!Number.isInteger(qty) || qty <= 0) return "Số lượng phải là số nguyên dương"
    const price = Number(p.display_price)
    if (!Number.isInteger(price) || price < 0) return "Giá trị hiển thị phải là số nguyên không âm"
  }
  return null
}

module.exports = function adminGachaRoutes() {
  const router = express.Router()

  router.get("/gacha-products/:productId/prizes", async (req, res) => {
    try {
      res.json(await prizeRepo.listPrizes(Number(req.params.productId)))
    } catch (err) { oops(res, err, "Lỗi đọc danh sách phần thưởng") }
  })

  router.put("/gacha-products/:productId/prizes", async (req, res) => {
    try {
      const invalid = validatePrizes(req.body.prizes)
      if (invalid) return bad(res, invalid)
      await prizeRepo.replacePrizes(Number(req.params.productId), req.body.prizes)
      res.json({ ok: true })
    } catch (err) {
      if (err instanceof prizeRepo.GachaPrizeQuantityError) {
        return res.status(409).json({ error: "gacha_prize_quantity", message: err.message })
      }
      oops(res, err, "Lỗi lưu phần thưởng")
    }
  })

  router.post("/gacha-products/:productId/booth-sessions", async (req, res) => {
    try {
      const turnsTotal = Number(req.body.turns_total)
      if (!Number.isInteger(turnsTotal) || turnsTotal <= 0) return bad(res, "Số lượt quay phải là số nguyên dương")

      const result = await sessionRepo.startBoothSession({
        productId: Number(req.params.productId),
        buyerName: req.body.buyer_name || null,
        turnsTotal,
      })
      res.status(201).json({ order_id: result.orderId, session_id: result.sessionId, order_token: result.orderToken })
    } catch (err) {
      if (err instanceof sessionRepo.GachaProductNotFoundError) return res.status(404).json({ error: "not_found", message: err.message })
      if (err instanceof sessionRepo.GachaSoldOutError) return res.status(409).json({ error: "gacha_sold_out", message: err.message })
      oops(res, err, "Lỗi bắt đầu phiên quầy")
    }
  })

  router.get("/gacha-sessions/:sessionId", async (req, res) => {
    try {
      const session = await sessionRepo.getSessionById(Number(req.params.sessionId))
      if (!session) return res.status(404).json({ error: "not_found", message: "Không tìm thấy phiên quay" })
      const drops = await sessionRepo.getDropsForSession(session.id)
      res.json({ session, drops })
    } catch (err) { oops(res, err, "Lỗi đọc phiên quay") }
  })

  router.post("/gacha-sessions/:sessionId/draw", async (req, res) => {
    try {
      const drawKey = req.body.draw_key
      if (!drawKey || typeof drawKey !== "string") return bad(res, "Cần draw_key")

      const result = await sessionRepo.drawForSession(Number(req.params.sessionId), { drawKey })
      res.json({
        prize: result.prize,
        turns_used: result.turnsUsed,
        turns_total: result.turnsTotal,
        session_completed: result.sessionCompleted,
      })
    } catch (err) {
      if (err instanceof sessionRepo.GachaSessionNotFoundError) return res.status(404).json({ error: "not_found", message: err.message })
      if (err instanceof sessionRepo.GachaSessionCompleteError) return res.status(409).json({ error: "session_complete", message: err.message })
      oops(res, err, "Lỗi quay gacha")
    }
  })

  return router
}
```

- [ ] **Step 4: Mount the router and add a draw rate limiter in `server.js`**

Add near the other limiters (after `proofLimiter`, before `globalLimiter`):

```js
// Gacha draw: 60/min per IP. A real festival session taps this fast (one
// per spin), but a scripted rapid-fire probe for the row-lock race window
// still needs a ceiling independent of the general admin/public limiters.
const gachaDrawLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyGen,
  store: makeStore("rl:gacha-draw:"),
  handler: (req, res) => {
    console.warn(`[RATE LIMIT] Gacha draw IP ${keyGen(req)} bị chặn`)
    res.status(429).json({ error: "too_many_requests", message: "Quá nhiều lượt quay. Thử lại sau." })
  },
})

// Gacha practice: 30/min per IP - unlimited free spins still need a ceiling
// against a scripted hammer, even though each one is cheap (no DB write).
const gachaPracticeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyGen,
  store: makeStore("rl:gacha-practice:"),
  handler: (req, res) => {
    res.status(429).json({ error: "too_many_requests", message: "Quá nhiều yêu cầu. Thử lại sau." })
  },
})
```

Mount, near the other `admin` routers:

```js
app.use(`${API_PREFIX}/admin`, auth, require("./routes/adminGacha")())
```

Apply `gachaDrawLimiter` ahead of the admin router for just the draw path (mirrors the existing `PROOF_PATH` pattern):

```js
const GACHA_DRAW_PATH = /^\/gacha-sessions\/\d+\/draw$/
app.use(`${API_PREFIX}/admin`, (req, res, next) => {
  if (req.method === "POST" && GACHA_DRAW_PATH.test(req.path)) return gachaDrawLimiter(req, res, next)
  return next()
})
```//
Place this line immediately **before** the `app.use(\`${API_PREFIX}/admin\`, auth, require("./routes/adminGacha")())` mount line, so the limiter runs ahead of admin auth for that one path (rate limiting by IP is still meaningful pre-auth; it protects the row-lock regardless of who's calling).

`gachaPracticeLimiter` is wired in Task 10 alongside the practice route itself.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/adminGachaRoutes.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd backend
git add routes/adminGacha.js server.js tests/adminGachaRoutes.test.js
git commit -m "feat(gacha): add admin prize editor and booth kiosk routes"
```

---

### Task 9: Buyer-facing online session + draw routes

**Files:**
- Modify: `backend/routes/orders.js`
- Modify: `backend/server.js` (draw rate limiter on this path too)
- Test: `backend/tests/gachaOrderRoutes.test.js`

**Interfaces:**
- Consumes: `shop/gacha/sessionRepo.js` (Task 4), existing `orderAccess` middleware (`shop/orders/orderAccess.js`).
- Produces HTTP (both behind `orderAccess`, mounted under the existing `/api/orders` router):
  - `GET /api/orders/:token/gacha-session` → `{ session, drops } | { session: null }`
  - `POST /api/orders/:token/gacha-session/draw` → same shape as the admin draw route
- Also modifies the existing `POST /api/orders/` handler's `catch` block to map the three new `orderRepo` error classes from Task 5 to HTTP responses.

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/gachaOrderRoutes.test.js
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import express from "express"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import prizeRepo from "../shop/gacha/prizeRepo.js"
import orderRepo from "../shop/orders/orderRepo.js"
import orderRoutes from "../routes/orders.js"
import { resetTables, closeDb } from "./helpers/db.js"

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use("/api/orders", orderRoutes())
  return app
}

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "1 X, Q1, TP.HCM" }

async function seedConfirmedGachaOrder(turns = 2, prizeQty = 10) {
  const cid = await catalog.createCollection({ title: "Gacha Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
  await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: prizeQty }])
  const detail = await catalog.getCollectionDetailById(cid)
  const variantId = detail.products[0].variant_id
  const order = await orderRepo.createOrder({
    items: [{ variant_id: variantId, qty: turns }], buyer, payment_method: "bank", fulfillment_method: "ship",
  })
  await orderRepo.transitionOrder(order.id, "confirmed")
  return { token: order.order_token, orderId: order.id, accessToken: order.access_pin ? null : null }
}

beforeEach(async () => {
  await resetTables("gacha_draws", "gacha_sessions", "gacha_prizes", "order_items", "orders", "product_variants", "products", "collections")
})

afterAll(closeDb)

describe("GET /:token/gacha-session", () => {
  it("401s without a PIN/admin session", async () => {
    const { token } = await seedConfirmedGachaOrder()
    const res = await request(makeApp()).get(`/api/orders/${token}/gacha-session`)
    expect(res.status).toBe(401)
  })
})

describe("POST /:token/gacha-session/draw", () => {
  it("draws for the buyer's own confirmed session using the admin bypass", async () => {
    const jwt = require("jsonwebtoken")
    const { token } = await seedConfirmedGachaOrder(1)
    const adminJwt = jwt.sign({ role: "admin" }, process.env.JWT_SECRET, { algorithm: "HS256" })

    const res = await request(makeApp())
      .post(`/api/orders/${token}/gacha-session/draw`)
      .set("Authorization", `Bearer ${adminJwt}`)
      .send({ draw_key: "tap-1" })
    expect(res.status).toBe(200)
    expect(res.body.prize.name).toBe("Sticker")
  })
})
```

(This mirrors `orderRoutes.test.js`'s existing convention for exercising `orderAccess`-gated routes with the admin-JWT bypass — check that file for whether it imports `jsonwebtoken` at the top already and match that instead of a mid-test `require`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/gachaOrderRoutes.test.js`
Expected: FAIL — routes don't exist yet (404s instead of 401/200).

- [ ] **Step 3: Modify `routes/orders.js`**

Add near the top requires:

```js
const sessionRepo = require("../shop/gacha/sessionRepo")
```

Add two new routes, placed after the existing `router.get("/:token", orderAccess, ...)` route:

```js
  router.get("/:token/gacha-session", orderAccess, async (req, res) => {
    try {
      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      const session = await sessionRepo.getSessionByOrderId(order.id)
      if (!session) return res.json({ session: null, drops: [] })
      const drops = await sessionRepo.getDropsForSession(session.id)
      res.json({ session, drops })
    } catch (err) {
      console.error("[ORDERS] Lỗi đọc phiên gacha:", err.message)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.post("/:token/gacha-session/draw", orderAccess, async (req, res) => {
    try {
      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      const session = await sessionRepo.getSessionByOrderId(order.id)
      if (!session) return res.status(404).json({ error: "not_found", message: "Không tìm thấy phiên quay" })

      const drawKey = req.body.draw_key
      if (!drawKey || typeof drawKey !== "string") {
        return res.status(400).json({ error: "invalid_input", message: "Cần draw_key" })
      }

      const result = await sessionRepo.drawForSession(session.id, { drawKey })
      res.json({
        prize: result.prize,
        turns_used: result.turnsUsed,
        turns_total: result.turnsTotal,
        session_completed: result.sessionCompleted,
      })
    } catch (err) {
      if (err instanceof sessionRepo.GachaSessionCompleteError) {
        return res.status(409).json({ error: "session_complete", message: err.message })
      }
      console.error("[ORDERS] Lỗi quay gacha:", err.message)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })
```

In the existing `POST /` handler's `catch` block, alongside the existing `if (err instanceof repo.NoCodForDigitalError) ...` line, add:

```js
      if (err instanceof repo.NoCodForGachaError) return bad(res, err.message)
      if (err instanceof repo.MixedGachaCartError) return bad(res, err.message)
      if (err instanceof repo.GachaPoolSoldOutError) return res.status(409).json({ error: "gacha_sold_out", message: err.message })
```

- [ ] **Step 4: Add the gacha draw rate limiter to the `/api/orders` mount in `server.js`**

Modify the existing dispatcher in `server.js`:

```js
const PROOF_PATH = /^\/[^/]+\/proof$/
// Named distinctly from Task 8's admin-side GACHA_DRAW_PATH - both consts
// live in this same server.js module scope, so they can't share a name.
const GACHA_ORDER_DRAW_PATH = /^\/[^/]+\/gacha-session\/draw$/
app.use(`${API_PREFIX}/orders`, (req, res, next) => {
  if (req.method === "POST" && PROOF_PATH.test(req.path)) return proofLimiter(req, res, next)
  if (req.method === "POST" && GACHA_ORDER_DRAW_PATH.test(req.path)) return gachaDrawLimiter(req, res, next)
  if (req.method === "POST") return orderLimiter(req, res, next)
  return publicLimiter(req, res, next)
},
  require("./routes/orders")())
```

(`gachaDrawLimiter` was defined in Task 8 — this reuses the same limiter instance across both the admin-booth and buyer-online draw paths, since they're the same class of action. Task 8's own `GACHA_DRAW_PATH` const stays as-is; this step just picks a different name for the second one to avoid a duplicate-`const` error in `server.js`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/gachaOrderRoutes.test.js`
Expected: PASS

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
cd backend
git add routes/orders.js server.js tests/gachaOrderRoutes.test.js
git commit -m "feat(gacha): add buyer-facing online session status/draw routes"
```

---

### Task 10: Public practice-mode routes

**Files:**
- Modify: `backend/routes/shop.js`
- Modify: `backend/server.js` (mount practice limiter)
- Test: `backend/tests/shopGachaPracticeRoute.test.js`

**Interfaces:**
- Consumes: `shop/gacha/prizeRepo.js`, `shop/gacha/sessionRepo.js` (Tasks 3-4).
- Produces HTTP (public, no auth, under the existing `/api/shop` router):
  - `GET /api/shop/gacha/:productId/practice` → `{ prizes, tier_odds }`
  - `POST /api/shop/gacha/:productId/practice-draw` → `{ prize }`

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/shopGachaPracticeRoute.test.js
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import express from "express"
import catalog from "../shop/catalogRepo.js"
import prizeRepo from "../shop/gacha/prizeRepo.js"
import shopRoutes from "../routes/shop.js"
import { resetTables, closeDb } from "./helpers/db.js"

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use("/api/shop", shopRoutes())
  return app
}

beforeEach(async () => {
  await resetTables("gacha_draws", "gacha_sessions", "gacha_prizes", "order_items", "orders", "product_variants", "products", "collections")
})

afterAll(closeDb)

describe("GET /gacha/:productId/practice", () => {
  it("returns the prize list and live tier odds with no auth", async () => {
    const cid = await catalog.createCollection({ title: "Gacha Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
    await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }])

    const res = await request(makeApp()).get(`/api/shop/gacha/${pid}/practice`)
    expect(res.status).toBe(200)
    expect(res.body.prizes).toHaveLength(1)
    expect(res.body.tier_odds[0].rate).toBe(1)
  })
})

describe("POST /gacha/:productId/practice-draw", () => {
  it("draws without touching quantity_remaining", async () => {
    const cid = await catalog.createCollection({ title: "Gacha Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
    await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }])

    const res = await request(makeApp()).post(`/api/shop/gacha/${pid}/practice-draw`)
    expect(res.status).toBe(200)
    expect(res.body.prize.name).toBe("Sticker")

    const rows = await prizeRepo.listPrizes(pid)
    expect(rows[0].quantity_remaining).toBe(10)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/shopGachaPracticeRoute.test.js`
Expected: FAIL — routes don't exist (404).

- [ ] **Step 3: Modify `routes/shop.js`**

Add near the top requires:

```js
const prizeRepo = require("../shop/gacha/prizeRepo")
const sessionRepo = require("../shop/gacha/sessionRepo")
const gachaDomain = require("../shop/gacha/domain")
```

Add two routes inside the exported router function:

```js
  router.get("/gacha/:productId/practice", async (req, res) => {
    try {
      const prizes = await prizeRepo.listPrizes(Number(req.params.productId))
      res.json({ prizes, tier_odds: gachaDomain.tierOdds(prizes) })
    } catch (err) {
      console.error("[SHOP] Lỗi đọc gacha demo:", err.message)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.post("/gacha/:productId/practice-draw", async (req, res) => {
    try {
      const result = await sessionRepo.practiceDraw(Number(req.params.productId))
      res.json({ prize: result.prize })
    } catch (err) {
      console.error("[SHOP] Lỗi quay demo:", err.message)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })
```

(Match the exact router-export shape `routes/shop.js` already uses — check its top/bottom before inserting; every other route file in this codebase exports a `function xRoutes() { const router = express.Router(); ...; return router }`, so these two blocks go inside that same function body.)

- [ ] **Step 4: Wire `gachaPracticeLimiter` in `server.js`**

```js
const GACHA_PRACTICE_DRAW_PATH = /^\/gacha\/\d+\/practice-draw$/
app.use(`${API_PREFIX}/shop`, (req, res, next) => {
  if (req.method === "POST" && GACHA_PRACTICE_DRAW_PATH.test(req.path)) return gachaPracticeLimiter(req, res, next)
  return next()
})
```

Place this immediately **before** the existing `app.use(\`${API_PREFIX}/shop\`, publicLimiter, require("./routes/shop")())` line, so `gachaPracticeLimiter` (30/min) binds ahead of the general `publicLimiter` (120/min) for just this one path — same layering the existing `addressLimiter` uses.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/shopGachaPracticeRoute.test.js`
Expected: PASS

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, no regressions. This is the last backend task — this run should be green across the whole suite.

- [ ] **Step 7: Commit**

```bash
cd backend
git add routes/shop.js server.js tests/shopGachaPracticeRoute.test.js
git commit -m "feat(gacha): add public practice-mode routes"
```

---

### Task 11: Frontend gacha API client

**Files:**
- Create: `frontend/src/shop/gacha/api.js`
- Test: `frontend/src/shop/gacha/api.test.js`

**Interfaces:**
- Consumes: `frontend/src/api/api.js`'s shared `api` axios instance, `frontend/src/utils/orderAuth.js`'s `orderAuthHeaders`.
- Produces (consumed by Tasks 12-16):
  - `fetchPracticePrizes(productId)`, `practiceDraw(productId)`
  - `fetchGachaSession(token)`, `drawGachaSession(token, drawKey)`
  - `adminFetchPrizes(productId)`, `adminSavePrizes(productId, prizes)`
  - `adminStartBoothSession(productId, { buyerName, turnsTotal })`
  - `adminFetchSession(sessionId)`, `adminDrawSession(sessionId, drawKey)`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/shop/gacha/api.test.js
import { describe, it, expect, vi, beforeEach } from "vitest"
import api from "../../api/api"
import { fetchPracticePrizes, practiceDraw, drawGachaSession } from "./api"

vi.mock("../../api/api", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))

beforeEach(() => { vi.clearAllMocks() })

describe("fetchPracticePrizes", () => {
  it("GETs the practice endpoint for the given product", async () => {
    api.get.mockResolvedValue({ data: { prizes: [], tier_odds: [] } })
    const result = await fetchPracticePrizes(42)
    expect(api.get).toHaveBeenCalledWith("/api/shop/gacha/42/practice")
    expect(result.prizes).toEqual([])
  })
})

describe("practiceDraw", () => {
  it("POSTs to the practice-draw endpoint", async () => {
    api.post.mockResolvedValue({ data: { prize: { name: "Sticker" } } })
    const result = await practiceDraw(42)
    expect(api.post).toHaveBeenCalledWith("/api/shop/gacha/42/practice-draw")
    expect(result.prize.name).toBe("Sticker")
  })
})

describe("drawGachaSession", () => {
  it("POSTs the draw_key with order auth headers", async () => {
    api.post.mockResolvedValue({ data: { prize: { name: "Sticker" }, turns_used: 1, turns_total: 3, session_completed: false } })
    const result = await drawGachaSession("tok123", "tap-1")
    expect(api.post).toHaveBeenCalledWith(
      "/api/orders/tok123/gacha-session/draw",
      { draw_key: "tap-1" },
      expect.objectContaining({ headers: expect.any(Object) })
    )
    expect(result.turns_used).toBe(1)
  })
})
```

(Check `frontend/src/api/api.js`'s actual default export shape before writing the mock — some existing frontend api modules export a plain object of functions rather than wrapping the axios instance directly; match whatever `frontend/src/shop/*` already imports for its own HTTP calls, e.g. how `Order.jsx`'s `fetchOrder`/`uploadPaymentProof` are implemented, so this module's calling convention isn't a new pattern in the codebase.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/shop/gacha/api.test.js`
Expected: FAIL with "Cannot find module './api'"

- [ ] **Step 3: Write the implementation**

```js
// frontend/src/shop/gacha/api.js
import api from "../../api/api"
import { orderAuthHeaders } from "../../utils/orderAuth"

export async function fetchPracticePrizes(productId) {
  const { data } = await api.get(`/api/shop/gacha/${productId}/practice`)
  return data
}

export async function practiceDraw(productId) {
  const { data } = await api.post(`/api/shop/gacha/${productId}/practice-draw`)
  return data
}

export async function fetchGachaSession(token) {
  const { data } = await api.get(`/api/orders/${token}/gacha-session`, { headers: orderAuthHeaders(token) })
  return data
}

export async function drawGachaSession(token, drawKey) {
  const { data } = await api.post(
    `/api/orders/${token}/gacha-session/draw`,
    { draw_key: drawKey },
    { headers: orderAuthHeaders(token) }
  )
  return data
}

export async function adminFetchPrizes(productId) {
  const { data } = await api.get(`/api/admin/gacha-products/${productId}/prizes`)
  return data
}

export async function adminSavePrizes(productId, prizes) {
  const { data } = await api.put(`/api/admin/gacha-products/${productId}/prizes`, { prizes })
  return data
}

export async function adminStartBoothSession(productId, { buyerName, turnsTotal }) {
  const { data } = await api.post(`/api/admin/gacha-products/${productId}/booth-sessions`, {
    buyer_name: buyerName || null,
    turns_total: turnsTotal,
  })
  return data
}

export async function adminFetchSession(sessionId) {
  const { data } = await api.get(`/api/admin/gacha-sessions/${sessionId}`)
  return data
}

export async function adminDrawSession(sessionId, drawKey) {
  const { data } = await api.post(`/api/admin/gacha-sessions/${sessionId}/draw`, { draw_key: drawKey })
  return data
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/shop/gacha/api.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/shop/gacha/api.js src/shop/gacha/api.test.js
git commit -m "feat(gacha): add frontend API client for gacha endpoints"
```

---

### Task 12: `GachaMachine` shared component (reel, spin, reveal)

**Files:**
- Create: `frontend/src/shop/gacha/GachaMachine.jsx`
- Create: `frontend/src/shop/gacha/reelMechanics.js` (pure geometry/timing, ported from the export)
- Test: `frontend/src/shop/gacha/reelMechanics.test.js`
- Test: `frontend/src/shop/gacha/GachaMachine.test.jsx`

**Interfaces:**
- Consumes: nothing external — takes a caller-supplied async `drawFn`.
- Produces: `<GachaMachine prizes turnsTotal turnsUsed drawFn onDrawResult onSessionComplete />`, consumed by Tasks 13-16 (`Order.jsx`, `GachaKiosk.jsx`, `GachaPractice.jsx`).
  - `drawFn: () => Promise<{ prize, turns_used, turns_total, session_completed }>` — the only way the component learns a result; it never invents one itself.
  - `pure reelMechanics.js` exports: `cardWidthFor(viewportWidth)`, `spinProfile()`, `stopFraction()`, `spinProgress(p, friction)` — same names/behavior as the exported mockup's `cardFor`/`spinProfile`/`stopFraction`/`spinProgress`.

- [ ] **Step 1: Write the failing pure-logic test**

```js
// frontend/src/shop/gacha/reelMechanics.test.js
import { describe, it, expect } from "vitest"
import { cardWidthFor, spinProgress } from "./reelMechanics"

describe("cardWidthFor", () => {
  it("uses the narrow card width under 640px, the wide one at/above it", () => {
    expect(cardWidthFor(400)).toBe(150)
    expect(cardWidthFor(639)).toBe(150)
    expect(cardWidthFor(640)).toBe(240)
    expect(cardWidthFor(1200)).toBe(240)
  })
})

describe("spinProgress", () => {
  it("is 0 at p=0 and 1 at p=1 regardless of friction", () => {
    expect(spinProgress(0, 2.7)).toBe(0)
    expect(spinProgress(1, 2.7)).toBeCloseTo(1, 10)
  })

  it("clamps p to [0,1]", () => {
    expect(spinProgress(-1, 2.7)).toBe(0)
    expect(spinProgress(2, 2.7)).toBeCloseTo(1, 10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/shop/gacha/reelMechanics.test.js`
Expected: FAIL with "Cannot find module './reelMechanics'"

- [ ] **Step 3: Write `reelMechanics.js`**

```js
// frontend/src/shop/gacha/reelMechanics.js
// Timing/geometry ported verbatim from the exported mockup
// (Concept B - Case Reel.dc.html's cardFor/spinProfile/stopFraction/spinProgress) -
// purely cosmetic reel animation, has no bearing on the actual draw result
// (which is decided server-side before the reel even starts spinning; see
// GachaMachine.jsx).
export function cardWidthFor(viewportWidth) {
  return viewportWidth < 640 ? 150 : 240
}

export function spinProfile() {
  return {
    durationMs: 7500 + Math.floor(Math.random() * 2001),
    tiles: 30 + Math.floor(Math.random() * 11),
    friction: 2.7 + Math.random() * 0.6,
  }
}

export function stopFraction() {
  return (Math.floor(Math.random() * 81) + 10) / 100
}

export function spinProgress(p, friction) {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, p)), friction)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/shop/gacha/reelMechanics.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing `GachaMachine` test**

```jsx
// frontend/src/shop/gacha/GachaMachine.test.jsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import GachaMachine from "./GachaMachine"

const prizes = [{ id: 1, name: "Sticker", tier: "common", image_url: null, display_price: 5000, quantity_remaining: 10 }]

describe("GachaMachine", () => {
  it("calls drawFn when the spin button is pressed, and shows the result", async () => {
    const drawFn = vi.fn().mockResolvedValue({
      prize: { id: 1, name: "Sticker", tier: "common", display_price: 5000 },
      turns_used: 1, turns_total: 3, session_completed: false,
    })
    render(<GachaMachine prizes={prizes} turnsTotal={3} turnsUsed={0} drawFn={drawFn} />)

    fireEvent.click(screen.getByRole("button", { name: /mở hộp|open case/i }))
    await waitFor(() => expect(drawFn).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText("Sticker")).toBeInTheDocument())
  })

  it("disables the spin button once turnsUsed reaches turnsTotal", () => {
    render(<GachaMachine prizes={prizes} turnsTotal={1} turnsUsed={1} drawFn={vi.fn()} />)
    expect(screen.getByRole("button", { name: /mở hộp|open case|hết lượt|no turns/i })).toBeDisabled()
  })

  it("never calls drawFn twice for one click while a draw is in flight", async () => {
    let resolveDraw
    const drawFn = vi.fn(() => new Promise((resolve) => { resolveDraw = resolve }))
    render(<GachaMachine prizes={prizes} turnsTotal={3} turnsUsed={0} drawFn={drawFn} />)

    const button = screen.getByRole("button", { name: /mở hộp|open case/i })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    expect(drawFn).toHaveBeenCalledTimes(1)
    resolveDraw({ prize: { id: 1, name: "Sticker", tier: "common", display_price: 5000 }, turns_used: 1, turns_total: 3, session_completed: false })
    await waitFor(() => expect(screen.getByText("Sticker")).toBeInTheDocument())
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/shop/gacha/GachaMachine.test.jsx`
Expected: FAIL with "Cannot find module './GachaMachine'"

- [ ] **Step 7: Write `GachaMachine.jsx`**

```jsx
// frontend/src/shop/gacha/GachaMachine.jsx
import { useEffect, useRef, useState } from "react"
import { cardWidthFor, spinProfile, stopFraction, spinProgress } from "./reelMechanics"

const TIER_COLOR = { common: "#E6E6E6", rare: "#3E8BFF", epic: "#A855F7", legendary: "#E4383A", ancient: "#E8B62C" }

function randomPrize(prizes) {
  return prizes[Math.floor(Math.random() * prizes.length)]
}

function buildReel(prizes, winner, count) {
  const cells = []
  for (let i = 0; i < count; i++) {
    cells.push(winner && i === count - 4 ? winner : randomPrize(prizes))
  }
  return cells
}

/**
 * Shared reel/reveal UI for the buyer order page, the booth kiosk, and the
 * practice page. Never decides a draw's outcome itself - drawFn (owned by
 * the caller) is the one and only source of the winning prize; this
 * component's entire job is to animate toward whatever drawFn resolves
 * with. See the design's Anti-cheat section for why this split matters.
 */
export default function GachaMachine({ prizes, turnsTotal, turnsUsed: initialTurnsUsed, drawFn, onSessionComplete }) {
  const [turnsUsed, setTurnsUsed] = useState(initialTurnsUsed)
  const [spinning, setSpinning] = useState(false)
  const [reel, setReel] = useState(() => buildReel(prizes, null, 14))
  const [result, setResult] = useState(null)
  const viewRef = useRef(null)
  const trackRef = useRef(null)
  const cw = useRef(cardWidthFor(typeof window !== "undefined" ? window.innerWidth : 900))

  useEffect(() => {
    if (!spinning) setReel(buildReel(prizes, null, 14))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prizes])

  const turnsLeft = turnsTotal - turnsUsed
  const disabled = spinning || turnsLeft <= 0

  async function handleSpin() {
    if (disabled) return
    setSpinning(true)
    setResult(null)

    let response
    try {
      response = await drawFn()
    } catch (err) {
      setSpinning(false)
      return
    }

    const winner = response.prize
    const profile = spinProfile()
    const winIndex = profile.tiles
    const count = winIndex + 4
    setReel(buildReel(prizes, winner, count))

    requestAnimationFrame(() => {
      const width = viewRef.current ? viewRef.current.clientWidth : 900
      const stepPx = cw.current + 14
      const end = width / 2 - cw.current * stopFraction() - winIndex * stepPx
      let t0 = 0
      const step = (now) => {
        if (!t0) t0 = now
        const p = Math.min(1, (now - t0) / profile.durationMs)
        const eased = spinProgress(p, profile.friction)
        const x = end * eased
        if (trackRef.current) trackRef.current.style.transform = `translate3d(${x}px,0,0)`
        if (p < 1) {
          requestAnimationFrame(step)
          return
        }
        setSpinning(false)
        setResult(winner)
        setTurnsUsed(response.turns_used)
        if (response.session_completed && onSessionComplete) onSessionComplete()
      }
      requestAnimationFrame(step)
    })
  }

  return (
    <div>
      <div ref={viewRef} style={{ position: "relative", height: 180, overflow: "hidden" }}>
        <div ref={trackRef} style={{ position: "absolute", top: 0, left: 0, height: "100%", willChange: "transform" }}>
          {reel.map((cell, i) => (
            <div
              key={i}
              style={{ position: "absolute", top: 0, height: 180, width: cw.current, left: i * (cw.current + 14) }}
            >
              <div style={{ borderBottom: `7px solid ${TIER_COLOR[cell.tier] || "#E6E6E6"}` }}>{cell.name}</div>
            </div>
          ))}
        </div>
      </div>

      <button type="button" onClick={handleSpin} disabled={disabled}>
        {spinning ? "Đang mở…" : turnsLeft <= 0 ? "Hết lượt" : "Mở hộp"}
      </button>

      {result && (
        <div role="dialog" aria-label="Kết quả">
          <div style={{ color: TIER_COLOR[result.tier] || "#E6E6E6" }}>{result.tier}</div>
          <div>{result.name}</div>
          <div>{result.display_price}đ</div>
        </div>
      )}
    </div>
  )
}
```

(Visual polish — fonts, gradients, sweep/flash animations, the "what's in the case" side panel — is intentionally left minimal here to keep this task's scope to the *mechanics*; a follow-up styling pass can layer in the mockup's exact look using the ported CSS from `Concept B - Case Reel.dc.html` without touching this component's logic/props contract.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/shop/gacha/GachaMachine.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
cd frontend
git add src/shop/gacha/reelMechanics.js src/shop/gacha/reelMechanics.test.js src/shop/gacha/GachaMachine.jsx src/shop/gacha/GachaMachine.test.jsx
git commit -m "feat(gacha): add shared GachaMachine reel/reveal component"
```

---

### Task 13: Order page gacha section

**Files:**
- Modify: `frontend/src/pages/Order.jsx`
- Test: `frontend/src/pages/Order.test.jsx` (add case)

**Interfaces:**
- Consumes: `shop/gacha/api.js` (`fetchGachaSession`, `drawGachaSession`), `shop/gacha/GachaMachine.jsx` (Tasks 11-12).
- Produces: a new section on the order page, gated on the fetched session existing (mirrors the existing digital-delivery-link gating pattern already in this file).

- [ ] **Step 1: Write the failing test**

```jsx
// Add to frontend/src/pages/Order.test.jsx
import { fetchGachaSession, drawGachaSession } from "../shop/gacha/api"
vi.mock("../shop/gacha/api")

it("shows the gacha machine when the order has an active session", async () => {
  fetchGachaSession.mockResolvedValue({
    session: { id: 1, turns_total: 3, turns_used: 1, status: "active" },
    drops: [],
  })
  // ... render Order.jsx with a mocked confirmed order, same setup this file's other tests already use ...
  await waitFor(() => expect(screen.getByRole("button", { name: /mở hộp|open case/i })).toBeInTheDocument())
})
```

(Check `Order.test.jsx`'s existing mock setup for `fetchOrder`/order fixture shape before writing this — it must reuse whatever confirmed-order fixture the file's other tests already build, not invent a new one.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/Order.test.jsx -t "gacha"`
Expected: FAIL — no gacha section rendered yet.

- [ ] **Step 3: Modify `Order.jsx`**

Add imports:

```js
import { fetchGachaSession, drawGachaSession } from "../shop/gacha/api"
import GachaMachine from "../shop/gacha/GachaMachine"
```

Add state + effect (placed alongside the existing order-detail fetch effect):

```js
const [gachaSession, setGachaSession] = useState(null)

useEffect(() => {
  if (!order || !["confirmed", "shipped", "completed"].includes(order.status)) return
  fetchGachaSession(token).then((data) => setGachaSession(data.session)).catch(() => {})
}, [order, token])
```

Add the render section (placed near the existing digital-delivery-link block, so both "extra content this order unlocks" sections live together):

```jsx
{gachaSession && gachaSession.status === "active" && (
  <section>
    <h2>Mở hộp gacha</h2>
    <GachaMachine
      prizes={[]}
      turnsTotal={gachaSession.turns_total}
      turnsUsed={gachaSession.turns_used}
      drawFn={() => drawGachaSession(token, crypto.randomUUID())}
      onSessionComplete={() => setGachaSession((s) => ({ ...s, status: "completed" }))}
    />
  </section>
)}
```

(`prizes={[]}` is a placeholder for the reel's random filler cells only — the real prize list for display purposes, if wanted here, would come from a follow-up fetch of the product's public prize list; out of scope for this task, which focuses on wiring the draw itself. `crypto.randomUUID()` gives each tap a fresh idempotency key, matching `sessionRepo.drawForSession`'s `drawKey` contract from Task 4.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/Order.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/pages/Order.jsx src/pages/Order.test.jsx
git commit -m "feat(gacha): render the gacha machine on the buyer's order page"
```

---

### Task 14: Booth kiosk page (Staff Panel + machine)

**Files:**
- Create: `frontend/src/pages/GachaKiosk.jsx`
- Modify: `frontend/src/App.jsx` (route)
- Test: `frontend/src/pages/GachaKiosk.test.jsx`

**Interfaces:**
- Consumes: `shop/gacha/api.js` (`adminStartBoothSession`, `adminFetchSession`, `adminDrawSession`), `shop/gacha/GachaMachine.jsx`, `utils/orderAuth.js` (`hasAdminSession`).
- Produces: route `/admin/gacha/:productId/kiosk`.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/GachaKiosk.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import GachaKiosk from "./GachaKiosk"
import { adminStartBoothSession, adminFetchSession, adminDrawSession } from "../shop/gacha/api"
import { hasAdminSession } from "../utils/orderAuth"

vi.mock("../shop/gacha/api")
vi.mock("../utils/orderAuth", () => ({ hasAdminSession: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

function renderKiosk() {
  return render(
    <MemoryRouter initialEntries={["/admin/gacha/1/kiosk"]}>
      <Routes><Route path="/admin/gacha/:productId/kiosk" element={<GachaKiosk />} /></Routes>
    </MemoryRouter>
  )
}

it("redirects to /admin when there is no admin session", () => {
  hasAdminSession.mockReturnValue(false)
  renderKiosk()
  expect(screen.queryByText(/bắt đầu phiên|start session/i)).not.toBeInTheDocument()
})

it("starts a booth session and shows the machine", async () => {
  hasAdminSession.mockReturnValue(true)
  adminStartBoothSession.mockResolvedValue({ session_id: 5, order_id: 9, order_token: "tok" })
  renderKiosk()

  fireEvent.click(screen.getByRole("button", { name: /bắt đầu phiên|start session/i }))
  await waitFor(() => expect(adminStartBoothSession).toHaveBeenCalledWith(1, expect.any(Object)))
  await waitFor(() => expect(screen.getByRole("button", { name: /mở hộp|open case/i })).toBeInTheDocument())
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/GachaKiosk.test.jsx`
Expected: FAIL with "Cannot find module './GachaKiosk'"

- [ ] **Step 3: Write `GachaKiosk.jsx`**

```jsx
// frontend/src/pages/GachaKiosk.jsx
import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { adminStartBoothSession, adminDrawSession } from "../shop/gacha/api"
import { hasAdminSession } from "../utils/orderAuth"
import GachaMachine from "../shop/gacha/GachaMachine"

/**
 * Staff logs into /admin once at the start of the festival day; this page
 * reuses that same admin session for the whole kiosk flow (no separate
 * scoped device token - see the design's Anti-cheat section for why that
 * tradeoff was made deliberately). The buyer only ever touches the "Start
 * session" screen and the machine below it, never anything else in /admin.
 */
export default function GachaKiosk() {
  const { productId } = useParams()
  const navigate = useNavigate()
  const [buyerName, setBuyerName] = useState("")
  const [turnsTotal, setTurnsTotal] = useState(5)
  const [session, setSession] = useState(null)

  if (!hasAdminSession()) {
    navigate("/admin")
    return null
  }

  async function handleStart() {
    const result = await adminStartBoothSession(Number(productId), { buyerName, turnsTotal })
    setSession({ id: result.session_id, turnsTotal, turnsUsed: 0 })
  }

  function handleNextBuyer() {
    setSession(null)
    setBuyerName("")
    setTurnsTotal(5)
  }

  if (!session) {
    return (
      <div>
        <h1>Bảng nhân viên</h1>
        <input
          value={buyerName}
          onChange={(e) => setBuyerName(e.target.value)}
          placeholder="Tên khách (tùy chọn)"
        />
        <input
          type="number"
          min={1}
          value={turnsTotal}
          onChange={(e) => setTurnsTotal(Math.max(1, Number(e.target.value) || 1))}
        />
        <button type="button" onClick={handleStart}>Bắt đầu phiên</button>
      </div>
    )
  }

  return (
    <div>
      <GachaMachine
        prizes={[]}
        turnsTotal={session.turnsTotal}
        turnsUsed={session.turnsUsed}
        drawFn={() => adminDrawSession(session.id, crypto.randomUUID())}
        onSessionComplete={handleNextBuyer}
      />
      <button type="button" onClick={handleNextBuyer}>Khách tiếp theo</button>
    </div>
  )
}
```

- [ ] **Step 4: Add the route in `App.jsx`**

```jsx
<Route path="/admin/gacha/:productId/kiosk" element={<GachaKiosk />} />
```

(Add the corresponding `import GachaKiosk from "./pages/GachaKiosk"` at the top, alongside the other page imports.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/GachaKiosk.test.jsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/pages/GachaKiosk.jsx src/pages/GachaKiosk.test.jsx src/App.jsx
git commit -m "feat(gacha): add booth kiosk page (Staff Panel + machine)"
```

---

### Task 15: Admin prize editor

**Files:**
- Create: `frontend/src/components/AdminGachaPrizeEditor.jsx`
- Test: `frontend/src/components/AdminGachaPrizeEditor.test.jsx`

**Interfaces:**
- Consumes: `shop/gacha/api.js` (`adminFetchPrizes`, `adminSavePrizes`).
- Produces: `<AdminGachaPrizeEditor productId />`, to be embedded wherever the admin product edit form renders a gacha product (wiring that embedding point is left to whatever existing admin catalog page renders product-type-specific sub-editors — follow the same pattern already used for the existing variant editor there).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/components/AdminGachaPrizeEditor.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import AdminGachaPrizeEditor from "./AdminGachaPrizeEditor"
import { adminFetchPrizes, adminSavePrizes } from "../shop/gacha/api"

vi.mock("../shop/gacha/api")
beforeEach(() => vi.clearAllMocks())

it("loads and displays existing prizes", async () => {
  adminFetchPrizes.mockResolvedValue([
    { id: 1, name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10, quantity_remaining: 8 },
  ])
  render(<AdminGachaPrizeEditor productId={1} />)
  await waitFor(() => expect(screen.getByDisplayValue("Sticker")).toBeInTheDocument())
})

it("adds a new prize row and saves the full list", async () => {
  adminFetchPrizes.mockResolvedValue([])
  adminSavePrizes.mockResolvedValue({ ok: true })
  render(<AdminGachaPrizeEditor productId={1} />)

  fireEvent.click(await screen.findByRole("button", { name: /thêm phần thưởng|add prize/i }))
  fireEvent.change(screen.getByPlaceholderText(/tên phần thưởng|prize name/i), { target: { value: "Sticker" } })
  fireEvent.change(screen.getByLabelText(/số lượng|quantity/i), { target: { value: "10" } })
  fireEvent.click(screen.getByRole("button", { name: /lưu|save/i }))

  await waitFor(() => expect(adminSavePrizes).toHaveBeenCalledWith(1, [
    expect.objectContaining({ name: "Sticker", quantity_total: 10 }),
  ]))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/AdminGachaPrizeEditor.test.jsx`
Expected: FAIL with "Cannot find module './AdminGachaPrizeEditor'"

- [ ] **Step 3: Write `AdminGachaPrizeEditor.jsx`**

```jsx
// frontend/src/components/AdminGachaPrizeEditor.jsx
import { useEffect, useState } from "react"
import { adminFetchPrizes, adminSavePrizes } from "../shop/gacha/api"

const TIERS = ["common", "rare", "epic", "legendary", "ancient"]
const emptyRow = () => ({ name: "", tier: "common", display_price: 0, quantity_total: 1 })

export default function AdminGachaPrizeEditor({ productId }) {
  const [rows, setRows] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    adminFetchPrizes(productId).then(setRows).catch(() => setError("Không tải được danh sách phần thưởng"))
  }, [productId])

  function updateRow(index, field, value) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  function removeRow(index) {
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await adminSavePrizes(productId, rows.map((r) => ({
        ...r,
        display_price: Number(r.display_price) || 0,
        quantity_total: Number(r.quantity_total) || 0,
      })))
    } catch (err) {
      setError(err.response?.data?.message || "Lỗi lưu phần thưởng")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {rows.map((row, i) => (
        <div key={row.id ?? `new-${i}`}>
          <input
            placeholder="Tên phần thưởng"
            value={row.name}
            onChange={(e) => updateRow(i, "name", e.target.value)}
          />
          <select value={row.tier} onChange={(e) => updateRow(i, "tier", e.target.value)}>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label>
            Số lượng
            <input
              type="number"
              min={row.quantity_total - (row.quantity_remaining ?? row.quantity_total)}
              value={row.quantity_total}
              onChange={(e) => updateRow(i, "quantity_total", e.target.value)}
            />
          </label>
          <input
            type="number"
            min={0}
            value={row.display_price}
            onChange={(e) => updateRow(i, "display_price", e.target.value)}
          />
          <button type="button" onClick={() => removeRow(i)}>Xóa</button>
        </div>
      ))}

      <button type="button" onClick={() => setRows((prev) => [...prev, emptyRow()])}>Thêm phần thưởng</button>
      <button type="button" onClick={handleSave} disabled={saving}>Lưu</button>
      {error && <div role="alert">{error}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/AdminGachaPrizeEditor.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/components/AdminGachaPrizeEditor.jsx src/components/AdminGachaPrizeEditor.test.jsx
git commit -m "feat(gacha): add admin prize editor component"
```

---

### Task 16: Public practice page + routing + collection turn-stepper

**Files:**
- Create: `frontend/src/pages/GachaPractice.jsx`
- Modify: `frontend/src/App.jsx` (route)
- Test: `frontend/src/pages/GachaPractice.test.jsx`

**Interfaces:**
- Consumes: `shop/gacha/api.js` (`fetchPracticePrizes`, `practiceDraw`), `shop/gacha/GachaMachine.jsx`.
- Produces: route `/merchandise/gacha/:productId/try`.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/GachaPractice.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import GachaPractice from "./GachaPractice"
import { fetchPracticePrizes, practiceDraw } from "../shop/gacha/api"

vi.mock("../shop/gacha/api")
beforeEach(() => vi.clearAllMocks())

function renderPractice() {
  return render(
    <MemoryRouter initialEntries={["/merchandise/gacha/1/try"]}>
      <Routes><Route path="/merchandise/gacha/:productId/try" element={<GachaPractice />} /></Routes>
    </MemoryRouter>
  )
}

it("loads the practice prize list and allows unlimited free spins", async () => {
  fetchPracticePrizes.mockResolvedValue({ prizes: [{ id: 1, name: "Sticker", tier: "common", display_price: 5000, quantity_remaining: 10 }], tier_odds: [] })
  practiceDraw.mockResolvedValue({ prize: { id: 1, name: "Sticker", tier: "common", display_price: 5000 } })
  renderPractice()

  const button = await screen.findByRole("button", { name: /mở hộp|open case/i })
  fireEvent.click(button)
  await waitFor(() => expect(practiceDraw).toHaveBeenCalledWith(1))
  await waitFor(() => expect(screen.getByText("Sticker")).toBeInTheDocument())

  // Practice never runs out of turns.
  expect(button).not.toBeDisabled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/GachaPractice.test.jsx`
Expected: FAIL with "Cannot find module './GachaPractice'"

- [ ] **Step 3: Write `GachaPractice.jsx`**

```jsx
// frontend/src/pages/GachaPractice.jsx
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { fetchPracticePrizes, practiceDraw } from "../shop/gacha/api"
import GachaMachine from "../shop/gacha/GachaMachine"

// A very large ceiling, not "true" infinity - GachaMachine's turnsLeft math
// (turnsTotal - turnsUsed) needs a real number, and practice mode both
// resets turnsUsed to 0 on every successful draw (see onSessionComplete
// below - a session "completing" is not the point of practice mode) and
// never decrements any real stock, so this is a UI-only conceit, not a
// stand-in for a limit that matters.
const UNLIMITED_TURNS = 1_000_000

export default function GachaPractice() {
  const { productId } = useParams()
  const [prizes, setPrizes] = useState([])
  const [spinCount, setSpinCount] = useState(0)

  useEffect(() => {
    fetchPracticePrizes(productId).then((data) => setPrizes(data.prizes)).catch(() => {})
  }, [productId])

  return (
    <div>
      <h1>Thử miễn phí</h1>
      <GachaMachine
        prizes={prizes}
        turnsTotal={UNLIMITED_TURNS}
        turnsUsed={spinCount}
        drawFn={async () => {
          const result = await practiceDraw(Number(productId))
          return { prize: result.prize, turns_used: spinCount + 1, turns_total: UNLIMITED_TURNS, session_completed: false }
        }}
        onSessionComplete={() => setSpinCount((c) => c + 1)}
      />
    </div>
  )
}
```

- [ ] **Step 4: Add the route in `App.jsx`**

```jsx
<Route path="/merchandise/gacha/:productId/try" element={<GachaPractice />} />
```

(Add `import GachaPractice from "./pages/GachaPractice"` alongside the other page imports.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/GachaPractice.test.jsx`
Expected: PASS

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS, no regressions. This is the last frontend task — this run should be green across the whole suite.

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/pages/GachaPractice.jsx src/pages/GachaPractice.test.jsx src/App.jsx
git commit -m "feat(gacha): add public practice page and route"
```

---

## Self-Review Notes

- **Spec coverage:** Data model (Task 1), odds/live-weighting (Tasks 2, 4), online purchase-and-ship flow (Tasks 5, 6, 9, 13), booth-cash flow (Tasks 4, 8, 14), practice mode (Tasks 4, 10, 16), admin prize editor with quantity-history guard (Tasks 3, 8, 15), delete guard (Task 7), anti-cheat (server-authoritative draw in Task 4, idempotency in Task 4/8/9, rate limiting in Tasks 8-10) are all covered. Out-of-scope items from the spec (claim codes, scoped booth token, cross-product pools) are deliberately not implemented anywhere above.
- **Follow-up not included in this plan** (call out explicitly rather than silently drop): a full visual/audio port of the exported mockup's reel styling, sweep/flash animations, and "what's in the case" tier-odds side panel — Task 12 intentionally ships minimal styling to keep scope to mechanics; a follow-up design pass can layer in the mockup's CSS without touching `GachaMachine`'s props contract. Also not included: displaying the real prize list (vs. an empty filler array) on the buyer order page and booth kiosk reels (Tasks 13-14 pass `prizes={[]}`) — wiring a `GET` of the product's prize list into those two pages is a small, isolated follow-up once this plan's core mechanics are verified working end-to-end.
- **Type/name consistency check:** `sessionRepo.drawForSession`'s return shape (`{ prize, turnsUsed, turnsTotal, sessionCompleted, orderId }`) is used identically by both route handlers (Tasks 8-9) and mapped to the same `{ prize, turns_used, turns_total, session_completed }` HTTP shape both times, which `GachaMachine`'s `drawFn` contract (Task 12) expects verbatim in every caller (Tasks 13-14, 16 adapt practice's shape to match). `GachaPrizeQuantityError`, `GachaSoldOutError`, `GachaProductNotFoundError`, `GachaSessionNotFoundError`, `GachaSessionCompleteError`, `MixedGachaCartError`, `NoCodForGachaError`, `GachaPoolSoldOutError` are each defined exactly once and referenced by the same name everywhere they're caught.
