# Event Pickup Verification & COD Restriction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every pickup order a short offline-verifiable pickup code (shown to the buyer, printed on the existing roster), let staff batch-mark orders completed after the event once connectivity returns, and restrict COD to ship orders only (checkout UI + server validation).

**Architecture:** One migration adds `orders.pickup_code`; `domain.generatePickupCode()` generates it; `orderRepo.createOrder` stores it for pickup orders only. It flows out through the existing public-order allowlist, the existing pickup confirmation email, and the existing printable roster — no new endpoints for any of that. A new `POST /admin/orders/bulk-complete` route and matching "Hoàn tất đã chọn" button mirror the existing bulk-cancel feature exactly. COD-for-pickup is rejected in `Checkout.jsx`'s method list and `routes/orders.js`'s `validate()`.

**Tech Stack:** Backend CommonJS + Vitest 3 ESM test imports, Knex migrations, raw mysql2 via `backend/db.js`. Frontend React 18 + Vitest 3, `createRoot`/`act` component-test pattern (no Testing Library).

**Spec:** `docs/superpowers/specs/2026-08-10-event-pickup-verification-design.md` — read it before touching this plan; every decision below traces back to it.

## Global Constraints

- `pickup_code` is **never** an alternative authentication credential — no route may accept it in place of `order_token` to look up or mutate an order. It exists only for a human to visually compare against the printed roster.
- `pickup_code` is `null` for every `ship` order; only ever set for `pickup` orders.
- Backend implementation files stay CommonJS (`require`/`module.exports`); backend test files use Vitest 3 ESM `import` (Vitest 3 refuses `require("vitest")`).
- Bulk-complete mirrors bulk-cancel's exact shape: same per-order error containment (one order's failure never aborts the batch), same request/response contract style, same `100`-item cap.
- Commits: Conventional Commits, descriptive bodies, **no `Co-Authored-By` trailer**.
- Test commands: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` (**595 passing** before this plan starts) and `cd frontend && npm test && npm run build && npm run lint` (**218 passing**, lint has exactly 3 pre-existing problems in `Portfolio.jsx`/`AdminAlbumImages.jsx` — not this plan's problem, do not fix or add a fourth).

---

### Task 1: `pickup_code` column, `generatePickupCode()`, and order creation wiring

**Files:**
- Create: `backend/migrations/018_add_order_pickup_code.js`
- Modify: `backend/shop/orders/domain.js`
- Modify: `backend/shop/orders/orderRepo.js`
- Test: `backend/tests/orderDomain.test.js`
- Test: `backend/tests/orderRepo.test.js`

**Interfaces:**
- Produces: `domain.generatePickupCode(): string` — a 6-character all-digit string. `orders.pickup_code` column (nullable string(6)).
- Consumed by: Task 2 (public order response), Task 3 (roster), Task 4 (email).

- [ ] **Step 1: Write the failing test for `generatePickupCode`**

In `backend/tests/orderDomain.test.js`, add (matching the file's existing `import d from "../shop/orders/domain.js"` and `generateOrderToken` test style):

```js
describe("generatePickupCode", () => {
  it("is a 6-digit numeric string", () => {
    expect(d.generatePickupCode()).toMatch(/^\d{6}$/)
  })

  it("varies across many generations (not a constant)", () => {
    const codes = new Set(Array.from({ length: 200 }, () => d.generatePickupCode()))
    expect(codes.size).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/orderDomain.test.js`
Expected: FAIL — `d.generatePickupCode` is not a function.

- [ ] **Step 3: Implement `generatePickupCode`**

In `backend/shop/orders/domain.js`, after `generateOrderToken`:

```js
/**
 * 6-digit numeric pickup verification code. Short enough for a staff member
 * to read aloud or match by eye against the printed pickup roster when
 * event-venue connectivity is too weak for the QR-scan flow (which needs a
 * live full order-list fetch). Unlike order_token, this is never accepted
 * as a credential anywhere — it only ever gets compared visually.
 */
function generatePickupCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0")
}
```

Add `generatePickupCode` to `module.exports`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/orderDomain.test.js`
Expected: PASS, 4 tests in the `generateOrderToken`/`generatePickupCode` describes combined (2 pre-existing + 2 new).

- [ ] **Step 5: Add the migration**

Create `backend/migrations/018_add_order_pickup_code.js`:

```js
exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.string("pickup_code", 6).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("pickup_code")
  })
}
```

Run: `cd backend && npm run migrate`
Expected: migration `018_add_order_pickup_code.js` runs without error.

- [ ] **Step 6: Write the failing test for order creation wiring**

In `backend/tests/orderRepo.test.js`, add a new `describe` block after the existing `describe("createOrder", ...)` content (using the file's existing `order()`/`seedVariant()` helpers):

```js
describe("createOrder: pickup_code", () => {
  it("sets a 6-digit pickup_code for a pickup order", async () => {
    const { variantId } = await seedVariant(5, { allow_pickup: true })
    const created = await repo.createOrder(order(variantId, 1, { fulfillment_method: "pickup" }))

    const [[row]] = await db.query("SELECT pickup_code FROM orders WHERE id = ?", [created.id])
    expect(row.pickup_code).toMatch(/^\d{6}$/)
  })

  it("leaves pickup_code null for a ship order", async () => {
    const { variantId } = await seedVariant(5)
    const created = await repo.createOrder(order(variantId, 1))

    const [[row]] = await db.query("SELECT pickup_code FROM orders WHERE id = ?", [created.id])
    expect(row.pickup_code).toBeNull()
  })
})
```

- [ ] **Step 7: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/orderRepo.test.js`
Expected: FAIL — `pickup_code` is never inserted, so both new assertions fail (`row.pickup_code` is `undefined`/not matching).

- [ ] **Step 8: Implement**

In `backend/shop/orders/orderRepo.js`, find:

```js
    const token = domain.generateOrderToken()
    const expiresAt = domain.computeExpiry(input.payment_method)
    const isPickup = input.fulfillment_method === "pickup"

    const [res] = await conn.query(
      `INSERT INTO orders
         (order_token, request_key, buyer_name, phone, email, fulfillment_method,
          address_street, address_ward, address_district, address_province, address_raw,
          note, status, payment_method, total, cod_amount, collection_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      [
        token,
        input.request_key || null,
        buyer.buyer_name,
        buyer.phone,
        buyer.email,
        input.fulfillment_method,
        isPickup ? null : buyer.address_street || null,
        isPickup ? null : buyer.address_ward || null,
        isPickup ? null : buyer.address_district || null,
        isPickup ? null : buyer.address_province || null,
        isPickup ? null : buyer.address_raw || null,
        input.note || null,
        input.payment_method,
        total,
        input.payment_method === "cod" ? total : null,
        lines[0].collection_id,
        expiresAt,
      ]
    )
```

Replace with:

```js
    const token = domain.generateOrderToken()
    const expiresAt = domain.computeExpiry(input.payment_method)
    const isPickup = input.fulfillment_method === "pickup"
    const pickupCode = isPickup ? domain.generatePickupCode() : null

    const [res] = await conn.query(
      `INSERT INTO orders
         (order_token, request_key, buyer_name, phone, email, fulfillment_method,
          address_street, address_ward, address_district, address_province, address_raw,
          note, status, payment_method, total, cod_amount, collection_id, expires_at, pickup_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      [
        token,
        input.request_key || null,
        buyer.buyer_name,
        buyer.phone,
        buyer.email,
        input.fulfillment_method,
        isPickup ? null : buyer.address_street || null,
        isPickup ? null : buyer.address_ward || null,
        isPickup ? null : buyer.address_district || null,
        isPickup ? null : buyer.address_province || null,
        isPickup ? null : buyer.address_raw || null,
        input.note || null,
        input.payment_method,
        total,
        input.payment_method === "cod" ? total : null,
        lines[0].collection_id,
        expiresAt,
        pickupCode,
      ]
    )
```

No other line in `orderRepo.js` changes — `getOrderById`/`getOrderByToken` already `SELECT *` (or `SELECT o.*, ...`), so `pickup_code` reaches every read path automatically without further edits here.

- [ ] **Step 9: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/orderRepo.test.js`
Expected: PASS, all tests in the file including the 2 new ones.

- [ ] **Step 10: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, 601 tests (595 baseline + 2 domain + 2 orderRepo... actually 4 new: 2 domain + 2 orderRepo = 599; verify against actual count printed).

- [ ] **Step 11: Commit**

```bash
git add backend/migrations/018_add_order_pickup_code.js backend/shop/orders/domain.js backend/shop/orders/orderRepo.js backend/tests/orderDomain.test.js backend/tests/orderRepo.test.js
git commit -F - <<'EOF'
feat(shop): add pickup_code, generated for every pickup order

A 6-digit numeric code, short enough to read aloud or match by eye,
unlike order_token (32 hex chars) or the sequential DH<id> reference
code (guessable, never meant as a credential). Generated once at order
creation via crypto.randomInt, stored only for pickup orders (null for
ship). Never accepted as an authentication credential anywhere -- its
only use is a human visually comparing it against the printed pickup
roster (wired in a later commit) when event-venue connectivity is too
weak for the existing QR-scan flow.
EOF
```

---

### Task 2: Surface `pickup_code` on the public order response; reject COD+pickup server-side

**Files:**
- Modify: `backend/routes/orders.js`
- Test: `backend/tests/orderRoutes.test.js`

**Interfaces:**
- Consumes: `orders.pickup_code` (Task 1).
- Produces: `toPublicOrder()`'s return value gains `pickup_code`. `validate()` rejects `payment_method === "cod"` + `fulfillment_method === "pickup"`.
- Consumed by: Task 7 (`Order.jsx` displays it).

- [ ] **Step 1: Write the failing tests**

In `backend/tests/orderRoutes.test.js`, add inside `describe("POST /api/orders", ...)` (using the file's existing `seed()`/`body()` helpers):

```js
  it("rejects COD for a pickup order", async () => {
    await settings.updateSettings({ cod_enabled: true, bank_enabled: true, bank_name: "ACB", bank_bin: "970416", bank_account_number: "1", bank_account_holder: "A" })
    const v = await seed(5, { allow_ship: true, allow_pickup: true })
    const res = await request(app).post("/api/orders")
      .send(body(v, { fulfillment_method: "pickup", payment_method: "cod", buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com" } }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("still allows COD for a ship order", async () => {
    await settings.updateSettings({ cod_enabled: true, bank_enabled: true, bank_name: "ACB", bank_bin: "970416", bank_account_number: "1", bank_account_holder: "A" })
    const v = await seed(5, { allow_ship: true, allow_pickup: true })
    const res = await request(app).post("/api/orders")
      .send(body(v, { payment_method: "cod" }))
    expect(res.status).toBe(201)
  })
```

And inside `describe("GET /api/orders/:token", ...)`:

```js
  it("includes pickup_code for a pickup order, null for a ship order", async () => {
    const v = await seed(5, { allow_ship: true, allow_pickup: true })
    const pickup = await request(app).post("/api/orders")
      .send(body(v, { fulfillment_method: "pickup", buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com" } }))
    const pickupGet = await request(app).get(`/api/orders/${pickup.body.order_token}`)
    expect(pickupGet.body.pickup_code).toMatch(/^\d{6}$/)

    const v2 = await seed(5)
    const ship = await request(app).post("/api/orders").send(body(v2))
    const shipGet = await request(app).get(`/api/orders/${ship.body.order_token}`)
    expect(shipGet.body.pickup_code).toBeNull()
  })
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/orderRoutes.test.js`
Expected: FAIL — COD+pickup is currently accepted (201, not 400); `pickup_code` is absent from the response (`undefined`, not matching `/^\d{6}$/` or `null`).

- [ ] **Step 3: Implement**

In `backend/routes/orders.js`, find `toPublicOrder`:

```js
function toPublicOrder(order) {
  const {
    id, order_token, status, total, fulfillment_method, tracking_code, created_at, items,
    // Spec (Fulfillment): pickup location/note must be shown on the order
    // page, not just the pre-purchase collection browse page. Sourced from
    // the order's own collection (joined in getOrderByToken), same content
    // that is already public on the collection page — no new exposure.
    pickup_location, pickup_note,
    // Spec (Buyer Onboarding, Phase 6): the payment deadline the reservation
    // and the expiry sweep already enforce, but never told to the buyer
    // before now. NULL for COD (domain.computeExpiry never sets a deadline
    // for it). This is the only line this phase adds to this allowlist.
    expires_at,
  } = order
  return {
    id, order_token, status, total, fulfillment_method, tracking_code, created_at, items,
    pickup_location, pickup_note, expires_at,
  }
}
```

Replace with:

```js
function toPublicOrder(order) {
  const {
    id, order_token, status, total, fulfillment_method, tracking_code, created_at, items,
    // Spec (Fulfillment): pickup location/note must be shown on the order
    // page, not just the pre-purchase collection browse page. Sourced from
    // the order's own collection (joined in getOrderByToken), same content
    // that is already public on the collection page — no new exposure.
    pickup_location, pickup_note,
    // Spec (Buyer Onboarding, Phase 6): the payment deadline the reservation
    // and the expiry sweep already enforce, but never told to the buyer
    // before now. NULL for COD (domain.computeExpiry never sets a deadline
    // for it). This is the only line this phase adds to this allowlist.
    expires_at,
    // Spec (Event Pickup Verification): a pickup-only code the buyer can
    // read aloud/show staff, verifiable against the printed roster without
    // network. Always null for a ship order.
    pickup_code,
  } = order
  return {
    id, order_token, status, total, fulfillment_method, tracking_code, created_at, items,
    pickup_location, pickup_note, expires_at, pickup_code,
  }
}
```

Find `validate`:

```js
  if (!FULFILLMENT.includes(fulfillment_method)) return "Hình thức nhận hàng không hợp lệ"
  if (!PAYMENT_METHODS.includes(payment_method)) return "Phương thức thanh toán không hợp lệ"
```

Replace with:

```js
  if (!FULFILLMENT.includes(fulfillment_method)) return "Hình thức nhận hàng không hợp lệ"
  if (!PAYMENT_METHODS.includes(payment_method)) return "Phương thức thanh toán không hợp lệ"
  // Pickup orders require prepayment — COD only applies when there is a
  // delivery to collect cash at. A crafted request could otherwise bypass
  // the checkout UI's own filter (added alongside this).
  if (payment_method === "cod" && fulfillment_method === "pickup") {
    return "COD không áp dụng cho đơn nhận tại sự kiện"
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/orderRoutes.test.js`
Expected: PASS, all tests in the file including the 3 new ones.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, baseline + 3 new tests, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/orders.js backend/tests/orderRoutes.test.js
git commit -F - <<'EOF'
feat(shop): surface pickup_code publicly, reject COD for pickup orders

toPublicOrder() adds pickup_code to its allowlist (null for ship orders,
a 6-digit code for pickup orders) so the buyer's order page (wired in a
later commit) can show it.

validate() now rejects payment_method "cod" combined with
fulfillment_method "pickup" server-side -- pickup orders require
prepayment, and this closes the gap a crafted request could otherwise
use to bypass the checkout UI's own filter (added alongside this in a
later commit).
EOF
```

---

### Task 3: `pickup_code` on the printable pickup roster

**Files:**
- Modify: `backend/shop/shipping/roster.js`
- Modify: `backend/routes/adminShipping.js`
- Test: `backend/tests/roster.test.js`
- Test: `backend/tests/adminShippingRoster.test.js`

**Interfaces:**
- Consumes: `order.pickup_code` (Task 1, already present on any order object `buildRoster` receives once the route's SELECT includes it).
- Produces: every row `buildRoster()` returns gains `pickup_code`.

- [ ] **Step 1: Write the failing test for `buildRoster`**

In `backend/tests/roster.test.js`, add a new `describe` block (using the file's existing `order()` fixture):

```js
describe("buildRoster — pickup_code", () => {
  it("includes pickup_code on every row", () => {
    const { rows } = buildRoster([order({ pickup_code: "482913" })])
    expect(rows[0].pickup_code).toBe("482913")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/roster.test.js`
Expected: FAIL — `rows[0].pickup_code` is `undefined`.

- [ ] **Step 3: Implement in `roster.js`**

In `backend/shop/shipping/roster.js`, find:

```js
    rows.push({
      order_id: order.id,
      order_code: orderCode(order.id),
      buyer_name: order.buyer_name,
      phone: order.phone,
      items: (order.items || []).map((i) => ({
        product_name: i.product_name_snapshot,
        variant_label: i.variant_label_snapshot,
        qty: i.qty,
      })),
      paid,
      amount_due: amountDue,
    })
```

Replace with:

```js
    rows.push({
      order_id: order.id,
      order_code: orderCode(order.id),
      buyer_name: order.buyer_name,
      phone: order.phone,
      pickup_code: order.pickup_code,
      items: (order.items || []).map((i) => ({
        product_name: i.product_name_snapshot,
        variant_label: i.variant_label_snapshot,
        qty: i.qty,
      })),
      paid,
      amount_due: amountDue,
    })
```

- [ ] **Step 4: Run to verify `roster.test.js` passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/roster.test.js`
Expected: PASS, all tests including the new one.

- [ ] **Step 5: Write the failing test for the roster route's SELECT**

In `backend/tests/adminShippingRoster.test.js`, add inside `describe("GET /api/admin/shipping/roster/:collectionId", ...)` (using the file's existing `seedPickupOrder()` helper):

```js
  it("includes pickup_code in the roster row", async () => {
    const { collectionId, orderId } = await seedPickupOrder()
    const res = await authed(request(app).get(`/api/admin/shipping/roster/${collectionId}`))
    const row = res.body.rows.find((r) => r.order_id === orderId)
    expect(row.pickup_code).toMatch(/^\d{6}$/)
  })
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/adminShippingRoster.test.js`
Expected: FAIL — `row.pickup_code` is `undefined` (the route's SELECT doesn't fetch the column yet).

- [ ] **Step 7: Implement in `adminShipping.js`**

In `backend/routes/adminShipping.js`, find:

```js
      const [orderRows] = await db.query(
        `SELECT id, buyer_name, phone, status, payment_method, cod_amount
           FROM orders
          WHERE collection_id = ? AND status = 'confirmed' AND fulfillment_method = 'pickup'`,
        [collectionId]
      )
```

Replace with:

```js
      const [orderRows] = await db.query(
        `SELECT id, buyer_name, phone, status, payment_method, cod_amount, pickup_code
           FROM orders
          WHERE collection_id = ? AND status = 'confirmed' AND fulfillment_method = 'pickup'`,
        [collectionId]
      )
```

`order_token` remains deliberately absent from this SELECT — do not add it. `pickup_code` is intentionally added: it is narrow, non-bearer, and meant to be printed, per the file's existing comment about this document being carried around a public event.

- [ ] **Step 8: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/adminShippingRoster.test.js`
Expected: PASS, all tests including the new one.

- [ ] **Step 9: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, baseline + 2 new tests, no regressions.

- [ ] **Step 10: Commit**

```bash
git add backend/shop/shipping/roster.js backend/routes/adminShipping.js backend/tests/roster.test.js backend/tests/adminShippingRoster.test.js
git commit -F - <<'EOF'
feat(shop): add pickup_code to the printable pickup roster

Staff can now verify a buyer at an event by matching their stated code
against this already-printable, already-offline-capable document,
without any live lookup. order_token remains deliberately excluded from
this SELECT (per the file's existing comment: this document is printed
and carried around a public event) -- pickup_code is added because,
unlike order_token, it is narrow and non-bearer by design and is meant
to be on this document.
EOF
```

---

### Task 4: `pickup_code` in the pickup confirmation email

**Files:**
- Modify: `backend/shop/email/sender.js`
- Test: `backend/tests/sender.test.js`

**Interfaces:**
- Consumes: `order.pickup_code` (Task 1, already present on the `order` object `sendQueued` fetches via `orderRepo.getOrderById`).

- [ ] **Step 1: Write the failing test**

In `backend/tests/sender.test.js`, add inside `describe("sendQueued: pickup QR gating", ...)` (using the file's existing `seedOrder()` helper):

```js
  it("pickup order: email includes the pickup_code", async () => {
    const o = await seedOrder("pickup")
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    const [[row]] = await db.query("SELECT pickup_code FROM orders WHERE id = ?", [o.id])
    expect(sentArg.html).toContain(row.pickup_code)
  })
```

(If `db` is not already imported in this test file, check its existing imports first — it very likely already is, since other tests in this suite query the database directly; use the same import it already uses rather than adding a second one.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/sender.test.js`
Expected: FAIL — the email HTML does not contain the pickup code yet.

- [ ] **Step 3: Implement**

In `backend/shop/email/sender.js`, find:

```js
      if (isPickup) {
        // cid: attachment rather than a data URI (Gmail strips those) or a
        // remote URL (blocked by default in many clients).
        const png = await qr.qrPngBuffer(qr.orderUrl(order.order_token))
        html += `
          <div style="text-align:center;margin-top:16px">
            <img src="cid:orderqr" alt="QR đơn hàng" width="160" height="160">
            <p style="font-size:12px;color:#888">Đưa mã này khi nhận hàng tại sự kiện</p>
          </div>`
        attachments.push({ filename: "order-qr.png", content: png, cid: "orderqr" })
      }
```

Replace with:

```js
      if (isPickup) {
        // cid: attachment rather than a data URI (Gmail strips those) or a
        // remote URL (blocked by default in many clients).
        const png = await qr.qrPngBuffer(qr.orderUrl(order.order_token))
        html += `
          <div style="text-align:center;margin-top:16px">
            <img src="cid:orderqr" alt="QR đơn hàng" width="160" height="160">
            <p style="font-size:12px;color:#888">Đưa mã này khi nhận hàng tại sự kiện</p>
            <p style="font-size:14px;margin-top:8px">
              Mã xác nhận nhận hàng: <strong>${order.pickup_code}</strong>
            </p>
            <p style="font-size:12px;color:#888">
              Nếu không quét được mã QR (mạng yếu tại sự kiện), hãy đọc mã này cho nhân viên.
            </p>
          </div>`
        attachments.push({ filename: "order-qr.png", content: png, cid: "orderqr" })
      }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/sender.test.js`
Expected: PASS, all tests in the file including the new one.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, baseline + 1 new test, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/shop/email/sender.js backend/tests/sender.test.js
git commit -F - <<'EOF'
feat(shop): include pickup_code in the pickup confirmation email

Alongside the existing order-QR image, the buyer now also gets their
6-digit pickup code as plain text -- readable aloud or showable to
staff even when the QR itself can't be scanned due to weak event-venue
connectivity.
EOF
```

---

### Task 5: `POST /admin/orders/bulk-complete` backend route

**Files:**
- Modify: `backend/routes/adminOrders.js`
- Test: `backend/tests/adminOrderRoutes.test.js`

**Interfaces:**
- Consumes: `repo.transitionOrder` (existing), `repo.getOrderById` (existing).
- Produces: `POST /api/admin/orders/bulk-complete` — same request/response shape as `bulk-cancel` (`{ ids: number[] }` → `{ results: [{ id, ok, error?, message? }] }`), transitioning each to `"completed"` instead of `"cancelled"`.
- Consumed by: Task 6 (`adminBulkCompleteOrders` API call + button).

This lets staff who verified buyers offline via the roster (Task 3) batch-apply the actual `completed` status once connectivity returns, instead of clicking "Hoàn tất" on each order individually.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/adminOrderRoutes.test.js`, add a new `describe` block after the existing `describe("POST /api/admin/orders/bulk-cancel", ...)` block (using the file's existing `seedOrder()` helper and `authed`/`token`):

```js
describe("POST /api/admin/orders/bulk-complete", () => {
  it("requires a token", async () => {
    const res = await request(app).post("/api/admin/orders/bulk-complete").send({ ids: [1] })
    expect(res.status).toBe(401)
  })

  it("completes multiple confirmed pickup orders", async () => {
    const a = await seedOrder({ fulfillment_method: "pickup" })
    const b = await seedOrder({ fulfillment_method: "pickup" })
    await orders.transitionOrder(a.id, "confirmed")
    await orders.transitionOrder(b.id, "confirmed")

    const res = await authed(request(app).post("/api/admin/orders/bulk-complete"))
      .send({ ids: [a.id, b.id] })

    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(2)
    expect(res.body.results.every((r) => r.ok)).toBe(true)

    const [[rowA]] = await db.query("SELECT status FROM orders WHERE id = ?", [a.id])
    const [[rowB]] = await db.query("SELECT status FROM orders WHERE id = ?", [b.id])
    expect(rowA.status).toBe("completed")
    expect(rowB.status).toBe("completed")
  })

  it("isolates a failing order from the others in the same batch", async () => {
    const ok1 = await seedOrder({ fulfillment_method: "pickup" })
    await orders.transitionOrder(ok1.id, "confirmed")
    const stillPending = await seedOrder({ fulfillment_method: "pickup" })
    const ok2 = await seedOrder({ fulfillment_method: "pickup" })
    await orders.transitionOrder(ok2.id, "confirmed")

    const res = await authed(request(app).post("/api/admin/orders/bulk-complete"))
      .send({ ids: [ok1.id, stillPending.id, ok2.id, 999999] })

    expect(res.status).toBe(200)
    const byId = Object.fromEntries(res.body.results.map((r) => [r.id, r]))
    expect(byId[ok1.id].ok).toBe(true)
    expect(byId[ok2.id].ok).toBe(true)
    expect(byId[stillPending.id].ok).toBe(false)
    expect(byId[stillPending.id].error).toBe("invalid_transition")
    expect(byId[999999].ok).toBe(false)
    expect(byId[999999].error).toBe("not_found")
  })

  it("rejects a non-array ids payload", async () => {
    const res = await authed(request(app).post("/api/admin/orders/bulk-complete")).send({ ids: "1,2" })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects an empty ids array", async () => {
    const res = await authed(request(app).post("/api/admin/orders/bulk-complete")).send({ ids: [] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects a batch larger than the cap", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1)
    const res = await authed(request(app).post("/api/admin/orders/bulk-complete")).send({ ids })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/adminOrderRoutes.test.js`
Expected: FAIL — `POST /api/admin/orders/bulk-complete` does not exist (404s), so every test in the new block fails.

- [ ] **Step 3: Implement**

In `backend/routes/adminOrders.js`, find the constant near the top:

```js
// A griefed drop is at most a few dozen orders; this is generous headroom
// while still bounding how many DB transactions + email enqueues one request
// can trigger.
const BULK_CANCEL_MAX = 100
```

Replace with:

```js
// A griefed drop is at most a few dozen orders; this is generous headroom
// while still bounding how many DB transactions + email enqueues one request
// can trigger. Shared by bulk-cancel and bulk-complete — same reasoning
// applies to both.
const BULK_ACTION_MAX = 100
```

Find every remaining use of `BULK_CANCEL_MAX` inside the existing `bulk-cancel` route and rename it to `BULK_ACTION_MAX` (two occurrences: the length check and the error message's `${BULK_CANCEL_MAX}` interpolation) — the bulk-cancel route's behavior is otherwise completely unchanged, only the constant's name.

After the entire existing `router.post("/orders/bulk-cancel", ...)` block (i.e. after its closing `})`), add:

```js
  // Bulk complete — lets staff who verified pickup buyers offline (via the
  // printed roster's pickup_code, when event-venue connectivity was too weak
  // for the live QR-scan flow) batch-apply the completed status once
  // connectivity returns, instead of one order at a time. Mirrors
  // bulk-cancel exactly: same transitionOrder() call per order, same
  // per-order error isolation, same cap.
  router.post("/orders/bulk-complete", async (req, res) => {
    try {
      const { ids } = req.body
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "invalid_input", message: "ids phải là mảng khác rỗng" })
      }
      if (ids.length > BULK_ACTION_MAX) {
        return res.status(400).json({
          error: "invalid_input",
          message: `Chỉ có thể hoàn tất tối đa ${BULK_ACTION_MAX} đơn mỗi lần`,
        })
      }

      const results = []
      for (const rawId of ids) {
        const id = Number(rawId)
        if (!Number.isInteger(id) || id <= 0) {
          results.push({ id: rawId, ok: false, error: "invalid_input", message: "ID đơn hàng không hợp lệ" })
          continue
        }

        try {
          const order = await repo.getOrderById(id)
          if (!order) {
            results.push({ id, ok: false, error: "not_found", message: "Không tìm thấy đơn hàng" })
            continue
          }

          const ok = await repo.transitionOrder(id, "completed")
          results.push(ok
            ? { id, ok: true }
            : {
                id, ok: false, error: "invalid_transition",
                message: `Không thể chuyển từ "${order.status}" sang "completed"`,
              })
        } catch (err) {
          console.error(`[ADMIN/ORDERS] Lỗi hoàn tất đơn ${id} trong hoàn tất hàng loạt:`, err)
          results.push({ id, ok: false, error: "server_error", message: "Lỗi server. Thử lại sau." })
        }
      }

      res.json({ results })
    } catch (err) { oops(res, err, "Lỗi hoàn tất hàng loạt đơn") }
  })
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/adminOrderRoutes.test.js`
Expected: PASS, all tests in the file including the 6 new ones (bulk-cancel's own tests must still pass unchanged — confirms the `BULK_CANCEL_MAX` → `BULK_ACTION_MAX` rename didn't break it).

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, baseline + 6 new tests, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/adminOrders.js backend/tests/adminOrderRoutes.test.js
git commit -F - <<'EOF'
feat(shop): add POST /admin/orders/bulk-complete

Mirrors the existing bulk-cancel route exactly (same request/response
shape, same per-order error isolation, same cap -- renamed
BULK_CANCEL_MAX to BULK_ACTION_MAX since it's now shared by both).
Lets staff who verified pickup buyers offline via the printed roster's
pickup_code batch-apply the completed status once connectivity returns,
instead of transitioning each order one at a time.
EOF
```

---

### Task 6: "Hoàn tất đã chọn" bulk-complete button in `AdminOrders.jsx`

**Files:**
- Modify: `frontend/src/api/shop.js`
- Modify: `frontend/src/components/AdminOrders.jsx`
- Test: `frontend/src/components/AdminOrders.test.jsx`

**Interfaces:**
- Consumes: `POST /admin/orders/bulk-complete` (Task 5).
- Produces: `adminBulkCompleteOrders(ids): Promise<{results}>` exported from `shop.js`.

- [ ] **Step 1: Add the API call**

In `frontend/src/api/shop.js`, find:

```js
export const adminBulkCancelOrders = (ids) =>
  api.post("/api/admin/orders/bulk-cancel", { ids }).then((r) => r.data)
```

Replace with:

```js
export const adminBulkCancelOrders = (ids) =>
  api.post("/api/admin/orders/bulk-cancel", { ids }).then((r) => r.data)

export const adminBulkCompleteOrders = (ids) =>
  api.post("/api/admin/orders/bulk-complete", { ids }).then((r) => r.data)
```

- [ ] **Step 2: Write the failing tests**

In `frontend/src/components/AdminOrders.test.jsx`, find how `adminBulkCancelOrders` is mocked at the top of the file (via `vi.mock("../api/shop", ...)`) and add `adminBulkCompleteOrders` to the same mock object, following the exact same pattern used for `adminBulkCancelOrders`. Then add a new `describe` block, using this file's existing `order()` fixture and `renderAdminOrders()` helper:

```js
describe("AdminOrders — bulk complete (Event Pickup Verification plan)", () => {
  it("renders a bulk-complete button beside bulk-cancel, disabled with nothing selected", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    const container = await renderAdminOrders()
    const buttons = [...container.querySelectorAll("button")]
    const completeBtn = buttons.find((b) => b.textContent.startsWith("Hoàn tất đã chọn"))
    expect(completeBtn).toBeTruthy()
    expect(completeBtn.disabled).toBe(true)
  })

  it("uses success styling, not danger, distinct from the cancel button", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 })])
    const container = await renderAdminOrders()
    const buttons = [...container.querySelectorAll("button")]
    const completeBtn = buttons.find((b) => b.textContent.startsWith("Hoàn tất đã chọn"))
    const cancelBtn = buttons.find((b) => b.textContent.startsWith("Huỷ đã chọn"))
    expect(completeBtn.className).toContain("var(--border-success)")
    expect(completeBtn.className).not.toBe(cancelBtn.className)
  })

  it("calls adminBulkCompleteOrders with the selected ids and reloads", async () => {
    adminListOrders.mockResolvedValue([order({ id: 1 }), order({ id: 2 })])
    adminBulkCompleteOrders.mockResolvedValue({ results: [{ id: 1, ok: true }, { id: 2, ok: true }] })
    const container = await renderAdminOrders()

    const checkboxes = [...container.querySelectorAll('input[type="checkbox"][aria-label]')]
    await act(async () => { checkboxes[0].click() })
    await act(async () => { checkboxes[1].click() })

    const completeBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.startsWith("Hoàn tất đã chọn"))
    await act(async () => { completeBtn.click() })

    expect(adminBulkCompleteOrders).toHaveBeenCalledWith([1, 2])
  })
})
```

Read the file's existing bulk-cancel tests first to confirm the exact mock-setup and helper names (`adminListOrders`, `renderAdminOrders`, `order()`, `act`) before writing these — reuse them, do not invent new ones.

- [ ] **Step 3: Run to verify the new tests fail**

Run: `cd frontend && npm test -- AdminOrders`
Expected: FAIL — no "Hoàn tất đã chọn" button exists yet, `adminBulkCompleteOrders` mock is never called.

- [ ] **Step 4: Implement**

In `frontend/src/components/AdminOrders.jsx`, find the import:

```js
import {
  adminListOrders, adminTransitionOrder, adminGetOrder, fetchPaymentInstructions,
  adminBulkCancelOrders, adminListCollections,
} from "../api/shop"
```

Replace with:

```js
import {
  adminListOrders, adminTransitionOrder, adminGetOrder, fetchPaymentInstructions,
  adminBulkCancelOrders, adminBulkCompleteOrders, adminListCollections,
} from "../api/shop"
```

Find `bulkCancel`:

```js
  const bulkCancel = async () => {
    if (selected.size === 0) return
    if (!confirm(`Hủy ${selected.size} đơn đã chọn? Thao tác này không thể hoàn tác — kho sẽ được hoàn lại cho những đơn hủy thành công.`)) {
      return
    }

    setBulkBusy(true)
    setBulkResults(null)
    try {
      // A 200 here only means the request was well-formed — each order's own
      // ok/error must be read individually; some may fail (e.g. an order
      // that was already completed cannot legally move to cancelled).
      const { results } = await adminBulkCancelOrders([...selected])
      setBulkResults(results)
      await reload()
      setSelected(new Set())
    } catch (e) {
      setBulkResults([{ id: null, ok: false, error: "server_error", message: e.response?.data?.message || "Huỷ hàng loạt thất bại" }])
    } finally {
      setBulkBusy(false)
    }
  }
```

Replace with (adds `bulkComplete` right after it, following the exact same shape):

```js
  const bulkCancel = async () => {
    if (selected.size === 0) return
    if (!confirm(`Hủy ${selected.size} đơn đã chọn? Thao tác này không thể hoàn tác — kho sẽ được hoàn lại cho những đơn hủy thành công.`)) {
      return
    }

    setBulkBusy(true)
    setBulkResults(null)
    try {
      // A 200 here only means the request was well-formed — each order's own
      // ok/error must be read individually; some may fail (e.g. an order
      // that was already completed cannot legally move to cancelled).
      const { results } = await adminBulkCancelOrders([...selected])
      setBulkResults(results)
      await reload()
      setSelected(new Set())
    } catch (e) {
      setBulkResults([{ id: null, ok: false, error: "server_error", message: e.response?.data?.message || "Huỷ hàng loạt thất bại" }])
    } finally {
      setBulkBusy(false)
    }
  }

  // For staff who verified pickup buyers offline via the printed roster's
  // pickup_code (weak event-venue connectivity), applying the actual
  // completed status can happen later, in one batch, instead of one order
  // at a time. Same shape as bulkCancel — a 200 only means the request was
  // well-formed, each order's own ok/error must be read individually.
  const bulkComplete = async () => {
    if (selected.size === 0) return

    setBulkBusy(true)
    setBulkResults(null)
    try {
      const { results } = await adminBulkCompleteOrders([...selected])
      setBulkResults(results)
      await reload()
      setSelected(new Set())
    } catch (e) {
      setBulkResults([{ id: null, ok: false, error: "server_error", message: e.response?.data?.message || "Hoàn tất hàng loạt thất bại" }])
    } finally {
      setBulkBusy(false)
    }
  }
```

Find the bulk-cancel button:

```jsx
          <button type="button" onClick={bulkCancel} disabled={selected.size === 0 || bulkBusy}
            className={`px-2 py-1 text-sm border rounded-lg ${ACTION_BUTTON_CLASSES.danger} disabled:opacity-50`}>
            {bulkBusy ? "Đang huỷ..." : `Huỷ đã chọn (${selected.size})`}
          </button>
```

Replace with:

```jsx
          <button type="button" onClick={bulkCancel} disabled={selected.size === 0 || bulkBusy}
            className={`px-2 py-1 text-sm border rounded-lg ${ACTION_BUTTON_CLASSES.danger} disabled:opacity-50`}>
            {bulkBusy ? "Đang huỷ..." : `Huỷ đã chọn (${selected.size})`}
          </button>
          <button type="button" onClick={bulkComplete} disabled={selected.size === 0 || bulkBusy}
            className={`px-2 py-1 text-sm border rounded-lg ${ACTION_BUTTON_CLASSES.success} disabled:opacity-50`}>
            {bulkBusy ? "Đang xử lý..." : `Hoàn tất đã chọn (${selected.size})`}
          </button>
```

`bulkResults`/`failedBulkResults` rendering below is already generic (keyed on `bulkResults`, not on which action produced them) — it needs no change to display either action's results correctly.

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npm test -- AdminOrders`
Expected: PASS, all tests including the 3 new ones.

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test && npm run build && npm run lint`
Expected: PASS; lint shows exactly the same 3 pre-existing problems, none new.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/shop.js frontend/src/components/AdminOrders.jsx frontend/src/components/AdminOrders.test.jsx
git commit -F - <<'EOF'
feat(admin): add a bulk "Hoàn tất đã chọn" action beside bulk-cancel

Lets staff who verified pickup buyers offline via the printed roster's
pickup_code batch-apply the completed status in one action once
connectivity returns, instead of transitioning each order individually.
Success-toned styling (not danger) since completing is not the
destructive, irreversible action cancelling is.
EOF
```

---

### Task 7: Buyer-facing pickup code on the order page

**Files:**
- Modify: `frontend/src/pages/Order.jsx`
- Modify: `frontend/src/i18n/translations.js`
- Test: `frontend/src/pages/Order.test.jsx`

**Interfaces:**
- Consumes: `order.pickup_code` (Task 2, `null` for ship orders / a 6-digit string for pickup orders).

- [ ] **Step 1: Add the i18n keys**

In `frontend/src/i18n/translations.js`, find (inside the `en` block, near the other pickup-related keys):

```js
    checkoutPaymentWindow: "Bank transfer / Momo / PayPal orders must be paid within a limited window after you order, or they're cancelled automatically. The exact deadline will appear on your order page after checkout.",
```

Replace with:

```js
    checkoutPaymentWindow: "Bank transfer / Momo / PayPal orders must be paid within a limited window after you order, or they're cancelled automatically. The exact deadline will appear on your order page after checkout.",
    orderPickupCode: "Pickup code",
    orderPickupCodeHint: "Show or read this to event staff if the QR code can't be scanned.",
```

Find (inside the `vi` block, near the equivalent Vietnamese keys):

```js
    checkoutPaymentWindow: "Đơn hàng thanh toán qua chuyển khoản/Momo/PayPal cần được thanh toán trong một khoảng thời gian giới hạn sau khi đặt hàng, nếu không sẽ tự động bị hủy. Hạn cụ thể sẽ hiển thị trên trang đơn hàng của bạn sau khi đặt.",
```

Replace with:

```js
    checkoutPaymentWindow: "Đơn hàng thanh toán qua chuyển khoản/Momo/PayPal cần được thanh toán trong một khoảng thời gian giới hạn sau khi đặt hàng, nếu không sẽ tự động bị hủy. Hạn cụ thể sẽ hiển thị trên trang đơn hàng của bạn sau khi đặt.",
    orderPickupCode: "Mã nhận hàng",
    orderPickupCodeHint: "Đọc hoặc cho nhân viên xem mã này nếu không quét được mã QR.",
```

- [ ] **Step 2: Write the failing tests**

In `frontend/src/pages/Order.test.jsx`, add a new `describe` block (using the file's existing `baseOrder()`/`renderOrder()` helpers):

```js
describe("Order — pickup code (Event Pickup Verification plan)", () => {
  it("shows the pickup code for a pickup order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ fulfillment_method: "pickup", pickup_code: "482913" }))
    const container = await renderOrder()
    expect(container.textContent).toContain("482913")
  })

  it("does not render a pickup code section for a ship order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ fulfillment_method: "ship", pickup_code: null }))
    const container = await renderOrder()
    expect(container.textContent).not.toContain("Pickup code")
  })
})
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `cd frontend && npm test -- Order.test`
Expected: FAIL — the pickup code isn't rendered anywhere yet.

- [ ] **Step 4: Implement**

In `frontend/src/pages/Order.jsx`, find:

```jsx
      {order.fulfillment_method === "pickup" && (order.pickup_location || order.pickup_note) && (
        <div className="mt-4 p-4 rounded-xl border border-[var(--border-brand)] opacity-80 text-sm">
          {order.pickup_location && (
            <p className="font-semibold">{t("shopPickupLocation")}: {order.pickup_location}</p>
          )}
          {order.pickup_note && <p>{t("shopPickupNote")}: {order.pickup_note}</p>}
        </div>
      )}
```

Replace with:

```jsx
      {order.fulfillment_method === "pickup" && (order.pickup_location || order.pickup_note) && (
        <div className="mt-4 p-4 rounded-xl border border-[var(--border-brand)] opacity-80 text-sm">
          {order.pickup_location && (
            <p className="font-semibold">{t("shopPickupLocation")}: {order.pickup_location}</p>
          )}
          {order.pickup_note && <p>{t("shopPickupNote")}: {order.pickup_note}</p>}
        </div>
      )}

      {order.fulfillment_method === "pickup" && order.pickup_code && (
        <div className="mt-4 p-4 rounded-xl border border-[var(--border-warning)] bg-[var(--surface-warning)] text-center">
          <p className="text-xs opacity-70">{t("orderPickupCode")}</p>
          <p className="text-2xl font-bold tracking-widest">{order.pickup_code}</p>
          <p className="text-xs opacity-60 mt-1">{t("orderPickupCodeHint")}</p>
        </div>
      )}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npm test -- Order.test`
Expected: PASS, all tests including the 2 new ones.

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test && npm run build && npm run lint`
Expected: PASS; lint shows exactly the same 3 pre-existing problems, none new.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Order.jsx frontend/src/i18n/translations.js frontend/src/pages/Order.test.jsx
git commit -F - <<'EOF'
feat(shop): show the pickup code on the buyer's order page

Alongside the existing pickup location/note and order QR, a pickup
order now shows its 6-digit pickup_code prominently -- readable aloud
or showable to staff when the QR can't be scanned due to weak
event-venue connectivity. Absent entirely for ship orders, whose
pickup_code is always null.
EOF
```

---

### Task 8: Restrict COD to ship orders in Checkout

**Files:**
- Modify: `frontend/src/pages/Checkout.jsx`
- Test: `frontend/src/pages/Checkout.test.jsx`

**Interfaces:**
- Consumes: nothing new — operates on the existing `methods` (from `fetchPaymentMethods()`) and `fulfillment` state already in this component.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/pages/Checkout.test.jsx`, add a new `describe` block (using the file's existing `seedCart()`/`renderCheckout()` helpers and mocks):

```js
describe("Checkout — COD restricted to ship orders (Event Pickup Verification plan)", () => {
  it("hides COD from the payment picker when pickup is selected", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank", "cod"] })
    fetchCollection.mockResolvedValue({ allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null })

    const container = await renderCheckout()
    const pickupRadio = [...container.querySelectorAll('input[name="fulfillment"]')][1]
    await act(async () => { pickupRadio.click() })

    const options = [...container.querySelectorAll("select option")].map((o) => o.value)
    expect(options).toEqual(["bank"])
  })

  it("resets away from cod when switching from ship to pickup with cod selected", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank", "cod"] })
    fetchCollection.mockResolvedValue({ allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null })

    const container = await renderCheckout()
    const select = container.querySelector("select")
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(select, "cod")
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(select.value).toBe("cod")

    const pickupRadio = [...container.querySelectorAll('input[name="fulfillment"]')][1]
    await act(async () => { pickupRadio.click() })

    expect(select.value).not.toBe("cod")
  })

  it("still offers cod for a ship order", async () => {
    seedCart()
    fetchPaymentMethods.mockResolvedValue({ methods: ["bank", "cod"] })
    fetchCollection.mockResolvedValue({ allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null })

    const container = await renderCheckout()
    const options = [...container.querySelectorAll("select option")].map((o) => o.value)
    expect(options).toEqual(["bank", "cod"])
  })
})
```

Import `act` from `"react"` at the top of the file if it isn't already imported there — check first, this project's other test files (`Order.test.jsx`, `AdminOrders.test.jsx`) already do this the same way.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd frontend && npm test -- Checkout`
Expected: FAIL — COD still appears in the pickup case; switching to pickup does not reset an existing `cod` selection.

- [ ] **Step 3: Implement**

In `frontend/src/pages/Checkout.jsx`, find:

```js
  // Auto-select the sole offered method once the real flags are in, and
  // never leave the picker pointed at a method the collection doesn't offer.
  const offered = useMemo(() => {
    const list = []
    if (flags.allow_ship) list.push("ship")
    if (flags.allow_pickup) list.push("pickup")
    return list
  }, [flags])

  useEffect(() => {
    if (!flags.loaded) return
    if (!offered.includes(fulfillment)) setFulfillment(offered[0] || "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags.loaded, offered])
```

Replace with:

```js
  // Auto-select the sole offered method once the real flags are in, and
  // never leave the picker pointed at a method the collection doesn't offer.
  const offered = useMemo(() => {
    const list = []
    if (flags.allow_ship) list.push("ship")
    if (flags.allow_pickup) list.push("pickup")
    return list
  }, [flags])

  useEffect(() => {
    if (!flags.loaded) return
    if (!offered.includes(fulfillment)) setFulfillment(offered[0] || "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags.loaded, offered])

  // COD requires a delivery to collect cash at — it does not apply to an
  // event pickup, which requires prepayment. The server rejects this
  // combination too (routes/orders.js validate()); this is the UI half.
  const offeredPayment = useMemo(
    () => (methods || []).filter((m) => !(m === "cod" && fulfillment === "pickup")),
    [methods, fulfillment]
  )

  useEffect(() => {
    if (!offeredPayment.includes(payment)) setPayment(offeredPayment[0] || "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offeredPayment])
```

Find:

```jsx
      <label className="block mb-4">
        <span className="block text-sm mb-1">{t("checkoutPayment")}</span>
        <select value={payment} onChange={(e) => setPayment(e.target.value)}
          disabled={!methods || methods.length === 0}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent disabled:opacity-50">
          {(methods || []).map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
        </select>
        {methods && methods.length === 0 && (
          <p className="text-sm text-[var(--text-error)] mt-1">{t("checkoutNoMethods")}</p>
        )}
```

Replace with:

```jsx
      <label className="block mb-4">
        <span className="block text-sm mb-1">{t("checkoutPayment")}</span>
        <select value={payment} onChange={(e) => setPayment(e.target.value)}
          disabled={!methods || methods.length === 0}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent disabled:opacity-50">
          {offeredPayment.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
        </select>
        {methods && methods.length === 0 && (
          <p className="text-sm text-[var(--text-error)] mt-1">{t("checkoutNoMethods")}</p>
        )}
```

The submit button's `disabled={submitting || !methods || methods.length === 0}` is intentionally left reading `methods` (whether the *seller* has any method enabled at all), not `offeredPayment` — a pickup-only collection where the seller has only enabled COD is a real "cannot check out" state already surfaced by `offeredPayment` being empty and `payment` resetting to `""`, which the existing submit call already can't succeed with (an empty `payment_method` fails `validate()` server-side); no separate disabled-state wiring is needed for this task's scope.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- Checkout`
Expected: PASS, all tests in the file including the 3 new ones.

- [ ] **Step 5: Run the full frontend suite, then the backend suite once as a scope check**

```bash
cd frontend && npm test && npm run build && npm run lint
cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test
```

Expected: frontend suite passes with no new lint problems beyond the 3 pre-existing ones; backend suite passes at Task 7's count with **zero** files changed under `backend/` in this task's diff — this task touches only `Checkout.jsx` and its test.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Checkout.jsx frontend/src/pages/Checkout.test.jsx
git commit -F - <<'EOF'
feat(shop): hide COD from checkout when pickup is selected

COD requires a delivery to collect cash at — it doesn't apply to an
event pickup, which requires prepayment. The payment picker now filters
it out whenever fulfillment is "pickup", and resets away from cod if
the buyer had it selected before switching fulfillment methods. Server
already rejects this combination too (routes/orders.js, an earlier
commit in this plan) as defense in depth against a crafted request
bypassing this UI filter.
EOF
```

---

## Out of Scope (carried from the spec — do not implement)

- SMS delivery of the pickup code.
- True offline database writes (service-worker-queued completions).
- Any change to the existing QR-scan flow (`AdminQrScanner.jsx`, `onScanToken`) or to `canTransition`'s state machine.
- Restricting bulk-complete to pickup orders only.
- Any change to how `order_token` works or is validated.
