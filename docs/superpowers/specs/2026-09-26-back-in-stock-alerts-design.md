# Back-in-Stock Email Alerts — Design

## Trend angle: Shopping/e-commerce

Back-in-stock alerts are table-stakes on every modern storefront (Shopee,
Tiki, Shopify's own "notify me" apps) - a buyer who hits a sold-out
listing expects a way to be told when it returns, not to have to keep
refreshing the page. This shop's drop-style collections (photocards,
posters, limited merch) genuinely sell out fast and often get restocked
later - there's already an admin `StatsRestock` view tracking restock
velocity, which means restocks are a known, tracked, recurring event in
this business, not a hypothetical. Right now a buyer who wants a
sold-out variant has zero way to find out it's back short of manually
re-checking the collection page. This closes that gap with the smallest
piece that could work: an email opt-in on the sold-out variant, and a
queued notification fired the moment an admin's stock edit brings it
back.

## Goal

A buyer viewing a sold-out (finite stock, `stock_qty === 0`) product
variant can leave their email to be notified once it's back in stock. An
admin's stock edit that raises that variant's stock from `0` to a
positive number automatically emails every subscriber, once per restock
event, without blocking the admin's save on SMTP.

## Scope decisions

- **Only a strictly sold-out (finite, zero) variant is eligible.** A
  variant with `stock_qty: null` (unlimited/made-to-order) can never be
  "sold out" (see `ProductCard.jsx`'s existing `isSoldOut`), so it can
  never be signed up for either - there is no "back in stock" event to
  wait for.
- **Per-variant, not per-product.** A multi-variant product (e.g. a
  photocard sheet) can have some codes sold out and others not; the
  signup is scoped to the exact `product_variant_id`, matching how stock
  itself is already tracked.
- **Resubscribing is an upsert, not a new row.** The same email signing
  up again for the same variant (e.g. after already being notified once,
  and the variant sells out and restocks again) resets `notified_at`
  back to `NULL` rather than erroring or duplicating - this is what lets
  a repeat buyer of a recurring drop opt in again for the next cycle.
- **The trigger is the 0 → positive transition only**, not "stock is
  currently positive". An admin editing a variant that already has
  stock (5 → 8) must not re-fire; only the edit that crosses from
  exactly `0` up past it counts as "back in stock". This is what makes
  "only fires once per restock event" true even though an admin might
  save a product's variant list many times while stock stays positive.
- **No synchronous send.** A stock edit's request/response cycle must
  never wait on an SMTP round trip - notifications are queued exactly
  like every other transactional email in this codebase and drained by
  the background worker.
- **Independent from `email_queue`.** `email_queue.order_id` is
  `NOT NULL` with `onDelete("CASCADE")` to `orders` - the entire
  send/retry/attempts pipeline in `queue.js`/`sender.js` assumes every
  queued email belongs to an order. A back-in-stock alert has no order.
  Rather than loosen that constraint (risking the well-tested
  order-email path) or bolt a nullable order-less row onto it, this
  feature gets its own queue table (`stock_alert_queue`) that mirrors
  `email_queue`'s status/attempts/retry shape but has zero relationship
  to `orders`. The two pipelines cannot interact with each other by
  construction.
- **No admin-editable template.** The stock-alert email's subject/body
  is a small fixed Vietnamese string built in code, not one of the four
  buyer-order-lifecycle templates in `templates.js` - it doesn't need
  admin editing, and folding it into that system would mean teaching
  `templates.js`'s order-shaped `buildVars()` about a message that isn't
  an order at all.
- **Minimal admin visibility, no new screen.** A failed-row count/list,
  surfaced the same minimal way `sender.js`'s `listFailed()` already is
  in `AdminEmailTemplates.jsx` - not a new admin page.

## Data model

### New table: `stock_alerts`

One row per (variant, email) subscription.

| Column | Type | Notes |
|---|---|---|
| `id` | int, PK | |
| `product_variant_id` | int unsigned, FK → `product_variants.id`, `onDelete("CASCADE")` | Deleting the variant deletes its subscriptions - there's nothing left to restock |
| `email` | string(191), not null | Basic-regex validated, not RFC-5322-parsed |
| `created_at` | timestamp | |
| `notified_at` | timestamp, nullable | `NULL` = still waiting for a restock; set once queued for send |
| unique | `(product_variant_id, email)` | Resubscribing upserts this row instead of duplicating it |

### New table: `stock_alert_queue`

Deliberately **not** a variant of `email_queue` and **not** FK'd to
`stock_alerts` or `product_variants` - every field this needs to render
and send the message is snapshotted at enqueue time (the same
snapshotting principle `order_items` already uses for order history),
so a queued row keeps working correctly even if the subscription row,
the variant, or the whole product is deleted afterward.

| Column | Type | Notes |
|---|---|---|
| `id` | int, PK | |
| `product_variant_id` | int unsigned, nullable, no FK | Informational only - not joined at send time |
| `email` | string(191), not null | Send target |
| `product_name_snapshot` | string(191), not null | |
| `variant_label_snapshot` | string(191), not null, default `''` | Empty for a flattened digital/gacha "variant" the same way `order_items.variant_label_snapshot` already tolerates blank |
| `collection_slug_snapshot` | string(191), nullable | Builds the "back in stock" link; nullable so a deleted collection doesn't block the row from existing |
| `status` | enum(`pending`,`sent`,`failed`), not null, default `pending` | Mirrors `email_queue.status` |
| `attempts` | int unsigned, not null, default 0 | |
| `last_error` | text, nullable | |
| `created_at` | timestamp | |
| `sent_at` | timestamp, nullable | |
| index | `(status, attempts)` | Same shape as `email_queue`'s `idx_email_queue_status`, for `claimPending`'s WHERE clause |

## Restock detection

`backend/shop/catalogRepo.js::replaceVariants(productId, variants)` is
the one write path that can move a variant's `stock_qty`. It already
locks the product's current variant rows (`SELECT ... FOR UPDATE`)
before deciding what to update/insert/delete - this is extended to also
select `stock_qty`, so the pre-update value is known before each row's
`UPDATE` runs.

For each variant being updated (`v.id` present in the incoming list):

1. Compare `previousStock = prevStockById.get(v.id)` against the new
   `stock` value being written.
2. A **restock event** is exactly `previousStock === 0 && stock !== null
   && stock > 0`. Any other transition (`5 → 8`, `null → 5`, `0 → null`,
   `5 → 0`, a brand new variant with no previous row) is not a restock -
   only crossing up from a tracked zero counts.
3. Newly inserted variants (`v.id` absent) can never restock - they have
   no "previous" stock to have been zero.

For every variant id flagged as a restock event, still inside the same
transaction/connection `replaceVariants` already holds:

1. `SELECT * FROM stock_alerts WHERE product_variant_id = ? AND
   notified_at IS NULL FOR UPDATE` - locks and fetches the still-waiting
   subscribers for that variant.
2. If none, do nothing (no query, no row, no error) - the common case
   for a variant nobody signed up for.
3. Otherwise, look up the product name and collection slug once
   (`SELECT p.name, c.slug FROM products p JOIN collections c ON c.id =
   p.collection_id WHERE p.id = ?`), then `INSERT` one
   `stock_alert_queue` row per subscriber with the snapshot fields
   filled in from that lookup and the just-saved `v.label`.
4. `UPDATE stock_alerts SET notified_at = UTC_TIMESTAMP() WHERE id IN
   (...)` for exactly the rows just queued.

Steps 3-4 happen inside `replaceVariants`'s own transaction, so a
mid-transaction failure rolls back the queue inserts and the
`notified_at` update together with the stock change itself - there is no
window where subscribers are marked notified but nothing was queued, or
vice versa.

## Public API

### `POST /api/shop/stock-alerts`

Body: `{ variant_id, email }`.

Validation, in order:
1. `email` matches a basic `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`-shape check -
   `invalid_email` (400) otherwise. Deliberately not full RFC-5322
   parsing, matching this codebase's existing "don't over-engineer
   free-text validation" convention.
2. The variant must exist - `variant_not_found` (404) otherwise.
3. The variant must be **strictly** sold out (`stock_qty === 0`) -
   `variant_not_sold_out` (400) for a variant with remaining stock *or*
   `stock_qty: null` (unlimited). This is what stops a buyer from
   pre-registering for something that was never going to run out.

On success: `INSERT ... ON DUPLICATE KEY UPDATE notified_at = NULL` on
`stock_alerts`, keyed by the table's `(product_variant_id, email)`
unique constraint. Returns `{ ok: true }`. Mounted under the existing
`/api/shop` router, which already sits behind `publicLimiter` at the
`server.js` mount point - no separate rate limiter needed.

## Worker dispatch

`backend/shop/stockAlerts/sender.js` exports `sendQueuedStockAlerts(limit
= 10)`, structured exactly like `email/sender.js::sendQueued`:

- No-ops (`{ sent: 0, failed: 0, skipped: true }`) when SMTP isn't
  configured - reuses `email/sender.js`'s `isConfigured()`/`getTransport()`
  rather than re-deriving SMTP config from `process.env` a second time.
- Claims up to `limit` pending rows below `MAX_ATTEMPTS` (5, same cap as
  `email/queue.js`), in ascending id order.
- Builds a small, fixed Vietnamese subject/body per row from its
  snapshot fields and `SITE_URL + /merchandise/{slug}`; sends via the
  shared transport.
- One failing row does not stop the batch - each row's send is wrapped
  in its own try/catch, `markSent`/`markFailed` per row, identical
  isolation guarantee to the order-email pipeline.
- `markFailed` increments `attempts` and flips `status` to `failed`
  once `attempts >= MAX_ATTEMPTS`, otherwise leaves it `pending` for the
  next tick - same retry semantics as `email/queue.js::markFailed`
  (including the same "attempts already reflects the post-increment
  value" MySQL evaluation-order gotcha that function's own comment
  documents).

`backend/worker.js` gains `dispatchStockAlertEmails()`, called from
`run()` right after the existing `dispatchEmails()` call, under the same
in-process `running` overlap guard - no new guard needed since it's
just one more awaited step inside the same guarded function.

## Admin visibility

`backend/shop/stockAlerts/queue.js` exports `listFailed()` (same query
shape as `email/sender.js::listFailed`). `backend/routes/adminEmail.js`
gets one more route, `GET /api/admin/stock-alert-queue/failed`, next to
its existing `GET /api/email-queue/failed`. The frontend's
`AdminEmailTemplates.jsx` (already home to the equivalent
`FailedEmails` component) gets a second, near-identical
`FailedStockAlerts` component below it - no new admin page, no new nav
entry.

## Frontend

`frontend/src/components/shop/ProductCard.jsx`'s existing detail modal
already renders the sold-out state (`isSoldOut(detail)` from this same
file). When that's true, instead of (or alongside) the disabled "Add to
cart" button, a small inline form (email input + submit button) appears.
Submitting calls the new `subscribeStockAlert({ variant_id, email })` API
wrapper. Three visible states: idle (form), submitting (button
disabled), and a result line - success ("Đã đăng ký, sẽ báo khi có
hàng") or the server's error message verbatim (mirrors how
`AdminGiftSettings.jsx`/`AdminPaymentSettings.jsx` already surface
`e.response?.data?.message` rather than re-deriving their own copy).
Buyer-facing strings go through the existing `{ vi, en }` /
`translations.js` mechanism, matching every other buyer-facing string in
`ProductCard.jsx`.

## Error handling summary

| Condition | Response |
|---|---|
| Malformed email | 400 `invalid_email` |
| `variant_id` does not exist | 404 `variant_not_found` |
| Variant has `stock_qty > 0` | 400 `variant_not_sold_out` |
| Variant has `stock_qty: null` (unlimited) | 400 `variant_not_sold_out` (same code - it was never sold out) |
| Same email + variant signs up twice | 200 `{ ok: true }`, single row, `notified_at` reset to `NULL` |
| SMTP not configured at dispatch time | Rows stay `pending` indefinitely (same behavior `email_queue` already has - `worker.js`'s existing `warnIfMailStuckUnconfigured`-style log line is not duplicated for this queue in v1, since a bare pending-count check would be a second near-identical warning; left as a possible follow-up, not required for this feature to be complete) |
| A queued row's send fails repeatedly | Marked `failed` after `MAX_ATTEMPTS`, visible via the admin failed-list, never retried past that |

## Testing approach

- **Repo-level** (`backend/tests/stockAlertsRepo.test.js`): `signUp`
  validation (not-found, not-sold-out for positive stock, not-sold-out
  for `null` stock, invalid email), upsert-resets-`notified_at` on
  resubscribe, no duplicate row.
- **Queue-level** (`backend/tests/stockAlertQueue.test.js`): enqueue,
  `claimPending` respects `MAX_ATTEMPTS`, `markSent`, `markFailed`
  retry/cap semantics - mirrors `emailQueue.test.js`'s structure.
- **Sender-level** (`backend/tests/stockAlertSender.test.js`): mirrors
  `sender.test.js`'s nodemailer-mocking approach (patch
  `nodemailer.createTransport` before import, per that file's own
  documented CJS/ESM interop gotcha) - batch isolation, retry-cap
  respect, `skipped: true` when unconfigured.
- **Route-level** (`backend/tests/shopStockAlertRoute.test.js`,
  supertest against the real app): every validation branch above, plus
  the resubscribe-no-duplicate-row path end to end.
- **Restock-trigger tests**, added to `backend/tests/catalogRepo.test.js`
  next to the existing `describe("replaceVariants", ...)` block: 0→positive
  queues+marks-notified; 5→8 does not fire; a variant with zero
  subscribers restocking queues nothing and does not error; multiple
  subscribers on one variant all get queued and all get `notified_at`
  set; deleting a variant instead of updating it does not crash the
  detection logic (it's simply absent from the update loop, never
  evaluated as a transition).
- **Frontend** (`frontend/src/components/shop/ProductCard.test.jsx`):
  the form only appears for a strictly sold-out variant (not an
  unlimited one), submits the right payload, shows the success message,
  and surfaces a server error message verbatim - run for real via
  `npx vitest run` per this repo's existing frontend test convention (no
  external services needed).

## Out of scope (explicitly deferred)

- SMS/push notification channels - email only.
- A buyer-facing "my alerts" management page (view/cancel
  subscriptions) - the only way to cancel is to not resubscribe; there
  is no unsubscribe endpoint in v1.
- Notifying on a product-level restock for gacha/digital products (their
  "stock" is a flattened single variant, so the same mechanism actually
  already covers them structurally, but the sold-out UI trigger point in
  `ProductCard.jsx` only wires it in for the same variant-detail view
  every product type already shares - no gacha-specific "pool refilled"
  concept is added).
- A full new admin screen for managing/re-triggering failed
  notifications - the minimal failed-count/list view described above is
  the complete admin surface for this feature.
