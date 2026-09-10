# Buyer Order Note in Shipping Export + Pickup Roster — Design

## Problem

A buyer can already leave a free-text note at checkout (`Checkout.jsx`'s
`<textarea>`, saved to the existing `orders.note` column, already shown in
the admin order detail panel). But the two views staff actually use while
fulfilling an order - the ViettelPost shipping export queue
(`ShippingExport.jsx`) and the printed pickup roster (`ShippingRoster.jsx`)
- never surface it. A buyer asking "please sign the card" or specifying a
preferred delivery window (work hours only, evening, etc.) has no way to
get that instruction in front of the person actually packing/handing over
the order, since neither of those two screens shows anything beyond the
order's shipping/pickup logistics fields.

## Solution

No schema change and no new buyer-facing input - `orders.note` already
exists and is already captured. This is purely a read-path + display gap:
thread the existing note through the two backend endpoints that don't
currently include it, and render it in the two admin views.

### Backend

`routes/adminShipping.js`'s `GET /shipping/export/orders` route calls
`orders.listOrders(filter)`, whose underlying query is `SELECT o.*` (per
`orderRepo.js:499`) - so `o.note` is already present on every row, it's
just not included in this route's hand-picked response object. Add
`note: o.note` to that mapped object.

`routes/adminShipping.js`'s `GET /shipping/roster/:collectionId` route runs
its own explicit-column `SELECT id, buyer_name, phone, status,
payment_method, cod_amount, pickup_code, created_at, prepared FROM orders
...` (not `SELECT *`) - add `note` to that column list.

`shop/shipping/roster.js`'s `buildRoster()` shapes each fetched order row
into the roster's own row shape (`order_id`, `order_code`, `buyer_name`,
`phone`, `pickup_code`, `items`, `has_digital_item`, `paid`, `amount_due`,
`prepared`) - add `note: order.note || null` to that pushed object.

### Frontend

`ShippingExport.jsx` gains a new "Ghi chú" table column. Empty for orders
with no note. For orders with one, the cell shows a truncated preview (CSS
`text-overflow: ellipsis` in a fixed-width cell) with the full text
available via the browser's native `title` attribute (a plain HTML tooltip
on hover) - no new interactive/expand state needed, since this table is
already dense and this is a secondary/reference field, not primary
packing data.

`ShippingRoster.jsx` renders the note as a visible line directly under the
buyer's name/phone on each row - not hidden behind the existing
`expandedIds` per-order expand toggle (that toggle currently gates the
item photo list). This is a printed physical checklist staff hand to
buyers at pickup; anything gated behind a click-to-expand interaction is
invisible on the printed page, and staff need to see "please sign the
card" without having had to think to expand that specific row first. No
`print:hidden` class - it must appear in both the on-screen and printed
views, same as the rest of the row.

### Out of scope

- The actual ViettelPost `.xlsx` export file (`vtpWorkbook.js`) - the note
  is for the seller's own staff, not the courier; ViettelPost's import
  format has no free-text remarks field currently wired into this codebase,
  and a courier driver has no channel to act on "please sign the card"
  regardless.
- Any change to how the buyer enters or edits the note - the existing
  checkout textarea and its validation are untouched.
- The main `AdminOrders.jsx` order-list detail panel, which already shows
  `detail.note` (`AdminOrders.jsx:379`) - no change needed there.

## Testing

Both backend routes already have test coverage for their existing response
shape - `backend/tests/adminShippingExport.test.js` and
`backend/tests/adminShippingRoster.test.js` - each gains an assertion that
a seeded order's `note` value round-trips through the response.
`backend/tests/roster.test.js` (the unit test of `buildRoster()` itself)
gains the same. Frontend:
`ShippingExport.test.jsx` and `ShippingRoster.test.jsx` each gain a test
rendering a fixture order with a note and asserting the text appears in
the table/roster output, plus one confirming a null/absent note renders
nothing (no stray "null" or empty bubble).
