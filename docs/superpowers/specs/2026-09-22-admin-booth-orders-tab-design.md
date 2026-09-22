# Admin booth-orders tab — design

## 1. Problem

Staff running the booth kiosk need to see what buyers have already paid for and drawn,
separate from the main Orders tab (which mixes booth-cash sales in with every online
ship/pickup/digital order). A fulfillment-method filter on the main Orders tab already lets
staff narrow to booth orders, but it resets on every reload/navigation and shows columns
(shipping address, tracking code, payment-proof review) that never apply to a booth order.

## 2. Goal

A new top-level admin tab, always scoped to booth orders, zero re-filtering needed, laid out
for what booth staff actually care about: who paid, what they won, has it been handed over.

## 3. Non-goals

- No new columns or migrations - the existing `orders.prepared` column and the existing
  `PATCH .../orders/:id/prepared` endpoint already cover the prepared checkbox.
- No "today's booth totals" mini-dashboard (buyer count, cash collected) - Stats/Bookkeeping
  already covers that; duplicating it here risks drifting out of sync.
- No push-based live updates (WebSocket/SSE) - this app has no real-time infra anywhere, and
  building one just for this view isn't worth it at booth scale (a few buyers per minute).
  Polling instead (see §4) - re-fetch on an interval, same request the manual refresh button
  already makes, no new infra.

## 3a. Correction found during implementation

The original draft of this spec claimed zero backend changes. That's wrong for one piece:
`listOrders` (what the existing fulfillment-method filter on the main Orders tab already
uses) never attaches `order_items` - only a full per-order detail fetch does (`getOrderById`),
which is what `AdminOrders.jsx`'s "Chi tiết" expand click triggers on demand. Since this tab's
whole point is showing the drawn items *without* a click, one small backend addition is
needed, mirroring the exact pattern `backend/shop/shipping/roster.js` +
`adminShipping.js`'s `GET /shipping/roster/:collectionId` already use for the identical
problem (pickup roster showing items without N+1 detail fetches): fetch the matching order
rows, then one batched `WHERE oi.order_id IN (?)` query for all their items in one round trip,
map items back onto each order by id.

New endpoint: `GET /api/admin/booth-orders?collection_id=` (collection_id optional), always
hardcoded server-side to `fulfillment_method = 'booth'` - never a client-supplied filter, so
this endpoint can never be pointed at anything else. Reuses `orderRepo.listOrders`'s existing
`fulfillment_method`/`collection_id` filter logic for the order-row query, then adds the same
items-batch step `roster.js`'s route already does.

## 4. UI

New component `frontend/src/components/AdminBoothOrders.jsx`, registered as a new `"booth"`
tab in `Admin.jsx` alongside the existing `orders`/`shipping`/etc. tabs.

- **Collection filter**: `SearchableSelect` populated from `adminListCollections()`, default
  empty (= all collections) - same option-list shape as `AdminOrders.jsx`'s own collection
  filter.
- **Refresh button**: same "Làm mới" pattern as `AdminOrders.jsx`.
- **Auto-refresh**: a `setInterval` (15s) re-runs the same fetch while the tab is mounted,
  paused whenever `document.visibilityState !== "visible"` (a backgrounded browser tab or
  switched-away admin section never polls). No new infra - same endpoint the manual refresh
  button and the initial load already use.
- **Order list**: each row shows buyer name, order total, timestamp, status badge, and -
  unlike the main Orders tab - the grouped drawn items (via the already-existing
  `groupOrderItems` helper) rendered directly, not behind a "Chi tiết" expand click.
- **Prepared checkbox**: per order, calling the existing `adminSetOrderPrepared(id, next)`
  exactly as `ShippingRoster.jsx` already does.
- Fetch: a new `adminListBoothOrders({ collection_id })` API function (`frontend/src/api/shop.js`)
  calling `GET /api/admin/booth-orders` (see §3a) - `collection_id` omitted entirely when the
  filter is empty, matching `buildFilterParams`'s existing strip-empty-params convention.

## 5. Testing

- **Backend**: `GET /api/admin/booth-orders` returns only `fulfillment_method='booth'` orders
  regardless of what's requested (proving the hardcoded server-side scope), respects
  `collection_id` when given, each returned order carries its `items` array (grouped-able
  drop names/qty/price), and an order with zero items (edge case, e.g. a booth session that
  hasn't drawn anything yet) returns `items: []` rather than erroring.
- **Frontend**: renders only booth orders, collection filter re-fetches with `collection_id`
  set (and omits it when reset to "all"), refresh re-fetches, prepared checkbox calls
  `adminSetOrderPrepared` and reflects the returned state, drawn items render grouped (reuse
  the same fixture shape `groupOrderItems.test.js` already covers).

## 6. Open questions / risks

None - the one backend addition directly mirrors an already-shipped, already-tested pattern
(`shop/shipping/roster.js` + its route), and everything else is read-mostly against
already-shipped behavior.
