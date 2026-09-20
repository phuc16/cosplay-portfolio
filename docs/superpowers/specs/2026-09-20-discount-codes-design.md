# Discount/Coupon Codes — Design

## Goal

Small sellers running drop-style collections (photocards/posters) commonly
want a promo code for a launch discount, an Instagram giveaway code, or a
small loyalty perk. Sellers can define percent-off or fixed-amount discount
codes, each with an optional minimum-order threshold, an optional usage cap,
and an optional expiry date. A buyer enters one code at checkout; if it's
valid, the discount is applied atomically as part of order creation and
snapshotted onto the order permanently.

## Scope decisions

- **Single code per order, entered as one text field at checkout.** No
  stacking multiple codes - the checkout payload carries at most one
  `discount_code` string.
- **Redemption is tracked by a global `used_count`/`max_uses` counter, not
  per-buyer.** This shop has no buyer-identity concept to hang a per-buyer
  limit on pre-order (an email address is collected, but nothing prevents a
  buyer from using a different one next time), and per-buyer tracking would
  be unnecessary complexity for this shop's scale. Deliberate YAGNI, same
  reasoning style as the free gift's "no stock limit" decision.
- **The threshold (`min_total`) and the discount computation are both
  measured against the paid-items subtotal - before the free gift and
  before shipping.** This is the exact same "subtotal" `createOrder`
  already computes for the free-gift threshold check (see
  `2026-09-14-free-gift-design.md`).
- **The discount and the free gift are deliberately independent/uncoupled.**
  Entering a discount code never changes gift eligibility - the gift is
  still evaluated off the pre-discount subtotal, exactly as it already was
  before this feature existed. A free gift is never itself discounted - it
  is a separate 0đ line, added (if it qualifies) after the discount amount
  is already resolved, so there is nothing on it to discount. Considered and
  rejected: discounting the gift line, or letting the code's minimum apply
  to (subtotal + gift value) - both add coupling for no real seller benefit
  and would make the gift's "always exactly 0đ" invariant a special case
  instead of a constant.
- **Discount amount is clamped so the final total can never go negative:**
  `discount_amount = min(computed_amount, subtotal)`. A 100%-off code, or a
  large fixed-amount code, can legitimately bring the order to exactly 0đ.
  This is an accepted edge case, not specially handled or blocked - a 0đ
  order already works today for e.g. a COD order collecting nothing, and no
  speculative "0đ COD" handling is added beyond the clamp itself.
- **Validation happens inside `createOrder`'s own transaction**, locking the
  matched `discount_codes` row `FOR UPDATE` - same locking discipline as the
  variant stock rows, and the same reason: two buyers racing to redeem the
  last use of a `max_uses`-limited code must not both succeed. Only the
  `discount_codes` row itself is locked (no joined table) - see
  `docs/EDGE_CASE_CHECKLIST.md`'s note on `FOR UPDATE OF v` for why
  over-broad locking caused deadlocks before; there is nothing to join here,
  so this is naturally already minimal. `used_count` increments in the same
  transaction as the order insert, so a rolled-back order never consumes a
  redemption.
- **No delete-guard on `discount_codes`, unlike collections/products/
  variants.** There is deliberately no foreign key from `orders` to
  `discount_codes` - this is a snapshot-based design like every other
  order-time fact in this codebase (see CLAUDE.md's Snapshotting section).
  An admin can freely delete or edit a discount code later with zero blast
  radius on historical orders - no `VariantInUseError`-style guard is
  needed, because there is no relationship to guard.
- **Checkout-only, not cart.** `Checkout.jsx` gets the code input and
  "Apply" button near the order summary; `Cart.jsx` is left alone - unlike
  the free gift (which shows a progress hint on both Cart and Checkout),
  a discount code is something a buyer types in once, right before paying,
  not something to advertise while still browsing. Smaller scope,
  deliberately.

## Data model

### New table: `discount_codes`

| Column | Type | Notes |
|---|---|---|
| `id` | int, PK | |
| `code` | string(64), unique, not null | Stored/matched case-insensitively - normalized to uppercase on write and on lookup (`shop/discountCodes.js`'s `normalizeCode`) |
| `type` | enum('percent', 'fixed'), not null | |
| `value` | int unsigned, not null | A percent (1-100) or a VND amount, depending on `type` |
| `enabled` | boolean, not null, default true | |
| `max_uses` | int unsigned, nullable | NULL = unlimited |
| `used_count` | int unsigned, not null, default 0 | Incremented inside `createOrder`'s transaction on successful application |
| `min_total` | int unsigned, not null, default 0 | VND subtotal threshold; 0 = no minimum |
| `expires_at` | timestamp, nullable | |
| `created_at`, `updated_at` | timestamps | |

No relationship to `orders`, `products`, `collections`, or anything else -
same "lives entirely in its own row" pattern as `gift_settings`, except this
is a genuine multi-row CRUD table (many codes), not a singleton.

### `orders` gets two new columns

| Column | Type | Notes |
|---|---|---|
| `discount_code_snapshot` | string(64), nullable | The normalized code actually applied, or NULL if none |
| `discount_amount_snapshot` | int unsigned, not null, default 0 | VND. The exact amount subtracted at order-creation time |

Once written, these are permanent - a later edit to (or deletion of) the
`discount_codes` row never retroactively changes an already-placed order,
because nothing re-reads `discount_codes` after order creation. Same
guarantee every other snapshot column in this schema already provides.

`orders.total` continues to mean "what the buyer actually pays" (per
CLAUDE.md): `total = subtotal - discount_amount_snapshot`. The free gift's
line item stays a separate, always-0đ line - unaffected by the discount in
either direction.

## Order creation flow (`orders/orderRepo.js::createOrder`)

Current flow, as already modified by the free gift feature (relevant
steps only):

1. Validate `items`, dedupe, sort ascending by variant id.
2. Idempotency check via `request_key`.
3. Lock + fetch all requested variant rows (`FOR UPDATE OF v`).
4. Validate digital+COD conflict, per-row collection open/scheduled check.
5. Build `lines[]` from the locked rows (paid items only).
6. `subtotal = domain.computeTotal(lines)`.
7. Free-gift decision: `giftApplies = gift_settings.enabled && subtotal >=
   gift_settings.min_total`; if so, `giftIsPhysical` is derived.
8. Fulfillment-required check (needs to know `giftIsPhysical`).
9. Ship/pickup-offered check over paid rows.
10. Stock decrement over paid lines.
11. If `giftApplies`, append the gift line to `lines[]`.
12. Insert `orders` row, then `order_items` rows.

This changes as follows:

1. Steps 1-6 unchanged.
2. **New step, immediately after step 6** (subtotal computed, before the
   gift decision): if `input.discount_code` is present, normalize it to
   uppercase and look it up with `SELECT * FROM discount_codes WHERE code =
   ? FOR UPDATE` inside the same transaction/connection already open for
   this order. Evaluate it against `subtotal` (not-found / disabled /
   expired / exhausted / below-minimum - see Error Handling below). On
   success: `discountAmount = min(computed_amount, subtotal)`,
   `discountCodeSnapshot = normalizedCode`, and `UPDATE discount_codes SET
   used_count = used_count + 1 WHERE id = ?` runs immediately (same
   transaction, so a later rollback undoes it too). On failure: throws
   `InvalidDiscountCodeError`, aborting order creation entirely - same
   all-or-nothing behavior as `OutOfStockError`/`VariantNotFoundError`.
3. Step 7 (free-gift decision) is **unchanged**, still keyed off `subtotal`
   - the discount code's existence/amount never enters this calculation,
   per the independence decision above.
4. Steps 8-11 unchanged.
5. **New step, after step 11** (gift line already appended, so this can't
   accidentally discount it): `total = subtotal - discountAmount`. This
   `total` is what gets written to `orders.total` and (for COD) to
   `orders.cod_amount` - both already read this variable under its old
   name, so every downstream consumer (payment instructions/VietQR amount,
   the buyer's order page, admin order detail, order emails) automatically
   reflects the post-discount amount with no separate wiring.
6. Step 12's `order_items` insert loop is unchanged (it already reads
   `lines[]`, which never includes anything about the discount - a discount
   is an amount off the total, not a line item, unlike the gift). The
   `orders` insert gains two new columns:
   `discount_code_snapshot`/`discount_amount_snapshot`.

### Why discount resolution runs before the gift decision, not after

Order doesn't functionally matter for correctness (the two are
independent), but resolving the discount first, while `lines` is still
exactly the buyer's real paid items, keeps the "gift is never itself
discounted" invariant true by construction rather than by a special case:
by the time the gift line could exist, `discountAmount` is already a fixed
number that only ever gets subtracted from `subtotal`, never recomputed
against a total that includes the gift.

## Error handling

New error class `InvalidDiscountCodeError` in `orderRepo.js`, matching the
existing `OutOfStockError`/`FulfillmentRequiredError` pattern: thrown with a
`reason` field (`not_found` | `disabled` | `expired` | `exhausted` |
`below_minimum`), whose buyer-facing message is looked up from
`discountCodes.REASON_MESSAGES` (shared with the preview endpoint below, so
the two surfaces never drift out of sync on wording).

`routes/orders.js`'s `POST /` handler maps it the same way it already maps
`FulfillmentRequiredError`/`NoCodForDigitalError` - a 400, since (like those)
a bad code is a request-shape problem the buyer can resolve themselves
(remove the code and resubmit), not a stock-style race the client should
retry unchanged:

```js
if (err instanceof repo.InvalidDiscountCodeError) {
  return res.status(400).json({ error: "invalid_discount_code", message: err.message, reason: err.reason })
}
```

## API surface

### Public: `POST /api/shop/discount-preview`

Body: `{ code, subtotal }`. Response: `{ valid: true, amount, type, value
}` or `{ valid: false, message }`. Non-locking, read-only - does not
increment `used_count` or hold any row lock. Used by `Checkout.jsx`'s
"Apply" button for immediate feedback before the buyer submits the whole
order, mirroring the free-gift design's principle: "a client-side estimate,
cosmetic only... the server is still the sole authority" - `createOrder`
re-validates for real, under its own lock, regardless of what this endpoint
said a moment earlier (the code's state can change between the two calls -
another buyer might exhaust it, or an admin might disable it).

Backed by `shop/discountCodes.js`'s `evaluateCode(row, subtotal, now)`, a
pure function with no DB access, shared between this endpoint's (non-
locking) read and `createOrder`'s (locking) read - the two can never
disagree about what counts as valid, only about whether the row was locked
when it was decided.

### Admin: `GET/POST/PUT/DELETE /api/admin/discount-codes[/:id]`

New thin router (`backend/routes/adminDiscounts.js`, mirroring the shape of
`adminGift.js`), backed by new business logic in
`backend/shop/discountCodes.js`. Mounted under the existing `auth` JWT
middleware alongside the other `/api/admin/*` routers.

- `GET /discount-codes` - list all codes, newest first.
- `POST /discount-codes` - create one. 400 on validation failure, 409
  (`duplicate_code`) if the (normalized) code already exists.
- `PUT /discount-codes/:id` - update one (including toggling `enabled`).
  Same validation/409 handling as create.
- `DELETE /discount-codes/:id` - delete one. No guard of any kind (see the
  scope decision above) - 404 if the id doesn't exist, 200 otherwise.

## Checkout UI

`Checkout.jsx` gets a text input + "Apply" button near the order summary
(next to where the free-gift progress hint already renders). Applying calls
the preview endpoint with the current cart subtotal; a valid result shows
the discount inline (e.g. "Mã ABC123: -50.000đ") and the code is carried in
component state. Submitting the order includes `discount_code` in the
payload whenever a code has been successfully applied. `Cart.jsx` is not
touched (see the scope decision above).

If the server rejects the code at order-creation time (code changed state
between Apply and Submit - exhausted by another buyer, disabled by the
admin, etc.), the existing error-display path shows
`InvalidDiscountCodeError`'s message and the buyer can remove the code and
resubmit, the same recovery shape every other 400/409 order-creation error
already has in this page.

## Display

Anywhere `orders.total` or the item list already renders - the buyer's
order page, admin order detail, and the order emails - a short line is
added when `discount_code_snapshot` is present: "Mã giảm giá {{code}}:
-{{amount}}đ", shown between the item list and the total row. This is a
rendering-only addition to existing templates, matching how the free-gift
spec's "Display" section handles `is_gift` rows - not a redesign.

Anywhere `orders.total` currently drives a payment amount shown to the
buyer or generated into a deep link (VietQR payload, Momo/PayPal amount)
needs no separate change, because `orders.total` is already computed
post-discount at the source (see Order Creation Flow above) - every one of
those call sites already reads `order.total` and gets the right number for
free.

## Testing approach

- `shop/discountCodes.js`'s pure `evaluateCode`/`normalizeCode`/`validate`
  functions get direct unit tests (no DB) covering every reason branch and
  the 100%-off/negative-total clamp.
- Repo/CRUD tests (`tests/discountCodes.test.js`) covering create/update/
  delete/list against the real DB, including the duplicate-code 409 path.
- `tests/adminDiscountRoutes.test.js` - auth requirement, CRUD round-trip,
  validation failures.
- `tests/shopDiscountPreview.test.js` - the public preview endpoint,
  including that it never mutates `used_count`.
- `tests/orderRepo.test.js` gets a new `describe("createOrder: discount
  codes", ...)` block: no code applied, a valid percent code, a valid fixed
  code, below-minimum, disabled, expired, exhausted (`max_uses` already
  hit), the 100%-off-clamps-to-zero edge case, and proof that applying a
  code does not change free-gift eligibility (still keyed off the
  pre-discount subtotal) and that the gift's own line stays 0đ regardless.
- `tests/orderConcurrency.test.js` gets a new test: N buyers race a
  `max_uses: 1` code; exactly one order carries the discount and
  `used_count` ends at exactly 1, not N (mirrors the existing "sells
  exactly one unit when 20 buyers race for the last item" stock test).
- Frontend: `AdminDiscountCodes.test.jsx` (list/create/edit/delete, same
  `createRoot`/`act` pattern as `AdminGiftSettings.test.jsx`) and
  `Checkout.test.jsx` gets new cases for entering/applying/clearing a code
  and for the order payload carrying it.

## Out of scope (explicitly deferred)

- Stacking multiple codes on one order.
- Per-buyer usage limits (see the scope decision above).
- Auto-applying a code without the buyer typing it in (e.g. a link-based
  promo).
- A cart-page hint/preview (checkout-only, see the scope decision above).
- Any interaction between a discount code and the free gift beyond both
  reading the same pre-discount subtotal - no chaining, no combined
  threshold.
