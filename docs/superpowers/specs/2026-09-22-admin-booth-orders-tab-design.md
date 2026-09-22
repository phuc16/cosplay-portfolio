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

- No new backend routes, columns, or migrations - `listOrders`'s existing
  `fulfillment_method`/`collection_id` filters, the existing `orders.prepared` column, and the
  existing `PATCH .../orders/:id/prepared` endpoint already cover everything needed.
- No "today's booth totals" mini-dashboard (buyer count, cash collected) - Stats/Bookkeeping
  already covers that; duplicating it here risks drifting out of sync.
- No live/auto-refresh - a manual refresh button, same as the main Orders tab.

## 4. UI

New component `frontend/src/components/AdminBoothOrders.jsx`, registered as a new `"booth"`
tab in `Admin.jsx` alongside the existing `orders`/`shipping`/etc. tabs.

- **Collection filter**: `SearchableSelect` populated from `adminListCollections()`, default
  empty (= all collections) - same option-list shape as `AdminOrders.jsx`'s own collection
  filter.
- **Refresh button**: same "Làm mới" pattern as `AdminOrders.jsx`.
- **Order list**: each row shows buyer name, order total, timestamp, status badge, and -
  unlike the main Orders tab - the grouped drawn items (via the already-existing
  `groupOrderItems` helper) rendered directly, not behind a "Chi tiết" expand click.
- **Prepared checkbox**: per order, calling the existing `adminSetOrderPrepared(id, next)`
  exactly as `ShippingRoster.jsx` already does.
- Fetch: `adminListOrders({ fulfillment_method: 'booth', collection_id })` - `collection_id`
  omitted entirely when the filter is empty, matching `buildFilterParams`'s existing
  strip-empty-params convention.

## 5. Testing

- Component test: renders only booth orders (mock `adminListOrders`, assert the call args
  include `fulfillment_method: 'booth'`), collection filter re-fetches with `collection_id`
  set, refresh re-fetches, prepared checkbox calls `adminSetOrderPrepared` and reflects the
  optimistic/returned state, drawn items render grouped (reuse the same fixture shape
  `groupOrderItems.test.js` already covers).

## 6. Open questions / risks

None - this is a read-mostly view built entirely from already-shipped, already-tested backend
behavior.
