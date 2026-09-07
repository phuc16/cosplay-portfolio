# Cart Early Availability Validation - Design Spec

## Goal

Catch a cart line that's actually sold out, or whose collection is closed/not-started/ended, on the Cart page itself - before the buyer fills out the whole checkout form and only then hits a server error at submit.

## Background

`Checkout.jsx` already has a `variant_not_found` recovery path that runs AFTER a failed submit, and a `loadFulfillmentFlags` helper that fetches each distinct `collection_slug` in the cart via the existing public `fetchCollection(slug)` API to derive ship/pickup availability. This spec reuses that same fetch, moved earlier (Cart page, on mount) and widened to also catch sold-out and closed/hidden collections, not just fulfillment-method availability.

The public `getPublicCollectionBySlug` endpoint (see the collection-scheduling feature) already returns 404 for a not-yet-started collection - identical to a deleted/archived/draft one, by design, so buyers never learn a hidden collection exists. A collection whose `end_at` has passed is returned normally but with `status: "closed"`.

## Decisions (from brainstorming)

- Validation runs on the **Cart page only**, once on mount - not polled, not repeated on Checkout (Checkout's existing post-submit `variant_not_found` recovery remains as the safety net for the narrow race window after leaving the cart page).
- Four buyer-facing states, collapsed from what the public API can actually distinguish:
  - **Fetch 404s** → generic "no longer available" (covers not-started, deleted, archived - the API deliberately can't tell these apart from the outside, and it shouldn't: revealing "come back at 3pm" would leak a hidden drop's existence).
  - **Fetch succeeds, `status: "closed"`** → "this drop has ended" (covers both a manually-closed collection and one whose `end_at` just passed - both already collapse to the same real `status` value).
  - **Fetch succeeds, item/variant no longer found in the collection's products** → "no longer available" (product deleted since it was added to cart).
  - **Fetch succeeds, item found but sold out** → "sold out" (per-variant stock check for physical, the flattened product-level stock check for digital).
- An invalid line stays visible with an inline reason badge, its quantity controls disabled, and "Proceed to checkout" is disabled with a short note until every invalid line is removed.

## Design

### `frontend/src/shop/cartAvailability.js` (new)

A single exported async function, `checkCartAvailability(cart)`, that:
1. Collects the distinct `collection_slug` values present in `cart` (ignoring falsy ones - shouldn't happen, but matches `Checkout.jsx`'s existing defensive pattern).
2. Fetches each via the existing `fetchCollection(slug)` API call, catching a failed fetch (404 or otherwise) as `null` rather than letting it reject.
3. For each cart line, looks up its collection's fetch result and classifies it:
   - `null` → `"unavailable"`
   - `status === "closed"` → `"ended"`
   - product/variant not found in `collection.products` → `"unavailable"`
   - found but sold out → `"sold_out"`
   - otherwise → not included in the result at all (valid)
4. Returns a `Map<variant_id, reasonKey>` containing only the invalid lines.

Matching a cart line to its product/variant: for a digital product (flattened per the digital-album feature), match `product.variant_id === line.variant_id` and check sold-out via the already-exported `isProductSoldOut(product)`. For a physical product, find `product.variants.find(v => v.id === line.variant_id)` and check sold-out via a per-variant check - this requires exporting `ProductCard.jsx`'s existing (currently private) `isSoldOut(variant)` helper, since `isProductSoldOut` answers "are ALL of this product's variants sold out", not "is this ONE variant sold out" (a product with variant A sold out and variant B - the one actually in the cart - still in stock must not be flagged).

### `frontend/src/components/shop/ProductCard.jsx`

Export the existing `isSoldOut` helper alongside the already-exported `isProductSoldOut`. No behavior change - purely a visibility change so `cartAvailability.js` can reuse the exact same per-variant stock logic instead of duplicating it.

### `frontend/src/pages/Cart.jsx`

- On mount, call `checkCartAvailability(cart)` and store the result in state (`problems: Map`, plus a `checking` boolean so the checkout button doesn't briefly enable before the check resolves).
- Each cart line whose `variant_id` is in `problems` renders a red inline badge with the mapped translation string, and its quantity `−`/`+`/number-input controls become `disabled` (the remove button stays active - that's the only useful action left).
- "Proceed to checkout" is `disabled` while `checking` is true or any line currently in the cart still has an entry in `problems`, with a short note shown beneath it in that case.
- Removing a line doesn't require re-fetching anything - gating is computed by intersecting `problems`'s keys with the current cart's `variant_id`s on every render, so removing the one bad line immediately re-enables checkout without a new network call.

### Translations

New keys (`en`/`vi`), added near the existing `cart*` keys in `frontend/src/i18n/translations.js`:
- `cartItemSoldOut` - "Sold out" / "Hết hàng"
- `cartItemEnded` - "This drop has ended" / "Đợt mở bán đã kết thúc"
- `cartItemUnavailable` - "No longer available" / "Không còn khả dụng"
- `cartResolveIssues` - "Remove unavailable items to continue" / "Xóa các sản phẩm không khả dụng để tiếp tục"

## Out of Scope

- Checkout page re-validation (deferred to its existing post-submit recovery path).
- Polling/periodic re-checks while sitting on the Cart page.
- Auto-removing bad lines (rejected in favor of an explicit, visible removal step).
- Distinguishing "not started" from "deleted" in the UI (the public API can't and shouldn't).

## Testing

- `frontend/src/shop/cartAvailability.test.js` (new): mocks `fetchCollection`; asserts each of the four classifications, a mix of valid/invalid lines in one cart, a cart spanning two collections, and that a line with no `collection_slug` is treated as valid (not flagged).
- `frontend/src/components/shop/ProductCard.test.jsx`: no behavior change expected - add one test confirming `isSoldOut` is exported and matches its existing (already-tested-indirectly) per-variant logic.
- `frontend/src/pages/Cart.test.jsx`: a sold-out line shows the right badge and disables its qty controls; an unavailable/ended line does the same with its own badge; "Proceed to checkout" is disabled while any problem exists and re-enables after removing the bad line; a fully-valid cart behaves exactly as today (no badges, checkout enabled) - this last case guards against a regression in all of this file's pre-existing tests.
