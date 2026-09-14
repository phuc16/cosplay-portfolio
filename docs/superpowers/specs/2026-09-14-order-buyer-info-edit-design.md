# Order Buyer-Info Edit — Design

## Goal

Let an order's contact/address/note fields be corrected after the order was
placed - by the admin at any time, or by the buyer themselves while the
order is still `pending` - with every actual change emailed to the buyer.

## Scope decisions (from brainstorming)

- **Editable fields**: `buyer_name`, `phone`, `email`, `note`, and the
  shipping address (`address_street`/`address_ward`/`address_district`/
  `address_province`/`address_raw`, only meaningful for a `ship` order).
  **Not editable** through this feature: order items, quantities, price,
  payment method, or anything else already covered by the existing
  transition flow (`tracking_code`, `shipping_fee`, `cancel_reason`).
- **Admin can edit at any order status**, including `completed`/`cancelled` -
  a mistake is often discovered after the fact, and this is a contact-detail
  correction, not a lifecycle transition.
- **Buyer can edit their own order only while `status === 'pending'`** -
  editing an address after the order has been confirmed/shipped is
  meaningless, and narrowing the window also narrows the security surface
  (see below).
- **Every actual change triggers a buyer-facing email** listing exactly
  what changed (`Tên người nhận: A → B`), for both admin-initiated and
  buyer-initiated edits. For a buyer's own edit this doubles as a
  receipt/tamper-alert: the buyer's order page is only gated by a PIN or a
  same-session token (see `docs/EDGE_CASE_CHECKLIST.md`'s "a buyer's order
  link leaks via screenshot" entry) - if that link ever leaked, someone
  else silently redirecting a shipping address would still notify the real
  buyer's (post-change) email.
- **No-op if nothing actually changed**: if the submitted values are
  identical to what's already stored, no DB write and no email.
- **The notification goes to the email on record *after* the update**
  (the new address if email itself changed, unchanged otherwise) - not
  also to the pre-change address. This is a deliberate simplification: the
  tamper-alert property still holds for every other field (a hijacker
  redirecting a shipping address, the far more likely attack, doesn't
  need to also touch the buyer's email to pull it off), and mailing a
  stale/typo'd old address on every edit would often just bounce.
  Notifying both addresses is a reasonable follow-up if it turns out to
  matter in practice, not built here.

## Data model

No schema changes. `orders.buyer_name`/`phone`/`email`/`note`/
`address_street`/`address_ward`/`address_district`/`address_province`/
`address_raw` already exist and are already nullable/writable at
order-creation time; this feature is the second write path for them.

## Backend

### `orderRepo.updateBuyerInfo(id, fields, { requirePending = false } = {})`

Single new function, used by both the admin and buyer routes so the
validation/diff/email logic lives in exactly one place:

1. Lock the order row (`FOR UPDATE`), same connection/transaction
   discipline as `transitionOrder`.
2. If `requirePending` and `order.status !== 'pending'`, roll back and
   throw a new `OrderNotEditableError` (409) - this is the buyer-only
   restriction; the admin call never sets this flag.
3. Validate: `buyer_name`/`phone`/`email` in `fields` must be non-empty
   strings (mirrors the same implicit trust level `createOrder` already
   gives these fields - no new format/regex validation is introduced
   beyond "not blank"). `note` is optional (nullable).
4. Address fields are only diffed/written when `order.fulfillment_method
   === 'ship'` - for a `pickup`/`digital` order, any address values in
   `fields` are silently ignored (these orders never had an address to
   begin with; this just preserves that invariant rather than erroring on
   a UI that will never send them anyway).
5. Diff: compare each of the (up to) 9 relevant fields against the row's
   current value. Address is treated as **one composite unit** in the
   diff/email - if any of the 5 address columns differ, one entry
   (`Địa chỉ nhận hàng: <old address_raw> → <new address_raw>`) is
   produced, not five. This keeps the notification email readable while
   the DB still stores the full structured address (street/ward/
   district/province still matter elsewhere, e.g. the ViettelPost export's
   province matching).
6. If the diff is empty: commit (no-op) and return `{ changed: false }`.
7. Otherwise: `UPDATE orders SET ...` for every changed column, commit,
   then (outside the transaction, same pattern `transitionOrder` already
   uses for its own email enqueue - a mail failure must never roll back a
   change the caller already made) `emailQueue.enqueue(id, "order_updated",
   order.email /* post-update */, { changes: diff })`, and return
   `{ changed: true, order: <updated row> }`.

`diff` entries have the shape `{ field, label, old, new }` where `label`
is the fixed Vietnamese label (`"Tên người nhận"`, `"Số điện thoại"`,
`"Email"`, `"Ghi chú"`, `"Địa chỉ nhận hàng"`) - computed here, not
re-derived by the email layer, so the email renderer stays a dumb
formatter.

### New error class

`OrderNotEditableError` - 409, message "Đơn hàng không còn ở trạng thái
chờ thanh toán nên không thể chỉnh sửa." Only ever thrown when
`requirePending` is true (the buyer path).

### Routes

- **Admin**: `PUT /api/admin/orders/:id/buyer-info` (new, in
  `routes/adminOrders.js`, behind the existing `auth` middleware the
  whole router already sits behind). Calls `updateBuyerInfo(id, fields)`
  (no `requirePending`). Responds `{ changed, order }` (order omitted when
  `changed: false`, since nothing to refresh).
- **Buyer**: `PUT /api/orders/:token/buyer-info` (new, in `routes/orders.js`,
  behind the existing `orderAccess` PIN/session middleware every other
  buyer-order-mutating route already uses, e.g. the proof-upload route).
  Resolves `token` to `id` the same way the sibling routes do, then calls
  `updateBuyerInfo(id, fields, { requirePending: true })`. Same response
  shape. `OrderNotEditableError` maps to 409 with its own message, same
  pattern as every other named error class in `routes/orders.js`.
  Rate-limited by the router's existing default (`publicLimiter` - a PUT
  falls through the same `server.js` method-based limiter selection every
  other non-POST route on this router already uses).

## Email

### New template type: `order_updated`

Added to `DEFAULT_TEMPLATES` (`backend/shop/email/templates.js`),
editable in the same admin template editor as the existing four - no
route change needed there, since `adminEmail.js`'s `TYPES` list is
already derived from `Object.keys(DEFAULT_TEMPLATES)`.

```
subject: "Thông tin đơn #{{order_id}} đã được cập nhật"
body: wrap(`<p>Chào <strong>{{buyer_name}}</strong>, thông tin đơn hàng
của bạn vừa được cập nhật.</p>{{items}}`)
```

The changed-fields list is **not** a template placeholder - it's spliced
into the rendered HTML at send time in `sender.js`, exactly like the
existing `cancel_reason` splice (right after the greeting's closing
`</p>`, ahead of the item list, using the already-existing
`spliceBeforeCardClose`-adjacent splice helper in that file). This
follows the same precedent (and the same reasoning already written down
for `cancel_reason`): a template placeholder can't express "zero to five
optional lines," but a fixed splice point can.

`sender.js` already parses `row.payload` as JSON for the `order_placed`/
PIN case; that parse is hoisted one level up so both cases can reuse it,
then a new branch: if `row.type === "order_updated"` and
`payload?.changes?.length`, render one `<p>` per changed field
(`<strong>{label}:</strong> {old} → {new}`, each value `escapeHtml`'d)
and splice it in.

## Frontend

### Admin (`AdminOrders.jsx`)

The existing expanded order-detail panel gains a "Sửa thông tin" button
next to the buyer info it already displays (email/address/note). Clicking
it swaps that block for an inline edit form (name/phone/email/note always;
address fields only when `detail.fulfillment_method === 'ship'`) with
Lưu/Hủy buttons - the same inline-edit-in-place pattern the collection
edit form already uses elsewhere in this codebase, not a modal. On save,
call the new `adminUpdateOrderBuyerInfo(id, fields)` API wrapper, then
reload the order detail (reusing whatever already re-fetches `detail`
after a transition) so the displayed values and the timeline area reflect
the change immediately. Address fields reuse the existing `AddressFields`
component (same one `Checkout.jsx` already uses), for the same
province/ward autocomplete behavior.

### Buyer (`Order.jsx`)

An "Sửa thông tin" button appears next to the receiver-info block
(`orderReceiverName`/`orderReceiverPhone`/`orderReceiverAddress`), but
**only while `order.status === 'pending'`**. Same inline-edit-in-place
form, same `AddressFields` reuse, calling a new
`updateOrderBuyerInfo(token, fields)` API wrapper (through the existing
`orderAuthHeaders()` mechanism every other authenticated buyer-order call
already uses). On success, re-fetch the order (matching how this page
already re-fetches after other buyer actions like proof upload) so the
displayed info and the confirmation banner reflect the change.

## Out of scope (explicitly deferred)

- Editing order items, quantities, price, or payment method.
- "Recover"/un-cancel (a separate, not-yet-designed feature).
- Notifying the pre-change email address in addition to the post-change
  one.
- Any admin-visible audit trail of who/when an edit happened beyond the
  buyer-facing email itself (no `edited_at`/`edited_by` column).
