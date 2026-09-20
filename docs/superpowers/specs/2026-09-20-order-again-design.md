# One-Click Reorder ("Order again") — Design

## Goal

Let a returning buyer re-add everything from a past order to their cart in
one click from their own order-status page (`Order.jsx`), instead of
re-browsing the collection and re-adding each item by hand. Standard
"buy it again" e-commerce convenience - this shop had zero support for it.

## Scope decisions (from brainstorming)

- **Entirely frontend, no backend/DB changes.** Everything needed already
  comes back from the existing buyer order-page endpoint
  (`GET /api/orders/:token` → `order.items`, each with `product_variant_id`
  and `collection_id_snapshot`) plus the existing public catalog endpoints
  (`GET /api/shop/collections`, `GET /api/shop/collections/:slug`). No new
  router, no new `backend/shop/` module, no new table.
- **Best-effort, not atomic.** Unlike checkout (the sole source of truth,
  which re-validates everything again under a row lock at order-creation
  time regardless of what's in the cart), reorder has no transactional
  requirement. It only ever mutates the local `localStorage` cart the same
  way any other `addToCart` call does. A stale/wrong add is not a
  correctness bug here - the existing `Cart.jsx`/`checkCartAvailability`
  safety net re-validates the cart again on its own next render, and
  checkout re-validates a third time.
- **Never trust the order's own snapshot data for price/availability.**
  Per `CLAUDE.md`'s Snapshotting section, `order_items`' `product_name_
  snapshot`/`unit_price_snapshot`/`image_url_snapshot` are frozen at the
  moment the original order was placed and never re-derived. Reordering
  must re-fetch **live** catalog data for each `product_variant_id` and use
  only that for what gets added to the cart (name, price, image). The
  snapshot is only used to find *which* variant to look up and *how many*
  units were originally bought (the qty ceiling before live-stock
  clamping).
- **Gift lines are skipped.** An order line with `is_gift: true` (from the
  free-gift feature, not yet on `main` as of this writing) is not
  something the buyer chose or paid for on its own, so it's not something
  "order again" should re-add. If `is_gift` is `undefined` on a given
  `order.items` row (that PR not merged yet, or a legacy order predating
  it), the check degrades to "falsy" and the item is treated as a normal,
  reorderable line - there is nothing to distinguish yet, so nothing is
  skipped on that basis.
- **A deleted variant (`product_variant_id` is `NULL`) is skipped
  up front**, both for the cheap "should the button even show" check and
  the real reorder pass. Migration `011_create_order_items.js` sets this
  column `ON DELETE SET NULL` specifically so a completed order survives
  its variant being deleted later - by the time that's happened there is
  nothing left to look up.
- **Button visibility is a cheap, local, no-network check** -
  `hasReorderableItems(order.items)` in the new `shop/reorder.js`, true iff
  at least one item is non-gift and still has a `product_variant_id`. This
  runs on every `Order.jsx` render (it's how the button's presence is
  decided), so it deliberately does **not** fetch anything - a real
  live-availability check only happens once the buyer actually clicks the
  button. It is possible for every item to still fail the live check after
  the button was shown (e.g. everything sold out since) - the resulting
  "0 added" summary communicates that outcome; the button itself is not a
  promise that reordering will succeed, only that it's plausible.
- **Live-availability source: reuse the existing public collection
  endpoints, no new one.** `order.items` only carries
  `collection_id_snapshot` (a numeric id), not a slug, and
  `GET /api/shop/collections/:slug` (`fetchCollection`, the same call
  `Collection.jsx`/`cartAvailability.js` already make) is keyed by slug.
  So the reorder flow first calls `GET /api/shop/collections`
  (`fetchCollections`, the same call `Shop.jsx` already makes) once to
  build a `collection_id → slug` map (a collection's slug is re-derived
  from its title on every admin edit - see `catalogRepo.js`'s
  `updateCollection` - so it cannot be cached/assumed stable from order
  time; this map must always be built fresh, right before use), then
  fetches each **distinct** collection's live detail once (not once per
  item - a 40-code photocard sheet order would otherwise fire 40 requests
  for one collection). A collection id missing from the first list means
  deleted, or currently in a non-public status (`draft`/`archived`) - both
  collapse into the same `unavailable` reason, matching
  `cartAvailability.js`'s existing behavior for a 404'd collection (the
  public API deliberately can't and shouldn't distinguish "deleted" from
  "archived" from the outside).
- **Availability rules mirror `cartAvailability.js` exactly, sharing its
  matching helper.** `checkCartAvailability`'s own reasons
  (`unavailable`/`ended`/`not_started`/`sold_out`) and its `findProduct`
  helper (now exported) are the single source of truth for "is this
  variant still orderable" - reorder.js does not re-derive its own rules
  for what counts as sold out, closed, or not-yet-started. `findProduct`
  is reused as-is (digital products are flattened - `variant_id` lives on
  the product itself; physical products carry a real `variants` array).
  `checkCartAvailability` itself is *not* called directly, because reorder
  needs more than a pass/fail verdict per line - it needs the live
  product/variant object itself (current price, name, image, stock) to
  build the cart entry. Calling `checkCartAvailability` and then
  separately re-fetching each collection's detail to get that data would
  fetch every distinct collection twice for no benefit; reorder.js instead
  fetches each collection detail once and both classifies *and* reads the
  live data off the same response.
- **Quantity is clamped, never dropped, when stock is short.** Originally
  bought 3, only 1 left now → add 1, not 3, not 0. `stock_qty: null`/
  `undefined` still means unlimited (same convention as everywhere else in
  this codebase) and clamps to the original qty unchanged.
  `unit_price_snapshot`/`variant_label_snapshot` are never read for this -
  price/label always come from the live product/variant.
- **Summary UX matches the existing "add to cart" toast pattern
  (`docs/DECISIONS.md`, 2026-08-10), not a new style.** Same fixed-bottom,
  clickable-link-to-`/cart` bar `Collection.jsx` already uses for a single
  add, reused here with richer content (a count of items added, plus a
  named, per-item reason for anything skipped) rather than inventing a
  second toast pattern. Clicking it (or the button itself, once the
  operation finishes) routes to `/cart`, where the existing
  `checkCartAvailability` re-validates everything a second time before
  checkout, and the existing quantity/remove controls let the buyer adjust
  anything reorder got wrong.
- **No partial-quantity negotiation UI.** The clamp is silent-but-visible
  only via the resulting cart qty (same as `ProductCard.jsx`'s own
  `clampQty` never shows a message besides the input value itself) - no
  "we could only add 1 of the 3 you wanted" toast line. This keeps the
  summary to two categories (added-count, skipped-with-reason) rather than
  a third partial-success category to design copy for.

## Data flow

```
Order.jsx (buyer clicks "Đặt lại" / "Order again")
  → reorderOrderItems(order)                              [shop/reorder.js]
      1. filter order.items: !is_gift && product_variant_id != null
      2. fetchCollections()                                [api/shop.js, existing]
           → Map<collection_id, slug>
      3. for each distinct slug among the filtered items:
           fetchCollection(slug)                            [api/shop.js, existing]
           → live collection detail (status, not_started_yet, products[])
      4. for each filtered item:
           - missing id→slug mapping, or that collection's detail fetch
             failed           → skip, reason "unavailable"
           - detail.status === "closed"                     → skip, reason "ended"
           - detail.not_started_yet                         → skip, reason "not_started"
           - findProduct(detail, variant_id) not found       → skip, reason "unavailable"
             [cartAvailability.js, now exported]
           - resolved variant is sold out (isSoldOut/digital
             stock_qty <= 0)                                 → skip, reason "sold_out"
           - otherwise: addToCart({ ...live data, qty: clamp(item.qty, live stock) })
                                                                [shop/cart.js, existing]
  ← { addedCount, skipped: [{ name, reason }] }
Order.jsx renders the summary toast (Link to /cart)
```

## Out of scope (explicitly deferred)

- Reordering as a single atomic re-checkout (a second, transactional
  "re-buy this whole order" endpoint) - this is a cart-population
  convenience, not a checkout shortcut; checkout itself is unchanged.
- Any partial-quantity negotiation UI beyond the automatic clamp.
- A backend batch "are these variant ids still orderable" endpoint - the
  existing collection-list + collection-detail endpoints are enough, and
  CLAUDE.md's guidance for this whole exercise is to extend existing
  patterns before adding new infrastructure.
- Re-adding a gift line, or attempting to infer a replacement gift under
  the free-gift feature's current rules (that feature isn't merged, and
  even once it is, a reorder's post-discount/post-gift-threshold total is
  unrelated to the original order's).
- Showing per-item "added" names in the summary - only the count of
  successes is shown; only skipped items are named (per the feature
  request), to keep the toast short for a large multi-code order.

## Testing approach

- `frontend/src/shop/reorder.test.js` (new): `hasReorderableItems` (empty
  items, all-gift, all-deleted-variant, mixed → true); `reorderOrderItems`
  happy path (adds with live price/name/image, not the snapshot),
  skip-deleted-collection, skip-closed-collection, skip-not-started-
  collection, skip-deleted-variant/product, skip-sold-out (physical and
  digital), qty-clamped-to-stock, qty-unclamped-when-unlimited,
  gift-items-skipped, `is_gift` undefined degrades gracefully, a
  `fetchCollections`/`fetchCollection` rejection degrades to
  "unavailable" for the affected item(s) rather than throwing. Mocks
  `../api/shop` as a whole module and `../shop/cart`'s `addToCart`, same
  pattern as `cartAvailability.test.js`.
- `frontend/src/pages/Order.test.jsx` (extended): button shown/hidden per
  `hasReorderableItems`, clicking it calls the reorder flow and shows the
  count-added/skipped-with-reason summary, the summary links to `/cart`.
  Mocks `../shop/reorder` as a whole module (same pattern the file
  already uses for `../api/shop`), so these tests assert Order.jsx's own
  wiring (button gating, busy state, summary rendering, navigation) without
  re-testing `reorder.js`'s own logic a second time.
