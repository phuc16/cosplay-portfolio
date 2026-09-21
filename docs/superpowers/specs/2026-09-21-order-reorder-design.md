# One-Click Reorder — Design

## Trend angle

**Shopping/e-commerce trend: one-click reorder.** Letting a returning buyer
re-add a past order's items to their cart in one tap is now a baseline
expectation on storefronts (Shopee/Lazada "Mua lại", Amazon "Buy it again").
For a drop-style shop selling photocards/posters in repeating collections,
this specifically helps a buyer who liked a past drop's assortment quickly
start a new order without hunting down each product again by hand.

## Goal

Add a "Đặt lại" (Reorder) action on the buyer's own order page
(`frontend/src/pages/Order.jsx`) that re-adds that order's real (non-gift)
items to the buyer's cart, then lets them go to `/cart` to review and check
out - reusing the cart and its existing live-availability revalidation
rather than building a new one.

## Why this is safe to build as "just add to cart"

`Cart.jsx` already revalidates every cart line against live catalog state on
mount via `checkCartAvailability` (`frontend/src/shop/cartAvailability.js`),
flagging `sold_out`/`ended`/`not_started`/`unavailable` lines - this is the
"Cart/checkout early sold-out/closed/not-started/ended validation" pattern
already documented in `CLAUDE.md`. Reorder does not need its own
availability check: it only needs to get the order's items back into the
cart in the shape `cart.js`/`cartAvailability.js` already expect, and the
existing revalidation on the very next page (`/cart`) takes it from there -
if a variant sold out, its collection closed, or a product/variant was
deleted since the order was placed, the buyer sees the same recoverable
"remove this line" flow that already exists for any other stale cart line
today, not a special reorder-only error path.

## Data model change

`order_items` already carries every field a cart line needs *except* the
collection's slug (it carries `collection_id_snapshot`, an id, not a slug -
`cart.js` entries are keyed by `collection_slug` because that's what
`checkCartAvailability` uses to refetch the right public collection).

`backend/shop/orders/orderRepo.js::attachItems` gets one added `LEFT JOIN`:

```sql
LEFT JOIN collections col ON col.id = oi.collection_id_snapshot
```
selecting `col.slug AS collection_slug`. No migration needed - this is a
read-path join onto an existing, already-indexed foreign key
(`collection_id_snapshot`, added in a prior phase specifically to make
per-item collection lookups reliable for a multi-collection cart - see
`docs/EDGE_CASE_CHECKLIST.md`'s `orders.collection_id` entry). `NULL` for a
gift row (no collection) or a pre-snapshot legacy row (no
`collection_id_snapshot` stored) - both cases are simply excluded from
reorder on the frontend, same as any other missing-data case.

`toPublicOrder` (`backend/routes/orders.js`) already spreads every item
field through unprojected (`publicItems = (items || []).map((i) => ({...i,
delivery_link_snapshot: ...}))`), so `collection_slug` reaches the buyer's
order response automatically - no allowlist change needed. It carries no
new privacy/trust concern: the buyer already sees this order's own item
list, and a slug is exactly the public URL segment for a collection anyone
can already browse at `/merchandise/:slug`.

## Frontend

`Order.jsx` gets a "Đặt lại" button (rendered once `order.items.length`
contains at least one reorderable line), placed directly below the order
total:

```js
const reorderable = order.items.filter((i) => !i.is_gift && i.product_variant_id && i.collection_slug)

const reorder = () => {
  for (const i of reorderable) {
    addToCart({
      variant_id: i.product_variant_id,
      qty: i.qty,
      product_name: i.product_name_snapshot,
      variant_label: i.variant_label_snapshot,
      price: i.unit_price_snapshot,
      image_url: i.image_url,
      collection_slug: i.collection_slug,
    })
  }
  setReorderedCount(reorderable.length)
}
```

- Uses `addToCart` from `frontend/src/shop/cart.js` (unchanged) - qty adds
  onto whatever is already in the cart for that `variant_id`, same as adding
  from the shop page twice.
- Prices/labels/images come from the order's own snapshot (what the buyer
  actually paid/received before), not a live re-fetch - consistent with how
  every other `cart.js` entry's `price` is already documented as "display
  only," the server is still the sole source of truth at checkout, and the
  very next page (`/cart`) already re-validates availability from live data.
- The free gift (`is_gift: true`) is never reorderable - it isn't a catalog
  item, has no `product_variant_id` to add, and re-appears on its own if a
  new order happens to qualify again (existing free-gift logic, untouched).
- A gift-less item with no `collection_slug` (only possible for a legacy
  order predating `collection_id_snapshot`) is silently skipped, matching
  how every other snapshot-fallback gap in this schema already degrades
  gracefully rather than erroring.
- After reordering, an inline confirmation (matching the existing
  no-toast-library pattern already used for "Added X to cart" on the
  Collection page - `frontend/src/pages/Collection.jsx`'s `addedMsg`) shows
  a `Link` to `/cart`, auto-dismissing after a few seconds. Does **not**
  auto-navigate - same reasoning as the existing add-to-cart toast: let the
  buyer keep browsing the order page (e.g. to also re-check its status) or
  head to the cart on their own terms.
- If every item in the order is either a gift or missing a
  `collection_slug` (nothing reorderable), the button doesn't render at
  all - a disabled button asking to be pressed on an order that has nothing
  reorderable was considered and rejected as strictly worse than not
  offering the action.

## Out of scope

- No live pre-check of stock/collection status before adding to cart - the
  existing `/cart` revalidation already covers it (see above).
- No partial-reorder UI (picking a subset of the order's items) - always
  all reorderable lines at once, matching Shopee/Amazon's "buy it again"
  behavior for a whole order.
- No change to `cart.js`, `cartAvailability.js`, or the checkout flow
  themselves - reorder is purely a new way to populate the existing cart.
- No reorder action from the admin's order view - buyer-facing only.

## Testing approach

- Backend: extend `backend/tests/orderRepo.test.js`'s existing
  `attachItems`/`createOrder` coverage with a case asserting
  `collection_slug` is present on a normal paid item and `null` on a gift
  item (gift row has no `collection_id_snapshot`).
- Frontend: extend `frontend/src/pages/Order.test.jsx` (existing
  `createRoot`/`act` pattern, `../api/shop` mocked as a whole module) with
  cases for: the button renders when a reorderable item exists; clicking it
  calls `addToCart`-equivalent behavior (asserted via `readCart()` from
  `frontend/src/shop/cart.js`, real - not mocked, matching how
  `Cart.test.jsx`/`Checkout.test.jsx` already seed carts) with the right
  shape; a gift-only order or an item missing `collection_slug` is excluded;
  the button is absent when nothing is reorderable.
