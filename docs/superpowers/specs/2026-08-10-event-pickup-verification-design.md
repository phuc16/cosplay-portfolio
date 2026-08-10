# Event Pickup Verification & COD Restriction — Design

## Context

Staff hand over pickup orders at live cosplay events, verifying each buyer
via `AdminQrScanner.jsx` scanning the buyer's order-page QR
(`/order/<order_token>`), then looking the order up with
`adminListOrders({})` (the *entire* order list) and marking it `completed`.
Every step of that flow — camera decode, full-list fetch, detail fetch,
status transition — needs live, solid connectivity. Event venues often have
weak or absent network, which can block the actual physical handover, not
just its bookkeeping.

Separately: COD (cash/collect on delivery/handover) is currently offered as
a payment method regardless of fulfillment method. It should only apply to
`ship` orders — pickup orders should require prepayment.

## Goal

Let staff verify and physically hand over a pickup order without depending
on live connectivity at the moment of handover, while keeping the existing
QR-scan flow for when the network does work. Restrict COD to ship orders,
both in the checkout UI and server-side.

## Pickup Verification Code

Every **pickup** order (never ship) gets a random 6-digit numeric code,
generated once at order creation — short enough to read aloud, write on
paper, or glance-match, unlike the 32-character `order_token` (too long) or
the sequential `DH<id>` reference code already used internally (guessable,
never meant as a credential). Generated via `crypto.randomInt(0, 1_000_000)`
zero-padded to 6 digits, alongside the existing `generateOrderToken()` in
`backend/shop/orders/domain.js`.

**This code is never an alternative authentication credential.** No route
accepts it in place of `order_token` to look up or act on an order — its
only use is a human visually comparing what the buyer says/shows against
what's printed on the roster (see below). `order_token` remains the sole
bearer credential for the public order page, unchanged.

Stored as a new nullable `pickup_code` column on `orders` (ship orders keep
it `null`). Surfaced to the buyer in two places, both already the delivery
mechanism for the existing pickup QR:
- The buyer's order page, next to the existing order QR
  (`frontend/src/pages/Order.jsx`), shown only when `fulfillment_method ===
  "pickup"`.
- The confirmation email's existing pickup-only QR block
  (`backend/shop/email/sender.js`'s `isPickup` branch) — the code is added
  as plain text beside the QR image already attached there. No new email
  type.

## Offline-Capable Roster Verification

The existing printable pickup roster (`buildRoster()` in
`backend/shop/shipping/roster.js`, served per-collection from
`backend/routes/adminShipping.js`) already lists every confirmed pickup
order's buyer name, phone, items, and amount due — generated ahead of time,
printable, no live lookup needed once printed. It gains one more field:
`pickup_code`, sourced from the same order row already being queried (the
route's SELECT gains the column; `order_token` remains deliberately
excluded, per that file's own existing comment about this document being
"printed and carried around a public event" — the same reasoning that kept
`order_token` off it applies to keeping it off `pickup_code`'s neighbors,
though the code itself is *meant* to be on this document, being narrow and
non-bearer by design).

Staff verify a buyer at the counter by asking for their pickup code (or
name) and matching it against the printed roster by eye — no network
required. The QR-scan flow is unchanged and still available as the fast
path when the network cooperates; the roster is the fallback, not a
replacement.

## Completing the Handover Later

Marking an order `completed` in the system is decoupled from the physical
handover — nothing new is needed for a single order, since the admin can
already transition any confirmed order to `completed` at any time via the
existing per-order action button. What's added is a **bulk "Mark completed"
action**, mirroring the existing bulk-cancel button
(`backend/routes/adminOrders.js`'s `POST /orders/bulk-cancel`,
`frontend/src/components/AdminOrders.jsx`'s "Huỷ đã chọn" button) exactly:
same multi-select checkboxes already in the orders list, a new `POST
/admin/orders/bulk-complete` endpoint that calls the same
`repo.transitionOrder(id, "completed")` per order (so the same
`canTransition` state-machine guard already protects it — an order not
legally completable is skipped with the same per-order error shape
bulk-cancel already returns, not a hard failure for the whole batch), and a
new button beside "Huỷ đã chọn," styled with the success semantic tokens
(`ACTION_BUTTON_CLASSES.success`, already defined from the admin-UI plan —
completing is not destructive the way cancelling is, so it should not share
cancel's danger styling).

This lets staff verify and hand over every order at the event using the
roster alone, then batch-select and mark them all `completed` afterward
once connectivity returns — the network dependency moves from
"blocking the handover" to "a bookkeeping step done later."

## COD Restricted to Ship Orders

**Checkout (`frontend/src/pages/Checkout.jsx`):** the payment-method list
already fetched from `fetchPaymentMethods()` is filtered to exclude `"cod"`
whenever `fulfillment === "pickup"`. If COD was selected and the buyer
switches fulfillment to pickup, the payment selection resets to the first
still-available method — mirroring the existing effect that already resets
`fulfillment` away from a method the collection doesn't offer.

**Order creation (`backend/routes/orders.js`'s `validate()`):** rejects
`payment_method === "cod"` combined with `fulfillment_method === "pickup"`
server-side, so a crafted request bypassing the UI filter is still refused
— same defense-in-depth pattern already used for every other validation
rule in that function (e.g. requiring an address only for `ship`).

## Error Handling

- `generatePickupCode()` never fails — `crypto.randomInt` cannot throw for
  fixed, valid bounds; no misconfiguration path exists (unlike, say, the
  VietQR payload build, which depends on admin-supplied settings).
- The roster's existing `cod_missing_amount` exclusion guard is untouched;
  `pickup_code` is added as a new field on included rows, not a new
  exclusion condition.
- Bulk-complete mirrors bulk-cancel's per-order error containment: one
  order's failure (e.g. already cancelled, already completed) does not stop
  the rest of the batch, and the response reports each order's own
  ok/error status individually.
- COD-for-pickup rejection returns the same `invalid_input` shape every
  other `validate()` failure already returns — no new error type.

## Testing

- `domain.test.js`: `generatePickupCode()` returns a 6-character
  all-digit string on every call across many invocations (format
  assertion, not true randomness testing).
- `orderRepo.test.js`: `createOrder` sets `pickup_code` for a pickup order,
  `null` for a ship order.
- `orderRoutes.test.js` (or wherever `toPublicOrder`/`validate` are
  tested): `pickup_code` is present on a pickup order's public response,
  `null`/absent on a ship order's; `validate()` rejects
  `payment_method: "cod"` + `fulfillment_method: "pickup"` with a Vietnamese
  message, and still accepts `cod` + `ship`.
- `roster.test.js`: `buildRoster()` includes `pickup_code` on every
  returned row, sourced from the input order's own field.
- Email sender test: the pickup-only email block includes the plain-text
  code alongside the existing QR attachment.
- `adminOrders` bulk-complete route test: mirrors the existing bulk-cancel
  test file's shape — valid ids transition to completed, an
  already-terminal order is reported as a per-item failure without
  aborting the batch, the `BULK_CANCEL_MAX`-equivalent cap is enforced.
- `Checkout.test.jsx`: COD option is absent from the payment picker when
  pickup is selected; selecting COD then switching to pickup resets the
  payment selection away from COD.
- `Order.test.jsx`: pickup code renders for a pickup order, is absent for a
  ship order.
- `AdminOrders.test.jsx`: the new bulk-complete button transitions selected
  orders via the new endpoint, uses the success (not danger) token classes,
  and is disabled when nothing is selected — same shape as the existing
  bulk-cancel tests.

## Out of Scope

- SMS delivery of the pickup code — email only (no SMS provider exists in
  this project; a future addition would be its own spec).
- True offline *database writes* (e.g. a service worker queuing completions
  while offline) — completions still require connectivity when actually
  submitted, just not at the moment of physical handover.
- Any change to the existing QR-scan flow itself (kept as the fast path) or
  to `canTransition`'s state machine.
- Restricting bulk-complete to pickup orders only — it works on any
  order in a completable state, matching bulk-cancel's own unrestricted
  scope.
- Any change to how `order_token` works or is validated.
