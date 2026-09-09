# Collection Start/End Scheduling - Design Spec

## Goal

Let the admin schedule a collection to become visible at a specific date and time (hour + minute precision) and, optionally, to automatically close at a later date/time. A collection with no end time stays open forever, matching today's behavior.

## Background

Collections already have a manual `status` column (`draft | active | closed | archived`). The public storefront only lists/serves collections whose status is `active` or `closed` (`PUBLIC_STATUSES` in `backend/shop/catalogRepo.js`); `closed` already means "browsable, but not orderable" - the buyer-facing UI (badges, overlays, disabled add-to-cart, sink-to-end sorting) already fully implements this state.

The public collections list and detail endpoints are currently cached in Redis for 1 hour (`backend/shop/catalogCache.js`), invalidated only on admin writes.

## Decisions (from brainstorming)

- Scheduling layers on top of the existing manual status, rather than replacing it: the admin still sets `status = 'active'` to publish a drop; `start_at`/`end_at` further gate it in time. Draft/archived collections are unaffected by scheduling (already fully admin-only regardless of time).
- A not-yet-started collection (`start_at` in the future) is **fully hidden** - excluded from the public list and the public slug route returns not-found (404), identical to a draft. No "coming soon" page.
- Reaching `end_at` performs a **real, persisted transition**: `status` is actually written to `'closed'` in the database - this is not a virtual/computed display value. Both the admin and buyer views show the same real `closed` status once it happens.
- The transition happens via **lazy write-through on read**, not a periodic background job: whenever a collection is fetched (by any code path - admin list, admin detail, public list, public detail, or order creation's own lookup) and its `end_at` has passed while the stored `status` is still `active`, that same read updates the row to `status = 'closed'` before returning the value. There is no new cron/worker tick.
- Consequence, accepted: reopening a collection after its `end_at` has passed requires the admin to explicitly set `status` back to `active` **and** clear or push out `end_at` - both real edits. Clearing `end_at` alone does not reopen an already-closed-by-expiry collection, because the closure already actually happened.
- The public collections list/detail Redis cache (`catalogCache.js`) is removed entirely, not adapted (e.g. via TTL-capping) - at this shop's actual scale (fewer than 5 collections a year), the underlying DB query costs nothing extra, and removing the cache eliminates staleness as a concern for this feature and in general, rather than adding TTL-capping complexity that would only be needed at a scale this shop doesn't operate at.
- `copyCollection` does not carry `start_at`/`end_at` into a duplicated collection - a copy starts as `draft` with a clean schedule the admin sets fresh, consistent with how it already resets `status` to `draft` regardless of the source's status.

## Data Model

One new additive migration:

- `collections.start_at` - `DATETIME NULL`. `NULL` means visible immediately (today's behavior).
- `collections.end_at` - `DATETIME NULL`. `NULL` means never auto-closes (today's behavior).

## Backend Logic

### Visibility (hidden before `start_at`)

- `listPublicCollections` and `getPublicCollectionBySlug` (`backend/shop/catalogRepo.js`) add `AND (start_at IS NULL OR start_at <= NOW())` to their existing `WHERE status IN (...)` filter. A not-yet-started collection simply doesn't come back from either query - the public slug route's existing "not found" 404 handling requires no change.

### Closing (real transition past `end_at`)

- A single shared helper, e.g. `closeExpiredCollections(rows)` in `catalogRepo.js`, takes whatever collection row(s) a query just fetched, finds any where `status === 'active' && end_at !== null && end_at <= now`, and:
  1. Runs one `UPDATE collections SET status = 'closed' WHERE id IN (...) AND status = 'active'` for all such rows in a single query (the `AND status = 'active'` guard makes concurrent calls from simultaneous requests safely idempotent - a second concurrent run simply updates zero rows).
  2. Mutates those rows' in-memory `status` field to `'closed'` before the caller returns them, so the caller never needs a second round-trip SELECT.
- This helper is called by all four collection-read paths: `listAllCollections`, `getCollectionDetailById` (admin), `listPublicCollections`, `getPublicCollectionBySlug` (buyer) - so the transition is visible to admin and buyer alike, consistent with the decision that this is a real, shared state change, not a per-audience computed value.
- `orderRepo.createOrder`'s existing per-line collection-active check (`row.collection_status !== "active"` inside its own transaction) is extended to also reject when `end_at` has passed, using the row it already joins in (add `c.end_at` to that `SELECT`). This check does **not** itself write the `closed` transition - writing it inside a transaction that's about to roll back (throwing `CollectionNotActiveError`) would roll the write back too. The persisted transition happens on whichever read path (list/detail) is hit next; `createOrder` only needs to correctly refuse the order in the meantime.

### Cache removal

- Delete `backend/shop/catalogCache.js`.
- `backend/routes/shop.js`'s `GET /collections` and `GET /collections/:slug` call `catalogRepo.listPublicCollections()` / `getPublicCollectionBySlug()` directly.
- Every `cache.invalidate()` call and `require("../shop/catalogCache")` import in `backend/routes/adminCatalog.js`, `backend/shop/orders/orderRepo.js`, and `backend/routes/orders.js` is removed - there is nothing left to invalidate.
- `backend/tests/catalogCache.test.js` and `backend/tests/catalogCacheInvalidation.test.js` are deleted (they test a module that no longer exists). Any assertion in `backend/tests/shopRoutes.test.js` / `backend/tests/adminCatalogRoutes.test.js` that depends on cache behavior (e.g. asserting a second identical call is served from cache, or asserting `invalidate()` was called) is removed or rewritten to assert the direct-DB-read behavior instead.

## Admin UI

- `frontend/src/components/AdminCollections.jsx` gains two optional `datetime-local` inputs, "Bắt đầu" (start) and "Kết thúc" (end), alongside the existing status/fulfillment fields.
- `backend/routes/adminCatalog.js`'s `validateCollection` rejects the case where both are set and `end_at <= start_at`.
- The admin collection list/detail already show the real `status` column (via the same read paths that now include the write-through) - no separate "computed badge" UI is needed; `status` itself is the truth, matching the earlier decision that this is a real transition, not a display-only overlay.

## Out of Scope

- A "coming soon" teaser page for a not-yet-started collection (rejected - fully hidden, like draft).
- A periodic/cron sweep for closing expired collections (rejected - lazy write-through on read instead).
- TTL-capping or any other cache-staleness mitigation (rejected - the cache is removed entirely).
- Carrying `start_at`/`end_at` through `copyCollection`.
- Any change to how `draft`/`archived` collections behave - scheduling only applies to `active`/`closed`.

## Testing

- `backend/tests/schema.test.js`: `collections.start_at`/`end_at` exist, nullable.
- `backend/tests/catalogRepo.test.js`: a collection with a future `start_at` is excluded from `listPublicCollections`/`getPublicCollectionBySlug`, but still returned by the admin equivalents; a collection with a past `end_at` and stored `status = 'active'` is returned with `status = 'closed'` by every read path (admin and public alike), and the DB row itself is verified updated (not just the returned object); running the same read twice is idempotent (no error, same result); `copyCollection` does not carry `start_at`/`end_at` into the copy.
- `backend/tests/orderRepo.test.js`: `createOrder` rejects a cart line whose collection's `end_at` has passed, even though the DB row's `status` might still say `active` (i.e. before any read has triggered the write-through) - `CollectionNotActiveError`.
- `backend/tests/adminCatalogRoutes.test.js`: `validateCollection` rejects `end_at <= start_at`.
- `backend/tests/shopRoutes.test.js`: a not-yet-started collection 404s on the public slug route and is absent from the public list; a past-end_at collection appears in both with `status: "closed"`.
- Delete `catalogCache.test.js`/`catalogCacheInvalidation.test.js`; update any cache-dependent assertions elsewhere.
- `frontend/src/components/AdminCollections.test.jsx`: the two new datetime fields render, submit correctly, and a validation error surfaces when `end_at <= start_at`.
