# Back-in-Stock Notifications — Design

**Trend angle:** Shopping/e-commerce trend — back-in-stock alerts are one of
the highest-converting lifecycle emails a small storefront can run (a buyer
who already wanted the item, told *at the moment* it becomes buyable again).
For this shop specifically - drop-style photocard/poster collections that
sell out fast and sometimes get restocked from a second print run - this is
directly relevant, not a generic e-commerce checkbox: a buyer who missed a
photocard code the first time has no way today to find out it came back
short of manually re-checking the collection page.

## Scope decisions

- **No admin configuration screen.** This is buyer-initiated (a "Notify me"
  button on a sold-out variant) with no seller-side toggle - always on,
  same posture as the existing PIN/lockout/rate-limit features that ship
  without an admin on/off switch.
- **Deliberately does NOT reuse the `email_queue` table.** That table's
  `order_id` column is `NOT NULL` with a hard FK to `orders`, and
  `sender.js`'s `sendQueued()` unconditionally calls `orderRepo.getOrderById`
  and builds order-specific vars (QR, receiver info, order status) for every
  row it dispatches. A restock notification has no order at all. Loosening
  `order_id` to nullable and branching every downstream consumer of that
  table to handle an orderless row would touch a heavily-relied-on piece of
  order infrastructure for a feature that has nothing to do with orders -
  disproportionate risk for the size of this feature. Instead: a small,
  self-contained table (`stock_notify_requests`) that carries its own
  `notified_at` sent-marker, functioning as its own tiny queue.
- **Does reuse the existing worker tick** (`backend/worker.js`), exactly as
  instructed - `run()` gains one more step (`stockNotify.sendPendingNotifications()`)
  alongside the existing thumbnail/sweep/email-queue steps, on the same
  interval, guarded by the same in-process `running` flag and Redis lease
  that already exist. No new process, no new cron.
- **Reuses the existing SMTP transport** (`sender.js`'s `getTransport()`/
  `isConfigured()`, exported for this purpose) rather than a second
  nodemailer setup.
- **No admin-editable template.** The notification content is a small, fixed
  Vietnamese HTML fragment built inline (reusing `templates.escapeHtml`/
  `templates.BRAND`/`templates.footerHtml` for visual consistency with every
  other transactional email) - same reasoning as the FAQ page and the free
  gift's plain-text name field: this content changes rarely enough that a
  full admin template-editor entry isn't justified for a v1. Revisit if it
  turns out to need frequent editing.
- **Polling, not write-path hooks.** Detecting "this variant just came back
  in stock" by hooking every place stock can change (`replaceVariants`
  bulk-save, single-variant edits, future paths) is fragile - miss one path
  and a buyer never gets notified. Instead, the same worker tick that
  already polls for expired orders and pending emails also polls: "is there
  a pending request whose variant is no longer sold out?" This is correct
  regardless of *how* the stock changed, at the cost of two DB round-trips
  per tick (both trivial: an indexed join against a table this shop's
  volume will never grow past a few hundred rows).
- **`stock_qty === null` (unlimited) also counts as "back in stock"** for a
  request made while `stock_qty` was `0` - if the seller flips a variant
  from tracked-and-sold-out to unlimited, that's unambiguously "you can
  order it again," the same trigger condition as restocking a positive
  count.
- **No collection-status gating.** A request is fulfilled purely on the
  variant's own `stock_qty`, independent of whether its collection is still
  `active`/orderable. Mirrors the free gift design's explicit "ignores
  per-collection concerns" precedent - scoped out deliberately, not an
  oversight. In practice this only matters for the rare case of a
  collection being closed at the same moment a variant is restocked, which
  the seller controls directly (closing a collection and restocking one of
  its items in the same window is an unusual, self-inflicted sequence).
- **Re-subscribing after being notified once re-arms the request** (`ON
  DUPLICATE KEY UPDATE notified_at = NULL`), so a buyer who signs up, gets
  notified, misses the restock again, and signs up a second time gets a
  second email next time it restocks - rather than the unique key silently
  swallowing their second request.
- **Sign-up is rejected outright for a variant that isn't currently sold
  out** (`stock_qty` is `NULL` or `> 0`) - `409 not_sold_out` - so the table
  never accumulates junk rows for items nobody needed to wait for.

## Data model

### New table: `stock_notify_requests`

| Column | Type | Notes |
|---|---|---|
| `id` | int, PK | |
| `product_variant_id` | int unsigned, not null, FK → `product_variants.id` ON DELETE CASCADE | Deleting the variant moots any pending request for it |
| `email` | string(255), not null | Lowercased/trimmed before insert |
| `created_at` | timestamp, default now | |
| `notified_at` | timestamp, nullable | `NULL` = still pending |

Unique key on `(product_variant_id, email)` - one active request per
buyer/variant pair; a repeat sign-up before being notified is a silent
no-op (`ON DUPLICATE KEY UPDATE created_at = NOW()`), a repeat sign-up
*after* being notified re-arms it (`notified_at = NULL`).

## API

### Public: `POST /api/shop/variants/:id/notify-me`

Body: `{ email }`. Mounted under `/api/shop`, already covered by
`publicLimiter` (120/min per IP - no dedicated limiter needed, this is a
single cheap insert, nothing like the proof-upload/order-creation cost
profile that earned those routes their own budgets).

- `400 invalid_input` - malformed email (same `EMAIL_RE` pattern already
  used by `routes/orders.js`).
- `404 not_found` - variant id doesn't exist.
- `409 not_sold_out` - variant is currently orderable; nothing to wait for.
- `200 { ok: true }` - request stored (or re-armed).

## Worker integration

`backend/shop/stockNotify.js` exports `requestNotify(variantId, email)` (used
by the route above) and `sendPendingNotifications()` (used by the worker).

`sendPendingNotifications()`:
1. No-op immediately if `sender.isConfigured()` is false (mirrors
   `dispatchEmails`'s own `skipped` short-circuit - no point querying if
   SMTP isn't set up).
2. `SELECT` up to 50 pending requests (`notified_at IS NULL`) joined to
   their variant/product, filtered to `stock_qty IS NULL OR stock_qty > 0`.
3. For each, send one email via `sender.getTransport()` (exported from
   `sender.js` for this reuse) and mark `notified_at = NOW()`. One request's
   send failure (bad address, transient SMTP error) is caught and logged per
   row - never aborts the rest of the batch, same isolation
   `sendQueued()` already guarantees for order emails.

`backend/worker.js`'s `run()` gains one line calling this, alongside
`sweepExpiredOrders()`/`dispatchEmails()`.

## Frontend

`ProductCard.jsx`'s variant detail modal already renders a stock line
(`stockLabel`) and disables "Add to cart" when `isSoldOut(detail)`. When
`isSoldOut(detail) && orderable` (sold out, but otherwise a live/orderable
collection - matches the scope decision above), render a compact inline
form in place of the quantity stepper: an email `<input>` + "Notify me"
button, calling the new endpoint via `fetchNotifyMe(variantId, email)`
(`frontend/src/api/shop.js`). Success replaces the form with a confirmation
line; the existing 409/404 error messages surface verbatim-ish (translated
via the bilingual `{vi,en}` pattern, not the raw server string, matching
`orderPinLocked`'s precedent of not trusting server message text directly
for anything shown to a buyer as a *label* rather than a raw error - here
it's simple enough that the two possible reasons (already back in stock, or
an invalid id) map to two fixed bilingual strings key on the response's
`error` code).

## Testing approach

Backend (`backend/tests/stockNotify.test.js`, `backend/tests/shopNotifyRoute.test.js`):
- `requestNotify` rejects an invalid email format.
- `requestNotify` rejects a non-existent variant id (`VariantNotFoundError`).
- `requestNotify` rejects a variant that isn't sold out (`NotSoldOutError`),
  covering both `stock_qty > 0` and `stock_qty === null` (unlimited).
- `requestNotify` inserts a row for a sold-out variant; calling it again
  with the same email is a no-op (still exactly one row).
- `requestNotify` re-arms (`notified_at` reset to `NULL`) when called again
  for an email that was already notified.
- `sendPendingNotifications` sends nothing when SMTP isn't configured.
- `sendPendingNotifications` skips a request whose variant is still sold
  out, sends one for a variant that is now in stock (`stock_qty > 0`) or
  unlimited (`stock_qty === null`), and marks `notified_at`.
- `sendPendingNotifications` continues past one send failure to process the
  rest of the batch (mock transport rejecting the first call).
- Route tests: 400/404/409/200 for the public endpoint.

Frontend (`ProductCard.test.jsx`, extended):
- The notify form renders only when the opened variant is sold out and the
  product is orderable.
- Submitting calls the API with the entered email and variant id.
- A success response replaces the form with a confirmation message.
- A `409` response shows the "already back in stock" message instead of a
  generic error.

## Edge cases

- **Variant deleted while a request is pending**: `ON DELETE CASCADE`
  removes the row - no dangling reference, no notification ever sent for a
  variant that no longer exists.
- **Product/collection deleted** (cascades through `products` → `product_variants`
  → `stock_notify_requests`, same FK chain already in place today):
  same as above.
- **Duplicate sign-up while still pending**: silent no-op via `ON DUPLICATE
  KEY UPDATE`, not a second row and not a 409 (a buyer clicking the button
  twice shouldn't see an error).
- **SMTP not configured**: `sendPendingNotifications` no-ops every tick
  (mirrors `dispatchEmails`'s existing behavior) rather than accumulating an
  error - requests simply stay pending, get sent once SMTP is configured,
  same as the existing "email_queue grows until SMTP is set up" behavior
  `warnIfMailStuckUnconfigured` already covers for order mail (that
  existing warning is order-email-specific and left unchanged, this table
  doesn't feed into it).
