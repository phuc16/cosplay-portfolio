# Payment Reminder Email — Design

## Goal

A buyer who places a bank/VietQR/Momo order but never uploads a payment
screenshot currently hears nothing from the shop again until either they
come back on their own, or the payment deadline passes and the worker's
existing expiry sweep silently cancels the order and releases its stock.
That silence is a lost-sale risk (the shop's version of cart abandonment,
since a "cart" here only becomes durable state once it's an order) with an
easy, low-risk fix: nudge the buyer once, by email, while there is still
time left to pay.

## Scope decisions

- **One reminder per order, ever.** Not a recurring nag - a single email
  sent once, tracked by a new timestamp column so the sweep can never send
  it twice.
- **Only for orders that can actually expire.** COD orders have
  `expires_at IS NULL` (see `domain.computeExpiry`) and are excluded by
  that alone - no separate payment-method check needed.
- **Only while still unpaid.** An order with `payment_proof_url` already
  set is excluded - the buyer already did the thing the reminder would
  have asked for; reminding them again reads as the shop not having
  noticed their upload.
- **Only while still `pending`.** A `confirmed`/`cancelled` order has
  already left the state this reminder is about - excluded by the status
  filter.
- **A configurable lead time before `expires_at`**, not a fixed clock
  time. Reuses the same "hours before a moment" shape
  `RESERVATION_HOURS`/`payment_deadline_hours` already use elsewhere,
  default 12h, overridable via `PAYMENT_REMINDER_LEAD_HOURS`.
- **Delivered through the existing order-email pipeline** -
  `email_queue`/`sender.js`/`templates.js` - as a new template `type`,
  not a new send mechanism. `sender.js`'s render path already only needs
  an `order_id` it can look up and a `type` with a registered template;
  a reminder email needs nothing beyond what any other order email
  already carries (order code, items, total, buyer name, a link back to
  the order page), so no changes to the row shape (`email_queue.order_id`
  stays `NOT NULL`) or to `sendQueued()`'s rendering logic are needed at
  all - only a new default template and a new sweep function that calls
  the existing `emailQueue.enqueue()`.
- **Detected by the existing worker tick**, alongside
  `sweepExpiredOrders`/`dispatchEmails` - no new process, no new
  schedule.
- **Editable by the admin** through the existing email-template editor -
  a `payment_reminder` type registered in `DEFAULT_TEMPLATES`
  automatically becomes editable there (`adminEmail.js`'s `TYPES` is
  derived from `Object.keys(DEFAULT_TEMPLATES)`), no separate wiring.

## Data model

### `orders` gets one new column

| Column | Type | Notes |
|---|---|---|
| `payment_reminder_sent_at` | timestamp, nullable | Set once the reminder is enqueued; `NULL` means "not sent yet" (or not applicable, e.g. COD). |

No new table - this is a single boolean-shaped fact about an existing
order, same class of addition as `access_pin_hash` or `cancel_reason`.

## Sweep logic (`orders/orderRepo.js`)

New exported function `sendDuePaymentReminders(now = new Date(), leadHours = PAYMENT_REMINDER_LEAD_HOURS)`,
modeled directly on `releaseExpiredOrders`'s two-phase shape (unlocked
read, then a per-row conditional write that only proceeds if the row is
still in the expected state):

1. `SELECT id, email FROM orders WHERE status = 'pending' AND expires_at
   IS NOT NULL AND expires_at > now AND expires_at <= now + leadHours AND
   payment_proof_url IS NULL AND payment_reminder_sent_at IS NULL`.
2. For each row, run a single atomic
   `UPDATE orders SET payment_reminder_sent_at = UTC_TIMESTAMP() WHERE id
   = ? AND status = 'pending' AND payment_reminder_sent_at IS NULL AND
   payment_proof_url IS NULL`. Only when `affectedRows === 1` does this
   call `emailQueue.enqueue(id, "payment_reminder", email)` - the same
   race-safety the expiry sweep gets from `transitionOrder`'s
   `expectedFromStatus` guard, adapted to a plain flag instead of a state
   transition (there is no status change here, so no `transitionOrder`
   call is needed - just the same "reread the guard condition in the
   UPDATE's WHERE clause" discipline).
3. No connection/transaction juggling beyond what `db.query` already
   gives a single statement - each row's claim is one atomic UPDATE, so
   two overlapping ticks (the in-process `running` guard already prevents
   this on one process, and the Redis lease prevents it across processes,
   but the sweep itself is written to be safe even without those) can
   race on the same row and only one gets `affectedRows === 1`.
4. Why `expires_at <= now + leadHours` rather than "within the last N
   minutes of a poll window": the sweep runs every ~5s
   (`workerLease.TICK_INTERVAL_MS`), so a plain window would need to be
   sized to the poll interval and could still miss a row if a tick is
   skipped (Redis lease contention, a slow previous tick). Using
   `payment_reminder_sent_at IS NULL` as the idempotency guard instead of
   a time window means a missed tick just catches up on the next one -
   the row stays eligible until it's actually claimed, exactly like
   `releaseExpiredOrders` already relies on for expiry.

## Worker integration (`worker.js`)

New `async function sendPaymentReminders()`, same try/catch-log-and-continue
shape as `sweepExpiredOrders`, called from `run()` right after
`sweepExpiredOrders()`:

```js
await sweepExpiredOrders()
await sendPaymentReminders()
await dispatchEmails()
```

Ordering matters: an order that crosses into the reminder window and also
happens to be past its expiry in the same tick should be cancelled, not
reminded about a deadline that has already passed - running the expiry
sweep first means a since-expired row is no longer `status = 'pending'`
(or still is, if the sweep's own guard rejected the cancel for some other
reason - `requireNoProof` - in which case reminding is still not
appropriate, but the reminder query's own `expires_at > now` upper bound
already excludes it either way since an expired order has `expires_at <=
now`, not `> now`).

## Email template

New `payment_reminder` entry in `templates.js`'s `DEFAULT_TEMPLATES`:

- Subject: "Đơn #{{order_id}} sắp hết hạn thanh toán"
- Body: greets the buyer by name, states the order is still awaiting
  payment and will be automatically cancelled if no payment proof is
  received before the deadline, repeats the items/total (so the buyer
  doesn't have to click through to remember what they ordered), and ends
  with the same "Xem đơn hàng →" CTA every template already gets from
  `wrap()`.
- No new placeholders needed - built entirely from the existing
  `PLACEHOLDERS` set (`buyer_name`, `items`, `total`, `order_id`,
  `payment_note`, `shipping_fee_note`).
- Flows through `sendQueued()` completely unchanged: it is a buyer-facing
  type (not in `ADMIN_EMAIL_TYPES`), so it gets the "PIN was in your
  confirmation email" hint, the order QR, and the standard footer exactly
  like `order_placed`/`payment_confirmed`/etc. already do - no branching
  needed in `sender.js` at all.

## Admin UI

No new screen. `payment_reminder` appears automatically in
`AdminEmailTemplates.jsx`'s template list once it exists in
`DEFAULT_TEMPLATES` (`TYPES` on the backend, and the existing
`LABELS[tpl.type] || tpl.type` fallback on the frontend already handles an
unlabeled type gracefully) - a Vietnamese label is added to `LABELS` for
polish, same as every other type.

## Edge cases

- **An order whose deadline was extended by editing
  `payment_deadline_hours` after the reminder already sent**: not
  possible - `payment_deadline_hours` lives on the collection, read once
  at `createOrder` time into `orders.expires_at`, which never changes
  after that (no edit path touches it). A sent reminder stays sent.
- **A buyer uploads proof in the same window the sweep is running**: the
  atomic `UPDATE ... WHERE payment_proof_url IS NULL` guard means a
  concurrent proof upload (which sets `payment_proof_url`) either wins
  the race and the reminder never sends, or loses it and a reminder goes
  out for an order that was, at the exact instant of the query,
  genuinely still unpaid - a harmless one-message-late email, not a
  correctness bug, same class of accepted race the expiry sweep already
  has relative to `savePaymentProof`.
- **`PAYMENT_REMINDER_LEAD_HOURS` larger than the order's actual
  reservation window** (e.g. a collection with a 6h override but a 12h
  default lead time): every such order becomes immediately eligible the
  moment it's created. Accepted - an admin who sets a short deadline
  presumably wants buyers reminded sooner, not later, and the guard
  columns still prevent a double-send regardless of how early the first
  eligible tick catches it.
- **SMTP not configured**: `sendQueued()` already no-ops and warns
  (`warnIfMailStuckUnconfigured`) - a queued-but-unsent reminder behaves
  exactly like every other queued email in that state, no special case
  needed.

## Testing approach

- `orderRepo.test.js`: new `describe("sendDuePaymentReminders", ...)`
  block - seeds pending orders at various `expires_at` offsets/payment
  states and asserts which get a queued `payment_reminder` row and which
  don't (too early, too late/already expired, COD, has proof, already
  reminded, wrong status).
- `worker.test.js`: asserts `run()` calls the new sweep function once per
  tick, same shape as its existing `sweepExpiredOrders` assertion.
- `sender.test.js` / template rendering: a small check that the new
  default template renders without leaving `{{placeholder}}` artifacts,
  matching the existing per-template render tests in that file.
- No frontend changes, so no frontend tests are needed - `payment_reminder`
  appearing in the admin template list is covered indirectly by
  `adminEmail.js`'s `TYPES` being derived from `DEFAULT_TEMPLATES`, which
  is already what every other type relies on.
