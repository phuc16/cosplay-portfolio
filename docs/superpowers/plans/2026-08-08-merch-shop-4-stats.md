# Merch Shop — Plan 4: Admin Statistics Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only "Thống kê" admin tab with three views — per-collection drop retrospective, cross-drop restock velocity, and a date-ranged bookkeeping view with CSV export — computed live from the existing `orders`/`order_items`/`product_variants` tables, with no new writes and no schema changes.

**Architecture:** Money classification (`received` / `awaiting_payment` / `to_collect` / `lost` / `other`) lives in one pure, exhaustively-tested module (`money.js`) keyed only on `(status, payment_method)`. `statsRepo.js` fetches the minimal order/item rows a view needs with a scoped, indexed SQL query (`WHERE collection_id = ?` or `WHERE created_at BETWEEN ...`) and reduces them in JavaScript using `classify()` from `money.js`. This is a deliberate divergence from "SQL only": duplicating the classification's five-way `(status × payment_method)` logic as a second, untested `CASE` expression in every query would let the two silently drift — the single worst failure mode for a money dashboard. Aggregations that don't depend on money classification (units sold per variant, order counts per status) use plain SQL `GROUP BY`. No rollup tables, no caching — see the spec's Architecture section for why.

**Tech Stack:** As Plans 1–3. No new npm packages, no new migrations — this phase is entirely new files plus one router mount and one Admin tab.

**Depends on:** Plans 1–3 complete, `feature/order` branch, HEAD includes commit `356d774` (order filters/bulk-cancel/timeline).

**Spec:** `docs/superpowers/specs/2026-08-08-admin-stats-dashboard-design.md` — read it before touching this plan; the Money Definitions and Edge Cases sections are the source of truth for every branch below.

## Global Constraints

- **Live aggregate queries only. No rollup tables. No caching.** A stats endpoint queries the real tables on every request. (Spec: Architecture.)
- **All money is integer VND.** Never introduce a float; sums are plain integer addition. (Spec: Money Definitions.)
- **Backend implementation files are CommonJS** (`module.exports` / `require`). **Test files are Vitest 3 ESM** (`import { describe, it, expect } from "vitest"`, `import x from "../y.js"` with the `.js` extension even though `y.js` is CommonJS — Vitest 3's default-import interop handles this). Vitest 3 refuses `require("vitest")` inside a test file.
- **Queries use the raw `mysql2` pool via `backend/db.js`** (`db.query(sql, params)` resolving to `[rows]` or `[rows, fields]` for a plain query, `[result]` with `.insertId`/`.affectedRows` for a write). **Knex is used only for migrations** — this phase needs no migration, since it reads existing tables only.
- **Admin routes live in `backend/routes/`, exported as a router-factory function** (`module.exports = function xRoutes() { ... return router }`), and are mounted in `backend/server.js` behind the existing `auth` middleware: `app.use(\`${API_PREFIX}/admin\`, auth, require("./routes/adminStats")())`.
- **The admin panel is hardcoded Vietnamese.** It has never used the i18n system (`frontend/src/i18n/translations.js`); only buyer-facing UI is bilingual. This phase adds **zero** translation keys.
- **Never invent a CSS variable.** The real tokens used throughout the admin panel include `--border-brand`, `--surface-card`, `--bg-page`, `--bg-sunken`, `--text-muted`, `--text-strong`, `--text-body`, `--radius-lg`, `--radius-md`. This project has shipped a non-existent `--bg-card` twice — grep `frontend/src` yourself before adding a new class if a task's JSX needs one not listed here. Every class used in this plan's JSX is plain Tailwind utilities (matching `AdminOrders.jsx`) plus `border-[var(--border-brand)]`, which is the one custom-property class the existing admin components actually use.
- **Test DB commands:** `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`. Frontend: `cd frontend && npm test && npm run build && npm run lint`.
- **`npm run lint` has ONE pre-existing failure** in `frontend/src/pages/Portfolio.jsx` (`react-hooks` `set-state-in-effect`, line 563), from Plan 1, untouched by this phase. Do not try to fix it as part of this plan; do not let it block a task's own lint run — only new errors in files this plan touches are this plan's problem.
- **Test fixtures** reset tables via `resetTables(...)` from `backend/tests/helpers/db.js`, always in this order when orders are involved: `"order_items", "orders", "product_variants", "products", "collections"`.
- **Timezone.** The seller is in Asia/Ho_Chi_Minh, fixed UTC+7 (Vietnam has no DST). `orders.created_at` is stored UTC. Any date-range boundary in this phase is parsed as `${dateStr}T00:00:00+07:00` before being compared against `created_at` — never compared as a bare UTC string.
- **Deleted variants:** `order_items.product_variant_id` is `SET NULL` when a variant is deleted, so a deleted variant's sales become indistinguishable from any other deleted variant sharing the same `product_variant_id` (`NULL`) unless grouped by the snapshot columns too. Always `GROUP BY product_variant_id, product_name_snapshot, variant_label_snapshot` when aggregating `order_items`, never `product_variant_id` alone.
- **Commits:** Conventional Commits, descriptive body, **no `Co-Authored-By` trailer**.

---

### Task 1: Money classification

Pure functions over `(status, payment_method)`. No I/O. This is the single highest-value file in the phase — every other task's money numbers are only as correct as this one.

**Files:**
- Create: `backend/shop/stats/money.js`
- Test: `backend/tests/statsMoney.test.js`

**Interfaces:**
- Produces `money.js` exporting:
  - `isPrepaid(paymentMethod: string): boolean`
  - `classify(order: {status, payment_method}): "received" | "awaiting_payment" | "to_collect" | "lost" | "other"`
  - `isExpired(order: {status, expires_at, cancelled_at}): boolean`
  - `PREPAID_METHODS: Set<string>`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/statsMoney.test.js`:

```js
import { describe, it, expect } from "vitest"
import { isPrepaid, classify, isExpired } from "../shop/stats/money.js"

describe("isPrepaid", () => {
  it("is true for bank, momo, and paypal", () => {
    expect(isPrepaid("bank")).toBe(true)
    expect(isPrepaid("momo")).toBe(true)
    expect(isPrepaid("paypal")).toBe(true)
  })

  it("is false for cod", () => {
    expect(isPrepaid("cod")).toBe(false)
  })
})

// The full (status × payment_method) matrix per the spec's Money Definitions:
//
//              pending            confirmed/shipped   completed   cancelled
// prepaid   awaiting_payment      received            received    lost
// cod       other                 to_collect          received    lost
//
// Every one of the 20 combinations is asserted explicitly — this is the
// highest-value test in the whole phase, per the spec's Testing section.
const PREPAID_METHODS = ["bank", "momo", "paypal"]
const CASES = []
for (const method of [...PREPAID_METHODS, "cod"]) {
  const prepaid = method !== "cod"
  CASES.push([method, "pending", prepaid ? "awaiting_payment" : "other"])
  CASES.push([method, "confirmed", prepaid ? "received" : "to_collect"])
  CASES.push([method, "shipped", prepaid ? "received" : "to_collect"])
  CASES.push([method, "completed", "received"])
  CASES.push([method, "cancelled", "lost"])
}

describe("classify", () => {
  for (const [payment_method, status, expected] of CASES) {
    it(`${payment_method}/${status} -> ${expected}`, () => {
      expect(classify({ status, payment_method })).toBe(expected)
    })
  }

  it("covers exactly 20 combinations, so no case can silently go unwritten", () => {
    expect(CASES).toHaveLength(20)
  })
})

describe("isExpired", () => {
  it("is true when cancelled_at is at or after expires_at", () => {
    const expiresAt = new Date("2026-01-01T00:00:00Z")
    expect(isExpired({
      status: "cancelled", expires_at: expiresAt, cancelled_at: expiresAt,
    })).toBe(true)
    expect(isExpired({
      status: "cancelled", expires_at: expiresAt,
      cancelled_at: new Date("2026-01-01T00:00:01Z"),
    })).toBe(true)
  })

  it("is false when cancelled before the deadline (a genuine manual cancel)", () => {
    expect(isExpired({
      status: "cancelled",
      expires_at: new Date("2026-01-01T00:00:00Z"),
      cancelled_at: new Date("2025-12-31T23:59:59Z"),
    })).toBe(false)
  })

  it("is false for any non-cancelled status, even with overdue timestamps", () => {
    expect(isExpired({
      status: "confirmed",
      expires_at: new Date("2020-01-01T00:00:00Z"),
      cancelled_at: new Date("2026-01-01T00:00:00Z"),
    })).toBe(false)
  })

  it("is false for a cancelled COD order (expires_at is always NULL)", () => {
    expect(isExpired({ status: "cancelled", expires_at: null, cancelled_at: new Date() })).toBe(false)
  })

  it("is false when cancelled_at is missing", () => {
    expect(isExpired({
      status: "cancelled", expires_at: new Date("2026-01-01T00:00:00Z"), cancelled_at: null,
    })).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- statsMoney`
Expected: FAIL — `backend/shop/stats/money.js` does not exist.

- [ ] **Step 3: Implement the classifier**

Create `backend/shop/stats/money.js`:

```js
const PREPAID_METHODS = new Set(["bank", "momo", "paypal"])

/** bank/momo/paypal are paid before the seller ships anything; COD is paid
 * at handover. This one set is the only place that distinction lives. */
function isPrepaid(paymentMethod) {
  return PREPAID_METHODS.has(paymentMethod)
}

/**
 * Classify one order into exactly one money bucket, per the spec's Money
 * Definitions:
 *
 *              pending            confirmed/shipped   completed   cancelled
 * prepaid   awaiting_payment      received            received    lost
 * cod       other                 to_collect          received    lost
 *
 * "other" (a pending COD order) is neither money in hand nor a committed
 * promise to collect — the seller has not even confirmed the order yet — so
 * it is deliberately excluded from Received, Outstanding, and Lost. It is
 * still a real return value, never undefined, so every input is accounted
 * for and a caller cannot silently drop an order by forgetting a branch.
 */
function classify(order) {
  const { status, payment_method: paymentMethod } = order
  const prepaid = isPrepaid(paymentMethod)

  if (status === "cancelled") return "lost"
  if (status === "completed") return "received"

  if (prepaid) {
    return status === "pending" ? "awaiting_payment" : "received"
  }
  return status === "pending" ? "other" : "to_collect"
}

/**
 * An order counts as expired when it was cancelled at or after its own
 * deadline. An admin who manually cancels an already-overdue order is
 * indistinguishable from the automatic sweep and is counted as expired too —
 * accepted per spec rather than adding a `cancel_reason` column for one
 * statistic. COD orders never have `expires_at` and are never expired.
 */
function isExpired(order) {
  if (order.status !== "cancelled") return false
  if (!order.expires_at || !order.cancelled_at) return false
  return new Date(order.cancelled_at).getTime() >= new Date(order.expires_at).getTime()
}

module.exports = { isPrepaid, classify, isExpired, PREPAID_METHODS }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- statsMoney`
Expected: PASS, 27 tests (2 + 20 + 1 + 4).

- [ ] **Step 5: Commit**

```bash
git add backend/shop/stats/money.js backend/tests/statsMoney.test.js
git commit -F - <<'EOF'
feat(stats): add money classification for the admin dashboard

classify() maps every (status, payment_method) combination to exactly one
bucket — received, awaiting_payment, to_collect, lost, or other (a pending
COD order, committed to neither side yet). All 20 combinations are asserted
explicitly in the test, because a wrong money number that looks authoritative
is the single worst outcome this phase can produce.

Isolated as a pure function so every other stats query can classify orders in
JavaScript after a scoped SQL fetch, rather than duplicating this branching
logic as a second, untested SQL CASE expression that could silently drift
from the tested version.
EOF
```

---

### Task 2: Drop view aggregate query

**Files:**
- Create: `backend/shop/stats/statsRepo.js`
- Test: `backend/tests/statsRepoDrop.test.js`

**Interfaces:**
- Consumes: `classify`, `isPrepaid`, `isExpired` from `backend/shop/stats/money.js` (Task 1).
- Produces `statsRepo.js` exporting `getDropStats(collectionId: number): Promise<DropStats | null>`, plus the internal helper `buildVariantSummary(row, collectionCreatedAt)` (not exported — Task 3 does not import it, it has its own inline logic; see Task 3's Interfaces).

  `DropStats` shape:
  ```
  {
    collection_id, collection_title,
    received: { bank, momo, paypal, cod },   // each an integer VND sum
    received_total,                          // sum of the four above
    awaiting_payment, to_collect, lost,      // integers
    order_counts: { pending, confirmed, shipped, completed, cancelled },
    units_sold,                              // integer, excludes cancelled orders
    expiry_rate,                             // number in [0,1], or null if no prepaid orders
    prepaid_order_count, expired_order_count,
    fulfillment_counts: { ship, pickup },
    variants: [{
      variant_id,        // null if the variant has been deleted
      product_name, variant_label,
      sold,              // integer, excludes cancelled orders
      deleted,           // true if variant_id is null
      unlimited,         // true if stock_qty is NULL and not deleted
      remaining,         // integer, or null if deleted/unlimited
      sell_through,      // number in [0,1], or null if deleted/unlimited
      time_to_sellout_days, // number, or null unless remaining === 0
    }],
  }
  ```
  Returns `null` when `collectionId` matches no collection.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/statsRepoDrop.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import statsRepo from "../shop/stats/statsRepo.js"
import { resetTables } from "./helpers/db.js"

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seed({ collectionTitle = "Drop", price = 35000, stock = 5 } = {}) {
  const cid = await catalog.createCollection({ title: collectionTitle, status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stock }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  return { collectionId: cid, productId: pid, variantId: v.id }
}

async function placeOrder(variantId, over = {}) {
  return orders.createOrder({
    items: [{ variant_id: variantId, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank", ...over,
  })
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("getDropStats", () => {
  it("returns null for an unknown collection", async () => {
    expect(await statsRepo.getDropStats(999999)).toBeNull()
  })

  it("returns a zero state for a collection with no orders", async () => {
    const { collectionId } = await seed()
    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.received_total).toBe(0)
    expect(stats.order_counts).toEqual({ pending: 0, confirmed: 0, shipped: 0, completed: 0, cancelled: 0 })
    expect(stats.units_sold).toBe(0)
    expect(stats.expiry_rate).toBeNull()
    expect(stats.variants).toEqual([])
  })

  it("buckets a confirmed bank order as received, split by method", async () => {
    const { collectionId, variantId } = await seed()
    const o = await placeOrder(variantId, { payment_method: "bank" })
    await orders.transitionOrder(o.id, "confirmed")

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.received.bank).toBe(35000)
    expect(stats.received.momo).toBe(0)
    expect(stats.received_total).toBe(35000)
    expect(stats.order_counts.confirmed).toBe(1)
  })

  it("buckets a pending bank order as awaiting_payment, not received", async () => {
    const { collectionId, variantId } = await seed()
    await placeOrder(variantId, { payment_method: "bank" })

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.awaiting_payment).toBe(35000)
    expect(stats.received_total).toBe(0)
  })

  it("buckets a confirmed COD order as to_collect, and a completed one as received", async () => {
    const { collectionId, variantId } = await seed({ stock: 5 })
    const a = await placeOrder(variantId, { payment_method: "cod" })
    await orders.transitionOrder(a.id, "confirmed")

    const b = await placeOrder(variantId, { payment_method: "cod" })
    await orders.transitionOrder(b.id, "confirmed")
    await orders.transitionOrder(b.id, "shipped")
    await orders.transitionOrder(b.id, "completed")

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.to_collect).toBe(35000)
    expect(stats.received.cod).toBe(35000)
  })

  it("buckets a cancelled order as lost, excluded from received/outstanding", async () => {
    const { collectionId, variantId } = await seed()
    const o = await placeOrder(variantId, { payment_method: "bank" })
    await orders.transitionOrder(o.id, "cancelled")

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.lost).toBe(35000)
    expect(stats.received_total).toBe(0)
    expect(stats.awaiting_payment).toBe(0)
  })

  it("excludes cancelled orders from units_sold", async () => {
    const { collectionId, variantId } = await seed({ stock: 5 })
    const kept = await placeOrder(variantId)
    await orders.transitionOrder(kept.id, "confirmed")
    const cancelled = await placeOrder(variantId)
    await orders.transitionOrder(cancelled.id, "cancelled")

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.units_sold).toBe(1)
  })

  it("computes expiry_rate over prepaid orders only, excluding COD from both sides", async () => {
    const { collectionId, variantId } = await seed({ stock: 5 })
    const expired = await placeOrder(variantId, { payment_method: "bank" })
    await db.query(
      "UPDATE orders SET expires_at = ?, cancelled_at = ?, status = 'cancelled' WHERE id = ?",
      [new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:01Z"), expired.id]
    )
    await placeOrder(variantId, { payment_method: "bank" }) // still pending, not expired
    await placeOrder(variantId, { payment_method: "cod" })  // excluded entirely

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.prepaid_order_count).toBe(2)
    expect(stats.expired_order_count).toBe(1)
    expect(stats.expiry_rate).toBe(0.5)
  })

  it("reports ship vs pickup mix", async () => {
    const { collectionId, variantId } = await seed({ stock: 5 })
    await placeOrder(variantId, { fulfillment_method: "ship" })
    await catalog.updateCollection(collectionId, { title: "Drop", status: "active", allow_pickup: true })
    await placeOrder(variantId, { fulfillment_method: "pickup" })

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.fulfillment_counts).toEqual({ ship: 1, pickup: 1 })
  })

  it("shows an unlimited variant as such, never a 0% or null sell-through", async () => {
    const { collectionId, variantId } = await seed({ stock: null })
    const o = await placeOrder(variantId)
    await orders.transitionOrder(o.id, "confirmed")

    const stats = await statsRepo.getDropStats(collectionId)
    const v = stats.variants.find((x) => x.variant_id === variantId)
    expect(v.unlimited).toBe(true)
    expect(v.remaining).toBeNull()
    expect(v.sell_through).toBeNull()
  })

  it("shows a deleted variant's revenue via order_items snapshots, remaining as null (displayed '—')", async () => {
    const { collectionId, productId, variantId } = await seed({ stock: 3 })
    const o = await placeOrder(variantId)
    await orders.transitionOrder(o.id, "confirmed")
    await orders.transitionOrder(o.id, "shipped")
    await orders.transitionOrder(o.id, "completed")
    await catalog.replaceVariants(productId, []) // deletes the now-safe-to-remove variant

    const stats = await statsRepo.getDropStats(collectionId)
    expect(stats.variants).toHaveLength(1)
    const v = stats.variants[0]
    expect(v.variant_id).toBeNull()
    expect(v.deleted).toBe(true)
    expect(v.product_name).toBe("Card")
    expect(v.sold).toBe(1)
    expect(v.remaining).toBeNull()
    expect(v.sell_through).toBeNull()
  })

  it("shows time-to-sellout only once remaining reaches 0", async () => {
    const { collectionId, variantId } = await seed({ stock: 1 })
    const o = await placeOrder(variantId)
    await orders.transitionOrder(o.id, "confirmed")

    const stats = await statsRepo.getDropStats(collectionId)
    const v = stats.variants.find((x) => x.variant_id === variantId)
    expect(v.remaining).toBe(0)
    expect(v.time_to_sellout_days).not.toBeNull()
    expect(v.time_to_sellout_days).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- statsRepoDrop`
Expected: FAIL — `backend/shop/stats/statsRepo.js` does not exist.

- [ ] **Step 3: Implement the drop view query**

Create `backend/shop/stats/statsRepo.js`:

```js
const db = require("./../../db")
const { classify, isPrepaid, isExpired } = require("./money")

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Sell-through and time-to-sellout for one row of a drop's per-variant
 * table. Deleted variants (product_variant_id NULL after ON DELETE SET
 * NULL) have no product_variants row to join — remaining is null, displayed
 * as "—" by the frontend, never 0, which would falsely read as sold out.
 */
function buildVariantSummary(row, collectionCreatedAt) {
  const sold = Number(row.sold)
  const deleted = row.variant_id === null
  const unlimited = !deleted && row.stock_qty === null
  const remaining = deleted || unlimited ? null : Number(row.stock_qty)

  let sellThrough = null
  if (!deleted && !unlimited) {
    const denom = sold + remaining
    sellThrough = denom === 0 ? 0 : sold / denom
  }

  let timeToSelloutDays = null
  if (!deleted && !unlimited && remaining === 0 && row.last_sale_at) {
    timeToSelloutDays = Math.max(
      (new Date(row.last_sale_at).getTime() - new Date(collectionCreatedAt).getTime()) / MS_PER_DAY,
      0
    )
  }

  return {
    variant_id: row.variant_id,
    product_name: row.product_name,
    variant_label: row.variant_label,
    sold,
    deleted,
    unlimited,
    remaining,
    sell_through: sellThrough,
    time_to_sellout_days: timeToSelloutDays,
  }
}

/**
 * Retrospective for one collection: money classified per order, order
 * counts, units sold, expiry rate, fulfillment mix, and a per-variant table.
 *
 * Money classification happens in JavaScript over a scoped fetch
 * (`WHERE collection_id = ?`, using idx_orders_status_created's leading
 * column) rather than as a SQL CASE expression, so the exhaustively-tested
 * classify() from money.js is what actually computes every number here —
 * see this plan's Architecture note for why that trumps a "SQL only" rule.
 */
async function getDropStats(collectionId) {
  const [[collection]] = await db.query(
    "SELECT id, title, created_at FROM collections WHERE id = ? LIMIT 1",
    [collectionId]
  )
  if (!collection) return null

  const [orderRows] = await db.query(
    `SELECT id, status, payment_method, total, fulfillment_method, expires_at, cancelled_at
       FROM orders WHERE collection_id = ?`,
    [collectionId]
  )

  const received = { bank: 0, momo: 0, paypal: 0, cod: 0 }
  const orderCounts = { pending: 0, confirmed: 0, shipped: 0, completed: 0, cancelled: 0 }
  const fulfillmentCounts = { ship: 0, pickup: 0 }
  let awaitingPayment = 0
  let toCollect = 0
  let lost = 0
  let prepaidCount = 0
  let expiredCount = 0

  for (const o of orderRows) {
    orderCounts[o.status] += 1
    fulfillmentCounts[o.fulfillment_method] += 1

    const bucket = classify(o)
    if (bucket === "received") received[o.payment_method] += o.total
    else if (bucket === "awaiting_payment") awaitingPayment += o.total
    else if (bucket === "to_collect") toCollect += o.total
    else if (bucket === "lost") lost += o.total

    if (isPrepaid(o.payment_method)) {
      prepaidCount += 1
      if (isExpired(o)) expiredCount += 1
    }
  }

  const [[{ units_sold: unitsSold }]] = await db.query(
    `SELECT COALESCE(SUM(oi.qty), 0) AS units_sold
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.collection_id = ? AND o.status != 'cancelled'`,
    [collectionId]
  )

  const [variantRows] = await db.query(
    `SELECT oi.product_variant_id AS variant_id,
            oi.product_name_snapshot AS product_name,
            oi.variant_label_snapshot AS variant_label,
            SUM(oi.qty) AS sold,
            MAX(o.created_at) AS last_sale_at,
            v.stock_qty AS stock_qty
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN product_variants v ON v.id = oi.product_variant_id
      WHERE o.collection_id = ? AND o.status != 'cancelled'
      GROUP BY oi.product_variant_id, oi.product_name_snapshot, oi.variant_label_snapshot
      ORDER BY sold DESC`,
    [collectionId]
  )

  return {
    collection_id: collection.id,
    collection_title: collection.title,
    received,
    received_total: received.bank + received.momo + received.paypal + received.cod,
    awaiting_payment: awaitingPayment,
    to_collect: toCollect,
    lost,
    order_counts: orderCounts,
    units_sold: Number(unitsSold),
    expiry_rate: prepaidCount === 0 ? null : expiredCount / prepaidCount,
    prepaid_order_count: prepaidCount,
    expired_order_count: expiredCount,
    fulfillment_counts: fulfillmentCounts,
    variants: variantRows.map((row) => buildVariantSummary(row, collection.created_at)),
  }
}

module.exports = { getDropStats, buildVariantSummary }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- statsRepoDrop`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/shop/stats/statsRepo.js backend/tests/statsRepoDrop.test.js
git commit -F - <<'EOF'
feat(stats): add the drop-view aggregate query

getDropStats(collectionId) is the per-collection retrospective: money by
classify() bucket (received split per payment method), order counts, units
sold (cancelled orders excluded — their items were never actually sold),
expiry rate over prepaid orders only, ship/pickup mix, and a per-variant
sell-through table.

Deleted variants are grouped by (variant_id, product_name_snapshot,
variant_label_snapshot) rather than variant_id alone, since ON DELETE SET
NULL collapses every deleted variant's product_variant_id to the same NULL —
grouping by id alone would merge unrelated deleted variants' sales into one
row. Their remaining stock is null (displayed as "—"), never 0, which would
falsely read as sold out.

Unlimited variants (stock_qty IS NULL) get a null sell-through rather than a
division by null or a misleading 0%.
EOF
```

---

### Task 3: Restock view aggregate query

**Files:**
- Modify: `backend/shop/stats/statsRepo.js`
- Test: `backend/tests/statsRepoRestock.test.js`

**Interfaces:**
- Consumes: nothing new from earlier tasks (queries `product_variants`/`products`/`collections`/`order_items`/`orders` directly).
- Produces `getRestockStats(): Promise<VariantVelocity[]>`, sorted by `velocity` descending.

  `VariantVelocity` shape:
  ```
  {
    variant_id, label, product_name, collection_id, collection_title,
    stock_qty,          // raw column value, null means unlimited
    unlimited, remaining,  // remaining is null when unlimited
    sold,               // integer, excludes cancelled orders
    velocity,           // sold ÷ days-on-sale, always a finite number ≥ 0
    sell_through,       // null when unlimited
    time_to_sellout_days, // null unless sold out (remaining === 0)
  }
  ```
  Deleted variants are absent from this list entirely (the query starts from `product_variants`, which no longer has their row) — restock decisions are about what can still be made, and a deleted variant cannot be restocked.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/statsRepoRestock.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import statsRepo from "../shop/stats/statsRepo.js"
import { resetTables } from "./helpers/db.js"

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seedVariant({ stock = 5, price = 35000 } = {}) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stock }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  return { collectionId: cid, productId: pid, variantId: v.id }
}

async function placeAndConfirm(variantId, qty = 1) {
  const o = await orders.createOrder({
    items: [{ variant_id: variantId, qty }],
    buyer, fulfillment_method: "ship", payment_method: "bank",
  })
  await orders.transitionOrder(o.id, "confirmed")
  return o
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("getRestockStats", () => {
  it("returns an empty list when there are no variants", async () => {
    expect(await statsRepo.getRestockStats()).toEqual([])
  })

  it("gives a variant with zero sales a velocity of exactly 0", async () => {
    const { variantId } = await seedVariant()
    const rows = await statsRepo.getRestockStats()
    const v = rows.find((r) => r.variant_id === variantId)
    expect(v.sold).toBe(0)
    expect(v.velocity).toBe(0)
  })

  it("computes velocity for a sold-out variant using time to its last sale, not now", async () => {
    const { collectionId, variantId } = await seedVariant({ stock: 1 })
    await placeAndConfirm(variantId, 1)
    // Backdate the collection so days-on-sale is a known, exact value.
    await db.query("UPDATE collections SET created_at = ? WHERE id = ?", [
      new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), collectionId,
    ])

    const rows = await statsRepo.getRestockStats()
    const v = rows.find((r) => r.variant_id === variantId)
    expect(v.remaining).toBe(0)
    expect(v.sold).toBe(1)
    // ~2 days on sale (last sale was "now" at placeAndConfirm time) -> velocity ~0.5/day
    expect(v.velocity).toBeGreaterThan(0.4)
    expect(v.velocity).toBeLessThan(0.6)
    expect(v.time_to_sellout_days).not.toBeNull()
  })

  it("computes velocity for a still-available variant using time to now", async () => {
    const { collectionId, variantId } = await seedVariant({ stock: 10 })
    await placeAndConfirm(variantId, 2)
    await db.query("UPDATE collections SET created_at = ? WHERE id = ?", [
      new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), collectionId,
    ])

    const rows = await statsRepo.getRestockStats()
    const v = rows.find((r) => r.variant_id === variantId)
    expect(v.remaining).toBe(8)
    expect(v.velocity).toBeGreaterThan(0.9)
    expect(v.velocity).toBeLessThan(1.1)
    expect(v.time_to_sellout_days).toBeNull()
    expect(v.sell_through).toBeCloseTo(2 / 10)
  })

  it("gives an unlimited variant a velocity but no sell-through", async () => {
    const { variantId } = await seedVariant({ stock: null })
    await placeAndConfirm(variantId, 3)

    const rows = await statsRepo.getRestockStats()
    const v = rows.find((r) => r.variant_id === variantId)
    expect(v.unlimited).toBe(true)
    expect(v.remaining).toBeNull()
    expect(v.sold).toBe(3)
    expect(v.velocity).toBeGreaterThan(0)
    expect(v.sell_through).toBeNull()
  })

  it("excludes cancelled-order quantity from sold", async () => {
    const { variantId } = await seedVariant({ stock: 5 })
    const o = await orders.createOrder({
      items: [{ variant_id: variantId, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })
    await orders.transitionOrder(o.id, "cancelled")

    const rows = await statsRepo.getRestockStats()
    expect(rows.find((r) => r.variant_id === variantId).sold).toBe(0)
  })

  it("excludes deleted variants entirely", async () => {
    const { productId, variantId } = await seedVariant({ stock: 3 })
    const o = await placeAndConfirm(variantId, 1)
    await orders.transitionOrder(o.id, "shipped")
    await orders.transitionOrder(o.id, "completed")
    await catalog.replaceVariants(productId, [])

    const rows = await statsRepo.getRestockStats()
    expect(rows.find((r) => r.variant_id === variantId)).toBeUndefined()
  })

  it("sorts by velocity descending", async () => {
    const slow = await seedVariant({ stock: 100 })
    await placeAndConfirm(slow.variantId, 1)
    const fast = await seedVariant({ stock: 1 })
    await placeAndConfirm(fast.variantId, 1)
    // fast sold out immediately; slow has 1 sale against 100 stock -> lower velocity.

    const rows = await statsRepo.getRestockStats()
    const fastIndex = rows.findIndex((r) => r.variant_id === fast.variantId)
    const slowIndex = rows.findIndex((r) => r.variant_id === slow.variantId)
    expect(fastIndex).toBeLessThan(slowIndex)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- statsRepoRestock`
Expected: FAIL — `getRestockStats` is not exported.

- [ ] **Step 3: Implement the restock view query**

In `backend/shop/stats/statsRepo.js`, add above `module.exports`:

```js
/**
 * Per-variant sales velocity across every drop, sorted fastest-first.
 *
 * Velocity = units sold ÷ days on sale, where days-on-sale runs from the
 * variant's collection's created_at to either its last sale (if it has sold
 * out) or now. This gives one comparable number for both sold-out and
 * still-available variants — time-to-sellout alone is undefined for
 * anything that has never sold out.
 *
 * Deleted variants are absent by construction: this query starts from
 * product_variants, which no longer has their row. A deleted variant cannot
 * be restocked, so its absence from a restock list is correct, not a gap.
 */
async function getRestockStats() {
  const [variantRows] = await db.query(
    `SELECT v.id AS variant_id, v.label, v.stock_qty,
            p.name AS product_name,
            c.id AS collection_id, c.title AS collection_title, c.created_at AS collection_created_at
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN collections c ON c.id = p.collection_id`
  )

  const [salesRows] = await db.query(
    `SELECT oi.product_variant_id AS variant_id, SUM(oi.qty) AS sold, MAX(o.created_at) AS last_sale_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.status != 'cancelled' AND oi.product_variant_id IS NOT NULL
      GROUP BY oi.product_variant_id`
  )
  const salesByVariant = new Map(salesRows.map((r) => [r.variant_id, r]))

  const now = new Date()

  const result = variantRows.map((v) => {
    const sales = salesByVariant.get(v.variant_id)
    const sold = sales ? Number(sales.sold) : 0
    const unlimited = v.stock_qty === null
    const remaining = unlimited ? null : Number(v.stock_qty)
    const soldOut = !unlimited && remaining === 0

    const saleEnd = soldOut && sales ? new Date(sales.last_sale_at) : now
    const daysOnSale = Math.max(
      (saleEnd.getTime() - new Date(v.collection_created_at).getTime()) / MS_PER_DAY,
      1 / 24 // floors at one hour, so a same-hour drop never divides by zero
    )
    const velocity = sold / daysOnSale

    let sellThrough = null
    if (!unlimited) {
      const denom = sold + remaining
      sellThrough = denom === 0 ? 0 : sold / denom
    }

    let timeToSelloutDays = null
    if (soldOut && sales) {
      timeToSelloutDays = Math.max(
        (new Date(sales.last_sale_at).getTime() - new Date(v.collection_created_at).getTime()) / MS_PER_DAY,
        0
      )
    }

    return {
      variant_id: v.variant_id,
      label: v.label,
      product_name: v.product_name,
      collection_id: v.collection_id,
      collection_title: v.collection_title,
      stock_qty: v.stock_qty,
      unlimited,
      remaining,
      sold,
      velocity,
      sell_through: sellThrough,
      time_to_sellout_days: timeToSelloutDays,
    }
  })

  return result.sort((a, b) => b.velocity - a.velocity)
}
```

Update the module's `module.exports` line to:

```js
module.exports = { getDropStats, buildVariantSummary, getRestockStats }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- statsRepoRestock`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/shop/stats/statsRepo.js backend/tests/statsRepoRestock.test.js
git commit -F - <<'EOF'
feat(stats): add the restock-view aggregate query

getRestockStats() ranks every current variant by sales velocity (units sold
÷ days on sale), where days-on-sale runs to the variant's last sale once it
sells out, or to now otherwise — one comparable number across sold-out and
still-available stock.

Deleted variants are absent by construction, since the query starts from the
live product_variants table: a deleted variant cannot be restocked, so its
absence here is correct, not a gap (its sales history still appears in the
drop view, which resolves from order_items snapshots instead).
EOF
```

---

### Task 4: Bookkeeping view aggregate query and timezone handling

**Files:**
- Modify: `backend/shop/stats/statsRepo.js`
- Test: `backend/tests/statsRepoBookkeeping.test.js`

**Interfaces:**
- Consumes: `classify` from `money.js` (Task 1); `getDropStats` from Task 2 (used only by this task's reconciliation test, not by the implementation).
- Produces:
  - `class InvalidRangeError extends Error {}` — thrown by malformed or backwards date ranges.
  - `parseLocalDateRange(dateFrom: string, dateTo: string): {from: Date, toExclusive: Date}` — `dateFrom`/`dateTo` are `YYYY-MM-DD` strings interpreted in Asia/Ho_Chi_Minh; throws `InvalidRangeError` on missing, unparsable, or backwards input.
  - `getBookkeepingStats({date_from: string, date_to: string}): Promise<BookkeepingStats>`

  `BookkeepingStats` shape:
  ```
  {
    date_from, date_to,
    received: { bank, momo, paypal, cod },
    received_total,
    awaiting_payment, to_collect, lost,
    shipping_cost,     // sum of orders.shipping_fee in range, integer
    by_collection: [{
      collection_id,       // null for the "no collection" bucket
      collection_title,    // "Không thuộc bộ sưu tập" for that bucket
      received_total, awaiting_payment, to_collect, lost,
    }],
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `backend/tests/statsRepoBookkeeping.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import statsRepo from "../shop/stats/statsRepo.js"
import { resetTables } from "./helpers/db.js"

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seedVariant() {
  const cid = await catalog.createCollection({ title: "Drop A", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 50 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  return { collectionId: cid, variantId: v.id }
}

async function placeOrderAt(variantId, createdAt, over = {}) {
  const o = await orders.createOrder({
    items: [{ variant_id: variantId, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank", ...over,
  })
  await db.query("UPDATE orders SET created_at = ? WHERE id = ?", [createdAt, o.id])
  return o
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("parseLocalDateRange / statsRepo.InvalidRangeError", () => {
  it("rejects a missing date", () => {
    expect(() => statsRepo.parseLocalDateRange("", "2026-08-08")).toThrow(statsRepo.InvalidRangeError)
  })

  it("rejects an unparsable date", () => {
    expect(() => statsRepo.parseLocalDateRange("not-a-date", "2026-08-08")).toThrow(statsRepo.InvalidRangeError)
  })

  it("rejects a range where the end is before the start", () => {
    expect(() => statsRepo.parseLocalDateRange("2026-08-08", "2026-08-01")).toThrow(statsRepo.InvalidRangeError)
  })

  it("treats date_to as inclusive of the whole local day", () => {
    const { toExclusive } = statsRepo.parseLocalDateRange("2026-08-01", "2026-08-01")
    // 2026-08-02T00:00:00+07:00 == 2026-08-01T17:00:00Z
    expect(toExclusive.toISOString()).toBe("2026-08-01T17:00:00.000Z")
  })
})

describe("getBookkeepingStats — timezone boundaries", () => {
  it("counts an order placed just after local midnight into that local day", async () => {
    const { variantId } = await seedVariant()
    // 2026-08-01T00:05:00+07:00 == 2026-07-31T17:05:00Z
    await placeOrderAt(variantId, new Date("2026-07-31T17:05:00Z"))

    const inRange = await statsRepo.getBookkeepingStats({ date_from: "2026-08-01", date_to: "2026-08-01" })
    expect(inRange.awaiting_payment).toBe(35000)

    const dayBefore = await statsRepo.getBookkeepingStats({ date_from: "2026-07-31", date_to: "2026-07-31" })
    expect(dayBefore.awaiting_payment).toBe(0)
  })

  it("excludes an order placed just before local midnight from the next local day", async () => {
    const { variantId } = await seedVariant()
    // 2026-07-31T23:55:00+07:00 == 2026-07-31T16:55:00Z
    await placeOrderAt(variantId, new Date("2026-07-31T16:55:00Z"))

    const nextDay = await statsRepo.getBookkeepingStats({ date_from: "2026-08-01", date_to: "2026-08-01" })
    expect(nextDay.awaiting_payment).toBe(0)

    const sameDay = await statsRepo.getBookkeepingStats({ date_from: "2026-07-31", date_to: "2026-07-31" })
    expect(sameDay.awaiting_payment).toBe(35000)
  })
})

describe("getBookkeepingStats — money and buckets", () => {
  it("splits received by payment method", async () => {
    const { variantId } = await seedVariant()
    const today = new Date()
    const a = await placeOrderAt(variantId, today, { payment_method: "bank" })
    await orders.transitionOrder(a.id, "confirmed")
    const b = await placeOrderAt(variantId, today, { payment_method: "momo" })
    await orders.transitionOrder(b.id, "confirmed")

    const dateStr = today.toISOString().slice(0, 10)
    const stats = await statsRepo.getBookkeepingStats({ date_from: dateStr, date_to: dateStr })
    expect(stats.received.bank).toBe(35000)
    expect(stats.received.momo).toBe(35000)
    expect(stats.received_total).toBe(70000)
  })

  it("sums recorded shipping cost as a cost, not income", async () => {
    const { variantId } = await seedVariant()
    const today = new Date()
    const o = await placeOrderAt(variantId, today, { payment_method: "bank" })
    await orders.transitionOrder(o.id, "confirmed")
    await orders.transitionOrder(o.id, "shipped", { shipping_fee: 25000 })

    const dateStr = today.toISOString().slice(0, 10)
    const stats = await statsRepo.getBookkeepingStats({ date_from: dateStr, date_to: dateStr })
    expect(stats.shipping_cost).toBe(25000)
    expect(stats.received_total).toBe(35000) // shipping never inflates income
  })

  it("buckets orders with no collection into an explicit 'no collection' entry", async () => {
    const { variantId } = await seedVariant()
    const today = new Date()
    const o = await placeOrderAt(variantId, today, { payment_method: "bank" })
    await db.query("UPDATE orders SET collection_id = NULL WHERE id = ?", [o.id])

    const dateStr = today.toISOString().slice(0, 10)
    const stats = await statsRepo.getBookkeepingStats({ date_from: dateStr, date_to: dateStr })
    const bucket = stats.by_collection.find((c) => c.collection_id === null)
    expect(bucket).toBeDefined()
    expect(bucket.collection_title).toBe("Không thuộc bộ sưu tập")
    expect(bucket.awaiting_payment).toBe(35000)
  })

  it("returns an explicit zero state for a range with no orders", async () => {
    const stats = await statsRepo.getBookkeepingStats({ date_from: "2000-01-01", date_to: "2000-01-01" })
    expect(stats.received_total).toBe(0)
    expect(stats.by_collection).toEqual([])
  })
})

describe("reconciliation — the highest-value test in this phase", () => {
  it("per-collection sums (plus the no-collection bucket) equal the bookkeeping total for the same range", async () => {
    const today = new Date()
    const dateStr = today.toISOString().slice(0, 10)

    const a = await seedVariant()
    const oa1 = await placeOrderAt(a.variantId, today, { payment_method: "bank" })
    await orders.transitionOrder(oa1.id, "confirmed")
    const oa2 = await placeOrderAt(a.variantId, today, { payment_method: "cod" })
    await orders.transitionOrder(oa2.id, "confirmed")

    const b = await seedVariant()
    const ob1 = await placeOrderAt(b.variantId, today, { payment_method: "paypal" })

    const stats = await statsRepo.getBookkeepingStats({ date_from: dateStr, date_to: dateStr })
    const dropA = await statsRepo.getDropStats(a.collectionId)
    const dropB = await statsRepo.getDropStats(b.collectionId)

    const bucketA = stats.by_collection.find((c) => c.collection_id === a.collectionId)
    const bucketB = stats.by_collection.find((c) => c.collection_id === b.collectionId)

    expect(bucketA.received_total).toBe(dropA.received_total)
    expect(bucketA.to_collect).toBe(dropA.to_collect)
    expect(bucketB.awaiting_payment).toBe(dropB.awaiting_payment)

    const sumReceived = stats.by_collection.reduce((s, c) => s + c.received_total, 0)
    const sumAwaiting = stats.by_collection.reduce((s, c) => s + c.awaiting_payment, 0)
    const sumToCollect = stats.by_collection.reduce((s, c) => s + c.to_collect, 0)
    const sumLost = stats.by_collection.reduce((s, c) => s + c.lost, 0)

    expect(sumReceived).toBe(stats.received_total)
    expect(sumAwaiting).toBe(stats.awaiting_payment)
    expect(sumToCollect).toBe(stats.to_collect)
    expect(sumLost).toBe(stats.lost)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- statsRepoBookkeeping`
Expected: FAIL — `parseLocalDateRange`, `InvalidRangeError`, `getBookkeepingStats` are not exported.

- [ ] **Step 3: Implement the timezone helper and bookkeeping query**

In `backend/shop/stats/statsRepo.js`, add near the top (after the `MS_PER_DAY` constant):

```js
/** Thrown for a missing, unparsable, or backwards date range — the bookkeeping
 * view rejects these with a clear message rather than silently returning
 * every order, unlike the admin orders list's tolerant date filter, because
 * a money view that misinterprets its own range is a bookkeeping error. */
class InvalidRangeError extends Error {}

/**
 * Turn a `YYYY-MM-DD` boundary, interpreted in Asia/Ho_Chi_Minh (fixed
 * UTC+7, no DST), into the UTC instant `orders.created_at` can be compared
 * against. `created_at` is stored UTC; comparing a bare local date string
 * against it would misfile every order placed between local midnight and
 * 7am UTC, and could push orders across a month boundary.
 */
function localDayStartUtc(dateStr) {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new InvalidRangeError(`Ngày không hợp lệ: ${dateStr}`)
  }
  const date = new Date(`${dateStr}T00:00:00+07:00`)
  if (Number.isNaN(date.getTime())) throw new InvalidRangeError(`Ngày không hợp lệ: ${dateStr}`)
  return date
}

/**
 * Resolve a bookkeeping date range to UTC bounds. `date_to` is inclusive of
 * its whole local day, so the upper bound is the start of the *following*
 * local day, used with `<` rather than `<=`.
 */
function parseLocalDateRange(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) throw new InvalidRangeError("Cần chọn ngày bắt đầu và ngày kết thúc")
  const from = localDayStartUtc(dateFrom)
  const toStart = localDayStartUtc(dateTo)
  const toExclusive = new Date(toStart.getTime() + MS_PER_DAY)
  if (toExclusive <= from) throw new InvalidRangeError("Ngày kết thúc phải sau ngày bắt đầu")
  return { from, toExclusive }
}
```

Then add, above `module.exports`:

```js
/**
 * Bookkeeping totals across every collection for a date range, plus an
 * explicit "no collection" bucket (orders.collection_id is nullable) so
 * per-collection sums always reconcile with the top-level totals — both are
 * computed from the same fetched rows in the same pass, by construction.
 */
async function getBookkeepingStats({ date_from: dateFrom, date_to: dateTo }) {
  const { from, toExclusive } = parseLocalDateRange(dateFrom, dateTo)

  const [orderRows] = await db.query(
    `SELECT o.id, o.status, o.payment_method, o.total, o.shipping_fee, o.collection_id,
            c.title AS collection_title
       FROM orders o
       LEFT JOIN collections c ON c.id = o.collection_id
      WHERE o.created_at >= ? AND o.created_at < ?`,
    [from, toExclusive]
  )

  const received = { bank: 0, momo: 0, paypal: 0, cod: 0 }
  let awaitingPayment = 0
  let toCollect = 0
  let lost = 0
  let shippingCost = 0
  const byCollection = new Map()

  const addTo = (entry, bucket, amount) => {
    if (bucket === "received") entry.received_total += amount
    else if (bucket === "awaiting_payment") entry.awaiting_payment += amount
    else if (bucket === "to_collect") entry.to_collect += amount
    else if (bucket === "lost") entry.lost += amount
  }

  for (const o of orderRows) {
    const bucket = classify(o)
    if (bucket === "received") received[o.payment_method] += o.total
    else if (bucket === "awaiting_payment") awaitingPayment += o.total
    else if (bucket === "to_collect") toCollect += o.total
    else if (bucket === "lost") lost += o.total

    if (o.shipping_fee) shippingCost += o.shipping_fee

    const key = o.collection_id === null ? "none" : o.collection_id
    if (!byCollection.has(key)) {
      byCollection.set(key, {
        collection_id: o.collection_id,
        collection_title: o.collection_id === null ? "Không thuộc bộ sưu tập" : o.collection_title,
        received_total: 0, awaiting_payment: 0, to_collect: 0, lost: 0,
      })
    }
    addTo(byCollection.get(key), bucket, o.total)
  }

  return {
    date_from: dateFrom,
    date_to: dateTo,
    received,
    received_total: received.bank + received.momo + received.paypal + received.cod,
    awaiting_payment: awaitingPayment,
    to_collect: toCollect,
    lost,
    shipping_cost: shippingCost,
    by_collection: [...byCollection.values()],
  }
}
```

Update the module's `module.exports` line to:

```js
module.exports = {
  getDropStats, buildVariantSummary, getRestockStats,
  getBookkeepingStats, parseLocalDateRange, InvalidRangeError,
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- statsRepoBookkeeping`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, no regressions from Plans 1–3.

- [ ] **Step 6: Commit**

```bash
git add backend/shop/stats/statsRepo.js backend/tests/statsRepoBookkeeping.test.js
git commit -F - <<'EOF'
feat(stats): add the bookkeeping-view query with Asia/Ho_Chi_Minh date ranges

getBookkeepingStats resolves date_from/date_to (YYYY-MM-DD, interpreted in
the seller's Asia/Ho_Chi_Minh timezone, fixed UTC+7) to the UTC instants
orders.created_at can be compared against, so "August" means the seller's
August rather than misfiling every order placed between local midnight and
7am UTC.

A malformed or backwards range throws InvalidRangeError with a Vietnamese
message, rejected rather than silently returning every order — a deliberate
departure from the admin orders list's tolerant date filter, justified here
because a bookkeeping view that silently widens its own range is itself a
bookkeeping error.

Per-collection sums (including an explicit "no collection" bucket, since
orders.collection_id is nullable) are computed in the same pass as the
top-level totals, so they can never disagree by construction. The
reconciliation test additionally cross-checks each collection's slice
against the independently-implemented getDropStats for the same collection,
proving the two views actually agree rather than merely being internally
consistent with themselves.
EOF
```

---

### Task 5: CSV serialization

**Files:**
- Create: `backend/shop/stats/csv.js`
- Test: `backend/tests/statsCsv.test.js`

**Interfaces:**
- Consumes: the `BookkeepingStats` shape produced by `getBookkeepingStats` (Task 4).
- Produces `csv.js` exporting:
  - `csvEscape(value: any): string`
  - `toCsvRow(values: any[]): string`
  - `toCsv(headers: string[], rows: any[][]): string` — prefixed with a UTF-8 BOM.
  - `bookkeepingToCsv(stats: BookkeepingStats): string`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/statsCsv.test.js`:

```js
import { describe, it, expect } from "vitest"
import { csvEscape, toCsvRow, toCsv, bookkeepingToCsv } from "../shop/stats/csv.js"

describe("csvEscape", () => {
  it("leaves a plain value unquoted", () => {
    expect(csvEscape("Photocard")).toBe("Photocard")
    expect(csvEscape(35000)).toBe("35000")
  })

  it("quotes a value containing a comma", () => {
    expect(csvEscape("Card, deluxe")).toBe('"Card, deluxe"')
  })

  it("quotes and doubles an embedded quote", () => {
    expect(csvEscape('Say "hi"')).toBe('"Say ""hi"""')
  })

  it("quotes a value containing a newline", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"')
  })

  it("renders null and undefined as an empty field", () => {
    expect(csvEscape(null)).toBe("")
    expect(csvEscape(undefined)).toBe("")
  })

  it("survives Vietnamese diacritics unescaped when there is nothing else to escape", () => {
    expect(csvEscape("Bộ sưu tập Hè")).toBe("Bộ sưu tập Hè")
  })
})

describe("toCsv", () => {
  it("joins headers and rows with CRLF and a leading BOM", () => {
    const out = toCsv(["Tên", "Giá"], [["Thẻ, ảnh", 35000]])
    expect(out.startsWith("﻿")).toBe(true)
    expect(out).toContain("Tên,Giá\r\n")
    expect(out).toContain('"Thẻ, ảnh",35000')
  })

  it("round-trips a name with a comma, a quote, and diacritics intact", () => {
    const out = toCsv(["Tên"], [['Sản phẩm "đặc biệt", giới hạn']])
    const body = out.replace("﻿", "")
    const [, dataLine] = body.split("\r\n")
    // A naive CSV parse of the quoted field must recover the exact original.
    const unquoted = dataLine.slice(1, -1).replace(/""/g, '"')
    expect(unquoted).toBe('Sản phẩm "đặc biệt", giới hạn')
  })
})

describe("bookkeepingToCsv", () => {
  const stats = {
    received_total: 100000, awaiting_payment: 20000, to_collect: 30000, lost: 5000,
    by_collection: [
      { collection_id: 1, collection_title: "Drop, mùa hè", received_total: 100000, awaiting_payment: 20000, to_collect: 30000, lost: 5000 },
    ],
  }

  it("includes a header row, one row per collection, and a total row", () => {
    const out = bookkeepingToCsv(stats)
    const lines = out.replace("﻿", "").split("\r\n")
    expect(lines[0]).toBe("Bộ sưu tập,Đã nhận,Chờ thanh toán,Thu khi giao,Đã mất")
    expect(lines[1]).toBe('"Drop, mùa hè",100000,20000,30000,5000')
    expect(lines[2]).toBe("Tổng cộng,100000,20000,30000,5000")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- statsCsv`
Expected: FAIL — `backend/shop/stats/csv.js` does not exist.

- [ ] **Step 3: Implement CSV serialization**

Create `backend/shop/stats/csv.js`:

```js
/**
 * Escape one CSV field per RFC 4180: wrap in quotes and double any embedded
 * quote whenever the value contains a comma, quote, or newline.
 */
function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCsvRow(values) {
  return values.map(csvEscape).join(",")
}

/**
 * `headers` and `rows` are arrays of arrays. A leading UTF-8 BOM is
 * prepended so Excel on Windows renders Vietnamese diacritics correctly
 * instead of guessing the wrong codepage.
 */
function toCsv(headers, rows) {
  const lines = [toCsvRow(headers), ...rows.map(toCsvRow)]
  return "﻿" + lines.join("\r\n")
}

/**
 * Serialize a bookkeeping-view result (see statsRepo.getBookkeepingStats)
 * into the exact CSV the admin downloads — built server-side, so the export
 * is guaranteed identical to what the screen displayed.
 */
function bookkeepingToCsv(stats) {
  const headers = ["Bộ sưu tập", "Đã nhận", "Chờ thanh toán", "Thu khi giao", "Đã mất"]
  const rows = stats.by_collection.map((c) => [
    c.collection_title, c.received_total, c.awaiting_payment, c.to_collect, c.lost,
  ])
  rows.push(["Tổng cộng", stats.received_total, stats.awaiting_payment, stats.to_collect, stats.lost])
  return toCsv(headers, rows)
}

module.exports = { csvEscape, toCsvRow, toCsv, bookkeepingToCsv }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- statsCsv`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/shop/stats/csv.js backend/tests/statsCsv.test.js
git commit -F - <<'EOF'
feat(stats): add CSV serialization for the bookkeeping export

Pure, dependency-free CSV encoding: commas, quotes, and newlines are escaped
per RFC 4180, and a leading UTF-8 BOM is emitted so Excel on Windows renders
Vietnamese diacritics correctly instead of guessing the wrong codepage.

bookkeepingToCsv builds the exact export from the same BookkeepingStats
object the JSON endpoint returns, so a screen and its CSV download can never
show different numbers for the same request.
EOF
```

---

### Task 6: Admin stats routes

**Files:**
- Create: `backend/routes/adminStats.js`
- Modify: `backend/server.js`
- Test: `backend/tests/adminStatsRoutes.test.js`

**Interfaces:**
- Consumes: `statsRepo.getDropStats`, `statsRepo.getRestockStats`, `statsRepo.getBookkeepingStats`, `statsRepo.InvalidRangeError` (Tasks 2–4); `csv.bookkeepingToCsv` (Task 5).
- Produces:
  - `GET /api/admin/stats/drop/:collectionId` → `200 DropStats` or `404 {error, message}`
  - `GET /api/admin/stats/restock` → `200 VariantVelocity[]`
  - `GET /api/admin/stats/bookkeeping?date_from=&date_to=` → `200 BookkeepingStats` or `400 {error, message}`
  - `GET /api/admin/stats/bookkeeping/export.csv?date_from=&date_to=` → `200` with `Content-Type: text/csv; charset=utf-8` and a `Content-Disposition` attachment header, or `400 {error, message}`
  - All four routes require the same `auth` middleware as every other admin route.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/adminStatsRoutes.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { resetTables } from "./helpers/db.js"

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)
const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seed() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  await orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank",
  })
  return cid
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("auth", () => {
  it("requires a token on every stats route", async () => {
    expect((await request(app).get("/api/admin/stats/drop/1")).status).toBe(401)
    expect((await request(app).get("/api/admin/stats/restock")).status).toBe(401)
    expect((await request(app).get("/api/admin/stats/bookkeeping?date_from=2026-01-01&date_to=2026-01-01")).status).toBe(401)
    expect((await request(app).get("/api/admin/stats/bookkeeping/export.csv?date_from=2026-01-01&date_to=2026-01-01")).status).toBe(401)
  })

  it("rejects a bad token", async () => {
    const res = await request(app).get("/api/admin/stats/restock").set("Authorization", "Bearer nope")
    expect(res.status).toBe(403)
  })
})

describe("GET /api/admin/stats/drop/:collectionId", () => {
  it("returns drop stats for a real collection", async () => {
    const cid = await seed()
    const res = await authed(request(app).get(`/api/admin/stats/drop/${cid}`))
    expect(res.status).toBe(200)
    expect(res.body.collection_id).toBe(cid)
    expect(res.body.awaiting_payment).toBe(35000)
  })

  it("404s an unknown collection", async () => {
    const res = await authed(request(app).get("/api/admin/stats/drop/999999"))
    expect(res.status).toBe(404)
  })
})

describe("GET /api/admin/stats/restock", () => {
  it("returns an array", async () => {
    await seed()
    const res = await authed(request(app).get("/api/admin/stats/restock"))
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
  })
})

describe("GET /api/admin/stats/bookkeeping", () => {
  it("returns bookkeeping stats for a valid range", async () => {
    await seed()
    const today = new Date().toISOString().slice(0, 10)
    const res = await authed(request(app).get(`/api/admin/stats/bookkeeping?date_from=${today}&date_to=${today}`))
    expect(res.status).toBe(200)
    expect(res.body.awaiting_payment).toBe(35000)
  })

  it("400s on a missing date_to", async () => {
    const res = await authed(request(app).get("/api/admin/stats/bookkeeping?date_from=2026-01-01"))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("400s on a backwards range", async () => {
    const res = await authed(
      request(app).get("/api/admin/stats/bookkeeping?date_from=2026-08-08&date_to=2026-01-01")
    )
    expect(res.status).toBe(400)
  })
})

describe("GET /api/admin/stats/bookkeeping/export.csv", () => {
  it("returns a CSV attachment matching the JSON view", async () => {
    await seed()
    const today = new Date().toISOString().slice(0, 10)
    const res = await authed(
      request(app).get(`/api/admin/stats/bookkeeping/export.csv?date_from=${today}&date_to=${today}`)
    )
    expect(res.status).toBe(200)
    expect(res.headers["content-type"]).toContain("text/csv")
    expect(res.headers["content-disposition"]).toContain("attachment")
    expect(res.text).toContain("Bộ sưu tập,Đã nhận,Chờ thanh toán,Thu khi giao,Đã mất")
    expect(res.text).toContain("35000")
  })

  it("400s on an invalid range the same way the JSON endpoint does", async () => {
    const res = await authed(request(app).get("/api/admin/stats/bookkeeping/export.csv?date_from=x&date_to=y"))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- adminStatsRoutes`
Expected: FAIL — `backend/routes/adminStats.js` does not exist, and the routes 404.

- [ ] **Step 3: Create the router**

Create `backend/routes/adminStats.js`:

```js
const express = require("express")
const repo = require("../shop/stats/statsRepo")
const { bookkeepingToCsv } = require("../shop/stats/csv")

module.exports = function adminStatsRoutes() {
  const router = express.Router()

  const oops = (res, err, where) => {
    console.error(`[ADMIN/STATS] ${where}:`, err)
    res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
  }

  router.get("/stats/drop/:collectionId", async (req, res) => {
    try {
      const stats = await repo.getDropStats(Number(req.params.collectionId))
      if (!stats) return res.status(404).json({ error: "not_found", message: "Không tìm thấy bộ sưu tập" })
      res.json(stats)
    } catch (err) { oops(res, err, "Lỗi thống kê theo đợt bán") }
  })

  router.get("/stats/restock", async (req, res) => {
    try {
      res.json(await repo.getRestockStats())
    } catch (err) { oops(res, err, "Lỗi thống kê restock") }
  })

  router.get("/stats/bookkeeping", async (req, res) => {
    try {
      const stats = await repo.getBookkeepingStats({
        date_from: req.query.date_from, date_to: req.query.date_to,
      })
      res.json(stats)
    } catch (err) {
      if (err instanceof repo.InvalidRangeError) {
        return res.status(400).json({ error: "invalid_input", message: err.message })
      }
      oops(res, err, "Lỗi sổ quỹ")
    }
  })

  router.get("/stats/bookkeeping/export.csv", async (req, res) => {
    try {
      const stats = await repo.getBookkeepingStats({
        date_from: req.query.date_from, date_to: req.query.date_to,
      })
      res.set("Content-Type", "text/csv; charset=utf-8")
      res.set("Content-Disposition", `attachment; filename="so-quy-${stats.date_from}-${stats.date_to}.csv"`)
      res.send(bookkeepingToCsv(stats))
    } catch (err) {
      if (err instanceof repo.InvalidRangeError) {
        return res.status(400).json({ error: "invalid_input", message: err.message })
      }
      oops(res, err, "Lỗi xuất CSV sổ quỹ")
    }
  })

  return router
}
```

- [ ] **Step 4: Mount the router**

In `backend/server.js`, beside the other admin mounts (near line 237):

```js
app.use(`${API_PREFIX}/admin`, auth, require("./routes/adminStats")())
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- adminStatsRoutes`
Expected: PASS, 10 tests.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/adminStats.js backend/server.js backend/tests/adminStatsRoutes.test.js
git commit -F - <<'EOF'
feat(stats): expose the admin statistics API

Four read-only routes behind the same auth middleware as every other admin
route: drop view by collection id, restock view, bookkeeping view, and a
server-generated CSV export of the bookkeeping view. CSV is built from the
identical BookkeepingStats object the JSON endpoint returns, so the download
can never disagree with what the screen showed.

A malformed or backwards bookkeeping date range 400s with a clear message on
both the JSON and CSV endpoints, rather than the CSV silently exporting an
unbounded query.
EOF
```

---

### Task 7: Frontend API calls, tab shell, and Admin.jsx wiring

**Files:**
- Modify: `frontend/src/api/shop.js`
- Create: `frontend/src/components/AdminStats.jsx`
- Modify: `frontend/src/pages/Admin.jsx`
- Test: `frontend/src/components/AdminStats.test.jsx`

**Interfaces:**
- Produces, appended to `frontend/src/api/shop.js`:
  - `adminGetDropStats(collectionId)` → `GET /api/admin/stats/drop/:id`
  - `adminGetRestockStats()` → `GET /api/admin/stats/restock`
  - `adminGetBookkeepingStats(params)` → `GET /api/admin/stats/bookkeeping`
  - `adminDownloadBookkeepingCsv(params)` → `GET /api/admin/stats/bookkeeping/export.csv` with `responseType: "blob"`, resolves to a `Blob`
- Produces `AdminStats.jsx` default export: a tab shell rendering `StatsDrop` / `StatsRestock` / `StatsBookkeeping` (Tasks 8–10) by an internal `view` state, defaulting to `"drop"`.
- Consumed by `Admin.jsx`, which gains a `"stats"` tab entry ("Thống kê") alongside the existing six.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/AdminStats.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

vi.mock("./stats/StatsDrop", () => ({ default: () => <div data-testid="stats-drop" /> }))
vi.mock("./stats/StatsRestock", () => ({ default: () => <div data-testid="stats-restock" /> }))
vi.mock("./stats/StatsBookkeeping", () => ({ default: () => <div data-testid="stats-bookkeeping" /> }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminStats } = await import("./AdminStats")

async function renderAdminStats() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<AdminStats />) })
  return container
}

describe("AdminStats", () => {
  it("defaults to the drop view", async () => {
    const container = await renderAdminStats()
    expect(container.querySelector('[data-testid="stats-drop"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="stats-restock"]')).toBeNull()
  })

  it("switches to the restock view on click", async () => {
    const container = await renderAdminStats()
    const restockButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Restock")
    await act(async () => { restockButton.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(container.querySelector('[data-testid="stats-restock"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="stats-drop"]')).toBeNull()
  })

  it("switches to the bookkeeping view on click", async () => {
    const container = await renderAdminStats()
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sổ quỹ")
    await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(container.querySelector('[data-testid="stats-bookkeeping"]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- AdminStats`
Expected: FAIL — `./AdminStats` and `./stats/StatsDrop` etc. do not exist.

- [ ] **Step 3: Append the API calls**

In `frontend/src/api/shop.js`, append at the end of the file:

```js
// ── Stats ──
export const adminGetDropStats = (collectionId) =>
  api.get(`/api/admin/stats/drop/${collectionId}`).then((r) => r.data)

export const adminGetRestockStats = () =>
  api.get("/api/admin/stats/restock").then((r) => r.data)

export const adminGetBookkeepingStats = (params) =>
  api.get("/api/admin/stats/bookkeeping", { params }).then((r) => r.data)

export const adminDownloadBookkeepingCsv = (params) =>
  api.get("/api/admin/stats/bookkeeping/export.csv", { params, responseType: "blob" }).then((r) => r.data)
```

- [ ] **Step 4: Create the tab shell**

Create `frontend/src/components/AdminStats.jsx`:

```jsx
import { useState } from "react"
import StatsDrop from "./stats/StatsDrop"
import StatsRestock from "./stats/StatsRestock"
import StatsBookkeeping from "./stats/StatsBookkeeping"

const VIEWS = [
  { key: "drop", label: "Theo đợt bán" },
  { key: "restock", label: "Restock" },
  { key: "bookkeeping", label: "Sổ quỹ" },
]

export default function AdminStats() {
  const [view, setView] = useState("drop")

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={`px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] ${
              view === v.key ? "bg-pink-500 text-white" : ""
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "drop" && <StatsDrop />}
      {view === "restock" && <StatsRestock />}
      {view === "bookkeeping" && <StatsBookkeeping />}
    </div>
  )
}
```

This imports `./stats/StatsDrop`, `./stats/StatsRestock`, and `./stats/StatsBookkeeping`, which do not exist yet — Tasks 8–10 create them. This task's own test mocks all three (Step 1), so it does not depend on their real implementation; it only fails to *build* until they exist as files, which the next three tasks provide. To keep this task's test runnable in isolation before those files exist, create minimal placeholder files now (Tasks 8–10 replace their contents):

Create `frontend/src/components/stats/StatsDrop.jsx`:

```jsx
export default function StatsDrop() {
  return <p className="opacity-60">Đang tải…</p>
}
```

Create `frontend/src/components/stats/StatsRestock.jsx`:

```jsx
export default function StatsRestock() {
  return <p className="opacity-60">Đang tải…</p>
}
```

Create `frontend/src/components/stats/StatsBookkeeping.jsx`:

```jsx
export default function StatsBookkeeping() {
  return <p className="opacity-60">Đang tải…</p>
}
```

- [ ] **Step 5: Wire the tab into Admin.jsx**

In `frontend/src/pages/Admin.jsx`, add the import alongside the existing admin component imports:

```js
import AdminStats from "../components/AdminStats"
```

Add a tab button after the "email" button (after line 73's closing `</button>`):

```jsx
            <button
              onClick={() => setTab("stats")}
              className={`text-sm ${tab === "stats" ? "text-pink-500 dark:text-pink-400" : "text-gray-600 dark:text-slate-500 hover:text-gray-900 dark:hover:text-slate-300"}`}
            >
              Thống kê
            </button>
```

Add the tab body after `{tab === "email" && <AdminEmailTemplates />}`:

```jsx
        {tab === "stats" && <AdminStats />}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd frontend && npm test -- AdminStats`
Expected: PASS, 3 tests.

- [ ] **Step 7: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/shop.js frontend/src/components/AdminStats.jsx \
        frontend/src/components/AdminStats.test.jsx frontend/src/components/stats \
        frontend/src/pages/Admin.jsx
git commit -F - <<'EOF'
feat(stats): add the Thống kê admin tab shell

AdminStats.jsx switches between three placeholder views — Theo đợt bán,
Restock, Sổ quỹ — matching the existing admin tab pattern in Admin.jsx
exactly. The three view components are stubs here; Tasks 8–10 replace each
with its real implementation independently.

No new i18n keys: the admin panel is hardcoded Vietnamese throughout, and
this tab follows that existing convention rather than introducing a new one.
EOF
```

---

### Task 8: Drop view component

**Files:**
- Modify: `frontend/src/components/stats/StatsDrop.jsx`
- Test: `frontend/src/components/stats/StatsDrop.test.jsx`

**Interfaces:**
- Consumes: `adminListCollections` (existing, from `frontend/src/api/shop.js`), `adminGetDropStats` (Task 7), `formatVnd` (existing, from `frontend/src/utils/money.js`).
- No new exports consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/stats/StatsDrop.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminListCollections = vi.fn()
const adminGetDropStats = vi.fn()

vi.mock("../../api/shop", () => ({
  adminListCollections: (...args) => adminListCollections(...args),
  adminGetDropStats: (...args) => adminGetDropStats(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: StatsDrop } = await import("./StatsDrop")

function dropStats(over = {}) {
  return {
    collection_id: 1, collection_title: "Drop",
    received: { bank: 35000, momo: 0, paypal: 0, cod: 0 }, received_total: 35000,
    awaiting_payment: 0, to_collect: 0, lost: 0,
    order_counts: { pending: 0, confirmed: 1, shipped: 0, completed: 0, cancelled: 0 },
    units_sold: 1, expiry_rate: null, prepaid_order_count: 0, expired_order_count: 0,
    fulfillment_counts: { ship: 1, pickup: 0 },
    variants: [
      { variant_id: 5, product_name: "Card", variant_label: "A1", sold: 1, deleted: false, unlimited: false, remaining: 4, sell_through: 0.2, time_to_sellout_days: null },
    ],
    ...over,
  }
}

function setSelectValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

async function renderStatsDrop() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<StatsDrop />) })
  return container
}

async function flush() {
  await act(async () => {})
}

beforeEach(() => {
  adminListCollections.mockReset()
  adminGetDropStats.mockReset()
  adminListCollections.mockResolvedValue([{ id: 1, title: "Drop" }])
})

describe("StatsDrop", () => {
  it("prompts to choose a collection before any is selected", async () => {
    const container = await renderStatsDrop()
    await flush()
    expect(container.textContent).toContain("Chọn một bộ sưu tập")
    expect(adminGetDropStats).not.toHaveBeenCalled()
  })

  it("loads and renders received/outstanding/lost after selecting a collection", async () => {
    adminGetDropStats.mockResolvedValue(dropStats())
    const container = await renderStatsDrop()
    await flush()

    setSelectValue(container.querySelector("select"), "1")
    await flush()

    expect(adminGetDropStats).toHaveBeenCalledWith("1")
    expect(container.textContent).toContain("35.000₫")
  })

  it("shows 'không giới hạn' for an unlimited variant, never a stock number", async () => {
    adminGetDropStats.mockResolvedValue(dropStats({
      variants: [{ variant_id: 9, product_name: "Poster", variant_label: "Std", sold: 3, deleted: false, unlimited: true, remaining: null, sell_through: null, time_to_sellout_days: null }],
    }))
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    expect(container.textContent).toContain("không giới hạn")
  })

  it("shows '—' for a deleted variant's remaining stock, never 0", async () => {
    adminGetDropStats.mockResolvedValue(dropStats({
      variants: [{ variant_id: null, product_name: "Old card", variant_label: "B2", sold: 2, deleted: true, unlimited: false, remaining: null, sell_through: null, time_to_sellout_days: null }],
    }))
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    const table = container.querySelector("table")
    expect(table.textContent).toContain("—")
    expect(table.textContent).not.toMatch(/\b0\b.*Old card|Old card.*\b0\b/)
  })

  it("prints the sell-through honesty caveat (spec: mid-drop restock shifts the number)", async () => {
    adminGetDropStats.mockResolvedValue(dropStats())
    const container = await renderStatsDrop()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    expect(container.textContent).toContain("nhập thêm hàng giữa đợt bán")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- stats/StatsDrop`
Expected: FAIL — the placeholder component has no select, no collection list, no variant table.

- [ ] **Step 3: Implement the component**

Replace `frontend/src/components/stats/StatsDrop.jsx`:

```jsx
import { useEffect, useState } from "react"
import { adminListCollections, adminGetDropStats } from "../../api/shop"
import { formatVnd } from "../../utils/money"

const STATUS_LABELS = {
  pending: "Chờ xử lý", confirmed: "Đã xác nhận", shipped: "Đã gửi",
  completed: "Hoàn tất", cancelled: "Đã hủy",
}

function formatPercent(ratio) {
  if (ratio === null || ratio === undefined) return "—"
  return `${Math.round(ratio * 1000) / 10}%`
}

export default function StatsDrop() {
  const [collections, setCollections] = useState([])
  const [collectionId, setCollectionId] = useState("")
  const [stats, setStats] = useState(null)
  const [error, setError] = useState("")

  useEffect(() => {
    adminListCollections().then(setCollections).catch(() => setCollections([]))
  }, [])

  useEffect(() => {
    if (!collectionId) { setStats(null); return }
    setError("")
    adminGetDropStats(collectionId).then(setStats).catch(() => {
      setStats(null)
      setError("Không tải được thống kê cho bộ sưu tập này")
    })
  }, [collectionId])

  return (
    <div>
      <label className="flex flex-col text-xs gap-1 mb-4 max-w-xs">
        Bộ sưu tập
        <select
          value={collectionId}
          onChange={(e) => setCollectionId(e.target.value)}
          className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        >
          <option value="">— Chọn một bộ sưu tập —</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      </label>

      {error && <p className="text-red-500 mb-3">{error}</p>}
      {!collectionId && <p className="opacity-60">Chọn một bộ sưu tập để xem thống kê.</p>}

      {stats && (
        Object.values(stats.order_counts).every((c) => c === 0) ? (
          <p className="opacity-60">Bộ sưu tập này chưa có đơn hàng nào.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Đã nhận</p>
                <p className="text-lg font-semibold">{formatVnd(stats.received_total)}</p>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Chờ thanh toán</p>
                <p className="text-lg font-semibold">{formatVnd(stats.awaiting_payment)}</p>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Thu khi giao</p>
                <p className="text-lg font-semibold">{formatVnd(stats.to_collect)}</p>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Đã mất</p>
                <p className="text-lg font-semibold">{formatVnd(stats.lost)}</p>
              </div>
            </div>

            <p className="mb-2 text-sm">
              Số đơn: {Object.entries(stats.order_counts).map(([s, c]) => `${STATUS_LABELS[s]} ${c}`).join(" · ")}
            </p>
            <p className="mb-2 text-sm">Tổng số lượng đã bán: {stats.units_sold}</p>
            <p className="mb-2 text-sm">
              Giao hàng: {stats.fulfillment_counts.ship} · Nhận tại chỗ: {stats.fulfillment_counts.pickup}
            </p>
            <p className="mb-4 text-sm">
              Tỷ lệ hết hạn:{" "}
              {stats.expiry_rate === null
                ? "— (không có đơn trả trước)"
                : `${formatPercent(stats.expiry_rate)} (${stats.expired_order_count}/${stats.prepaid_order_count} đơn trả trước)`}
            </p>

            <p className="mb-2 text-xs opacity-60">
              Tỷ lệ bán hết được tính trên số lượng tồn kho hiện tại, không phải tồn kho gốc — nếu
              admin đã nhập thêm hàng giữa đợt bán, tỷ lệ này sẽ thay đổi theo.
            </p>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left opacity-70">
                  <th className="pr-2">Sản phẩm</th>
                  <th className="pr-2">Phân loại</th>
                  <th className="pr-2">Đã bán</th>
                  <th className="pr-2">Còn lại</th>
                  <th className="pr-2">Tỷ lệ bán hết</th>
                  <th>Thời gian bán hết</th>
                </tr>
              </thead>
              <tbody>
                {stats.variants.map((v, i) => (
                  <tr key={v.variant_id ?? `deleted-${i}`} className="border-t border-[var(--border-brand)]">
                    <td className="pr-2 py-1">{v.product_name}</td>
                    <td className="pr-2 py-1">{v.variant_label}</td>
                    <td className="pr-2 py-1">{v.sold}</td>
                    <td className="pr-2 py-1">
                      {v.deleted ? "—" : v.unlimited ? "không giới hạn" : v.remaining}
                    </td>
                    <td className="pr-2 py-1">
                      {v.unlimited || v.deleted ? "—" : formatPercent(v.sell_through)}
                    </td>
                    <td className="py-1">
                      {v.time_to_sellout_days === null ? "—" : `${Math.ceil(v.time_to_sellout_days)} ngày`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- stats/StatsDrop`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/stats/StatsDrop.jsx frontend/src/components/stats/StatsDrop.test.jsx
git commit -F - <<'EOF'
feat(stats): implement the drop-view component

Collection picker feeding a real-time load of getDropStats. Unlimited
variants render "không giới hạn" rather than a stock number or a percentage,
and deleted variants render "—" for remaining stock rather than 0, which
would falsely read as sold out — both mirrored exactly from the backend's
DropStats null-vs-flag contract established in statsRepo.js.
EOF
```

---

### Task 9: Restock view component

**Files:**
- Modify: `frontend/src/components/stats/StatsRestock.jsx`
- Test: `frontend/src/components/stats/StatsRestock.test.jsx`

**Interfaces:**
- Consumes: `adminGetRestockStats` (Task 7).
- No new exports consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/stats/StatsRestock.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminGetRestockStats = vi.fn()

vi.mock("../../api/shop", () => ({
  adminGetRestockStats: (...args) => adminGetRestockStats(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: StatsRestock } = await import("./StatsRestock")

async function renderStatsRestock() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<StatsRestock />) })
  return container
}

async function flush() {
  await act(async () => {})
}

beforeEach(() => {
  adminGetRestockStats.mockReset()
})

describe("StatsRestock", () => {
  it("shows an empty state with no data", async () => {
    adminGetRestockStats.mockResolvedValue([])
    const container = await renderStatsRestock()
    await flush()
    expect(container.textContent).toContain("Chưa có dữ liệu")
  })

  it("renders one row per variant, in the order the API returned them", async () => {
    adminGetRestockStats.mockResolvedValue([
      { variant_id: 1, label: "A1", product_name: "Fast card", collection_id: 1, collection_title: "Drop", stock_qty: 0, unlimited: false, remaining: 0, sold: 20, velocity: 5, sell_through: 1, time_to_sellout_days: 4 },
      { variant_id: 2, label: "B1", product_name: "Slow card", collection_id: 1, collection_title: "Drop", stock_qty: 90, unlimited: false, remaining: 90, sold: 1, velocity: 0.1, sell_through: 0.01, time_to_sellout_days: null },
    ])
    const container = await renderStatsRestock()
    await flush()

    const rows = container.querySelectorAll("tbody tr")
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain("Fast card")
    expect(rows[1].textContent).toContain("Slow card")
  })

  it("shows 'không giới hạn' for an unlimited variant's remaining and sell-through", async () => {
    adminGetRestockStats.mockResolvedValue([
      { variant_id: 3, label: "C1", product_name: "Sticker", collection_id: 1, collection_title: "Drop", stock_qty: null, unlimited: true, remaining: null, sold: 10, velocity: 2, sell_through: null, time_to_sellout_days: null },
    ])
    const container = await renderStatsRestock()
    await flush()

    const row = container.querySelector("tbody tr")
    expect(row.textContent).toContain("không giới hạn")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- stats/StatsRestock`
Expected: FAIL — the placeholder component has no table.

- [ ] **Step 3: Implement the component**

Replace `frontend/src/components/stats/StatsRestock.jsx`:

```jsx
import { useEffect, useState } from "react"
import { adminGetRestockStats } from "../../api/shop"

function formatPercent(ratio) {
  if (ratio === null || ratio === undefined) return "—"
  return `${Math.round(ratio * 1000) / 10}%`
}

export default function StatsRestock() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState("")

  useEffect(() => {
    adminGetRestockStats().then(setRows).catch(() => setError("Không tải được thống kê restock"))
  }, [])

  return (
    <div>
      <p className="text-sm opacity-70 mb-3">
        Vận tốc bán = số lượng đã bán ÷ số ngày mở bán. Một khi một phân loại đã bán hết, nhu cầu
        thực tế sau đó không còn hiển thị được — thời gian bán hết là ước lượng tốt nhất, không
        phải nhu cầu thật.
      </p>
      {error && <p className="text-red-500 mb-3">{error}</p>}
      {rows.length === 0 && !error && <p className="opacity-60">Chưa có dữ liệu.</p>}

      {rows.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left opacity-70">
              <th className="pr-2">Bộ sưu tập</th>
              <th className="pr-2">Sản phẩm</th>
              <th className="pr-2">Phân loại</th>
              <th className="pr-2">Đã bán</th>
              <th className="pr-2">Còn lại</th>
              <th className="pr-2">Vận tốc (đơn vị/ngày)</th>
              <th>Tỷ lệ bán hết</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.variant_id} className="border-t border-[var(--border-brand)]">
                <td className="pr-2 py-1">{v.collection_title}</td>
                <td className="pr-2 py-1">{v.product_name}</td>
                <td className="pr-2 py-1">{v.label}</td>
                <td className="pr-2 py-1">{v.sold}</td>
                <td className="pr-2 py-1">{v.unlimited ? "không giới hạn" : v.remaining}</td>
                <td className="pr-2 py-1">{v.velocity.toFixed(2)}</td>
                <td className="py-1">{v.unlimited ? "không giới hạn" : formatPercent(v.sell_through)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- stats/StatsRestock`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/stats/StatsRestock.jsx frontend/src/components/stats/StatsRestock.test.jsx
git commit -F - <<'EOF'
feat(stats): implement the restock-view component

Renders getRestockStats() as a table sorted by velocity (the backend does
the sort; the frontend just renders in the order it received). Unlimited
variants show "không giới hạn" for both remaining stock and sell-through
rather than a stock number or a misleading percentage.

The known-limitation note (a sold-out variant's true demand is invisible
past the sellout point) is printed on the page per the spec's Restock view
section, not just left in a code comment.
EOF
```

---

### Task 10: Bookkeeping view component

**Files:**
- Modify: `frontend/src/components/stats/StatsBookkeeping.jsx`
- Test: `frontend/src/components/stats/StatsBookkeeping.test.jsx`

**Interfaces:**
- Consumes: `adminGetBookkeepingStats`, `adminDownloadBookkeepingCsv` (Task 7), `formatVnd` (existing).
- No new exports consumed by later tasks — last task in the plan.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/stats/StatsBookkeeping.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminGetBookkeepingStats = vi.fn()
const adminDownloadBookkeepingCsv = vi.fn()

vi.mock("../../api/shop", () => ({
  adminGetBookkeepingStats: (...args) => adminGetBookkeepingStats(...args),
  adminDownloadBookkeepingCsv: (...args) => adminDownloadBookkeepingCsv(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.URL.createObjectURL = vi.fn(() => "blob:mock")
globalThis.URL.revokeObjectURL = vi.fn()

const { default: StatsBookkeeping } = await import("./StatsBookkeeping")

function bookkeepingStats(over = {}) {
  return {
    date_from: "2026-08-01", date_to: "2026-08-08",
    received: { bank: 100000, momo: 20000, paypal: 0, cod: 30000 }, received_total: 150000,
    awaiting_payment: 40000, to_collect: 10000, lost: 5000, shipping_cost: 25000,
    by_collection: [
      { collection_id: 1, collection_title: "Drop hè", received_total: 150000, awaiting_payment: 40000, to_collect: 10000, lost: 5000 },
    ],
    ...over,
  }
}

async function renderStatsBookkeeping() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<StatsBookkeeping />) })
  return container
}

async function flush() {
  await act(async () => {})
}

async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
}

beforeEach(() => {
  adminGetBookkeepingStats.mockReset()
  adminDownloadBookkeepingCsv.mockReset()
})

describe("StatsBookkeeping", () => {
  it("loads and renders totals when 'Xem' is clicked", async () => {
    adminGetBookkeepingStats.mockResolvedValue(bookkeepingStats())
    const container = await renderStatsBookkeeping()
    await flush()

    const viewButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xem")
    await click(viewButton)

    expect(adminGetBookkeepingStats).toHaveBeenCalled()
    expect(container.textContent).toContain("150.000₫")
    expect(container.textContent).toContain("Drop hè")
  })

  it("shows an explicit empty state for a range with no orders", async () => {
    adminGetBookkeepingStats.mockResolvedValue(bookkeepingStats({ by_collection: [], received_total: 0 }))
    const container = await renderStatsBookkeeping()
    await flush()
    const viewButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xem")
    await click(viewButton)

    expect(container.textContent).toContain("Không có đơn hàng nào")
  })

  it("downloads the CSV with the same date params shown on screen", async () => {
    adminGetBookkeepingStats.mockResolvedValue(bookkeepingStats())
    adminDownloadBookkeepingCsv.mockResolvedValue(new Blob(["csv"], { type: "text/csv" }))
    const container = await renderStatsBookkeeping()
    await flush()

    const viewButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xem")
    await click(viewButton)

    const exportButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xuất CSV")
    await click(exportButton)

    expect(adminDownloadBookkeepingCsv).toHaveBeenCalledTimes(1)
    const params = adminDownloadBookkeepingCsv.mock.calls[0][0]
    expect(params.date_from).toBeTruthy()
    expect(params.date_to).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- stats/StatsBookkeeping`
Expected: FAIL — the placeholder component has no date inputs, no buttons.

- [ ] **Step 3: Implement the component**

Replace `frontend/src/components/stats/StatsBookkeeping.jsx`:

```jsx
import { useState } from "react"
import { adminGetBookkeepingStats, adminDownloadBookkeepingCsv } from "../../api/shop"
import { formatVnd } from "../../utils/money"

function todayLocal() {
  return new Date().toISOString().slice(0, 10)
}

export default function StatsBookkeeping() {
  const [dateFrom, setDateFrom] = useState(todayLocal())
  const [dateTo, setDateTo] = useState(todayLocal())
  const [stats, setStats] = useState(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setError("")
    setBusy(true)
    try {
      setStats(await adminGetBookkeepingStats({ date_from: dateFrom, date_to: dateTo }))
    } catch (e) {
      setStats(null)
      setError(e.response?.data?.message || "Không tải được sổ quỹ")
    } finally {
      setBusy(false)
    }
  }

  const downloadCsv = async () => {
    try {
      const blob = await adminDownloadBookkeepingCsv({ date_from: dateFrom, date_to: dateTo })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `so-quy-${dateFrom}-${dateTo}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError("Không xuất được CSV")
    }
  }

  return (
    <div>
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <label className="flex flex-col text-xs gap-1">
          Từ ngày
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent" />
        </label>
        <label className="flex flex-col text-xs gap-1">
          Đến ngày
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent" />
        </label>
        <button type="button" onClick={load} disabled={busy}
          className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] disabled:opacity-50">
          {busy ? "Đang tải..." : "Xem"}
        </button>
        {stats && (
          <button type="button" onClick={downloadCsv}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)]">
            Xuất CSV
          </button>
        )}
      </div>

      {error && <p className="text-red-500 mb-3">{error}</p>}

      {stats && (
        stats.by_collection.length === 0 ? (
          <p className="opacity-60">Không có đơn hàng nào trong khoảng ngày này.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Đã nhận</p>
                <p className="text-lg font-semibold">{formatVnd(stats.received_total)}</p>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Chờ thanh toán</p>
                <p className="text-lg font-semibold">{formatVnd(stats.awaiting_payment)}</p>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Thu khi giao</p>
                <p className="text-lg font-semibold">{formatVnd(stats.to_collect)}</p>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Chi phí ship đã ghi nhận</p>
                <p className="text-lg font-semibold">{formatVnd(stats.shipping_cost)}</p>
              </div>
            </div>

            <p className="mb-2 text-sm">
              Đã nhận theo phương thức: Ngân hàng {formatVnd(stats.received.bank)} · Momo{" "}
              {formatVnd(stats.received.momo)} · PayPal {formatVnd(stats.received.paypal)} · COD{" "}
              {formatVnd(stats.received.cod)}
            </p>
            <p className="mb-4 text-sm text-red-500">Đã mất (đơn hủy): {formatVnd(stats.lost)}</p>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left opacity-70">
                  <th className="pr-2">Bộ sưu tập</th>
                  <th className="pr-2">Đã nhận</th>
                  <th className="pr-2">Chờ thanh toán</th>
                  <th className="pr-2">Thu khi giao</th>
                  <th>Đã mất</th>
                </tr>
              </thead>
              <tbody>
                {stats.by_collection.map((c) => (
                  <tr key={c.collection_id ?? "none"} className="border-t border-[var(--border-brand)]">
                    <td className="pr-2 py-1">{c.collection_title}</td>
                    <td className="pr-2 py-1">{formatVnd(c.received_total)}</td>
                    <td className="pr-2 py-1">{formatVnd(c.awaiting_payment)}</td>
                    <td className="pr-2 py-1">{formatVnd(c.to_collect)}</td>
                    <td className="py-1">{formatVnd(c.lost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- stats/StatsBookkeeping`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full frontend suite, build, and lint**

Run:
```bash
cd frontend && npm test && npm run build && npm run lint
```
Expected: `npm test` PASS with no regressions. `npm run build` succeeds (a pre-existing >500KB chunk-size warning is fine). `npm run lint` shows exactly the one pre-existing `Portfolio.jsx` error noted in Global Constraints — no new errors from any file this plan touched.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/stats/StatsBookkeeping.jsx frontend/src/components/stats/StatsBookkeeping.test.jsx
git commit -F - <<'EOF'
feat(stats): implement the bookkeeping-view component and CSV export

Date range picker driving getBookkeepingStats, with a received breakdown by
payment method, recorded shipping cost shown as a cost, and a per-collection
table including the "no collection" bucket the backend always returns
explicitly. "Xuất CSV" downloads the server-generated CSV as a blob using
the exact same date params the screen is showing, so the file can never
describe a different range than what's displayed.

This is the last task in Plan 4 — the full Thống kê tab (drop, restock,
bookkeeping) is now feature-complete pending manual acceptance per
2026-08-08-merch-shop-4-verification.md.
EOF
```
