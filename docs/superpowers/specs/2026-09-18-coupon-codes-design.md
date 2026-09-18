# Coupon / Discount Codes — Design

## Goal

Sellers can create discount codes (percent-off or fixed-amount-off) that
buyers enter at checkout. A code can be limited to a minimum order
subtotal, a maximum number of total uses, and an expiry date. The
discount is validated and applied server-side at order creation - the
same trust boundary every other price-affecting decision in this shop
already uses (catalog prices, stock, the free gift) - and is permanently
recorded on the order via two new snapshot-style columns.

## Scope decisions

- **Order-level discount, not per-item.** A coupon discounts the order's
  paid-items subtotal as a single amount, not individual
  `order_items.unit_price_snapshot` rows - simpler to reason about,
  matches how the free gift is *not* a per-item price change either, and
  avoids rounding a percent discount across many lines.
- **One code, unlimited stacking is out of scope.** A checkout submits at
  most one `coupon_code`; there is no concept of combining two codes.
- **Validated and applied only inside `createOrder`'s existing
  transaction**, under `SELECT ... FOR UPDATE` on the coupon's own row -
  the same reason stock is locked: two concurrent checkouts racing for
  the last use of a `max_uses`-limited code must serialize, not both
  succeed.
- **`times_used` increments in the same transaction as the order it
  belongs to.** If order creation fails for any other reason (stock,
  collection closed, etc.) the whole transaction rolls back, including
  the increment - a rejected order never consumes a coupon use.
- **Discount is computed against the paid-items subtotal, before the
  free gift and before shipping fee** (there is no shipping fee at
  order-creation time - it's an admin-set field added later). The gift's
  own `min_total` eligibility check is evaluated against the
  **post-discount** total, since that is what the buyer is actually
  paying and is the more defensible number to gate a "spend X get a
  free gift" promotion on.
- **COD eligibility is unaffected by a coupon**, in either direction -
  same precedent as the free gift; a coupon changes price, not cart
  contents.
- **No client-side rule duplication.** Checkout may call a new
  read-only preview endpoint to show the discount before submitting, but
  the server is the sole authority - exactly the "client estimate,
  server authoritative" pattern the free gift's checkout hint already
  established.
- **A coupon has no relationship to a specific collection/product.**
  It's a shop-wide code, same "flat, global" shape as `gift_settings`,
  just multi-row (many codes can exist) instead of a singleton.
- **Deleting is out of scope for this iteration** - `active` can be
  flipped off instead. A code with real order history should never
  actually disappear (nothing references `coupons.id` as a foreign key,
  so this is not a data-integrity requirement, just a UX one: an admin
  accidentally deleting a code that's already been used and snapshotted
  on live orders should not be one click away).

## Data model

### New table: `coupons`

| Column | Type | Notes |
|---|---|---|
| `id` | int, PK | |
| `code` | string(32), unique, not null | Stored uppercase/trimmed; matched case-insensitively by uppercasing the buyer's input before lookup |
| `type` | enum('percent','fixed'), not null | |
| `value` | int unsigned, not null | Percent: 1-100. Fixed: VND amount, no upper bound enforced beyond "cannot exceed the subtotal it's applied to" (clamped at apply time, not at creation time - a seller may legitimately want a fixed code worth more than a typical small order, to be fully absorbed on a large one) |
| `active` | boolean, not null, default true | |
| `min_total` | int unsigned, not null, default 0 | VND. Subtotal (paid items only) required to redeem |
| `max_uses` | int unsigned, nullable | `NULL` = unlimited |
| `times_used` | int unsigned, not null, default 0 | Incremented transactionally inside `createOrder` |
| `expires_at` | timestamp, nullable | `NULL` = never expires |
| `created_at` | timestamp, default now() | |

### `orders` gets two new columns

| Column | Type | Notes |
|---|---|---|
| `coupon_code_snapshot` | string(32), nullable | The code as redeemed, permanent regardless of later edits/deactivation of the `coupons` row |
| `discount_amount` | int unsigned, not null, default 0 | VND actually deducted - already clamped to never exceed the subtotal it was applied to |

`orders.total` continues to mean "what the buyer pays for their items" -
unchanged in shape, just now computed as `subtotal - discount_amount`
before the (always-0-priced) gift line is considered. `cod_amount`
(already `= total` for COD orders) is therefore automatically the
post-discount amount.

## Order creation flow (`orders/orderRepo.js::createOrder`)

Inserted immediately after `const subtotal = domain.computeTotal(lines)`
(renamed from the current `total` to make the pre/post-discount
distinction explicit) and before the free-gift block:

1. If `input.coupon_code` is falsy, `discountAmount = 0`,
   `couponCodeSnapshot = null` - skip everything below.
2. Otherwise, normalize (`trim().toUpperCase()`) and
   `SELECT * FROM coupons WHERE code = ? FOR UPDATE` on the transaction's
   own connection.
3. Validate, in order, throwing `InvalidCouponError(reason)` on the
   first failure: row exists (`not_found`) → `active` is true
   (`inactive`) → `expires_at` is null or in the future
   (`expired`) → `max_uses` is null or `times_used < max_uses`
   (`limit_reached`) → `subtotal >= min_total` (`min_total_not_met`).
4. Compute `discountAmount`: `percent` → `floor(subtotal * value /
   100)`; `fixed` → `value`. Either way, clamp to `min(discountAmount,
   subtotal)` - a coupon can never make an order's paid total negative.
5. `UPDATE coupons SET times_used = times_used + 1 WHERE id = ?` on the
   same connection/transaction - rolled back along with everything else
   if a later step in `createOrder` throws.
6. `total = subtotal - discountAmount` - this is the variable every
   downstream step (gift threshold, `orders.total`, `cod_amount`) already
   reads, so nothing past this point needs to know a coupon was involved.

The `INSERT INTO orders` statement gains `coupon_code_snapshot` and
`discount_amount`. No change to the `order_items` insert loop or to any
existing error class/check - `InvalidCouponError` is a new, independent
failure mode alongside `OutOfStockError`/`CollectionNotActiveError`/etc.

**Why the coupon lock happens after the variant locks, not before:** the
existing ascending-id `FOR UPDATE OF v` lock order is what keeps two
concurrent checkouts touching the same products from deadlocking. A
coupon row is a different table with no id relationship to
`product_variants`, so as long as *every* transaction that touches both
always locks variants first and the coupon second (true here, since
`coupon_code` resolution is coded to always run after the variant lock
query), the lock order between the two tables stays consistent
shop-wide and cannot introduce a new deadlock class.

## Public API

### `POST /api/shop/coupons/validate` (read-only preview)

Body: `{ code, subtotal }` (subtotal = the buyer's current cart total,
computed client-side exactly like the free-gift hint already is).
Response: `{ valid: true, discount_amount, type, value }` or `{ valid:
false, reason }` (same `reason` vocabulary as `InvalidCouponError`).
Never locks or increments anything - `getCouponByCode` is a plain
unlocked read. Purely a UX convenience so Checkout can show "you saved
X" before submitting; the real, authoritative check is the one inside
`createOrder`. A stale preview (coupon exhausted between preview and
submit) surfaces the real `InvalidCouponError` from the order-creation
call, same recoverable-error pattern the free-gift's estimate-vs-reality
gap already established.

### Admin: `GET/POST/PUT /api/admin/coupons`

New thin router (`backend/routes/adminCoupons.js`), backed by
`backend/shop/coupons/couponRepo.js` (`listCoupons`, `createCoupon`,
`updateCoupon`, `getCouponByCode`). Mounted alongside the other
`/api/admin/*` routers, behind the existing `auth` JWT middleware.

- `GET /coupons` → all coupons, newest first.
- `POST /coupons` → create; validates `code` (non-empty, uppercased,
  unique - a duplicate returns 400, not a raw `ER_DUP_ENTRY` 500),
  `type` (`percent`/`fixed`), `value` (positive integer; percent capped
  at 100), `min_total`/`max_uses`/`expires_at` (optional).
- `PUT /coupons/:id` → update any field, including `active` - this is
  also how a seller "deletes" a code (flips it off) without breaking
  historical orders that already snapshotted it.

## Display

- Buyer's order page and confirmation/reminder/etc. emails: a new
  "Mã giảm giá {{code}}: -{{amount}}" row appears in the totals block
  whenever `discount_amount > 0`, via a new `{{discount_row}}`
  placeholder folded into the shared `TOTAL_ROW` HTML fragment (so every
  template that already includes `TOTAL_ROW` gets it automatically,
  rendering empty for every non-discounted order - no per-template
  edits needed).
- Admin order list/detail: `discount_amount`/`coupon_code_snapshot`
  already ride along on the existing order row (no projection
  allowlist on the admin side the way the buyer-facing response has) -
  a small display addition in `AdminOrders.jsx`'s detail panel, next to
  the existing total.
- Buyer's public order response (`routes/orders.js::toPublicOrder`)
  gains both fields to its explicit allowlist.

## Edge cases

- **A coupon deactivated after being used on live orders**: those
  orders keep their `coupon_code_snapshot`/`discount_amount` untouched -
  nothing re-reads the `coupons` table after order creation, same
  guarantee every other snapshot column already provides.
- **Two concurrent checkouts racing the last use of a `max_uses: 1`
  code**: the `FOR UPDATE` lock serializes them - the first to commit
  wins, the second re-reads `times_used` (now `1`) inside its own lock
  wait and throws `limit_reached` cleanly instead of allowing a second
  redemption.
- **A percent coupon on a very small order rounds to 0đ discount**
  (e.g. 1% of 500đ = 5đ, `floor` keeps it exact, but 1% of 50đ = 0):
  allowed to proceed with `discountAmount = 0` rather than rejected -
  the buyer typed a valid, active code; a rounding artifact is not a
  reason to block the order.
- **`coupon_code` sent as an empty string vs. omitted**: both treated as
  "no coupon" (falsy check), not as an attempt to redeem code `""`.
- **Coupon code casing** ("save10" vs "SAVE10"): normalized to uppercase
  on both create and lookup, so they always refer to the same code.

## Testing approach

- `couponRepo.test.js`: CRUD (create validates shape, rejects a
  duplicate code with a clean error rather than a raw constraint
  violation, update flips `active`/edits fields, list).
- `orderRepo.test.js`: new `describe("createOrder: coupon codes", ...)`
  - percent discount applied correctly (with rounding), fixed discount
    clamped to subtotal, `not_found`/`inactive`/`expired`/
    `limit_reached`/`min_total_not_met` each rejected with the right
    `reason`, `times_used` increments exactly once per successful order,
    a `max_uses`-exhausted code rejects a second order, a rolled-back
    order (e.g. stock race on a different line) does not increment
    `times_used`, gift eligibility is evaluated post-discount,
    `coupon_code_snapshot`/`discount_amount` land correctly on the row.
- `adminCouponRoutes.test.js`: auth required, create/list/update
  round-trip, validation rejects bad shapes.
- `shopCouponRoutes.test.js`: the public preview endpoint - valid code
  returns a discount preview, each invalid reason returns `valid:
  false` with the right `reason`, never mutates `times_used`.
- `emailTemplates.test.js`: discount row renders when `discount_amount >
  0`, stays empty otherwise, uses only valid placeholders.
