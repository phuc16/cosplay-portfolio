# Product Reviews & Ratings — Design

## Goal

Buyers can leave a star rating (1-5) and an optional text comment for a
product they actually received, once their order reaches `completed`.
Reviews are public, shown on the product's page, and require no buyer
account - access is gated the same way every other buyer-order action
already is (the order's own PIN/admin-session gate,
`shop/orders/orderAccess.js`), since that's the only identity this shop
has for a buyer.

## Scope decisions

- **Gated by a completed order, not a buyer account.** There are no
  buyer accounts anywhere in this shop - `orderAccess` (PIN-verified
  session JWT scoped to one `order_token`, or an admin session) is the
  existing, only trust boundary for "this request comes from the person
  who placed this order." Reviews reuse it directly rather than
  inventing a second identity system.
- **One review per (order, product) pair.** A buyer with two completed
  orders for the same product may leave one review per order (a repeat
  purchase can have a fresh opinion) - enforced by a DB unique
  constraint, not just app-level checking.
- **Only once `status === 'completed'`.** Not `confirmed`/`shipped` - a
  review is about the received item, and `completed` is the one status
  that means "the buyer actually has it" for both ship and pickup
  orders (see `domain.canTransition`: pickup orders skip `shipped`
  entirely and go `confirmed → completed` directly, so `completed`,
  not `shipped`, is the only status both fulfillment methods share at
  the end of their lifecycle).
- **Reviews attach to a product, not a variant.** A photocard-style
  product can have 40 variants (A1, A2, ...); fragmenting ratings per
  variant would make each one meaningless. The buyer submits the
  `variant_id` of the order item they're reviewing (already visible to
  them on the order page); the server resolves it to a `product_id` via
  a live join, never trusting a client-supplied product id directly.
- **No moderation/approval queue.** A review publishes immediately -
  this is a small shop where the seller already personally handles
  every order; adding an approval step is scope the prompt is not big
  enough to need yet. The seller can delete an inappropriate review
  (admin JWT-gated `DELETE`), which is the one moderation action this
  iteration includes.
- **Reviewer name is shown masked, not verbatim.** Unlike most fields
  this codebase already protects, a review is the first thing in this
  shop shown to an anonymous public visitor with no token/session
  required - a meaningfully different exposure level from admin-only or
  order-token-gated views. `buyer_name` is snapshotted at review-creation
  time (matches this schema's existing convention of not re-deriving
  history from live/mutable rows) but only ever rendered masked on the
  public read path (`"Nguyễn Văn A"` → `"Nguyễn V***"`).
- **No photo attachments.** Every image-upload path in this codebase
  depends on MinIO/sharp; a text+rating review needs none of that and
  ships without it. Can be added later as its own scoped feature.
- **No reply-from-seller field.** Considered and deliberately deferred -
  YAGNI until there's evidence sellers want to publicly respond.
- **A product whose variant was deleted after the order completed**
  cannot be reviewed - `order_items.product_variant_id` is `ON DELETE
  SET NULL`, so once the variant is actually gone, that order's item no
  longer carries any `variant_id` at all, and step 4's "does this
  variant_id belong to this order" check rejects it with the ordinary
  400 before step 5 is ever reached. The `product_unavailable` response
  in step 5 exists only as defense in depth against the narrow race
  between reading `order.items` and re-reading `product_variants` in the
  same request - not a scenario reachable through the API in a single
  call, and not exercised by a dedicated test for that reason.

## Data model

### New table: `reviews`

| Column | Type | Notes |
|---|---|---|
| `id` | int, PK | |
| `order_id` | int unsigned, FK → `orders.id`, `ON DELETE CASCADE`, not null | Orders are never hard-deleted in this schema, but cascade matches every other order-scoped table's convention |
| `product_id` | int unsigned, FK → `products.id`, `ON DELETE CASCADE`, not null | |
| `buyer_name` | string(191), not null | Snapshot of `orders.buyer_name` at review time - masked only at the public read layer, never masked at rest (an admin listing may want the real name) |
| `rating` | tinyint unsigned, not null | 1-5, validated in the app layer (this codebase does not use DB `CHECK` constraints anywhere else) |
| `comment` | text, nullable | Optional, capped at 1000 chars at the app layer |
| `created_at` | timestamp, default now() | |

Unique index on `(order_id, product_id)` - the DB is the actual guard
against a duplicate review for the same pair; the app-level check exists
only to turn the resulting constraint violation into a clean error
message, same pattern `couponRepo.createCoupon` already uses for a
duplicate code.

## Buyer flow: `POST /api/orders/:token/reviews`

Mounted alongside the other `orderAccess`-gated routes in
`routes/orders.js`. Body: `{ variant_id, rating, comment }`.

1. `orderAccess` middleware (existing) - PIN session or admin.
2. Load the order via `repo.getOrderByToken(token)`; 404 if missing
   (mirrors every other order sub-route).
3. Reject with 400 unless `order.status === 'completed'`.
4. Reject with 400 unless `variant_id` matches a non-gift
   `product_variant_id` among `order.items` - a buyer cannot review a
   product they didn't actually buy on this order, and the gift line
   (which has no catalog relationship at all) is never reviewable.
5. Resolve `product_id`: `SELECT product_id FROM product_variants WHERE
   id = ?` - if the variant no longer exists, reject with 400
   `product_unavailable` (see Scope decisions).
6. Validate `rating` is an integer 1-5; `comment`, if present, is
   trimmed and capped at 1000 chars.
7. `INSERT INTO reviews (order_id, product_id, buyer_name, rating,
   comment) VALUES (...)`, using `order.buyer_name` as the snapshot -
   catches the unique-constraint violation and reports a clean
   `already_reviewed` 400 instead of a raw `ER_DUP_ENTRY` 500.

No stock/price/collection concerns apply here at all - this route never
touches `product_variants`/`collections` for anything but the one
read in step 5, so it needs no row locking.

## Public read: `GET /api/shop/products/:id/reviews`

No auth. Returns `{ summary: { count, average }, reviews: [{ id,
buyer_name, rating, comment, created_at }] }`, newest first, capped at
50 rows (a product accumulating more than that is a "nice problem" this
iteration doesn't need to paginate for yet). `buyer_name` is masked
before it ever leaves the server (`maskBuyerName`, `reviews/reviewRepo.js`)
- there is no "show full name" mode on this endpoint, by design.

Deliberately **not** folded into `catalogRepo`'s existing collection
listing/detail queries (`listPublicCollections`/
`getPublicCollectionBySlug`) - those are already the most
performance-sensitive, heavily-tested queries in the codebase, and a
rating aggregate is not needed to browse/add-to-cart. Fetched on demand
by the frontend (when a product's detail view opens), same "fetch what
this specific view needs, not everything up front" precedent the
free-gift settings/payment-methods fetches already follow.

## Admin: `DELETE /api/admin/reviews/:id`

New thin router (`backend/routes/adminReviews.js`), auth-gated like
every other `/api/admin/*` route. The only admin-side moderation action
this iteration ships - no admin listing UI beyond what's needed to know
an id to delete (a seller can already see a review's id via the public
product page's dev tools/API response in a pinch; a dedicated admin
review-browsing UI is deferred as unnecessary scope for a first cut).

## Edge cases

- **A buyer reviews the same product across two different completed
  orders**: allowed - two distinct `(order_id, product_id)` pairs, two
  reviews, same buyer.
- **A cancelled-then-somehow-later-completed order**: impossible per
  `domain.canTransition` - `cancelled` has no outgoing transitions, so
  an order can never reach `completed` after being cancelled.
- **A gift line's product**: never reviewable - gifts have
  `product_variant_id: NULL` and no relationship to `products` at all,
  so they never match the "variant_id belongs to this order" check in
  step 4.
- **Rating without a comment**: allowed - `comment` is optional, matches
  how most storefronts treat a star-only review as complete.
- **A product with zero reviews**: `GET .../reviews` returns `{
  summary: { count: 0, average: 0 }, reviews: [] }`, not a 404 - "no
  reviews yet" is a normal, common state for a newly-listed product, not
  an error.

## Testing approach

- `reviewRepo.test.js`: `createReview` shape validation
  (rating 1-5, comment length cap), duplicate `(order_id, product_id)`
  rejected cleanly, `maskBuyerName` covers single-word/multi-word/short
  names, `getProductRatingSummary` computes count/average correctly
  (including zero-review and rounding cases), `listProductReviews`
  returns newest-first and respects the cap.
- `orderReviewRoutes.test.js`: auth required (PIN/admin), 400 for a
  non-completed order, 400 for a `variant_id` not on this order, 400 for
  a gift line, 400 `already_reviewed` on a second attempt for the same
  pair, 400 `product_unavailable` when the variant has been deleted,
  successful creation snapshots `buyer_name` from the order.
- `shopReviewRoutes.test.js`: the public read endpoint - aggregate
  correctness, masked names, newest-first ordering, empty-product shape.
- `adminReviewRoutes.test.js`: auth required, delete removes the row,
  delete of an unknown id is a clean 404 (not a 500).
