# Merch Shop - Plan 2: Cart, Checkout & Orders

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A buyer can add merch to a cart, check out without an account, and receive an order page; stock is reserved atomically at order placement; the seller can move orders through their lifecycle in the admin; abandoned prepaid orders expire and return their stock.

**Architecture:** Two new tables (`orders`, `order_items`) plus a `backend/shop/orders/` module holding pure domain logic (totals, status machine, tokens) separately from the transactional repository. Reservation happens inside a single MySQL transaction using `SELECT ... FOR UPDATE` on variant rows locked in deterministic id order. The cart is client-side only. The expiry sweep extends the existing `worker.js` loop - no new process.

**Tech Stack:** As Plan 1, plus `crypto` (Node built-in) for order tokens and Goong.io for address autocomplete.

**Depends on:** Plan 1 complete, its verification checklist fully PASS.

## Global Constraints

Everything in Plan 1's Global Constraints still applies (raw mysql2 queries, `{error, message}` Vietnamese error shape, integer VND, WebP images, bracketed log prefixes, bilingual UI chrome, Conventional Commits with descriptive bodies and no `Co-Authored-By` trailer). Additionally:

- **The server never trusts client-supplied money or stock.** Prices are re-read from `products` inside the reservation transaction and snapshotted. A client-sent price or total is ignored entirely. The cart sends only `{variant_id, qty}`.
- **Reservation is transactional.** Stock is decremented in the same transaction that inserts the order. A partial write is a blocking defect.
- **Variant rows are locked in ascending id order** in every transaction that touches more than one, so concurrent orders cannot deadlock by grabbing the same rows in opposite orders.
- **`stock_qty IS NULL` means unlimited** and is never decremented, never checked against, and never released.
- **COD orders never get an `expires_at`** and must be invisible to the expiry sweep.
- **Stock is released exactly once per order**, guarded by `orders.stock_released_at`.
- **Order tokens** come from `crypto.randomBytes(16).toString("hex")` - 128 bits, no sequential component.
- **Payment instructions, proof upload, emails, and QR are Plan 3.** Plan 2 records `payment_method` on the order and shows a placeholder on the order page. This plan ships a complete, testable order lifecycle without them.

---

### Task 1: Order schema

**Files:**
- Create: `backend/migrations/010_create_orders.js`
- Create: `backend/migrations/011_create_order_items.js`
- Test: `backend/tests/orderSchema.test.js`

**Interfaces:**
- Produces tables:

```
orders        id, order_token (unique), request_key (unique, nullable),
              buyer_name, phone, email,
              fulfillment_method ENUM(ship|pickup),
              address_street, address_ward, address_district, address_province, address_raw,
              note, status ENUM(pending|confirmed|shipped|completed|cancelled),
              payment_method ENUM(bank|momo|paypal|cod),
              total INT UNSIGNED, shipping_fee INT UNSIGNED NULL, cod_amount INT UNSIGNED NULL,
              tracking_code, collection_id FK→collections SET NULL,
              stock_released_at, created_at, confirmed_at, expires_at NULL

order_items   id, order_id FK→orders CASCADE,
              product_variant_id FK→product_variants SET NULL,
              product_name_snapshot, variant_label_snapshot,
              unit_price_snapshot INT UNSIGNED, qty INT UNSIGNED
```

- [ ] **Step 1: Write the failing test**

Create `backend/tests/orderSchema.test.js`:

```js
const { describe, it, expect } = require("vitest")
const db = require("../db")

async function columns(table) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE, COLUMN_KEY
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  )
  return Object.fromEntries(rows.map((r) => [r.COLUMN_NAME, r]))
}

describe("orders schema", () => {
  it("has the lifecycle and reservation columns", async () => {
    const c = await columns("orders")
    expect(Object.keys(c)).toEqual(expect.arrayContaining([
      "id", "order_token", "request_key", "buyer_name", "phone", "email",
      "fulfillment_method", "address_street", "address_ward", "address_district",
      "address_province", "address_raw", "note", "status", "payment_method",
      "total", "shipping_fee", "cod_amount", "tracking_code", "collection_id",
      "stock_released_at", "created_at", "confirmed_at", "expires_at",
    ]))
  })

  it("stores money as unsigned integers", async () => {
    const c = await columns("orders")
    expect(c.total.COLUMN_TYPE).toBe("int unsigned")
    expect(c.shipping_fee.COLUMN_TYPE).toBe("int unsigned")
    expect(c.cod_amount.COLUMN_TYPE).toBe("int unsigned")
  })

  it("allows a null expires_at, which is how COD orders avoid the sweep", async () => {
    const c = await columns("orders")
    expect(c.expires_at.IS_NULLABLE).toBe("YES")
  })

  it("enforces unique order_token and request_key", async () => {
    const c = await columns("orders")
    expect(c.order_token.COLUMN_KEY).toBe("UNI")
    expect(c.request_key.COLUMN_KEY).toBe("UNI")
  })

  it("covers every lifecycle status", async () => {
    const c = await columns("orders")
    for (const s of ["pending", "confirmed", "shipped", "completed", "cancelled"]) {
      expect(c.status.COLUMN_TYPE).toContain(s)
    }
  })
})

describe("order_items schema", () => {
  it("snapshots name, label and price", async () => {
    const c = await columns("order_items")
    expect(Object.keys(c)).toEqual(expect.arrayContaining([
      "id", "order_id", "product_variant_id",
      "product_name_snapshot", "variant_label_snapshot", "unit_price_snapshot", "qty",
    ]))
    expect(c.unit_price_snapshot.COLUMN_TYPE).toBe("int unsigned")
  })

  it("keeps product_variant_id nullable so deleting a variant cannot erase history", async () => {
    const c = await columns("order_items")
    expect(c.product_variant_id.IS_NULLABLE).toBe("YES")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- orderSchema`
Expected: FAIL - tables do not exist.

- [ ] **Step 3: Create the orders migration**

Create `backend/migrations/010_create_orders.js`:

```js
exports.up = function (knex) {
  return knex.schema.createTable("orders", (table) => {
    table.increments("id").primary()

    // 128-bit random; the only thing protecting the buyer's order page.
    table.string("order_token", 64).notNullable().unique()
    // Client-supplied idempotency key: a retry of the same submit reuses the order.
    table.string("request_key", 64).nullable().unique()

    table.string("buyer_name").notNullable()
    table.string("phone", 32).notNullable()
    table.string("email").notNullable()

    table.enu("fulfillment_method", ["ship", "pickup"]).notNullable()
    table.string("address_street", 512).nullable()
    table.string("address_ward").nullable()
    table.string("address_district").nullable()
    table.string("address_province").nullable()
    table.text("address_raw").nullable()

    table.text("note").nullable()

    table.enu("status", ["pending", "confirmed", "shipped", "completed", "cancelled"])
      .notNullable().defaultTo("pending")
    table.enu("payment_method", ["bank", "momo", "paypal", "cod"]).notNullable()

    // Merch only. Shipping is receiver-pays and never part of the total.
    table.integer("total").unsigned().notNullable()
    // Recorded after the fact for bookkeeping; never charged to the buyer.
    table.integer("shipping_fee").unsigned().nullable()
    table.integer("cod_amount").unsigned().nullable()

    table.string("tracking_code").nullable()

    // Kept for admin filtering; SET NULL so deleting a collection never
    // destroys order history.
    table.integer("collection_id").unsigned().nullable()
      .references("id").inTable("collections").onDelete("SET NULL")

    // Guards against releasing reserved stock twice.
    table.timestamp("stock_released_at").nullable()

    table.timestamp("created_at").defaultTo(knex.fn.now())
    table.timestamp("confirmed_at").nullable()
    // NULL for COD: there is no payment to wait for, so the sweep must skip it.
    table.timestamp("expires_at").nullable()

    table.index(["status", "expires_at"], "idx_orders_status_expires")
    table.index(["status", "created_at"], "idx_orders_status_created")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("orders")
}
```

- [ ] **Step 4: Create the order_items migration**

Create `backend/migrations/011_create_order_items.js`:

```js
exports.up = function (knex) {
  return knex.schema.createTable("order_items", (table) => {
    table.increments("id").primary()

    table.integer("order_id").unsigned().notNullable()
      .references("id").inTable("orders").onDelete("CASCADE")

    // SET NULL, never CASCADE: deleting a variant must not erase the record of
    // what somebody bought and paid for.
    table.integer("product_variant_id").unsigned().nullable()
      .references("id").inTable("product_variants").onDelete("SET NULL")

    // Snapshots, so later catalog edits cannot rewrite order history.
    table.string("product_name_snapshot").notNullable()
    table.string("variant_label_snapshot").notNullable()
    table.integer("unit_price_snapshot").unsigned().notNullable()
    table.integer("qty").unsigned().notNullable()

    table.index("order_id", "idx_order_items_order")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("order_items")
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- orderSchema`
Expected: PASS, 7 tests.

- [ ] **Step 6: Add the order tables to the test reset helper**

In `backend/tests/setup.js` (or wherever `resetTables` is invoked per Plan 1), ensure the truncation list is now, in this order:

```js
const TABLES = ["order_items", "orders", "product_variants", "products", "collections"]
```

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/010_create_orders.js backend/migrations/011_create_order_items.js \
        backend/tests/orderSchema.test.js backend/tests/setup.js
git commit -F - <<'EOF'
feat(orders): add orders and order_items tables

Schema for the order lifecycle, per the phase 1-3 design doc.

Money is int unsigned VND throughout. total covers merch only, because
ViettelPost ships receiver-pays and the buyer settles carriage with the
shipper; shipping_fee exists purely so the seller can record the real cost
afterwards for bookkeeping.

expires_at is nullable because COD orders have no payment to wait for and must
be invisible to the reservation sweep. stock_released_at guards against
returning the same reserved stock twice when a cancel races an expiry.

Two foreign keys deliberately use SET NULL rather than CASCADE:
order_items.product_variant_id and orders.collection_id. Deleting a variant or
a collection must never erase the record of what somebody bought and paid for,
and the snapshot columns mean the order still reads correctly without them.
EOF
```

---

### Task 2: Order domain logic

Pure functions, no I/O. This is where the money and lifecycle rules live, so they can be tested exhaustively and cheaply.

**Files:**
- Create: `backend/shop/orders/domain.js`
- Test: `backend/tests/orderDomain.test.js`

**Interfaces:**
- Produces `backend/shop/orders/domain.js` exporting:
  - `generateOrderToken(): string` - 32 hex chars.
  - `computeTotal(items: {unit_price_snapshot:number, qty:number}[]): number`
  - `canTransition(from: string, to: string, fulfillment: string): boolean`
  - `computeExpiry(paymentMethod: string, now: Date, hours: number): Date|null`
  - `isReservable(stockQty: number|null, qty: number): boolean`
  - `RESERVATION_HOURS: number` (48)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/orderDomain.test.js`:

```js
const { describe, it, expect } = require("vitest")
const d = require("../shop/orders/domain")

describe("generateOrderToken", () => {
  it("is 32 hex characters (128 bits)", () => {
    expect(d.generateOrderToken()).toMatch(/^[0-9a-f]{32}$/)
  })

  it("does not repeat across many generations", () => {
    const tokens = new Set(Array.from({ length: 5000 }, () => d.generateOrderToken()))
    expect(tokens.size).toBe(5000)
  })
})

describe("computeTotal", () => {
  it("sums price times quantity", () => {
    expect(d.computeTotal([
      { unit_price_snapshot: 35000, qty: 3 },
      { unit_price_snapshot: 90000, qty: 1 },
    ])).toBe(195000)
  })

  it("is 0 for an empty cart", () => {
    expect(d.computeTotal([])).toBe(0)
  })

  it("stays an exact integer at large quantities", () => {
    expect(d.computeTotal([{ unit_price_snapshot: 999999, qty: 999 }])).toBe(998999001)
    expect(Number.isInteger(d.computeTotal([{ unit_price_snapshot: 35000, qty: 7 }]))).toBe(true)
  })

  it("throws on a non-integer price rather than silently rounding", () => {
    expect(() => d.computeTotal([{ unit_price_snapshot: 35000.5, qty: 1 }])).toThrow()
  })

  it("throws on a negative quantity", () => {
    expect(() => d.computeTotal([{ unit_price_snapshot: 35000, qty: -1 }])).toThrow()
  })
})

describe("isReservable", () => {
  it("always allows unlimited stock", () => {
    expect(d.isReservable(null, 1)).toBe(true)
    expect(d.isReservable(null, 9999)).toBe(true)
  })

  it("allows exactly the remaining quantity", () => {
    expect(d.isReservable(3, 3)).toBe(true)
  })

  it("refuses more than remains", () => {
    expect(d.isReservable(3, 4)).toBe(false)
  })

  it("refuses anything when sold out", () => {
    expect(d.isReservable(0, 1)).toBe(false)
  })

  it("refuses a zero or negative request", () => {
    expect(d.isReservable(5, 0)).toBe(false)
    expect(d.isReservable(5, -1)).toBe(false)
  })
})

describe("computeExpiry", () => {
  const now = new Date("2026-08-07T10:00:00Z")

  it("gives prepaid orders a deadline", () => {
    expect(d.computeExpiry("bank", now, 48)).toEqual(new Date("2026-08-09T10:00:00Z"))
    expect(d.computeExpiry("momo", now, 48)).not.toBeNull()
    expect(d.computeExpiry("paypal", now, 48)).not.toBeNull()
  })

  it("never expires COD, which has no payment to wait for", () => {
    expect(d.computeExpiry("cod", now, 48)).toBeNull()
  })
})

describe("canTransition", () => {
  it("allows the prepaid ship path", () => {
    expect(d.canTransition("pending", "confirmed", "ship")).toBe(true)
    expect(d.canTransition("confirmed", "shipped", "ship")).toBe(true)
    expect(d.canTransition("shipped", "completed", "ship")).toBe(true)
  })

  it("lets pickup orders skip shipped", () => {
    expect(d.canTransition("confirmed", "completed", "pickup")).toBe(true)
  })

  it("refuses shipping a pickup order", () => {
    expect(d.canTransition("confirmed", "shipped", "pickup")).toBe(false)
  })

  it("refuses skipping confirmation", () => {
    expect(d.canTransition("pending", "shipped", "ship")).toBe(false)
    expect(d.canTransition("pending", "completed", "ship")).toBe(false)
  })

  it("allows cancelling anything not already terminal", () => {
    expect(d.canTransition("pending", "cancelled", "ship")).toBe(true)
    expect(d.canTransition("confirmed", "cancelled", "ship")).toBe(true)
    expect(d.canTransition("shipped", "cancelled", "ship")).toBe(true)
  })

  it("treats completed and cancelled as terminal", () => {
    for (const to of ["pending", "confirmed", "shipped", "completed", "cancelled"]) {
      expect(d.canTransition("completed", to, "ship")).toBe(false)
      expect(d.canTransition("cancelled", to, "ship")).toBe(false)
    }
  })

  it("refuses going backwards", () => {
    expect(d.canTransition("confirmed", "pending", "ship")).toBe(false)
    expect(d.canTransition("shipped", "confirmed", "ship")).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- orderDomain`
Expected: FAIL with `Cannot find module '../shop/orders/domain'`.

- [ ] **Step 3: Implement the domain module**

Create `backend/shop/orders/domain.js`:

```js
const crypto = require("crypto")

const RESERVATION_HOURS = Number(process.env.RESERVATION_HOURS) || 48

/** 128 bits of entropy. This token is the only thing guarding the order page. */
function generateOrderToken() {
  return crypto.randomBytes(16).toString("hex")
}

/**
 * Sum the order. Throws rather than coercing, because a non-integer price or a
 * negative quantity reaching this point means something upstream is broken and
 * silently rounding it would produce a wrong charge.
 */
function computeTotal(items) {
  let total = 0
  for (const item of items) {
    const price = item.unit_price_snapshot
    const qty = item.qty
    if (!Number.isInteger(price) || price < 0) {
      throw new Error(`Giá không hợp lệ: ${price}`)
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error(`Số lượng không hợp lệ: ${qty}`)
    }
    total += price * qty
  }
  return total
}

/** null stock means unlimited and is always reservable. */
function isReservable(stockQty, qty) {
  if (!Number.isInteger(qty) || qty <= 0) return false
  if (stockQty === null || stockQty === undefined) return true
  return stockQty >= qty
}

/** COD has nothing to wait for, so it never expires. */
function computeExpiry(paymentMethod, now = new Date(), hours = RESERVATION_HOURS) {
  if (paymentMethod === "cod") return null
  return new Date(now.getTime() + hours * 60 * 60 * 1000)
}

const TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["shipped", "completed", "cancelled"],
  shipped: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
}

/**
 * Pickup orders go confirmed -> completed directly: there is nothing to ship
 * and no tracking code to give.
 */
function canTransition(from, to, fulfillment) {
  const allowed = TRANSITIONS[from]
  if (!allowed || !allowed.includes(to)) return false
  if (fulfillment === "pickup" && to === "shipped") return false
  return true
}

module.exports = {
  RESERVATION_HOURS,
  generateOrderToken,
  computeTotal,
  isReservable,
  computeExpiry,
  canTransition,
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- orderDomain`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/shop/orders/domain.js backend/tests/orderDomain.test.js
git commit -F - <<'EOF'
feat(orders): add pure order domain logic

Totals, tokens, expiry and the status machine live here as pure functions so
the money and lifecycle rules can be covered exhaustively without a database.

computeTotal throws on a non-integer price or a non-positive quantity instead
of coercing. If a fractional price reaches this function something upstream is
already broken, and silently rounding it would produce a wrong charge that
nobody notices until a buyer complains.

canTransition refuses backwards moves, refuses skipping confirmation, treats
completed and cancelled as terminal, and refuses to ship a pickup order, which
goes confirmed straight to completed since there is nothing to hand a carrier.

Order tokens are 128 bits from crypto.randomBytes with no sequential part,
because the token is the only thing protecting a buyer's order page.
EOF
```

---

### Task 3: Transactional reservation

The heart of the feature. Everything else can be repaired by hand; overselling cannot.

**Files:**
- Create: `backend/shop/orders/orderRepo.js`
- Test: `backend/tests/orderRepo.test.js`

**Interfaces:**
- Consumes: `domain.js` (Task 2), `backend/db.js`.
- Produces `backend/shop/orders/orderRepo.js` exporting:
  - `createOrder(input): Promise<{id, order_token, total, reused: boolean}>` where `input` is `{items: [{variant_id, qty}], buyer, fulfillment_method, payment_method, note, request_key}`. Throws `OutOfStockError` (with `.variantLabel`) or `EmptyCartError`.
  - `getOrderByToken(token): Promise<Order & {items: []}|null>`
  - `listOrders(filter): Promise<Order[]>`
  - `getOrderById(id): Promise<Order & {items: []}|null>`
  - `transitionOrder(id, toStatus, extra): Promise<boolean>` - releases stock on `cancelled`, exactly once.
  - `releaseExpiredOrders(now): Promise<number>` - returns how many were expired.
  - `OutOfStockError`, `EmptyCartError`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/orderRepo.test.js`:

```js
const { describe, it, expect, beforeEach } = require("vitest")
const db = require("../db")
const repo = require("../shop/orders/orderRepo")
const catalog = require("../shop/catalogRepo")
const { resetTables } = require("./helpers/db")

const buyer = {
  buyer_name: "Nguyễn Văn A",
  phone: "0900000000",
  email: "a@example.com",
  address_raw: "1 Đường ABC, Q1, TP.HCM",
}

async function seedVariant(stock) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Photocard", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stock }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return { cid, pid, variantId: v.id }
}

const order = (variantId, qty = 1, over = {}) => ({
  items: [{ variant_id: variantId, qty }],
  buyer,
  fulfillment_method: "ship",
  payment_method: "bank",
  ...over,
})

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("createOrder", () => {
  it("reserves stock immediately", async () => {
    const { variantId } = await seedVariant(5)
    await repo.createOrder(order(variantId, 2))

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(3)
  })

  it("computes the total server-side from catalog prices", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 3))
    expect(res.total).toBe(105000)
  })

  it("ignores any client-supplied price or total", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder({
      ...order(variantId, 1),
      total: 1,
      items: [{ variant_id: variantId, qty: 1, unit_price_snapshot: 1, price: 1 }],
    })
    expect(res.total).toBe(35000)

    const [[item]] = await db.query("SELECT unit_price_snapshot FROM order_items LIMIT 1")
    expect(item.unit_price_snapshot).toBe(35000)
  })

  it("snapshots the product name and variant label", async () => {
    const { variantId } = await seedVariant(5)
    await repo.createOrder(order(variantId))

    const [[item]] = await db.query("SELECT * FROM order_items LIMIT 1")
    expect(item.product_name_snapshot).toBe("Photocard")
    expect(item.variant_label_snapshot).toBe("A1")
  })

  it("does not decrement unlimited stock", async () => {
    const { variantId } = await seedVariant(null)
    await repo.createOrder(order(variantId, 100))

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBeNull()
  })

  it("refuses to oversell and leaves stock untouched", async () => {
    const { variantId } = await seedVariant(2)
    await expect(repo.createOrder(order(variantId, 3))).rejects.toThrow(repo.OutOfStockError)

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(2)
    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(0)
  })

  it("rejects an empty cart", async () => {
    await expect(repo.createOrder({ ...order(1), items: [] })).rejects.toThrow(repo.EmptyCartError)
  })

  it("rolls back everything if one line of a multi-item order is short", async () => {
    const { pid, variantId } = await seedVariant(5)
    await catalog.replaceVariants(pid, [
      { label: "A1", stock_qty: 5 },
      { label: "A2", stock_qty: 1 },
    ])
    const [rows] = await db.query("SELECT id, label FROM product_variants ORDER BY label")
    const a1 = rows.find((r) => r.label === "A1")
    const a2 = rows.find((r) => r.label === "A2")

    await expect(repo.createOrder({
      ...order(a1.id),
      items: [{ variant_id: a1.id, qty: 1 }, { variant_id: a2.id, qty: 5 }],
    })).rejects.toThrow(repo.OutOfStockError)

    const [after] = await db.query("SELECT label, stock_qty FROM product_variants ORDER BY label")
    expect(after.map((r) => r.stock_qty)).toEqual([5, 1])
    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(0)
    void variantId
  })

  it("sets an expiry for prepaid orders", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId))
    const [[o]] = await db.query("SELECT expires_at FROM orders WHERE id = ?", [res.id])
    expect(o.expires_at).not.toBeNull()
  })

  it("never sets an expiry for COD", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1, { payment_method: "cod" }))
    const [[o]] = await db.query("SELECT expires_at, cod_amount FROM orders WHERE id = ?", [res.id])
    expect(o.expires_at).toBeNull()
    expect(o.cod_amount).toBe(35000)
  })

  it("reuses the existing order when the same request_key is replayed", async () => {
    const { variantId } = await seedVariant(5)
    const first = await repo.createOrder(order(variantId, 1, { request_key: "abc123" }))
    const second = await repo.createOrder(order(variantId, 1, { request_key: "abc123" }))

    expect(second.reused).toBe(true)
    expect(second.order_token).toBe(first.order_token)

    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(1)
    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(4) // reserved once, not twice
  })
})

describe("transitionOrder", () => {
  it("releases stock when cancelled", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2))

    await repo.transitionOrder(res.id, "cancelled")

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5)
  })

  it("does not release stock twice when cancelled twice", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2))

    await repo.transitionOrder(res.id, "cancelled")
    await repo.transitionOrder(res.id, "cancelled")

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5)
  })

  it("does not release unlimited stock", async () => {
    const { variantId } = await seedVariant(null)
    const res = await repo.createOrder(order(variantId, 3))
    await repo.transitionOrder(res.id, "cancelled")

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBeNull()
  })

  it("refuses an illegal transition", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId))
    expect(await repo.transitionOrder(res.id, "shipped")).toBe(false)
  })

  it("refuses to ship a pickup order", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1, { fulfillment_method: "pickup" }))
    await repo.transitionOrder(res.id, "confirmed")
    expect(await repo.transitionOrder(res.id, "shipped")).toBe(false)
    expect(await repo.transitionOrder(res.id, "completed")).toBe(true)
  })

  it("stamps confirmed_at on confirmation", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId))
    await repo.transitionOrder(res.id, "confirmed")

    const [[o]] = await db.query("SELECT confirmed_at FROM orders WHERE id = ?", [res.id])
    expect(o.confirmed_at).not.toBeNull()
  })
})

describe("releaseExpiredOrders", () => {
  it("cancels overdue prepaid orders and returns their stock", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2))
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?",
      [new Date(Date.now() - 1000), res.id])

    const count = await repo.releaseExpiredOrders(new Date())
    expect(count).toBe(1)

    const [[o]] = await db.query("SELECT status FROM orders WHERE id = ?", [res.id])
    expect(o.status).toBe("cancelled")
    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5)
  })

  it("never touches COD orders", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2, { payment_method: "cod" }))

    expect(await repo.releaseExpiredOrders(new Date())).toBe(0)
    const [[o]] = await db.query("SELECT status FROM orders WHERE id = ?", [res.id])
    expect(o.status).toBe("pending")
  })

  it("never touches confirmed orders even if overdue", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2))
    await repo.transitionOrder(res.id, "confirmed")
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?",
      [new Date(Date.now() - 1000), res.id])

    expect(await repo.releaseExpiredOrders(new Date())).toBe(0)
  })

  it("leaves orders that have not yet expired alone", async () => {
    const { variantId } = await seedVariant(5)
    await repo.createOrder(order(variantId, 2))
    expect(await repo.releaseExpiredOrders(new Date())).toBe(0)
  })
})

describe("getOrderByToken", () => {
  it("returns the order with its items", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2))

    const found = await repo.getOrderByToken(res.order_token)
    expect(found.total).toBe(70000)
    expect(found.items).toHaveLength(1)
    expect(found.items[0].variant_label_snapshot).toBe("A1")
  })

  it("returns null for an unknown token", async () => {
    expect(await repo.getOrderByToken("deadbeef".repeat(4))).toBeNull()
  })

  it("still reads correctly after its variant is deleted", async () => {
    const { pid, variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1))
    await db.query("DELETE FROM product_variants WHERE id = ?", [variantId])

    const found = await repo.getOrderByToken(res.order_token)
    expect(found.items[0].product_name_snapshot).toBe("Photocard")
    expect(found.items[0].unit_price_snapshot).toBe(35000)
    void pid
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- orderRepo`
Expected: FAIL with `Cannot find module '../shop/orders/orderRepo'`.

- [ ] **Step 3: Implement the repository**

Create `backend/shop/orders/orderRepo.js`:

```js
const db = require("./../../db")
const domain = require("./domain")

class OutOfStockError extends Error {
  constructor(variantLabel) {
    super(`Hết hàng: ${variantLabel}`)
    this.name = "OutOfStockError"
    this.variantLabel = variantLabel
  }
}

class EmptyCartError extends Error {
  constructor() {
    super("Giỏ hàng trống")
    this.name = "EmptyCartError"
  }
}

async function findByRequestKey(conn, requestKey) {
  const [[row]] = await conn.query(
    "SELECT id, order_token, total FROM orders WHERE request_key = ? LIMIT 1",
    [requestKey]
  )
  return row || null
}

/**
 * Create an order and reserve its stock in one transaction.
 *
 * Prices come from the catalog inside the transaction - never from the client,
 * which sends only {variant_id, qty}. Variant rows are locked FOR UPDATE in
 * ascending id order so two concurrent orders touching the same variants
 * cannot deadlock by grabbing them in opposite orders.
 */
async function createOrder(input) {
  const items = Array.isArray(input.items) ? input.items : []
  if (!items.length) throw new EmptyCartError()

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    // Idempotency: a retried submit must not reserve stock a second time.
    if (input.request_key) {
      const existing = await findByRequestKey(conn, input.request_key)
      if (existing) {
        await conn.commit()
        return { ...existing, reused: true }
      }
    }

    // Deterministic lock order prevents deadlock under concurrency.
    const wanted = new Map()
    for (const item of items) {
      const id = Number(item.variant_id)
      const qty = Number(item.qty)
      wanted.set(id, (wanted.get(id) || 0) + qty)
    }
    const ids = [...wanted.keys()].sort((a, b) => a - b)

    const [rows] = await conn.query(
      `SELECT v.id, v.label, v.stock_qty, p.id AS product_id, p.name AS product_name,
              p.price, p.collection_id
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.id IN (${ids.map(() => "?").join(",")})
        ORDER BY v.id ASC
        FOR UPDATE`,
      ids
    )
    if (rows.length !== ids.length) throw new OutOfStockError("không tồn tại")

    const byId = new Map(rows.map((r) => [r.id, r]))
    const lines = []

    for (const id of ids) {
      const variant = byId.get(id)
      const qty = wanted.get(id)
      if (!domain.isReservable(variant.stock_qty, qty)) {
        throw new OutOfStockError(variant.label)
      }
      lines.push({
        variant_id: id,
        qty,
        product_name_snapshot: variant.product_name,
        variant_label_snapshot: variant.label,
        unit_price_snapshot: variant.price,
        collection_id: variant.collection_id,
      })
    }

    const total = domain.computeTotal(lines)

    // Decrement only finite stock; NULL means unlimited and stays NULL.
    for (const line of lines) {
      const variant = byId.get(line.variant_id)
      if (variant.stock_qty !== null) {
        await conn.query(
          "UPDATE product_variants SET stock_qty = stock_qty - ? WHERE id = ?",
          [line.qty, line.variant_id]
        )
      }
    }

    const token = domain.generateOrderToken()
    const expiresAt = domain.computeExpiry(input.payment_method)
    const isPickup = input.fulfillment_method === "pickup"
    const b = input.buyer || {}

    const [res] = await conn.query(
      `INSERT INTO orders
         (order_token, request_key, buyer_name, phone, email, fulfillment_method,
          address_street, address_ward, address_district, address_province, address_raw,
          note, status, payment_method, total, cod_amount, collection_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      [
        token,
        input.request_key || null,
        b.buyer_name,
        b.phone,
        b.email,
        input.fulfillment_method,
        isPickup ? null : b.address_street || null,
        isPickup ? null : b.address_ward || null,
        isPickup ? null : b.address_district || null,
        isPickup ? null : b.address_province || null,
        isPickup ? null : b.address_raw || null,
        input.note || null,
        input.payment_method,
        total,
        input.payment_method === "cod" ? total : null,
        lines[0].collection_id,
        expiresAt,
      ]
    )

    for (const line of lines) {
      await conn.query(
        `INSERT INTO order_items
           (order_id, product_variant_id, product_name_snapshot,
            variant_label_snapshot, unit_price_snapshot, qty)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [res.insertId, line.variant_id, line.product_name_snapshot,
         line.variant_label_snapshot, line.unit_price_snapshot, line.qty]
      )
    }

    await conn.commit()
    return { id: res.insertId, order_token: token, total, reused: false }
  } catch (err) {
    await conn.rollback()
    // A concurrent submit with the same key won the unique index; return theirs.
    if (err.code === "ER_DUP_ENTRY" && input.request_key) {
      const existing = await findByRequestKey(db, input.request_key)
      if (existing) return { ...existing, reused: true }
    }
    throw err
  } finally {
    conn.release()
  }
}

async function attachItems(order) {
  if (!order) return null
  const [items] = await db.query(
    "SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC",
    [order.id]
  )
  return { ...order, items }
}

async function getOrderByToken(token) {
  const [[row]] = await db.query("SELECT * FROM orders WHERE order_token = ? LIMIT 1", [token])
  return attachItems(row)
}

async function getOrderById(id) {
  const [[row]] = await db.query("SELECT * FROM orders WHERE id = ? LIMIT 1", [id])
  return attachItems(row)
}

async function listOrders(filter = {}) {
  const where = []
  const params = []
  if (filter.status) { where.push("status = ?"); params.push(filter.status) }
  if (filter.collection_id) { where.push("collection_id = ?"); params.push(filter.collection_id) }

  const [rows] = await db.query(
    `SELECT * FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC, id DESC`,
    params
  )
  return rows
}

/** Return reserved stock. Caller must hold the order row lock. */
async function releaseStock(conn, orderId) {
  const [items] = await conn.query(
    "SELECT product_variant_id, qty FROM order_items WHERE order_id = ?",
    [orderId]
  )
  // Ascending id order, same as reservation, to keep lock ordering consistent.
  const sorted = items
    .filter((i) => i.product_variant_id !== null)
    .sort((a, b) => a.product_variant_id - b.product_variant_id)

  for (const item of sorted) {
    // The NULL guard keeps unlimited variants unlimited.
    await conn.query(
      "UPDATE product_variants SET stock_qty = stock_qty + ? WHERE id = ? AND stock_qty IS NOT NULL",
      [item.qty, item.product_variant_id]
    )
  }
  await conn.query("UPDATE orders SET stock_released_at = NOW() WHERE id = ?", [orderId])
}

/**
 * Move an order to a new status. Cancelling returns reserved stock, guarded by
 * stock_released_at so a double cancel - or a cancel racing the expiry sweep -
 * cannot credit the same stock twice.
 */
async function transitionOrder(id, toStatus, extra = {}) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [[order]] = await conn.query(
      "SELECT id, status, fulfillment_method, stock_released_at FROM orders WHERE id = ? FOR UPDATE",
      [id]
    )
    if (!order) { await conn.rollback(); return false }

    if (!domain.canTransition(order.status, toStatus, order.fulfillment_method)) {
      await conn.rollback()
      return false
    }

    if (toStatus === "cancelled" && order.stock_released_at === null) {
      await releaseStock(conn, id)
    }

    const sets = ["status = ?"]
    const params = [toStatus]
    if (toStatus === "confirmed") sets.push("confirmed_at = NOW()")
    if (extra.tracking_code !== undefined) { sets.push("tracking_code = ?"); params.push(extra.tracking_code) }
    if (extra.shipping_fee !== undefined) { sets.push("shipping_fee = ?"); params.push(extra.shipping_fee) }
    params.push(id)

    await conn.query(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`, params)
    await conn.commit()
    return true
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/**
 * Cancel pending prepaid orders past their deadline. COD orders have a NULL
 * expires_at and are excluded by the query itself, not by a code path that
 * could be forgotten.
 */
async function releaseExpiredOrders(now = new Date()) {
  const [due] = await db.query(
    "SELECT id FROM orders WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?",
    [now]
  )

  let released = 0
  for (const row of due) {
    if (await transitionOrder(row.id, "cancelled")) released += 1
  }
  return released
}

module.exports = {
  createOrder,
  getOrderByToken,
  getOrderById,
  listOrders,
  transitionOrder,
  releaseExpiredOrders,
  OutOfStockError,
  EmptyCartError,
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- orderRepo`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/shop/orders/orderRepo.js backend/tests/orderRepo.test.js
git commit -F - <<'EOF'
feat(orders): add transactional order creation with stock reservation

The core of the feature. Everything else can be repaired by hand afterwards;
overselling cannot, so reservation and order insertion happen in one
transaction and stock is decremented at placement rather than at payment.

Prices are read from the catalog inside the transaction and snapshotted onto
order_items. The client sends only {variant_id, qty} and any price or total it
supplies is ignored, so a tampered request cannot buy a 35.000d photocard for
1d. There is a test asserting exactly that.

Variant rows are locked FOR UPDATE in ascending id order, so two concurrent
orders covering overlapping variants cannot deadlock by acquiring them in
opposite orders. Stock release follows the same ordering.

Reservation and release both skip NULL stock, which means unlimited: it is
never decremented, never checked, never credited back.

Idempotency comes from a unique request_key. A replayed submit returns the
original order rather than reserving twice, and a concurrent submit that loses
the unique index race falls back to reading the winner's row instead of
failing.

stock_released_at guards release so a double cancel, or a cancel racing the
expiry sweep, cannot credit the same stock twice. releaseExpiredOrders excludes
COD in the query itself rather than in a code path somebody could later forget.
EOF
```

---

### Task 4: Concurrency proof

Reservation correctness cannot be established by reading code. These tests exist to fail loudly if locking is ever weakened.

**Files:**
- Test: `backend/tests/orderConcurrency.test.js`

**Interfaces:**
- Consumes: `orderRepo` (Task 3).
- Produces: no source changes - this task proves Task 3 and may expose bugs requiring fixes there.

- [ ] **Step 1: Write the concurrency tests**

Create `backend/tests/orderConcurrency.test.js`:

```js
const { describe, it, expect, beforeEach } = require("vitest")
const db = require("../db")
const repo = require("../shop/orders/orderRepo")
const catalog = require("../shop/catalogRepo")
const { resetTables } = require("./helpers/db")

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seedVariant(stock) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stock }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return v.id
}

const attempt = (variantId, qty, extra = {}) =>
  repo.createOrder({
    items: [{ variant_id: variantId, qty }],
    buyer,
    fulfillment_method: "ship",
    payment_method: "bank",
    ...extra,
  }).then((r) => ({ ok: true, r })).catch((e) => ({ ok: false, e }))

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("concurrent reservation", () => {
  it("sells exactly one unit when 20 buyers race for the last item", async () => {
    const variantId = await seedVariant(1)

    const results = await Promise.all(Array.from({ length: 20 }, () => attempt(variantId, 1)))

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toHaveLength(19)

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(0)

    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(1)
  })

  it("never drives stock negative when demand exceeds supply", async () => {
    const variantId = await seedVariant(5)

    const results = await Promise.all(Array.from({ length: 15 }, () => attempt(variantId, 1)))

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(0)
    expect(v.stock_qty).toBeGreaterThanOrEqual(0)
    expect(results.filter((r) => r.ok)).toHaveLength(5)
  })

  it("keeps reserved plus remaining equal to the original stock", async () => {
    const variantId = await seedVariant(10)

    await Promise.all(Array.from({ length: 12 }, () => attempt(variantId, 2)))

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    const [[sum]] = await db.query(
      "SELECT COALESCE(SUM(qty), 0) AS reserved FROM order_items"
    )
    expect(Number(sum.reserved) + v.stock_qty).toBe(10)
  })

  it("creates one order when the same request_key is submitted concurrently", async () => {
    const variantId = await seedVariant(10)

    await Promise.all([
      attempt(variantId, 1, { request_key: "same-key" }),
      attempt(variantId, 1, { request_key: "same-key" }),
      attempt(variantId, 1, { request_key: "same-key" }),
    ])

    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(1)

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(9) // reserved once
  })

  it("credits stock once when an order is cancelled concurrently", async () => {
    const variantId = await seedVariant(5)
    const { r } = await attempt(variantId, 2)

    await Promise.all([
      repo.transitionOrder(r.id, "cancelled"),
      repo.transitionOrder(r.id, "cancelled"),
      repo.transitionOrder(r.id, "cancelled"),
    ])

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5)
  })

  it("credits stock once when a cancel races the expiry sweep", async () => {
    const variantId = await seedVariant(5)
    const { r } = await attempt(variantId, 2)
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?", [new Date(Date.now() - 1000), r.id])

    await Promise.all([
      repo.transitionOrder(r.id, "cancelled"),
      repo.releaseExpiredOrders(new Date()),
    ])

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5)

    const [[o]] = await db.query("SELECT status FROM orders WHERE id = ?", [r.id])
    expect(o.status).toBe("cancelled")
  })

  it("does not deadlock when two orders touch the same variants in opposite order", async () => {
    const cid = await catalog.createCollection({ title: "Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await catalog.replaceVariants(pid, [
      { label: "A1", stock_qty: 50 },
      { label: "A2", stock_qty: 50 },
    ])
    const [vs] = await db.query("SELECT id, label FROM product_variants ORDER BY label")
    const a1 = vs[0].id
    const a2 = vs[1].id

    const forward = () => repo.createOrder({
      items: [{ variant_id: a1, qty: 1 }, { variant_id: a2, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })
    const reverse = () => repo.createOrder({
      items: [{ variant_id: a2, qty: 1 }, { variant_id: a1, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? forward() : reverse()))
    )
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the concurrency suite**

Run: `cd backend && DB_PORT=3307 npm test -- orderConcurrency`
Expected: PASS, 7 tests.

- [ ] **Step 3: Run it repeatedly, because races are probabilistic**

Run:
```bash
cd backend && for i in $(seq 1 20); do DB_PORT=3307 npm test -- orderConcurrency || break; done
```
Expected: 20 consecutive passes. **A single failure across these runs is a blocking defect** - do not proceed, fix the locking in Task 3 first. Record the number of runs completed.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/orderConcurrency.test.js
git commit -F - <<'EOF'
test(orders): prove reservation is safe under concurrency

Reservation correctness cannot be established by reading code, so these tests
drive the real database with genuinely parallel requests. They exist to fail
loudly if the locking in orderRepo is ever weakened.

Covered: 20 buyers racing for the last unit yield exactly one order; demand
exceeding supply never drives stock negative; reserved plus remaining always
equals the original quantity; a concurrently replayed request_key creates one
order and reserves once; a triple cancel credits stock once; a cancel racing
the expiry sweep credits once and leaves a single terminal state; and two
orders touching the same variants in opposite sequence do not deadlock, which
is what the ascending-id lock ordering exists to guarantee.

These are run twenty times consecutively, since a race that reproduces one run
in twenty is still a race. Any single failure blocks the plan.
EOF
```

---

### Task 5: Order API routes

**Files:**
- Create: `backend/routes/orders.js`
- Modify: `backend/server.js` (mount, add an order rate limiter)
- Test: `backend/tests/orderRoutes.test.js`

**Interfaces:**
- Consumes: `orderRepo` (Task 3).
- Produces:
  - `POST /api/orders` - body `{items, buyer, fulfillment_method, payment_method, note, request_key}` → `201 {order_token, total}`; `400 invalid_input`; `409 out_of_stock`; `429` when rate limited.
  - `GET /api/orders/:token` → `200` order with items, or `404`. Sets `X-Robots-Tag: noindex`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/orderRoutes.test.js`:

```js
const { describe, it, expect, beforeEach } = require("vitest")
const request = require("supertest")
const app = require("../server")
const db = require("../db")
const catalog = require("../shop/catalogRepo")
const { resetTables } = require("./helpers/db")

async function seed(stock = 5) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stock }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return v.id
}

const body = (variantId, over = {}) => ({
  items: [{ variant_id: variantId, qty: 1 }],
  buyer: {
    buyer_name: "Nguyễn Văn A",
    phone: "0900000000",
    email: "a@example.com",
    address_raw: "1 ABC, Q1, TP.HCM",
  },
  fulfillment_method: "ship",
  payment_method: "bank",
  ...over,
})

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("POST /api/orders", () => {
  it("creates an order and returns its token and total", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders").send(body(v))

    expect(res.status).toBe(201)
    expect(res.body.order_token).toMatch(/^[0-9a-f]{32}$/)
    expect(res.body.total).toBe(35000)
  })

  it("ignores a client-supplied total", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders").send(body(v, { total: 1 }))
    expect(res.body.total).toBe(35000)
  })

  it("rejects a missing email", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders")
      .send(body(v, { buyer: { buyer_name: "A", phone: "0900000000", address_raw: "x" } }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects a malformed email", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders")
      .send(body(v, { buyer: { buyer_name: "A", phone: "0900000000", email: "nope", address_raw: "x" } }))
    expect(res.status).toBe(400)
  })

  it("requires an address for ship but not for pickup", async () => {
    const v = await seed()

    const noAddr = { buyer_name: "A", phone: "0900000000", email: "a@example.com" }
    const ship = await request(app).post("/api/orders").send(body(v, { buyer: noAddr }))
    expect(ship.status).toBe(400)

    const pickup = await request(app).post("/api/orders")
      .send(body(v, { buyer: noAddr, fulfillment_method: "pickup" }))
    expect(pickup.status).toBe(201)
  })

  it("rejects an empty cart", async () => {
    const res = await request(app).post("/api/orders").send(body(1, { items: [] }))
    expect(res.status).toBe(400)
  })

  it("rejects an unknown payment method", async () => {
    const v = await seed()
    const res = await request(app).post("/api/orders").send(body(v, { payment_method: "bitcoin" }))
    expect(res.status).toBe(400)
  })

  it("rejects a zero or negative quantity", async () => {
    const v = await seed()
    for (const qty of [0, -1, 1.5]) {
      const res = await request(app).post("/api/orders")
        .send(body(v, { items: [{ variant_id: v, qty }] }))
      expect(res.status).toBe(400)
    }
  })

  it("returns 409 when stock is insufficient", async () => {
    const v = await seed(1)
    const res = await request(app).post("/api/orders")
      .send(body(v, { items: [{ variant_id: v, qty: 2 }] }))
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("out_of_stock")
  })
})

describe("GET /api/orders/:token", () => {
  it("returns the order with its items", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))

    const res = await request(app).get(`/api/orders/${created.body.order_token}`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(35000)
    expect(res.body.items[0].variant_label_snapshot).toBe("A1")
  })

  it("is marked noindex so a shared link never reaches search results", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))

    const res = await request(app).get(`/api/orders/${created.body.order_token}`)
    expect(String(res.headers["x-robots-tag"])).toContain("noindex")
  })

  it("404s an unknown token", async () => {
    const res = await request(app).get(`/api/orders/${"a".repeat(32)}`)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- orderRoutes`
Expected: FAIL - routes return the catch-all 404.

- [ ] **Step 3: Create the router**

Create `backend/routes/orders.js`:

```js
const express = require("express")
const repo = require("../shop/orders/orderRepo")

const PAYMENT_METHODS = ["bank", "momo", "paypal", "cod"]
const FULFILLMENT = ["ship", "pickup"]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const bad = (res, message) => res.status(400).json({ error: "invalid_input", message })

function validate(body) {
  const { items, buyer, fulfillment_method, payment_method } = body

  if (!Array.isArray(items) || items.length === 0) return "Giỏ hàng trống"
  for (const item of items) {
    if (!Number.isInteger(Number(item.variant_id))) return "Sản phẩm không hợp lệ"
    const qty = Number(item.qty)
    if (!Number.isInteger(qty) || qty <= 0) return "Số lượng không hợp lệ"
  }

  if (!FULFILLMENT.includes(fulfillment_method)) return "Hình thức nhận hàng không hợp lệ"
  if (!PAYMENT_METHODS.includes(payment_method)) return "Phương thức thanh toán không hợp lệ"

  if (!buyer) return "Thiếu thông tin người mua"
  if (!buyer.buyer_name?.trim()) return "Cần họ tên"
  if (!buyer.phone?.trim()) return "Cần số điện thoại"
  if (!buyer.email?.trim() || !EMAIL_RE.test(buyer.email)) return "Email không hợp lệ"

  // Pickup collects no address; shipping cannot go anywhere without one.
  if (fulfillment_method === "ship" && !buyer.address_raw?.trim() && !buyer.address_street?.trim()) {
    return "Cần địa chỉ nhận hàng"
  }
  return null
}

module.exports = function orderRoutes() {
  const router = express.Router()

  router.post("/", async (req, res) => {
    try {
      const invalid = validate(req.body)
      if (invalid) return bad(res, invalid)

      const order = await repo.createOrder(req.body)
      res.status(201).json({ order_token: order.order_token, total: order.total })
    } catch (err) {
      if (err instanceof repo.EmptyCartError) return bad(res, err.message)
      if (err instanceof repo.OutOfStockError) {
        return res.status(409).json({
          error: "out_of_stock",
          message: `Rất tiếc, "${err.variantLabel}" vừa hết hàng. Vui lòng chọn lại.`,
        })
      }
      console.error("[ORDERS] Lỗi tạo đơn:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.get("/:token", async (req, res) => {
    try {
      // The token is a bearer credential; keep these pages out of search results.
      res.set("X-Robots-Tag", "noindex, nofollow")

      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      res.json(order)
    } catch (err) {
      console.error("[ORDERS] Lỗi lấy đơn:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  return router
}
```

- [ ] **Step 4: Mount with a dedicated rate limiter**

In `backend/server.js`, add below the existing `storageLimiter` definition:

```js
// Order creation: 10/hour per IP. Reservation holds stock, so unchecked
// submissions could exhaust a limited drop before anyone pays.
const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyGen,
  store: makeStore("rl:order:"),
  handler: (req, res) => {
    console.warn(`[RATE LIMIT] Order IP ${keyGen(req)} bị chặn`)
    res.status(429).json({ error: "too_many_requests", message: "Quá nhiều đơn. Thử lại sau." })
  },
})
```

Then mount the router next to the shop router:

```js
app.use(`${API_PREFIX}/orders`, (req, res, next) =>
  req.method === "POST" ? orderLimiter(req, res, next) : publicLimiter(req, res, next),
  require("./routes/orders")())
```

Reading an order page is not rate-limited like creation - a buyer refreshing to check status must not be locked out.

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- orderRoutes`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/orders.js backend/server.js backend/tests/orderRoutes.test.js
git commit -F - <<'EOF'
feat(orders): add public order API

POST /api/orders creates an order and GET /api/orders/:token reads it back.

Validation rejects blank names, malformed emails, non-integer or non-positive
quantities, unknown payment methods, and a shipping order with no address -
while deliberately allowing a pickup order without one, since there is nothing
to deliver.

Insufficient stock returns 409 with the variant named, so the buyer can see
which item went while they were filling the form rather than a generic failure.

Order creation gets its own limiter at 10/hour per IP, far tighter than the
public 120/minute, because reservation holds stock: unchecked submissions could
exhaust a limited drop before anyone pays. Reading an order is not limited that
way, since a buyer refreshing to check status must not lock themselves out.

Order pages send X-Robots-Tag noindex, because the token is a bearer credential
and a link shared into a group chat should never reach search results.
EOF
```

---

### Task 6: Admin order management

**Files:**
- Create: `backend/routes/adminOrders.js`
- Modify: `backend/server.js`
- Test: `backend/tests/adminOrderRoutes.test.js`

**Interfaces:**
- Produces, all behind `auth`:
  - `GET /api/admin/orders?status=&collection_id=` → list
  - `GET /api/admin/orders/:id` → order with items
  - `POST /api/admin/orders/:id/transition` - body `{to, tracking_code?, shipping_fee?}` → `200 {ok:true}` or `409 invalid_transition`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/adminOrderRoutes.test.js`:

```js
const { describe, it, expect, beforeEach } = require("vitest")
const request = require("supertest")
const jwt = require("jsonwebtoken")
const app = require("../server")
const db = require("../db")
const catalog = require("../shop/catalogRepo")
const orders = require("../shop/orders/orderRepo")
const { resetTables } = require("./helpers/db")

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seedOrder(over = {}) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank", ...over,
  })
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("auth", () => {
  it("requires a token", async () => {
    expect((await request(app).get("/api/admin/orders")).status).toBe(401)
  })

  it("rejects a bad token", async () => {
    const res = await request(app).get("/api/admin/orders").set("Authorization", "Bearer nope")
    expect(res.status).toBe(403)
  })
})

describe("GET /api/admin/orders", () => {
  it("lists orders", async () => {
    await seedOrder()
    const res = await authed(request(app).get("/api/admin/orders"))
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it("filters by status", async () => {
    const o = await seedOrder()
    await orders.transitionOrder(o.id, "confirmed")
    await seedOrder()

    const res = await authed(request(app).get("/api/admin/orders?status=confirmed"))
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe(o.id)
  })
})

describe("POST /api/admin/orders/:id/transition", () => {
  it("confirms a pending order", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).post(`/api/admin/orders/${o.id}/transition`))
      .send({ to: "confirmed" })

    expect(res.status).toBe(200)
    const [[row]] = await db.query("SELECT status, confirmed_at FROM orders WHERE id = ?", [o.id])
    expect(row.status).toBe("confirmed")
    expect(row.confirmed_at).not.toBeNull()
  })

  it("stores a tracking code when shipping", async () => {
    const o = await seedOrder()
    await orders.transitionOrder(o.id, "confirmed")

    await authed(request(app).post(`/api/admin/orders/${o.id}/transition`))
      .send({ to: "shipped", tracking_code: "VTP123" })

    const [[row]] = await db.query("SELECT tracking_code FROM orders WHERE id = ?", [o.id])
    expect(row.tracking_code).toBe("VTP123")
  })

  it("rejects an illegal transition with 409", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).post(`/api/admin/orders/${o.id}/transition`))
      .send({ to: "shipped" })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("invalid_transition")
  })

  it("rejects an unknown target status", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).post(`/api/admin/orders/${o.id}/transition`))
      .send({ to: "refunded" })
    expect(res.status).toBe(400)
  })

  it("returns reserved stock when cancelled", async () => {
    const o = await seedOrder()
    await authed(request(app).post(`/api/admin/orders/${o.id}/transition`)).send({ to: "cancelled" })

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants LIMIT 1")
    expect(v.stock_qty).toBe(5)
  })

  it("404s an unknown order", async () => {
    const res = await authed(request(app).post("/api/admin/orders/99999/transition")).send({ to: "confirmed" })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- adminOrderRoutes`
Expected: FAIL.

- [ ] **Step 3: Create the router**

Create `backend/routes/adminOrders.js`:

```js
const express = require("express")
const repo = require("../shop/orders/orderRepo")

const STATUSES = ["pending", "confirmed", "shipped", "completed", "cancelled"]

module.exports = function adminOrderRoutes() {
  const router = express.Router()

  const oops = (res, err, where) => {
    console.error(`[ADMIN/ORDERS] ${where}:`, err)
    res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
  }

  router.get("/orders", async (req, res) => {
    try {
      res.json(await repo.listOrders({
        status: req.query.status,
        collection_id: req.query.collection_id,
      }))
    } catch (err) { oops(res, err, "Lỗi liệt kê đơn") }
  })

  router.get("/orders/:id", async (req, res) => {
    try {
      const order = await repo.getOrderById(req.params.id)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      res.json(order)
    } catch (err) { oops(res, err, "Lỗi lấy đơn") }
  })

  router.post("/orders/:id/transition", async (req, res) => {
    try {
      const { to, tracking_code, shipping_fee } = req.body
      if (!STATUSES.includes(to)) {
        return res.status(400).json({ error: "invalid_input", message: "Trạng thái không hợp lệ" })
      }

      const order = await repo.getOrderById(req.params.id)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      const extra = {}
      if (tracking_code !== undefined) extra.tracking_code = tracking_code
      if (shipping_fee !== undefined) extra.shipping_fee = Number(shipping_fee) || null

      const ok = await repo.transitionOrder(Number(req.params.id), to, extra)
      if (!ok) {
        return res.status(409).json({
          error: "invalid_transition",
          message: `Không thể chuyển từ "${order.status}" sang "${to}"`,
        })
      }
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi đổi trạng thái đơn") }
  })

  return router
}
```

- [ ] **Step 4: Mount it**

In `backend/server.js`, below the existing admin catalog mount:

```js
app.use(`${API_PREFIX}/admin`, auth, require("./routes/adminOrders")())
```

- [ ] **Step 5: Run the whole suite**

Run: `cd backend && DB_PORT=3307 npm test`
Expected: PASS, every file.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/adminOrders.js backend/server.js backend/tests/adminOrderRoutes.test.js
git commit -F - <<'EOF'
feat(orders): add admin order management API

List with status and collection filters, read one order with its items, and
drive the lifecycle through a single transition endpoint rather than a separate
route per status, so the state machine stays the only authority on what is
legal.

An illegal move returns 409 naming both states instead of silently doing
nothing, so a mis-click is visible rather than mysterious. Cancelling returns
reserved stock through the same guarded path as every other release.
EOF
```

---

### Task 7: Expiry sweep in the worker

**Files:**
- Modify: `backend/worker.js`
- Test: `backend/tests/expirySweep.test.js`

**Interfaces:**
- Consumes: `repo.releaseExpiredOrders` (Task 3).
- Produces: `backend/worker.js` exports `sweepExpiredOrders(): Promise<number>` and calls it from its existing interval.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/expirySweep.test.js`:

```js
const { describe, it, expect, beforeEach } = require("vitest")
const db = require("../db")
const catalog = require("../shop/catalogRepo")
const orders = require("../shop/orders/orderRepo")
const { sweepExpiredOrders } = require("../worker")
const { resetTables } = require("./helpers/db")

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seedOrder(paymentMethod = "bank") {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return orders.createOrder({
    items: [{ variant_id: v.id, qty: 2 }],
    buyer, fulfillment_method: "ship", payment_method: paymentMethod,
  })
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("sweepExpiredOrders", () => {
  it("cancels an overdue prepaid order and returns its stock", async () => {
    const o = await seedOrder()
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?", [new Date(Date.now() - 1000), o.id])

    expect(await sweepExpiredOrders()).toBe(1)

    const [[row]] = await db.query("SELECT status FROM orders WHERE id = ?", [o.id])
    expect(row.status).toBe("cancelled")
    const [[v]] = await db.query("SELECT stock_qty FROM product_variants LIMIT 1")
    expect(v.stock_qty).toBe(5)
  })

  it("never expires a COD order", async () => {
    await seedOrder("cod")
    expect(await sweepExpiredOrders()).toBe(0)
  })

  it("is safe to run repeatedly", async () => {
    const o = await seedOrder()
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?", [new Date(Date.now() - 1000), o.id])

    await sweepExpiredOrders()
    await sweepExpiredOrders()
    await sweepExpiredOrders()

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants LIMIT 1")
    expect(v.stock_qty).toBe(5) // credited once, not three times
  })

  it("does nothing when there is nothing due", async () => {
    await seedOrder()
    expect(await sweepExpiredOrders()).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- expirySweep`
Expected: FAIL - `sweepExpiredOrders is not a function`.

- [ ] **Step 3: Extend the worker**

In `backend/worker.js`, add the require at the top beside the existing ones:

```js
const orderRepo = require("./shop/orders/orderRepo")
```

Add this function above `run()`:

```js
/**
 * Cancel prepaid orders whose payment window has passed and return their
 * reserved stock. COD orders have a NULL expires_at and are never swept.
 */
async function sweepExpiredOrders() {
  try {
    const released = await orderRepo.releaseExpiredOrders(new Date())
    if (released > 0) {
      console.log(`[WORKER] Đã hủy ${released} đơn quá hạn, hoàn kho`)
    }
    return released
  } catch (err) {
    console.error("[WORKER] Lỗi quét đơn quá hạn:", err.message)
    return 0
  }
}
```

Inside `run()`, after the existing thumbnail loop and before its closing brace, add:

```js
  await sweepExpiredOrders()
```

Finally, replace the bottom of the file so the worker only self-starts when run directly, and exports its functions for testing:

```js
if (require.main === module) {
  run()
  setInterval(run, 5000)
}

module.exports = { run, sweepExpiredOrders }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- expirySweep`
Expected: PASS, 4 tests.

- [ ] **Step 5: Confirm the worker still runs standalone**

Run: `cd backend && DB_PORT=3307 node worker.js`
Expected: it starts and polls without error. Stop it with Ctrl-C.

- [ ] **Step 6: Commit**

```bash
git add backend/worker.js backend/tests/expirySweep.test.js
git commit -F - <<'EOF'
feat(orders): sweep expired reservations in the existing worker

Prepaid orders reserve stock at placement, so an abandoned checkout would hold
a limited item forever. The sweep cancels orders past their payment window and
returns the stock, reusing the worker's existing 5s loop rather than adding a
process, which the 2GB box does not have room for.

COD orders are excluded: they have a NULL expires_at because there is no
payment to wait for, and cancelling one would destroy a legitimate order that
is simply waiting on seller approval.

The sweep is idempotent - running it repeatedly credits stock once, guarded by
stock_released_at - and it swallows its own errors so a database blip cannot
kill the worker and stop thumbnail generation with it.

worker.js now only self-starts when run directly, so tests can import the sweep
without launching the interval.
EOF
```

---

### Task 8: Frontend cart module

**Files:**
- Create: `frontend/src/shop/cart.js`
- Test: `frontend/src/shop/cart.test.js`
- Modify: `frontend/package.json`, create `frontend/vitest.config.js` if Plan 1 did not

**Interfaces:**
- Produces `frontend/src/shop/cart.js` exporting `readCart()`, `addToCart(item)`, `updateQty(variantId, qty)`, `removeFromCart(variantId)`, `clearCart()`, `cartCount(cart)`, `cartTotal(cart)`. A cart item is `{variant_id, qty, product_name, variant_label, price, image_url, collection_slug}`.

- [ ] **Step 1: Ensure the frontend test setup exists**

If `frontend/vitest.config.js` does not exist yet, install and create it:

```bash
cd frontend && npm install --save-dev vitest@^3.2.4 jsdom@^26.0.0
```

Create `frontend/vitest.config.js`:

```js
import { defineConfig } from "vite"

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{js,jsx}"],
  },
})
```

Add to `frontend/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/shop/cart.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest"
import { readCart, addToCart, updateQty, removeFromCart, clearCart, cartCount, cartTotal } from "./cart"

const item = (over = {}) => ({
  variant_id: 1, qty: 1, product_name: "Card", variant_label: "A1",
  price: 35000, image_url: null, collection_slug: "drop", ...over,
})

beforeEach(() => localStorage.clear())

describe("cart", () => {
  it("starts empty", () => {
    expect(readCart()).toEqual([])
  })

  it("adds an item", () => {
    addToCart(item())
    expect(readCart()).toHaveLength(1)
  })

  it("merges quantity when the same variant is added twice", () => {
    addToCart(item({ qty: 2 }))
    addToCart(item({ qty: 3 }))

    const cart = readCart()
    expect(cart).toHaveLength(1)
    expect(cart[0].qty).toBe(5)
  })

  it("keeps different variants separate", () => {
    addToCart(item({ variant_id: 1 }))
    addToCart(item({ variant_id: 2, variant_label: "A2" }))
    expect(readCart()).toHaveLength(2)
  })

  it("persists across reads", () => {
    addToCart(item())
    expect(readCart()[0].variant_id).toBe(1)
  })

  it("updates a quantity", () => {
    addToCart(item())
    updateQty(1, 7)
    expect(readCart()[0].qty).toBe(7)
  })

  it("removes an item when quantity drops to zero", () => {
    addToCart(item())
    updateQty(1, 0)
    expect(readCart()).toHaveLength(0)
  })

  it("refuses a negative quantity", () => {
    addToCart(item())
    updateQty(1, -5)
    expect(readCart()).toHaveLength(0)
  })

  it("removes an item explicitly", () => {
    addToCart(item())
    removeFromCart(1)
    expect(readCart()).toEqual([])
  })

  it("clears everything", () => {
    addToCart(item())
    addToCart(item({ variant_id: 2 }))
    clearCart()
    expect(readCart()).toEqual([])
  })

  it("counts total units, not lines", () => {
    addToCart(item({ qty: 2 }))
    addToCart(item({ variant_id: 2, qty: 3 }))
    expect(cartCount(readCart())).toBe(5)
  })

  it("totals price times quantity", () => {
    addToCart(item({ qty: 2 }))
    addToCart(item({ variant_id: 2, price: 90000, qty: 1 }))
    expect(cartTotal(readCart())).toBe(160000)
  })

  it("recovers from corrupt storage instead of throwing", () => {
    localStorage.setItem("shop_cart", "{not json")
    expect(readCart()).toEqual([])
  })

  it("ignores stored data that is not an array", () => {
    localStorage.setItem("shop_cart", JSON.stringify({ nope: true }))
    expect(readCart()).toEqual([])
  })

  it("drops malformed entries rather than trusting them", () => {
    localStorage.setItem("shop_cart", JSON.stringify([
      { variant_id: 1, qty: 2, price: 35000 },
      { qty: 1 },
      { variant_id: 3, qty: 0, price: 100 },
      { variant_id: 4, qty: 1, price: -5 },
    ]))
    const cart = readCart()
    expect(cart).toHaveLength(1)
    expect(cart[0].variant_id).toBe(1)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npm test -- cart`
Expected: FAIL - module not found.

- [ ] **Step 4: Implement the cart**

Create `frontend/src/shop/cart.js`:

```js
const KEY = "shop_cart"

/** A stored entry is only trusted if it still has a usable id, qty and price. */
function isValid(entry) {
  return (
    entry &&
    Number.isInteger(entry.variant_id) &&
    Number.isInteger(entry.qty) && entry.qty > 0 &&
    Number.isInteger(entry.price) && entry.price >= 0
  )
}

/**
 * localStorage is user-writable and survives deploys, so anything read back
 * is treated as untrusted input rather than assumed well-formed.
 */
export function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValid)
  } catch {
    return []
  }
}

function writeCart(cart) {
  localStorage.setItem(KEY, JSON.stringify(cart))
  return cart
}

export function addToCart(item) {
  const cart = readCart()
  const existing = cart.find((c) => c.variant_id === item.variant_id)

  if (existing) existing.qty += item.qty
  else cart.push({ ...item })

  return writeCart(cart)
}

export function updateQty(variantId, qty) {
  const cart = readCart()
  if (!Number.isInteger(qty) || qty <= 0) {
    return writeCart(cart.filter((c) => c.variant_id !== variantId))
  }
  return writeCart(cart.map((c) => (c.variant_id === variantId ? { ...c, qty } : c)))
}

export function removeFromCart(variantId) {
  return writeCart(readCart().filter((c) => c.variant_id !== variantId))
}

export function clearCart() {
  return writeCart([])
}

/** Total units across the cart, not the number of distinct lines. */
export function cartCount(cart) {
  return cart.reduce((sum, c) => sum + c.qty, 0)
}

/**
 * Display only. The server recomputes the authoritative total from catalog
 * prices at checkout, so a tampered localStorage cannot change what is charged.
 */
export function cartTotal(cart) {
  return cart.reduce((sum, c) => sum + c.price * c.qty, 0)
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npm test -- cart`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.js \
        frontend/src/shop/cart.js frontend/src/shop/cart.test.js
git commit -F - <<'EOF'
feat(shop): add client-side cart

The cart lives in localStorage so it survives a refresh without a server
round-trip or an account.

Everything read back is treated as untrusted input. localStorage is
user-writable and survives deploys, so corrupt JSON, a non-array, and entries
with missing ids or negative prices are all dropped rather than trusted - a
malformed cart returns empty instead of crashing checkout.

cartTotal is for display only. The server recomputes the authoritative total
from catalog prices inside the reservation transaction, so editing
localStorage cannot change what a buyer is actually charged.
EOF
```

---

### Task 9: Cart and checkout UI

**Files:**
- Create: `frontend/src/pages/Cart.jsx`
- Create: `frontend/src/pages/Checkout.jsx`
- Create: `frontend/src/components/shop/AddressFields.jsx`
- Modify: `frontend/src/components/shop/ProductCard.jsx` (add-to-cart)
- Modify: `frontend/src/api/shop.js`, `frontend/src/App.jsx`, `frontend/src/i18n/translations.js`

**Interfaces:**
- Adds to `frontend/src/api/shop.js`: `createOrder(payload)`, `fetchOrder(token)`.
- `AddressFields` props: `{ value, onChange }` where value is `{address_street, address_ward, address_district, address_province, address_raw}`.

- [ ] **Step 1: Add the order API calls**

Append to `frontend/src/api/shop.js`:

```js
// ── Orders ──
export const createOrder = (payload) =>
  api.post("/api/orders", payload).then((r) => r.data)

export const fetchOrder = (token) =>
  api.get(`/api/orders/${token}`).then((r) => r.data)
```

- [ ] **Step 2: Add translation keys**

Add to both the `en` and `vi` objects in `frontend/src/i18n/translations.js` (English shown; write natural Vietnamese equivalents for `vi`):

```js
    cart: "Cart", cartEmpty: "Your cart is empty.", cartTotal: "Total",
    cartCheckout: "Checkout", cartRemove: "Remove", cartQty: "Qty",
    addToCart: "Add to cart", added: "Added",
    checkout: "Checkout", checkoutName: "Full name", checkoutPhone: "Phone",
    checkoutEmail: "Email", checkoutNote: "Note (optional)",
    checkoutFulfillment: "Delivery method", checkoutShip: "Ship nationwide",
    checkoutPickup: "Pickup at event", checkoutPayment: "Payment method",
    checkoutAddress: "Address", checkoutPlaceOrder: "Place order",
    checkoutShippingNote: "+ shipping fee, paid to the courier on delivery",
    orderPlaced: "Order placed", orderStatus: "Status", orderItems: "Items",
    orderTotalLabel: "Total", orderPending: "Awaiting payment confirmation",
    orderConfirmed: "Confirmed", orderShipped: "Shipped", orderCompleted: "Completed",
    orderCancelled: "Cancelled", orderNotFound: "Order not found.",
    orderSaveLink: "Save this link to check your order later.",
    errOutOfStock: "Sorry, that item just sold out. Please review your cart.",
```

- [ ] **Step 3: Add add-to-cart to the product card**

In `frontend/src/components/shop/ProductCard.jsx`, import the cart and add a per-variant add action. Replace the variant `<li>` body so each selectable variant becomes a button that calls `addToCart`:

```jsx
import { addToCart } from "../../shop/cart"
```

and inside the map, for a non-sold-out variant, render:

```jsx
<button
  type="button"
  disabled={soldOut || !orderable}
  onClick={() => {
    addToCart({
      variant_id: v.id,
      qty: 1,
      product_name: product.name,
      variant_label: v.label,
      price: product.price,
      image_url: v.image_url || product.images?.[0] || null,
      collection_slug: collectionSlug,
    })
    onAdded?.(v.label)
  }}
  className={
    "px-2 py-1 rounded-lg text-xs border transition " +
    (soldOut ? "opacity-40 line-through border-current cursor-not-allowed"
             : "border-[var(--border-brand)] hover:bg-[var(--brand-soft)]")
  }
>
  {v.label}
</button>
```

`ProductCard` now takes `{ product, collectionSlug, orderable, onAdded }`. `orderable` is `false` for a `closed` collection, so a past drop stays browsable but cannot be added to a cart.

- [ ] **Step 4: Create the cart page**

Create `frontend/src/pages/Cart.jsx`:

```jsx
import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { readCart, updateQty, removeFromCart, cartTotal } from "../shop/cart"
import { useLanguage } from "../contexts/LanguageContext"
import { formatVnd } from "../utils/money"

export default function Cart() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [cart, setCart] = useState(readCart())

  const change = (variantId, qty) => setCart(updateQty(variantId, qty))
  const drop = (variantId) => setCart(removeFromCart(variantId))

  if (!cart.length) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold mb-4">{t("cart")}</h1>
        <p className="opacity-70 mb-4">{t("cartEmpty")}</p>
        <Link to="/shop" className="text-[var(--text-link)]">{t("shopBack")}</Link>
      </main>
    )
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-6">{t("cart")}</h1>

      {cart.map((c) => (
        <div key={c.variant_id} className="flex gap-3 items-center py-3 border-b border-[var(--border-brand)]">
          {c.image_url && <img src={c.image_url} alt="" className="w-16 h-16 object-cover rounded-lg" />}
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{c.product_name}</p>
            <p className="text-sm opacity-70">{c.variant_label} · {formatVnd(c.price)}</p>
          </div>
          <input
            type="number" min="1" value={c.qty}
            onChange={(e) => change(c.variant_id, Number(e.target.value))}
            className="w-16 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
          <button type="button" onClick={() => drop(c.variant_id)} className="px-2 opacity-70">✕</button>
        </div>
      ))}

      <div className="mt-6 flex justify-between items-center">
        <div>
          <p className="text-sm opacity-70">{t("cartTotal")}</p>
          <p className="text-xl font-bold text-[var(--brand)]">{formatVnd(cartTotal(cart))}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/checkout")}
          className="px-5 py-2 rounded-xl bg-[var(--brand)] text-white"
        >
          {t("cartCheckout")}
        </button>
      </div>
    </main>
  )
}
```

- [ ] **Step 5: Create the address fields with Goong autocomplete and a plain fallback**

Create `frontend/src/components/shop/AddressFields.jsx`:

```jsx
import { useEffect, useState } from "react"
import { useLanguage } from "../../contexts/LanguageContext"

const GOONG_KEY = import.meta.env.VITE_GOONG_API_KEY

/**
 * Goong is Vietnam-specific and handles ward/district/province properly.
 * When no key is configured, or the lookup fails, this degrades to a plain
 * textarea - a buyer must never be blocked from ordering by a third party.
 */
export default function AddressFields({ value, onChange }) {
  const { t } = useLanguage()
  const [query, setQuery] = useState(value.address_raw || "")
  const [suggestions, setSuggestions] = useState([])

  useEffect(() => {
    if (!GOONG_KEY || query.trim().length < 4) return setSuggestions([])

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://rsapi.goong.io/Place/AutoComplete?api_key=${GOONG_KEY}&input=${encodeURIComponent(query)}`
        )
        const data = await res.json()
        setSuggestions(data.predictions?.slice(0, 5) || [])
      } catch {
        setSuggestions([]) // silent: the manual field below still works
      }
    }, 350)

    return () => clearTimeout(timer)
  }, [query])

  const pick = (s) => {
    const parts = s.structured_formatting?.secondary_text?.split(",").map((x) => x.trim()) || []
    onChange({
      address_raw: s.description,
      address_street: s.structured_formatting?.main_text || s.description,
      address_ward: parts[0] || null,
      address_district: parts[1] || null,
      address_province: parts[2] || null,
    })
    setQuery(s.description)
    setSuggestions([])
  }

  return (
    <div className="relative">
      <label className="block text-sm mb-1">{t("checkoutAddress")}</label>
      <textarea
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange({ ...value, address_raw: e.target.value })
        }}
        rows={2}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
      />

      {suggestions.length > 0 && (
        <ul className="absolute z-10 w-full bg-[var(--bg-card)] border border-[var(--border-brand)] rounded-lg mt-1 overflow-hidden">
          {suggestions.map((s) => (
            <li key={s.place_id}>
              <button type="button" onClick={() => pick(s)} className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--brand-soft)]">
                {s.description}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Create the checkout page**

Create `frontend/src/pages/Checkout.jsx`:

```jsx
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { readCart, cartTotal, clearCart } from "../shop/cart"
import { createOrder } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import { formatVnd } from "../utils/money"
import AddressFields from "../components/shop/AddressFields"

const PAYMENT_METHODS = ["bank", "momo", "paypal", "cod"]

export default function Checkout() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const cart = useMemo(() => readCart(), [])

  const [buyer, setBuyer] = useState({ buyer_name: "", phone: "", email: "" })
  const [address, setAddress] = useState({ address_raw: "" })
  const [fulfillment, setFulfillment] = useState("ship")
  const [payment, setPayment] = useState("bank")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Stable across retries so a double-tap or a retried submit cannot create
  // two orders holding two reservations.
  const requestKey = useMemo(() => crypto.randomUUID(), [])

  const submit = async () => {
    setError("")
    setSubmitting(true)
    try {
      const res = await createOrder({
        items: cart.map((c) => ({ variant_id: c.variant_id, qty: c.qty })),
        buyer: { ...buyer, ...(fulfillment === "ship" ? address : {}) },
        fulfillment_method: fulfillment,
        payment_method: payment,
        note,
        request_key: requestKey,
      })
      clearCart()
      navigate(`/order/${res.order_token}`)
    } catch (e) {
      setError(
        e.response?.status === 409
          ? e.response.data.message || t("errOutOfStock")
          : e.response?.data?.message || "Đặt hàng thất bại"
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (!cart.length) {
    return <main className="max-w-2xl mx-auto px-4 py-10 opacity-70">{t("cartEmpty")}</main>
  }

  const field = (key, label, type = "text") => (
    <label className="block mb-3">
      <span className="block text-sm mb-1">{label}</span>
      <input
        type={type}
        value={buyer[key]}
        onChange={(e) => setBuyer({ ...buyer, [key]: e.target.value })}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
      />
    </label>
  )

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-6">{t("checkout")}</h1>

      {field("buyer_name", t("checkoutName"))}
      {field("phone", t("checkoutPhone"), "tel")}
      {field("email", t("checkoutEmail"), "email")}

      <fieldset className="mb-4">
        <legend className="text-sm mb-1">{t("checkoutFulfillment")}</legend>
        {["ship", "pickup"].map((m) => (
          <label key={m} className="mr-4 text-sm">
            <input type="radio" name="fulfillment" checked={fulfillment === m}
              onChange={() => setFulfillment(m)} className="mr-1" />
            {m === "ship" ? t("checkoutShip") : t("checkoutPickup")}
          </label>
        ))}
      </fieldset>

      {fulfillment === "ship" && (
        <div className="mb-4">
          <AddressFields value={address} onChange={setAddress} />
          <p className="text-xs opacity-70 mt-1">{t("checkoutShippingNote")}</p>
        </div>
      )}

      <label className="block mb-4">
        <span className="block text-sm mb-1">{t("checkoutPayment")}</span>
        <select value={payment} onChange={(e) => setPayment(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent">
          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
        </select>
      </label>

      <label className="block mb-6">
        <span className="block text-sm mb-1">{t("checkoutNote")}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent" />
      </label>

      <div className="flex justify-between items-center mb-4">
        <span className="opacity-70">{t("cartTotal")}</span>
        <span className="text-xl font-bold text-[var(--brand)]">{formatVnd(cartTotal(cart))}</span>
      </div>

      {error && <p className="text-red-500 mb-3">{error}</p>}

      <button type="button" onClick={submit} disabled={submitting}
        className="w-full py-3 rounded-xl bg-[var(--brand)] text-white disabled:opacity-50">
        {submitting ? "..." : t("checkoutPlaceOrder")}
      </button>
    </main>
  )
}
```

- [ ] **Step 7: Register the routes**

In `frontend/src/App.jsx`, add imports and routes for `/cart`, `/checkout`, and `/order/:token` (the page comes in Task 10).

- [ ] **Step 8: Verify build and lint**

Run: `cd frontend && npm test && npm run build && npm run lint`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/Cart.jsx frontend/src/pages/Checkout.jsx \
        frontend/src/components/shop/AddressFields.jsx \
        frontend/src/components/shop/ProductCard.jsx \
        frontend/src/api/shop.js frontend/src/App.jsx frontend/src/i18n/translations.js
git commit -F - <<'EOF'
feat(shop): add cart and checkout pages

Checkout generates a request key once per page load and sends it with the
order, so a double-tap on a flaky mobile connection returns the original order
rather than creating a second one holding a second reservation.

The cart posts only variant ids and quantities. Prices shown here are for
display; the server recomputes the total from the catalog, so nothing the
client sends can change what is charged.

Address entry uses Goong, which understands Vietnamese ward/district/province
structure, but degrades to a plain textarea when no API key is configured or
the lookup fails. A buyer must never be blocked from ordering because a third
party is down. Address fields only appear for shipping, since pickup collects
none, and the shipping note states plainly that carriage is paid to the courier
on delivery.

Sold-out variants and closed collections render their add buttons disabled
rather than hidden, so buyers can see what existed and what went.
EOF
```

---

### Task 10: Order status page and admin orders UI

**Files:**
- Create: `frontend/src/pages/Order.jsx`
- Create: `frontend/src/components/AdminOrders.jsx`
- Modify: `frontend/src/api/shop.js`, `frontend/src/pages/Admin.jsx`, `frontend/index.html`

**Interfaces:**
- Adds to `frontend/src/api/shop.js`: `adminListOrders(filter)`, `adminGetOrder(id)`, `adminTransitionOrder(id, payload)`.

- [ ] **Step 1: Add the admin order API calls**

Append to `frontend/src/api/shop.js`:

```js
export const adminListOrders = (params = {}) =>
  api.get("/api/admin/orders", { params }).then((r) => r.data)

export const adminGetOrder = (id) =>
  api.get(`/api/admin/orders/${id}`).then((r) => r.data)

export const adminTransitionOrder = (id, payload) =>
  api.post(`/api/admin/orders/${id}/transition`, payload).then((r) => r.data)
```

- [ ] **Step 2: Create the buyer order page**

Create `frontend/src/pages/Order.jsx`:

```jsx
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { fetchOrder } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import { formatVnd } from "../utils/money"

const STATUS_KEY = {
  pending: "orderPending", confirmed: "orderConfirmed", shipped: "orderShipped",
  completed: "orderCompleted", cancelled: "orderCancelled",
}

export default function Order() {
  const { token } = useParams()
  const { t } = useLanguage()
  const [order, setOrder] = useState(undefined)

  useEffect(() => {
    // Belt and braces with the server's X-Robots-Tag: the order page is
    // protected only by an unguessable token and must never be indexed.
    const meta = document.createElement("meta")
    meta.name = "robots"
    meta.content = "noindex, nofollow"
    document.head.appendChild(meta)

    fetchOrder(token).then(setOrder).catch(() => setOrder(null))
    return () => document.head.removeChild(meta)
  }, [token])

  if (order === undefined) return <main className="max-w-2xl mx-auto px-4 py-10 opacity-60">...</main>
  if (order === null) {
    return <main className="max-w-2xl mx-auto px-4 py-10 opacity-70">{t("orderNotFound")}</main>
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-1">{t("orderPlaced")}</h1>
      <p className="text-sm opacity-70 mb-6">{t("orderSaveLink")}</p>

      <div className="p-4 rounded-xl border border-[var(--border-brand)] mb-6">
        <p className="text-sm opacity-70">{t("orderStatus")}</p>
        <p className="font-semibold">{t(STATUS_KEY[order.status])}</p>
        {order.tracking_code && <p className="text-sm mt-1">#{order.tracking_code}</p>}
      </div>

      <h2 className="font-semibold mb-2">{t("orderItems")}</h2>
      {order.items.map((i) => (
        <div key={i.id} className="flex justify-between py-2 border-b border-[var(--border-brand)]">
          <span>{i.product_name_snapshot} · {i.variant_label_snapshot} × {i.qty}</span>
          <span>{formatVnd(i.unit_price_snapshot * i.qty)}</span>
        </div>
      ))}

      <div className="flex justify-between mt-4 text-lg font-bold">
        <span>{t("orderTotalLabel")}</span>
        <span className="text-[var(--brand)]">{formatVnd(order.total)}</span>
      </div>

      {order.fulfillment_method === "ship" && (
        <p className="text-xs opacity-70 mt-1">{t("checkoutShippingNote")}</p>
      )}
    </main>
  )
}
```

- [ ] **Step 3: Create the admin orders UI**

Create `frontend/src/components/AdminOrders.jsx`:

```jsx
import { useEffect, useState } from "react"
import { adminListOrders, adminTransitionOrder, adminGetOrder } from "../api/shop"
import { formatVnd } from "../utils/money"

const STATUSES = ["", "pending", "confirmed", "shipped", "completed", "cancelled"]

const NEXT = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["shipped", "completed", "cancelled"],
  shipped: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
}

export default function AdminOrders() {
  const [orders, setOrders] = useState([])
  const [filter, setFilter] = useState("")
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState("")

  const reload = () => adminListOrders(filter ? { status: filter } : {}).then(setOrders)

  useEffect(() => { reload().catch(() => setOrders([])) }, [filter])

  const move = async (order, to) => {
    setError("")
    const payload = { to }
    if (to === "shipped") {
      const code = prompt("Mã vận đơn (có thể bỏ trống):")
      if (code) payload.tracking_code = code
    }
    if (to === "cancelled" && !confirm("Hủy đơn này? Kho sẽ được hoàn lại.")) return

    try {
      await adminTransitionOrder(order.id, payload)
      await reload()
      if (detail?.id === order.id) setDetail(await adminGetOrder(order.id))
    } catch (e) {
      setError(e.response?.data?.message || "Đổi trạng thái thất bại")
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-xl font-semibold">Đơn hàng</h3>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent">
          {STATUSES.map((s) => <option key={s} value={s}>{s || "Tất cả"}</option>)}
        </select>
      </div>

      {error && <p className="text-red-500 mb-3">{error}</p>}
      {orders.length === 0 && <p className="opacity-60">Chưa có đơn nào.</p>}

      {orders.map((o) => (
        <div key={o.id} className="mb-3 p-3 rounded-xl border border-[var(--border-brand)]">
          <div className="flex justify-between items-start gap-3 flex-wrap">
            <div>
              <p className="font-medium">#{o.id} · {o.buyer_name} · {o.phone}</p>
              <p className="text-sm opacity-70">
                {o.status} · {o.fulfillment_method} · {o.payment_method} · {formatVnd(o.total)}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={async () => setDetail(await adminGetOrder(o.id))}
                className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Chi tiết</button>
              {NEXT[o.status].map((to) => (
                <button key={to} type="button" onClick={() => move(o, to)}
                  className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">{to}</button>
              ))}
            </div>
          </div>

          {detail?.id === o.id && (
            <div className="mt-3 pt-3 border-t border-[var(--border-brand)] text-sm">
              <p className="opacity-70">{detail.email}</p>
              {detail.fulfillment_method === "ship" && <p className="opacity-70">{detail.address_raw}</p>}
              {detail.note && <p className="mt-1 italic opacity-70">“{detail.note}”</p>}
              <ul className="mt-2">
                {detail.items.map((i) => (
                  <li key={i.id}>
                    {i.product_name_snapshot} · {i.variant_label_snapshot} × {i.qty} -{" "}
                    {formatVnd(i.unit_price_snapshot * i.qty)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Wire the admin tab and the order route**

Add an "Đơn hàng" tab rendering `<AdminOrders />` in `frontend/src/pages/Admin.jsx`, following the existing tab pattern. Confirm `/order/:token` is registered in `App.jsx`.

- [ ] **Step 5: Verify build, lint and the full backend suite**

Run:
```bash
cd frontend && npm test && npm run build && npm run lint
cd ../backend && DB_PORT=3307 npm test
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Order.jsx frontend/src/components/AdminOrders.jsx \
        frontend/src/api/shop.js frontend/src/pages/Admin.jsx frontend/src/App.jsx
git commit -F - <<'EOF'
feat(orders): add order status page and admin order management

The buyer's order page is reachable only by its token and injects a noindex
meta tag alongside the server's X-Robots-Tag header, so a link pasted into a
group chat cannot end up in search results.

Line items render from their snapshots rather than from the live catalog, so
an order still reads correctly after a variant is renamed, repriced, or
deleted.

The admin list offers only the transitions the state machine actually permits
for each order's current status, so an illegal move is not presented and then
rejected. Cancelling asks for confirmation, since it returns stock and cannot
be undone.
EOF
```

---

## Self-Review

**Spec coverage for Plan 2's slice:**

| Requirement | Task |
|---|---|
| Cart in localStorage, no account | 8, 9 |
| Checkout collects name, phone, mandatory email, note | 9 |
| Goong address autocomplete, VN-specific | 9 |
| Fulfillment choice; pickup collects no address | 5, 9 |
| Stock reserved at placement, transactional | 3 |
| Unlimited stock never reserved or released | 2, 3 |
| Server-authoritative pricing and totals | 2, 3 |
| Idempotent checkout | 3, 4, 9 |
| Crypto-random order token, noindex order page | 2, 5, 10 |
| Five-status lifecycle, pickup skips shipped | 2, 3, 6 |
| COD never expires, needs admin approval | 2, 3, 7 |
| Expiry sweep releasing stock, no new process | 7 |
| Order-creation rate limiting | 5 |
| Admin list, filter, detail, transitions | 6, 10 |
| Concurrency safety | 4 |

**Deferred to Plan 3:** payment settings and instructions, payment proof upload, all emails, order QR and admin scanner, SePay/Momo/PayPal auto-confirm, nightly backups.

**Type consistency:** `variant_id`/`qty` integers everywhere; `stock_qty` is `null`-or-integer at every layer; money is integer VND with no float path; `order_token` is 32 hex chars in the domain, the DB column, the API, and the route param; `canTransition(from, to, fulfillment)` keeps that signature in Tasks 2, 3, and 6; `createOrder` input shape is identical in Tasks 3, 4, 5, and 9.

**Known gap to address in Plan 3:** a variant with pending reservations can still be deleted through the Plan 1 admin catalog UI. `order_items.product_variant_id` is `SET NULL`, so history survives and the order page still reads correctly, but that order's reserved stock can no longer be returned on cancel. Plan 3 should block deleting variants that have pending orders.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-merch-shop-2-orders.md`. Two execution options:

**1. Subagent-Driven (recommended)** - a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
