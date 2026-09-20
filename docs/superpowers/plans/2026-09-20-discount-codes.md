# Discount/Coupon Codes Implementation Plan

**Goal:** Sellers can CRUD percent/fixed discount codes (optional minimum
order, optional usage cap, optional expiry). A buyer enters one code at
checkout; `createOrder` validates and applies it atomically, snapshotting
the code and amount onto the order permanently.

**Architecture:** A new `discount_codes` table (real CRUD, not a
singleton). `orders` gets `discount_code_snapshot`/`discount_amount_snapshot`.
`createOrder` resolves the code (if any) right after computing the paid-items
subtotal - locking the matched row `FOR UPDATE`, incrementing `used_count` in
the same transaction - before the (unrelated, independent) free-gift decision
runs off that same subtotal. A shared pure `evaluateCode()` function is used
by both the locking `createOrder` path and a new non-locking public preview
endpoint, so the two can never disagree about validity.

**Tech Stack:** Node/Express, MySQL via mysql2 + Knex migrations, React/Vite, Vitest.

## Global Constraints

- Single code per order, checkout-only (no `Cart.jsx` UI).
- Redemption tracked by a global `used_count`/`max_uses` counter, not per-buyer.
- `min_total` and the discount computation are both measured against the
  paid-items subtotal - before the free gift, before shipping.
- The discount and the free gift are independent: a code never changes gift
  eligibility; the gift is never itself discounted.
- `discount_amount = min(computed_amount, subtotal)` - never drives the
  total negative. A 0đ final total is an accepted edge case.
- Validation + `used_count` increment happen inside `createOrder`'s own
  transaction, locking only the matched `discount_codes` row.
- No delete-guard on `discount_codes` - snapshot-based, no FK from `orders`.
- Plain hyphens (` - `), never em dashes, in all new code/comments/copy.
- Buyer-facing strings go through the existing bilingual `t()`/
  `translations.js` mechanism; admin-facing labels are plain Vietnamese,
  same as every other admin form in this codebase.

---

### Task 1: Migrations - `discount_codes` table + `orders` snapshot columns

**Files:**
- Create: `backend/migrations/040_create_discount_codes.js`
- Create: `backend/migrations/041_add_order_discount_snapshot.js`

**Interfaces:**
- Produces: `discount_codes` table (`id, code, type, value, enabled,
  max_uses, used_count, min_total, expires_at, created_at, updated_at`);
  `orders.discount_code_snapshot` (nullable string), `orders.discount_amount_snapshot`
  (unsigned int, default 0).

- [x] **Step 1: Write `040_create_discount_codes.js`** (see file for exact columns/types)
- [x] **Step 2: Write `041_add_order_discount_snapshot.js`**
- [x] **Step 3: Run migrations**

Run: `cd backend && npm run migrate`
Expected: both migrations report as run, no errors. Confirmed via
`DESCRIBE discount_codes; DESCRIBE orders;`.

- [x] **Step 4: Commit**

```bash
git add backend/migrations/040_create_discount_codes.js backend/migrations/041_add_order_discount_snapshot.js
git commit -m "feat(shop): add discount_codes table and orders discount snapshot columns"
```

---

### Task 2: `discountCodes` repo (pure eval + CRUD) + admin routes + public preview route

**Files:**
- Create: `backend/shop/discountCodes.js`
- Create: `backend/routes/adminDiscounts.js`
- Modify: `backend/routes/shop.js` (add public `POST /discount-preview`)
- Modify: `backend/server.js` (mount `adminDiscounts`)
- Test: `backend/tests/discountCodes.test.js`
- Test: `backend/tests/adminDiscountRoutes.test.js`
- Test: `backend/tests/shopDiscountPreview.test.js`

**Interfaces:**
- Produces: `normalizeCode(code)`, `evaluateCode(row, subtotal, now)` (pure,
  no DB), `REASON_MESSAGES`, `validate(data)`, `listCodes()`,
  `getCodeById(id)`, `createCode(data)`, `updateCode(id, data)`,
  `deleteCode(id)`, `previewCode(code, subtotal, now)`, `DuplicateCodeError`.
  These are what Task 3 (`createOrder`) imports directly for
  `normalizeCode`/`evaluateCode`/`REASON_MESSAGES` (the locked read itself
  stays inline SQL inside `createOrder`'s own transaction, same discipline
  as every other locked read in that function).
- Produces HTTP: `GET/POST/PUT/DELETE /api/admin/discount-codes[/:id]`
  (JWT-guarded), `POST /api/shop/discount-preview` (public).

- [x] **Step 1: Write the failing pure-function + repo tests** (`discountCodes.test.js`)

Cover: `normalizeCode` trims/uppercases; `evaluateCode` returns each reason
(`not_found`, `disabled`, `expired`, `exhausted`, `below_minimum`) and the
success shape for both `percent` and `fixed`, including the
clamp-to-subtotal case (a 100%-off or oversized fixed code never returns an
amount greater than `subtotal`); `validate` rejects a missing code, an
out-of-range percent (>100), a non-positive value, a non-positive
`max_uses`, a negative `min_total`, an unparsable `expires_at`; CRUD
round-trips through the real DB including the duplicate-code error.

- [x] **Step 2: Run to verify failure** - `npx vitest run --pool=forks tests/discountCodes.test.js`
- [x] **Step 3: Write `backend/shop/discountCodes.js`**
- [x] **Step 4: Run to verify pass**
- [x] **Step 5: Write the failing admin route tests** (`adminDiscountRoutes.test.js`)

Cover: 401 without auth; create + list round-trip; 400 on invalid payload;
409 on a duplicate code (case-insensitive - creating "abc123" after "ABC123"
exists must also 409); update (including toggling `enabled`); delete (200
then a second delete 404s).

- [x] **Step 6: Run to verify failure**
- [x] **Step 7: Write `backend/routes/adminDiscounts.js`**
- [x] **Step 8: Mount in `backend/server.js`** immediately after the `adminGift` line
- [x] **Step 9: Run to verify pass**
- [x] **Step 10: Write the failing public preview test** (`shopDiscountPreview.test.js`)

Cover: valid code returns `{valid:true, amount, type, value}`; unknown code
returns `{valid:false, message}`; below-minimum returns
`{valid:false, message}` naming the reason; the call never increments
`used_count` (assert the DB row's `used_count` is unchanged after the
call); case-insensitive lookup (`abc123` matches a stored `ABC123`).

- [x] **Step 11: Run to verify failure**
- [x] **Step 12: Add the public route to `backend/routes/shop.js`**
- [x] **Step 13: Run to verify pass**
- [x] **Step 14: Run the full backend suite** - `npx vitest run --pool=forks`
- [x] **Step 15: Commit**

```bash
git add backend/shop/discountCodes.js backend/routes/adminDiscounts.js backend/routes/shop.js backend/server.js backend/tests/discountCodes.test.js backend/tests/adminDiscountRoutes.test.js backend/tests/shopDiscountPreview.test.js
git commit -m "feat(shop): add discount_codes repo, admin CRUD routes, and public preview endpoint"
```

---

### Task 3: `createOrder` discount resolution + snapshot + concurrency

**Files:**
- Modify: `backend/shop/orders/orderRepo.js`
- Modify: `backend/routes/orders.js` (map `InvalidDiscountCodeError` to 400)
- Test: `backend/tests/orderRepo.test.js` (new `describe("createOrder: discount codes", ...)`)
- Test: `backend/tests/orderConcurrency.test.js` (new race test)

**Interfaces:**
- Consumes: `discountCodes.normalizeCode`/`evaluateCode`/`REASON_MESSAGES`
  (Task 2); the `discount_codes` table, queried directly via `conn.query`
  inside `createOrder`'s own transaction (same pattern as the `gift_settings`
  read already there).
- Produces: every order created with a valid `discount_code` now has
  `discount_code_snapshot`/`discount_amount_snapshot` populated and
  `orders.total` reduced accordingly; `discount_codes.used_count` increments
  atomically. New export `InvalidDiscountCodeError` from `orderRepo.js`.

- [x] **Step 1: Add a `seedDiscountCode` helper + write the failing tests** in `orderRepo.test.js`

Add `"discount_codes"` to the file's `resetTables(...)` call and its
`afterAll` cleanup (mirrors how `gift_settings` was added for the same
cross-file-pollution reason - see `docs/EDGE_CASE_CHECKLIST.md`'s Free Gift
section).

New `describe("createOrder: discount codes", ...)` covering: no code -> no
snapshot, total unchanged; a valid percent code reduces `total` and stores
the snapshot fields; a valid fixed code; below `min_total` throws
`InvalidDiscountCodeError` with `reason: "below_minimum"`; disabled code
throws with `reason: "disabled"`; expired code throws with `reason:
"expired"`; a code already at `max_uses` throws with `reason: "exhausted"`
and does NOT increment `used_count` further; a 100%-off code clamps
`discount_amount_snapshot` to exactly `subtotal` (total lands at 0, order
still creates successfully); applying a code does not change free-gift
eligibility (a below-gift-threshold-after-discount order that was
gift-eligible before the discount still gets the gift, proving eligibility
is keyed off the pre-discount subtotal); the gift line's own
`unit_price_snapshot` stays `0` regardless of an applied code; code
lookup is case-insensitive (`abc123` input matches a stored `ABC123`); a
rolled-back order (e.g. a losing race, see Task 3's concurrency test) does
not leave `used_count` incremented for its own attempt.

- [x] **Step 2: Run to verify failure**
- [x] **Step 3: Add `InvalidDiscountCodeError` and rewrite the relevant section of `createOrder`**

Insert the discount-resolution block immediately after
`const subtotal = domain.computeTotal(lines)` (renamed from `total`) and
before the `gift_settings` read - using `conn.query(... FOR UPDATE)` on
`discount_codes` only, per the locking discipline above. Move the final
`total = subtotal - discountAmount` computation to after the gift line is
appended (so the gift line's presence can never affect it), and thread that
`total` through to the existing `orders` insert (unchanged column position
for `total`/`cod_amount`, since both already read the variable that now
carries the post-discount value) plus the two new columns.

- [x] **Step 4: Run the new tests to verify pass**
- [x] **Step 5: Run the FULL `orderRepo.test.js` file** - confirm zero regression
  (every pre-existing test has no `discount_codes` row, so `input.discount_code`
  is never set and the new block is a no-op for them).
- [x] **Step 6: Add the concurrency test to `orderConcurrency.test.js`**

`it("redeems a max_uses:1 code exactly once when 10 buyers race for it")`
- 10 concurrent `createOrder` calls with the same `discount_code`, one
  `discount_codes` row seeded with `max_uses: 1`. Exactly one order carries
  `discount_amount_snapshot > 0`; the rest either fail with
  `InvalidDiscountCodeError` (`reason: "exhausted"`) or succeed with the
  code simply not applied (a code that only just failed for a concurrent
  peer should still be usable for one final winner) - actual pattern: with
  `max_uses: 1`, at most one call can win the row lock and see `used_count
  < max_uses`, so exactly one order gets the discount and the rest must
  throw. Assert `used_count` ends at exactly `1`, not more.

- [x] **Step 7: Map `InvalidDiscountCodeError` in `backend/routes/orders.js`**

```js
if (err instanceof repo.InvalidDiscountCodeError) {
  return res.status(400).json({ error: "invalid_discount_code", message: err.message, reason: err.reason })
}
```

- [x] **Step 8: Run the full backend suite** - `npx vitest run --pool=forks`
- [x] **Step 9: Commit**

```bash
git add backend/shop/orders/orderRepo.js backend/routes/orders.js backend/tests/orderRepo.test.js backend/tests/orderConcurrency.test.js
git commit -m "feat(shop): apply and atomically redeem discount codes during order creation"
```

---

### Task 4: Payment/email/order-detail display of the applied discount

**Files:**
- Modify: `backend/shop/email/templates.js` (discount line in `order_placed`/`payment_confirmed`/`cancelled`/`payment_proof_uploaded`)
- Modify: `backend/routes/orders.js` (`toPublicOrder` exposes the two new fields)
- Modify: `frontend/src/pages/Order.jsx` (discount line between items and total)
- Modify: `frontend/src/components/AdminOrders.jsx` (discount line in order detail)
- Modify: `frontend/src/i18n/translations.js` (new keys)
- Test: extend `backend/tests/emailTemplates.test.js` (or equivalent) for the new discount line
- Test: extend `frontend/src/pages/Order.test.jsx` and `AdminOrders.test.jsx`

**Interfaces:**
- Consumes: `order.discount_code_snapshot`/`order.discount_amount_snapshot`
  (Task 3) - already present on every order read path since they're plain
  columns on `orders` (`getOrderById`/`getOrderByToken` do `SELECT *`), no
  repo change needed there.

- [x] **Step 1: `toPublicOrder` in `routes/orders.js`** - add
  `discount_code_snapshot`/`discount_amount_snapshot` to the destructured
  allowlist and the returned object (same pattern as every other field
  already listed there).
- [x] **Step 2: Email template discount line**

Add a `discount_row` var to `buildVars` in `templates.js`, built the same
way `TOTAL_ROW` is (a small table row), non-empty only when
`order.discount_code_snapshot` is set:

```js
discount_row: order.discount_code_snapshot
  ? `<table style="width:100%;border-collapse:collapse"><tr>
       <td style="padding:2px 0;font-size:13px;color:#888">Mã giảm giá ${escapeHtml(order.discount_code_snapshot)}</td>
       <td style="padding:2px 0;font-size:13px;color:#888;text-align:right">-${formatVnd(order.discount_amount_snapshot)}</td>
     </tr></table>`
  : "",
```

Add `{{discount_row}}` immediately before `${TOTAL_ROW}` in `order_placed`,
`payment_confirmed`, `cancelled`, and `payment_proof_uploaded` (the four
templates that already render `${TOTAL_ROW}`). Add `discount_row` to
`PLACEHOLDERS`.

- [x] **Step 3: Write/extend the failing email template test**, run, confirm pass.
- [x] **Step 4: Buyer order page (`Order.jsx`)** - a line between the items
  list and the total row: `{t("orderDiscountLabel")}: -{formatVnd(order.discount_amount_snapshot)}`
  next to the code, rendered only when `order.discount_code_snapshot` is set.
- [x] **Step 5: Admin order detail (`AdminOrders.jsx`)** - same content,
  plain Vietnamese label (no `t()`), placed after the items `<ul>` and
  before/alongside the existing total display, mirroring how `cancel_reason`
  is shown just above.
- [x] **Step 6: i18n keys** - `orderDiscountLabel` in both `en`/`vi` blocks
  of `translations.js`.
- [x] **Step 7: Run the full backend + frontend suites.**
- [x] **Step 8: Commit**

```bash
git add backend/shop/email/templates.js backend/routes/orders.js backend/tests frontend/src/pages/Order.jsx frontend/src/components/AdminOrders.jsx frontend/src/i18n/translations.js frontend/src/pages/Order.test.jsx frontend/src/components/AdminOrders.test.jsx
git commit -m "feat(shop): show the applied discount on the order page, admin detail, and emails"
```

---

### Task 5: Admin UI for discount code CRUD

**Files:**
- Create: `frontend/src/components/AdminDiscountCodes.jsx`
- Create: `frontend/src/components/AdminDiscountCodes.test.jsx`
- Modify: `frontend/src/api/shop.js` (admin CRUD wrappers)
- Modify: `frontend/src/pages/Admin.jsx` (new "Mã giảm giá" nav tab)

**Interfaces:**
- Consumes: `GET/POST/PUT/DELETE /api/admin/discount-codes[/:id]` (Task 2).

- [x] **Step 1: Add API wrappers** in `frontend/src/api/shop.js`, immediately
  after the gift-settings wrappers.
- [x] **Step 2: Write the failing component test** - same
  `createRoot`/`act`/`container.querySelector` pattern as
  `AdminCollections.test.jsx`: loads and lists existing codes; creates a new
  one (fills code/type/value, submits, asserts the API call payload);
  toggles `enabled` on an existing row; deletes a row (asserts the confirm
  dialog + API call); shows the server's validation/duplicate message on
  failure.
- [x] **Step 3: Run to verify failure**
- [x] **Step 4: Write `frontend/src/components/AdminDiscountCodes.jsx`**

List + shared single edit-form pattern, modeled directly on
`AdminCollections.jsx`'s list/edit/delete shape (not the
gift-settings singleton form, since this is a real multi-row CRUD list):
a table/list of existing codes (code, type/value, used_count/max_uses,
enabled, expires_at, Sửa/Xóa buttons), a form below for create/edit
(code, type select, value, max_uses, min_total, expires_at,
enabled checkbox), plain Vietnamese labels throughout.

- [x] **Step 5: Run to verify pass**
- [x] **Step 6: Wire into `Admin.jsx`** - new `tab === "discounts"` nav
  button ("Mã giảm giá") + render, placed after the "orders" tab.
- [x] **Step 7: Run the full frontend suite.**
- [x] **Step 8: Commit**

```bash
git add frontend/src/api/shop.js frontend/src/components/AdminDiscountCodes.jsx frontend/src/components/AdminDiscountCodes.test.jsx frontend/src/pages/Admin.jsx
git commit -m "feat(admin): add discount code CRUD UI as its own nav tab"
```

---

### Task 6: Checkout UI - code entry, apply, inline discount, submit payload

**Files:**
- Modify: `frontend/src/api/shop.js` (`previewDiscountCode`)
- Modify: `frontend/src/pages/Checkout.jsx`
- Modify: `frontend/src/pages/Checkout.test.jsx`
- Modify: `frontend/src/i18n/translations.js` (new keys)

**Interfaces:**
- Consumes: `POST /api/shop/discount-preview` (Task 2).

- [x] **Step 1: Add the API wrapper.**
- [x] **Step 2: Add i18n keys** (`checkoutDiscountLabel`, `checkoutDiscountApply`,
  `checkoutDiscountApplied`, `checkoutDiscountRemove`, plus whatever the
  preview's own invalid-code messages need - those come from the server
  verbatim, same as every other order-creation error message already
  displayed as-is in this codebase).
- [x] **Step 3: Write the failing `Checkout.test.jsx` cases** - entering a
  code and clicking Apply calls the preview endpoint with the cart subtotal;
  a valid response shows the discount inline and reduces the displayed
  total; an invalid response shows the server's message and applies
  nothing; a successful order submission includes `discount_code` in the
  payload only when a code was successfully applied; clearing an applied
  code removes it from the next submission's payload.
- [x] **Step 4: Run to verify failure.**
- [x] **Step 5: Implement in `Checkout.jsx`** - a text input + "Áp dụng"/
  "Apply" button near the cart-total block (next to the existing gift
  hint), state for `{code, applied: {amount, type, value} | null, error}`,
  wired into the `createOrder` payload's `discount_code` field and into the
  displayed total (`cartTotal(cart) - (applied?.amount || 0)`).
- [x] **Step 6: Run to verify pass.**
- [x] **Step 7: Run the full frontend suite + `npm run lint`.**
- [x] **Step 8: Commit**

```bash
git add frontend/src/api/shop.js frontend/src/pages/Checkout.jsx frontend/src/pages/Checkout.test.jsx frontend/src/i18n/translations.js
git commit -m "feat(shop): add discount code entry to Checkout"
```

---

### Task 7: Full suite + lint + docs

- [x] **Step 1:** `cd backend && npx vitest run --pool=forks` - full pass
  (only the known pre-existing MinIO-dependent failures remain).
- [x] **Step 2:** `cd frontend && npm test` - full pass.
- [x] **Step 3:** `cd frontend && npm run lint` - clean.
- [x] **Step 4:** Append a row to `docs/AUTOMATED_FEATURES_LOG.md`.
- [x] **Step 5: Commit** the log update.
