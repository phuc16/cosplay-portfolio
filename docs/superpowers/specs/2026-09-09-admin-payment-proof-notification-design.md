# Admin Payment-Proof-Uploaded Notification - Design

## Problem

Today the admin (seller) gets exactly one automated email: a copy of the buyer's `order_placed` template, sent to `ADMIN_EMAIL` at order-creation time (`routes/orders.js`). This is wrong on two counts:

1. **Wrong framing.** The content is written for the buyer ("Cảm ơn bạn đã đặt hàng!", instructions to upload a payment screenshot addressed to *them*). The admin receives their own shop's buyer-facing copy about themselves.
2. **Wrong moment.** A new pending order needs no admin action yet - it's just been placed, nothing to review. The moment that actually needs a human is when the buyer uploads their payment screenshot (`POST /api/orders/:token/proof`), since that's when an order is ready to be confirmed or rejected. Today that event sends no email at all.

## Scope

The admin has exactly **one** automated email type going forward: `payment_proof_uploaded`. The existing new-order copy is removed outright, not kept alongside the new one.

No other admin-notification triggers are in scope for this spec (e.g. auto-cancellation, low stock) - only this one swap.

## Behavior

There are **two** existing admin-copy sites to remove, not one - both must go so the admin ends up with exactly the one `payment_proof_uploaded` trigger:

- `routes/orders.js`'s new-order handler no longer enqueues anything to `ADMIN_EMAIL`. The buyer's own `order_placed` email (with `access_pin`) is unaffected.
- `shop/orders/orderRepo.js`'s `transitionOrder` also currently copies `payment_confirmed` to `ADMIN_EMAIL` on a `confirmed` transition (the `notifyAdminType`/`TRANSITION_EMAILS.confirmed` path, `orderRepo.js:539,606-610,631-637`). This whole mechanism is removed: the `notifyAdminType` variable, the block that sets it, and the block that enqueues it. The buyer's own `payment_confirmed` copy (`notifyEmailType`/`notifyAddress`) is unaffected - only the admin fork-off goes.
- `POST /api/orders/:token/proof` (`routes/orders.js`), immediately after successfully storing `payment_proof_url`, enqueues one `payment_proof_uploaded` email to `ADMIN_EMAIL`, guarded by the same `if (process.env.ADMIN_EMAIL)` check the old triggers used. No payload is needed (unlike `order_placed`'s `access_pin` payload) since the admin template needs no order-specific secret.
- If `ADMIN_EMAIL` is unset, this is a silent no-op, matching every other optional-notification path in the app.
- This enqueue happens only on a successful proof upload for a `pending` order - the existing route already rejects uploads for any other status, so no extra status check is needed at the enqueue site.

## Template

A fifth entry in `shop/email/templates.js`'s `DEFAULT_TEMPLATES`, keyed `payment_proof_uploaded`. Since `backend/routes/adminEmail.js`'s `TYPES` is derived from `Object.keys(DEFAULT_TEMPLATES)`, the admin CRUD routes (`GET`/`PUT /api/admin/email-templates`) pick it up automatically - no route change needed there. `AdminEmailTemplates.jsx`'s `TYPE_LABELS` map gets one new entry so it has a human-readable name in the editor UI (e.g. "Đã tải ảnh chuyển khoản").

**Placeholders available to this template** - the existing set (`order_id`, `buyer_name`, `total`, `items`, `payment_method`, `shop_name`, `receiver_info`, `payment_note`), plus two new ones added to `buildVars`:
- `admin_url` - `${SITE_URL}/admin`. Always computed (harmless/unused by the four buyer templates), used by this template's "view order" CTA instead of the buyer-facing `order_url`.
- `payment_proof_image` - an `<img>` tag embedding `order.payment_proof_url` (prefixed with `SITE_URL`, same pattern `itemsHtml`'s thumbnails already use), sized larger than the 44×44 item thumbnails (~320px wide) since the admin needs to actually read the transfer confirmation in it. Both new placeholders are added to the `PLACEHOLDERS` allowlist so `validatePlaceholders` doesn't flag them as unknown when an admin edits the template.

**Default content**: order code, buyer name, the item list + total (so admin knows what this order was for), a one-line "buyer uploaded a payment screenshot, review below" note, the embedded screenshot, and a "Xem đơn hàng" button pointing at `{{admin_url}}`.

**Structural reuse**: `wrap()` (the shared header/card/footer chrome every template uses) is parameterized to accept which placeholder name its CTA button links to, defaulting to `"order_url"` for the four existing buyer templates and `"admin_url"` for this one. No other change to `wrap()`'s markup - same visual card, same "Xem đơn hàng →" button text (needed as-is: `sender.js`'s splice functions locate their insertion point by searching for that exact string).

## Sender: admin-audience gating

`shop/email/sender.js` currently splices two buyer-only blocks into every rendered email unconditionally:

1. Either the plaintext access PIN (only for `order_placed`, via its payload) or, for every *other* type, a "your PIN was already emailed to you" reminder.
2. A QR code (as an attachment) plus a pickup-code caption, always appended near the end.

Both are meaningless in an admin inbox - the admin doesn't use a PIN (they're logged in), and has no reason to scan their own shop's QR code or see pickup-handover copy.

Add `const ADMIN_EMAIL_TYPES = new Set(["payment_proof_uploaded"])` near the top of `sender.js`. Wrap both splice blocks (the PIN if/else, and the QR/pickup block) in `if (!ADMIN_EMAIL_TYPES.has(row.type)) { ... }`. This is the extension point for any future admin-only trigger - adding a new type to the Set is enough to opt it out of both buyer-only blocks without touching the splice logic itself.

The `cancel_reason` splice is unaffected (left as-is): it's already conditioned on `order.status === "cancelled"`, which a `payment_proof_uploaded` row (always fired against a `pending` order) can never be - no dead code, no new guard needed.

## Testing

- `shop/email/templates.js`: `buildVars` includes `admin_url`/`payment_proof_image`; `payment_proof_image` renders nothing (or an empty string, not a broken `<img src="">`) when `payment_proof_url` is null - defensive, though the real trigger only ever fires after a proof was just stored.
- `shop/email/sender.js`: a queued `payment_proof_uploaded` row renders without the PIN reminder text and without the QR image/attachment; a queued `order_placed` row is unaffected (still gets its PIN block and QR).
- `routes/orders.js`: `POST /:token/proof` enqueues exactly one `payment_proof_uploaded` row addressed to `ADMIN_EMAIL` on success, and none when `ADMIN_EMAIL` is unset; the order-creation route no longer enqueues anything to `ADMIN_EMAIL`.
- `routes/adminEmail.js` / `AdminEmailTemplates.jsx`: the new type is listed, editable, and restorable-to-default the same way the existing four are (existing generic tests already exercise this per-type, so this is largely "does it show up," not new test infrastructure).
