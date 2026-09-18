# Product Reviews & Ratings Implementation Plan

**Goal:** Buyers leave a 1-5 star rating + optional comment for a
product on a completed order, gated by the existing `orderAccess`
PIN/admin trust boundary. Public, masked-name display per product.
Admin can delete a review.

**Architecture:** New `reviews` table, unique on `(order_id,
product_id)`. `POST /api/orders/:token/reviews` (buyer, orderAccess-gated)
validates order status + item ownership, resolves `product_id` from a
submitted `variant_id` via a live join, inserts. `GET
/api/shop/products/:id/reviews` (public) returns a masked-name list +
rating aggregate, fetched on demand by the frontend - not folded into
the existing catalog listing queries. `DELETE /api/admin/reviews/:id`
(admin-gated) is the only moderation action.

**Tech Stack:** Node/Express, MySQL via mysql2 + Knex migrations, React/Vite, Vitest.

## Global Constraints

- Reviews require `order.status === 'completed'`.
- One review per `(order_id, product_id)` - DB-enforced unique index.
- `buyer_name` is snapshotted at creation, masked only at the public
  read layer (never masked at rest).
- No photo attachments, no moderation queue, no seller-reply field -
  all explicitly deferred.
- Does not touch `catalogRepo.js`'s existing listing/detail queries.

---

### Task 1: Migration - `reviews` table

**Files:** Create `backend/migrations/040_create_reviews.js`

- [ ] Write:

```js
exports.up = function (knex) {
  return knex.schema.createTable("reviews", (table) => {
    table.increments("id").primary()
    table.integer("order_id").unsigned().notNullable()
      .references("id").inTable("orders").onDelete("CASCADE")
    table.integer("product_id").unsigned().notNullable()
      .references("id").inTable("products").onDelete("CASCADE")
    table.string("buyer_name", 191).notNullable()
    table.tinyint("rating").unsigned().notNullable()
    table.text("comment").nullable()
    table.timestamp("created_at").defaultTo(knex.fn.now())

    table.unique(["order_id", "product_id"])
    table.index(["product_id"])
  })
}
exports.down = function (knex) {
  return knex.schema.dropTableIfExists("reviews")
}
```

- [ ] Run `cd backend && npm run migrate`, confirm via `DESCRIBE reviews`.
- [ ] Commit.

---

### Task 2: `reviewRepo.js`

**Files:** Create `backend/shop/reviews/reviewRepo.js`; Test: `backend/tests/reviewRepo.test.js`

- [ ] Implement:
  - `maskBuyerName(name)` - pure. First whitespace-separated token kept
    verbatim; each subsequent token collapses to its first character +
    `"***"`. `"Nguyễn Văn A"` → `"Nguyễn V*** A***"` - actually spec
    says `"Nguyễn V***"` (only the first extra token shown, rest
    dropped) - implement as: first token + " " + (second token's first
    char + "***") if a second token exists, else just the first token.
  - `validateShape({ rating, comment })` - rating must be an integer
    1-5; comment (if present) trimmed and length-capped at 1000 - returns
    an error string or null, same convention as `couponRepo.validateShape`.
  - `createReview({ orderId, productId, buyerName, rating, comment })` -
    validates shape, inserts, catches `ER_DUP_ENTRY` and rethrows
    `DuplicateReviewError`.
  - `listProductReviews(productId, limit = 50)` - newest-first, maps
    each row's `buyer_name` through `maskBuyerName` before returning.
  - `getProductRatingSummary(productId)` - `SELECT COUNT(*) AS count,
    AVG(rating) AS average FROM reviews WHERE product_id = ?`; average
    rounded to 1 decimal, `0` when `count` is `0` (avoid `NaN` from
    `AVG` over zero rows).
  - `deleteReview(id)` - returns whether a row was actually deleted
    (`affectedRows`), so the route can 404 cleanly on an unknown id.
- [ ] Write tests per the design doc's Testing Approach section before
  implementing (TDD), run, then implement, then re-run to green.
- [ ] Run `npx vitest run tests/reviewRepo.test.js` - green.
- [ ] Commit.

---

### Task 3: Buyer route - `POST /api/orders/:token/reviews`

**Files:** Modify `backend/routes/orders.js`; Test: `backend/tests/orderReviewRoutes.test.js`

- [ ] Add the route inside the existing `orderAccess`-gated block in
  `orderRoutes()`, using the module's existing `bad()` helper and error
  conventions. Resolution order: order exists → `status === 'completed'`
  → `variant_id` matches a non-gift item on this order → variant still
  resolves to a live `product_id` (`SELECT product_id FROM
  product_variants WHERE id = ?`) → `reviewRepo.createReview(...)`,
  mapping `DuplicateReviewError` to a 400 `already_reviewed` and
  `InvalidReviewInputError` (from `validateShape`) to a plain 400.
- [ ] Write the failing tests first (auth required, wrong status,
  wrong/foreign variant_id, gift line rejected, duplicate rejected,
  deleted-variant rejected, happy path snapshots `buyer_name`).
- [ ] Run `npx vitest run tests/orderReviewRoutes.test.js` - green.
- [ ] Commit.

---

### Task 4: Public read + admin delete routes

**Files:**
- Modify `backend/routes/shop.js` (public `GET /products/:id/reviews`)
- Create `backend/routes/adminReviews.js`
- Modify `backend/server.js` (mount `adminReviews`)
- Test: `backend/tests/shopReviewRoutes.test.js`, `backend/tests/adminReviewRoutes.test.js`

- [ ] Public route: `couponRepo`-style thin handler calling
  `reviewRepo.listProductReviews`/`getProductRatingSummary` in parallel,
  returning `{ summary, reviews }`.
- [ ] Admin route: `DELETE /reviews/:id` → `reviewRepo.deleteReview`,
  404 if nothing was deleted, else `{ ok: true }`.
- [ ] Mount `adminReviews` in `server.js` alongside the other
  `/api/admin/*` routers.
- [ ] Write failing tests, implement, green.
- [ ] Commit.

---

### Task 5: Buyer-facing display (frontend)

**Files:**
- Modify `frontend/src/api/shop.js` (`fetchProductReviews`, `submitReview`)
- Modify `frontend/src/pages/Order.jsx` (review form for a completed order's items)
- Modify `frontend/src/pages/Order.test.jsx`
- Modify `frontend/src/components/shop/ProductCard.jsx` (rating summary in the detail view)
- Modify `frontend/src/i18n/translations.js` (new keys)

- [ ] API wrappers: `fetchProductReviews(productId)` (public),
  `submitReview(token, { variant_id, rating, comment }, headers)`
  (mirrors `updateOrderBuyerInfo`'s auth-header-forwarding shape).
- [ ] `Order.jsx`: once `order.status === 'completed'`, render a small
  per-item (non-gift) "leave a review" control - a 1-5 star picker +
  optional comment textarea + submit - reusing `order.items[].
  product_variant_id` already present in the existing response. On
  success, replace the form with a "thanks, reviewed" state (no need to
  re-fetch the order - track submitted state locally per item).
  On `already_reviewed`, same terminal state (idempotent from the
  buyer's point of view - they've already left one).
- [x] `ProductCard.jsx`: when a product's detail view opens, fetch
  `fetchProductReviews(productId)` and show the average/count badge next
  to the price - additive, no change to the existing gallery/grid
  rendering paths. **Scope note (shipped):** only the aggregate badge
  landed in this iteration, not the full per-review comment list under
  it - `GET /api/shop/products/:id/reviews` already returns the full
  `reviews` array, so rendering it is a follow-up UI-only change with no
  backend work left, deliberately deferred to keep this PR's frontend
  surface small (`ProductCard.jsx` is already one of the larger,
  state-heavy components in the shop).
- [ ] Add i18n keys (`orderReviewTitle`, `orderReviewSubmit`,
  `orderReviewThanks`, `orderReviewCommentPlaceholder`,
  `productReviewsTitle`, `productReviewsEmpty`, etc.) in both `en`/`vi`
  blocks.
- [ ] Add/extend component tests using this codebase's established
  `createRoot`/`act`/`vi.mock("../api/shop")` pattern.
- [ ] Run `cd frontend && npm test` - green.
- [ ] Commit.

---

### Task 6: Full suite + log

- [ ] `cd backend && npm test` - full suite green (documented
  MinIO-dependent failures excepted).
- [ ] `cd frontend && npm test` - full suite green.
- [ ] Update `docs/AUTOMATED_FEATURES_LOG.md`.
- [ ] Push branch, open PR.
