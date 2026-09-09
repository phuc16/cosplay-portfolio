# Scheduled Collection Preview - Design

## Problem

A collection with `status: 'active'` but a future `start_at` is currently filtered out of the public API entirely (`listPublicCollections`/`getPublicCollectionBySlug` both require `start_at IS NULL OR start_at <= UTC_TIMESTAMP()`). A buyer can't see the collection exists at all until the exact moment it goes live - no way to preview merch, photos, or prices ahead of a drop.

## Behavior

Every active collection with a future `start_at` is now publicly visible and browsable, but not orderable, until `start_at` arrives - the same "visible, can't order" treatment a `closed` collection already gets, just with different (accurate) copy and its own open-date display.

This is unconditional - there is no admin opt-out. Every scheduled collection previews automatically once created/published; there is no "surprise reveal with zero advance visibility" mode.

## Backend

`catalogRepo.js`:
- `listPublicCollections` and `getPublicCollectionBySlug` drop the `start_at <= UTC_TIMESTAMP()` clause from their `WHERE`. Both keep the existing `status IN ('active', 'closed')` filter unchanged - a `draft`/`archived` collection is still fully invisible.
- Both add a computed `not_started_yet` boolean (`start_at IS NOT NULL AND start_at > UTC_TIMESTAMP()`) to their response rows, so the three frontend consumers (collection list, collection detail, cart-availability check) share one server-computed source of truth instead of each independently comparing `start_at` against the browser's own clock. `start_at` itself already passes through unstripped (`mapCollection` spreads the row), so no new field is needed to carry the date/time itself - only the boolean is new.

**Order-creation guard: no change needed.** `orderRepo.js`'s `createOrder` already independently re-checks `collectionNotStarted` (comparing `collection_start_at` against `new Date()`) under the same row lock as the stock check, and already throws `CollectionNotActiveError` regardless of what the listing API does or doesn't expose - this was written defensively for exactly this class of bypass ("a buyer who already has the variant_id... must not be able to check out before it's actually live") and does not depend on catalogRepo hiding the collection. A test already covers this exact case (`orderRepo.test.js`: `"rejects an order on a collection whose start_at hasn't arrived yet, even with a valid variant_id in hand"`) and passes today, unaffected by this change.

The one thing that does need updating: the guard's own comment currently frames the risk as "a buyer who already has the variant_id (an old cart, a stale page, a crafted request)" - implying the variant_id is somewhat hard to come by. Once the collection is openly listed, its variant_ids are directly visible to anyone browsing the page, not just someone with a stale link or a crafted request. Reword the comment to reflect that the guard is now the *primary*, not secondary, defense against ordering early - not just cleanup for edge cases.

## Frontend

**`Shop.jsx`** (collection list): a not-started collection gets the same dark thumbnail overlay + caption slot the `closed` collections already use, with its own copy and the formatted open date/time (e.g. "Mở lúc 10/09/2026, 20:00" / "Opens 10/09/2026, 20:00"). Rendered in the browser's local timezone via the same `Intl`-based formatting approach already used for order deadlines elsewhere in the app (never a raw `toLocaleString` string-split, per the timezone bug already fixed once this session).

**`Collection.jsx`** (detail page): the existing `closed` banner slot gets a sibling for `not_started_yet`, with its own copy + open date/time, in the same visual treatment (bordered card, not the harsher closed-collection red used for the *ended* case - this is a "come back later," not a warning). Products, photos, descriptions, and prices all render normally underneath, exactly like the closed case already does.

**`ProductCard.jsx`**: the existing `orderable` prop (already `false` for a closed collection, gating add-to-cart) is also `false` when `not_started_yet` is true. No new prop - `orderable` already means "can this be added to cart right now," which covers both reasons equally.

**`cartAvailability.js`**: currently, a not-yet-started collection always 404s from the public API and collapses into the generic `"unavailable"` bucket - the file's own comment says this is deliberate, since the public API "can't (and shouldn't)" distinguish not-started from deleted/archived from the outside. That premise no longer holds once the collection is visible. Add a real `"not_started"` bucket, driven by the new `not_started_yet` field, mirroring the existing `"ended"` bucket (`collection.status === "closed"`) exactly - same code shape, new condition, new reason string.

**Checkout's early-validation** (`Checkout.jsx`'s `collection_not_active`/`out_of_stock` auto-removal, from the earlier cart-early-validation feature) needs no change - it already removes a cart line on any `collection_not_active` rejection from the server with generic messaging, and `createOrder`'s error code is not being split into finer-grained reasons by this spec. The value-add here is entirely about being caught earlier and labeled accurately at *cart-review* time (via `cartAvailability.js`), before the buyer ever reaches checkout - not about a new checkout-time error code.

## Testing

- `catalogRepo.test.js`: `listPublicCollections` includes a not-yet-started active collection (previously it would have been excluded) and sets `not_started_yet: true`; a started collection has `not_started_yet: false`; `getPublicCollectionBySlug` same coverage. A `draft`/`archived` collection with a future `start_at` is still excluded (the `status IN (...)` filter is untouched).
- `orderRepo.test.js`: the existing "rejects an order on a collection whose start_at hasn't arrived yet" test needs no change, but re-run it as part of verification to confirm it still passes unaffected (it does not depend on catalogRepo's filter).
- Frontend: `Shop.test.jsx` (not-started overlay + open date rendered, distinct from the closed overlay), `Collection.test.jsx` (not-started banner + open date, products still render, add-to-cart disabled), `ProductCard.test.jsx` (`orderable={false}` still disables add-to-cart the same way the closed case already does - likely provable by parametrizing an existing closed-case test rather than writing a new one), `cartAvailability.test.js` (new `"not_started"` bucket, distinct from `"ended"` and `"unavailable"`).
