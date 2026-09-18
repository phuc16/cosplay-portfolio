# Coupon / Discount Codes Implementation Plan

**Goal:** Admin-creatable percent/fixed discount codes, redeemable once
per order at checkout, validated and applied inside `createOrder`'s
existing transaction with a `FOR UPDATE` lock on the coupon row so a
`max_uses` limit is race-safe.

**Architecture:** New `coupons` table (multi-row, unlike the singleton
`gift_settings`). New `orders.coupon_code_snapshot`/`discount_amount`
columns. `createOrder` resolves and locks the coupon row right after
computing the paid-items subtotal, applies the discount to `total`
before the free-gift threshold check runs (post-discount total decides
gift eligibility). A new public read-only preview endpoint lets Checkout
show a discount estimate before submitting - server stays authoritative.

**Tech Stack:** Node/Express, MySQL via mysql2 + Knex migrations, Vitest.

## Global Constraints

- One code per order, no stacking.
- Coupon lock always happens after the variant-rows lock in
  `createOrder`, keeping a consistent shop-wide lock order.
- `times_used` increments only inside the same transaction as the order
  it belongs to - a rolled-back order never consumes a use.
- Discount is order-level (a subtracted amount), never rewrites
  `order_items.unit_price_snapshot`.
- Gift eligibility is evaluated against the post-discount total.
- Deactivating (`active: false`) is the only "delete" - no hard delete.

---

### Task 1: Migrations

**Files:**
- Create `backend/migrations/041_create_coupons.js`
- Create `backend/migrations/042_add_order_coupon_columns.js`

- [ ] `041_create_coupons.js`:

```js
exports.up = function (knex) {
  return knex.schema.createTable("coupons", (table) => {
    table.increments("id").primary()
    table.string("code", 32).notNullable().unique()
    table.enu("type", ["percent", "fixed"]).notNullable()
    table.integer("value").unsigned().notNullable()
    table.boolean("active").notNullable().defaultTo(true)
    table.integer("min_total").unsigned().notNullable().defaultTo(0)
    table.integer("max_uses").unsigned().nullable()
    table.integer("times_used").unsigned().notNullable().defaultTo(0)
    table.timestamp("expires_at").nullable()
    table.timestamp("created_at").defaultTo(knex.fn.now())
  })
}
exports.down = function (knex) {
  return knex.schema.dropTableIfExists("coupons")
}
```

- [ ] `042_add_order_coupon_columns.js`:

```js
exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.string("coupon_code_snapshot", 32).nullable()
    table.integer("discount_amount").unsigned().notNullable().defaultTo(0)
  })
}
exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("coupon_code_snapshot")
    table.dropColumn("discount_amount")
  })
}
```

- [ ] Run `cd backend && npm run migrate`, confirm both via `DESCRIBE coupons; DESCRIBE orders;`.
- [ ] Commit.

---

### Task 2: `couponRepo.js` + admin routes + public preview route

**Files:**
- Create `backend/shop/coupons/couponRepo.js`
- Create `backend/routes/adminCoupons.js`
- Modify `backend/routes/shop.js` (public preview route)
- Modify `backend/server.js` (mount `adminCoupons`)
- Test: `backend/tests/couponRepo.test.js`, `backend/tests/adminCouponRoutes.test.js`, `backend/tests/shopCouponRoutes.test.js`

**`couponRepo.js` shape** (mirrors `catalogRepo.js`'s create/update
style, direct `db.query`, no ORM):

- `listCoupons()` → all rows, `ORDER BY id DESC`.
- `getCouponByCode(code)` → normalized-uppercase lookup, unlocked plain read.
- `createCoupon(data)` → validates shape (see below), normalizes code to
  uppercase/trim, catches `ER_DUP_ENTRY` and rethrows a clean
  `DuplicateCouponCodeError`.
- `updateCoupon(id, data)` → partial update of any field.
- `checkEligibility(coupon, subtotal, now)` → pure function, returns
  `{ ok: true }` or `{ ok: false, reason }` (`not_found` handled by the
  caller when `coupon` is null/undefined before calling this).
- `computeDiscount(coupon, subtotal)` → pure function, `floor(subtotal *
  value/100)` for percent (clamped to subtotal) or `min(value,
  subtotal)` for fixed.

`checkEligibility`/`computeDiscount` are exported so `orderRepo.js`
(Task 3) and the public preview route both use the exact same logic -
no duplicated validation rules to drift apart.

- [ ] Write failing tests in `couponRepo.test.js`: create validates
  `code`/`type`/`value` shape, rejects a duplicate code cleanly, `value`
  for `percent` capped at 100, `updateCoupon` flips `active` and edits
  fields, `list` returns newest-first, `checkEligibility` covers every
  reason (`inactive`, `expired`, `limit_reached`, `min_total_not_met`,
  ok), `computeDiscount` covers percent rounding + fixed clamping.
- [ ] Implement `couponRepo.js`.
- [ ] Run `npx vitest run tests/couponRepo.test.js` - green.
- [ ] Write failing admin route tests (`adminCouponRoutes.test.js`):
  auth required, create/list/update round-trip, validation errors surface
  as 400 with the repo's message.
- [ ] Implement `adminCoupons.js` (GET/POST/PUT), mount in `server.js`
  right after `adminGift`.
- [ ] Run `npx vitest run tests/adminCouponRoutes.test.js` - green.
- [ ] Write failing public preview test (`shopCouponRoutes.test.js`):
  valid code → `{valid:true, discount_amount, ...}`; each invalid reason
  → `{valid:false, reason}`; never touches `times_used`.
- [ ] Add `POST /coupons/validate` to `shop.js` (public, no auth,
  `publicLimiter` already covers this route's mount point).
- [ ] Run `npx vitest run tests/shopCouponRoutes.test.js` - green.
- [ ] Commit.

---

### Task 3: `createOrder` coupon resolution + discount application

**Files:**
- Modify `backend/shop/orders/orderRepo.js`
- Test: `backend/tests/orderRepo.test.js`

- [ ] Add `InvalidCouponError` (carries `.reason`) alongside the other
  error classes at the top of the file.
- [ ] Rename the existing `const total = domain.computeTotal(lines)` to
  `const subtotal = domain.computeTotal(lines)`.
- [ ] Immediately after it, insert the coupon block described in the
  design doc: normalize `input.coupon_code`, `SELECT * FROM coupons
  WHERE code = ? FOR UPDATE` on `conn`, validate via
  `couponRepo.checkEligibility` (treating a missing row as `not_found`
  before calling it), compute `discountAmount` via
  `couponRepo.computeDiscount`, `UPDATE coupons SET times_used =
  times_used + 1 WHERE id = ?` on `conn`, then `const total = subtotal -
  discountAmount`.
- [ ] Everything below (gift lookup, fulfillment resolution, stock
  decrement, `INSERT INTO orders`) keeps reading `total` unchanged - only
  the `INSERT INTO orders` column list/values gains
  `coupon_code_snapshot`/`discount_amount`.
- [ ] Export `InvalidCouponError`.
- [ ] Write the failing tests described in the design doc's Testing
  Approach section, in a new `describe("createOrder: coupon codes",
  ...)` block, seeding coupons directly via `db.query(INSERT INTO
  coupons ...)` (same style `seedGift` already uses for `gift_settings`).
  Include a rollback test: seed a coupon, force `createOrder` to throw
  for an unrelated reason (e.g. stock) on the same call, and assert
  `times_used` is unchanged afterward.
- [ ] Run `npx vitest run tests/orderRepo.test.js -t "coupon codes"` - green.
- [ ] Run the FULL `orderRepo.test.js` file - confirm no regressions
  (every pre-existing test passes no `coupon_code`, so `discountAmount`
  stays `0` and `total` is identical to before).
- [ ] Commit.

---

### Task 4: Buyer-facing + admin display

**Files:**
- Modify `backend/routes/orders.js` (`toPublicOrder` allowlist)
- Modify `backend/shop/email/templates.js` (`discount_row` placeholder + `PLACEHOLDERS`)
- Modify `frontend/src/components/AdminEmailTemplates.jsx` (`PLACEHOLDERS` mirror)
- Test: `backend/tests/emailTemplates.test.js`

- [ ] Add `coupon_code_snapshot, discount_amount` to `toPublicOrder`'s
  destructure and return object.
- [ ] Add `discount_row` to `templates.js`'s `PLACEHOLDERS` array and to
  `buildVars` (empty string when `discount_amount` is falsy or 0; else a
  table row showing the code and `-formatVnd(discount_amount)`).
- [ ] Insert `{{discount_row}}` as the first row inside the shared
  `TOTAL_ROW` HTML fragment, so every template using `${TOTAL_ROW}`
  picks it up automatically.
- [ ] Mirror the new placeholder name in
  `AdminEmailTemplates.jsx`'s `PLACEHOLDERS` array.
- [ ] Add tests in `emailTemplates.test.js`: renders the discount row
  when `discount_amount > 0` with the coupon code and amount, renders
  nothing when `discount_amount` is `0`/absent, `DEFAULT_TEMPLATES`
  placeholder-validity test still passes with the new placeholder
  registered.
- [ ] Run `npx vitest run tests/emailTemplates.test.js` - green.
- [ ] Commit.

---

### Task 5: Checkout UI - coupon field + preview

**Files:**
- Modify `frontend/src/api/shop.js` (`validateCoupon`, admin CRUD wrappers)
- Modify `frontend/src/pages/Checkout.jsx`
- Modify `frontend/src/pages/Checkout.test.jsx`
- Create `frontend/src/components/AdminCoupons.jsx` (+ test)
- Modify `frontend/src/pages/Admin.jsx` (mount under an existing tab)
- Modify `frontend/src/i18n/translations.js` (new keys)

- [ ] Add API wrappers: `validateCoupon({code, subtotal})`,
  `adminListCoupons`, `adminCreateCoupon`, `adminUpdateCoupon`.
- [ ] `Checkout.jsx`: a coupon-code text input + "Áp dụng" button, calls
  `validateCoupon` on click (not on every keystroke - same
  button-gated pattern `AddressFields.jsx`'s street search already
  established, for the same reason: no live-typing API spam), shows the
  discount estimate or an error message, includes `coupon_code` in the
  submitted order payload when a code is currently applied. On order
  creation returning `invalid_coupon`, clears the applied state and
  surfaces the server's message (server remains authoritative - mirrors
  the free gift's stale-estimate recovery path).
- [ ] `AdminCoupons.jsx`: list + create form (code, type, value,
  min_total, max_uses, expires_at) + active toggle per row. Modeled on
  `AdminGiftSettings.jsx`'s get/save pattern, but list-shaped like
  `AdminVariants.jsx`'s row list instead of a singleton form.
- [ ] Mount `AdminCoupons` under the existing "payments" tab (or a
  dedicated tab if the existing one is already crowded - check
  `Admin.jsx`'s current tab list before deciding).
- [ ] Add/extend component tests using this codebase's established
  `createRoot`/`act`/`vi.mock("../api/shop")` pattern (no
  `@testing-library/react`).
- [ ] Run `cd frontend && npm test` - green.
- [ ] Commit.

---

### Task 6: Full suite + log

- [ ] `cd backend && npm test` - full suite green (MinIO-dependent
  failures excepted, as documented in the payment-reminder-email PR).
- [ ] `cd frontend && npm test` - full suite green.
- [ ] Update `docs/AUTOMATED_FEATURES_LOG.md`.
- [ ] Push branch, open PR.
