# Payment Reminder Email Implementation Plan

**Goal:** Send a single reminder email to a buyer whose pending, unpaid,
non-COD order is approaching its payment deadline, reusing the existing
`email_queue`/`sender.js`/`templates.js` pipeline and the worker's existing
tick loop.

**Architecture:** New `orders.payment_reminder_sent_at` column guards
against a double-send. A new `orderRepo.sendDuePaymentReminders()` mirrors
`releaseExpiredOrders`'s unlocked-read-then-atomic-conditional-write shape.
`worker.js` calls it once per tick, between the expiry sweep and the email
dispatch. A new `payment_reminder` template type needs zero changes to
`sender.js`'s rendering path - it is a buyer-facing order email exactly like
the four that already exist.

**Tech Stack:** Node/Express, MySQL via mysql2 + Knex migrations, Vitest.

## Global Constraints

- One reminder per order, ever - guarded by `payment_reminder_sent_at`.
- Only pending, non-COD (`expires_at IS NOT NULL`), unpaid
  (`payment_proof_url IS NULL`) orders are eligible.
- No new process/schedule - runs inside the existing worker tick.
- No new email-sending code path - the new template type flows through
  `sendQueued()` unchanged.

---

### Task 1: Migration - `orders.payment_reminder_sent_at`

**Files:** Create `backend/migrations/040_add_order_payment_reminder.js`

- [ ] Write the migration:

```js
exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.timestamp("payment_reminder_sent_at").nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("payment_reminder_sent_at")
  })
}
```

- [ ] Run `cd backend && npm run migrate` against the local test DB, confirm
  with `DESCRIBE orders` that the column exists.
- [ ] Commit: `git add backend/migrations/040_add_order_payment_reminder.js && git commit -m "feat(shop): add orders.payment_reminder_sent_at column"`

---

### Task 2: `orderRepo.sendDuePaymentReminders`

**Files:**
- Modify: `backend/shop/orders/orderRepo.js`
- Test: `backend/tests/orderRepo.test.js`

- [ ] Add a `PAYMENT_REMINDER_LEAD_HOURS` constant (from
  `process.env.PAYMENT_REMINDER_LEAD_HOURS`, default `12`) near
  `domain.RESERVATION_HOURS`'s usage, or directly in `orderRepo.js` next to
  the new function.
- [ ] Implement, placed right after `releaseExpiredOrders`:

```js
const PAYMENT_REMINDER_LEAD_HOURS = Number(process.env.PAYMENT_REMINDER_LEAD_HOURS) || 12

/**
 * Queue a one-time reminder for a pending, unpaid, non-COD order whose
 * expires_at falls within the lead window. Mirrors releaseExpiredOrders's
 * shape: an unlocked read, then a per-row atomic conditional UPDATE that
 * only enqueues the email if this call is the one that actually flips the
 * guard column - safe against an overlapping tick or a concurrent proof
 * upload racing the same row.
 */
async function sendDuePaymentReminders(now = new Date(), leadHours = PAYMENT_REMINDER_LEAD_HOURS) {
  const windowEnd = new Date(now.getTime() + leadHours * 60 * 60 * 1000)
  const [due] = await db.query(
    `SELECT id, email FROM orders
      WHERE status = 'pending' AND expires_at IS NOT NULL
        AND expires_at > ? AND expires_at <= ?
        AND payment_proof_url IS NULL
        AND payment_reminder_sent_at IS NULL`,
    [now, windowEnd]
  )

  let sent = 0
  for (const row of due) {
    const [result] = await db.query(
      `UPDATE orders SET payment_reminder_sent_at = UTC_TIMESTAMP()
        WHERE id = ? AND status = 'pending'
          AND payment_proof_url IS NULL AND payment_reminder_sent_at IS NULL`,
      [row.id]
    )
    if (result.affectedRows === 1) {
      await emailQueue.enqueue(row.id, "payment_reminder", row.email)
      sent += 1
    }
  }
  return sent
}
```

- [ ] Export it from `module.exports` alongside `releaseExpiredOrders`.
- [ ] Write tests in `orderRepo.test.js` (new `describe("sendDuePaymentReminders", ...)`,
  seeding orders via the file's existing `order()`/`seedVariant()` helpers
  and directly patching `expires_at`/`payment_proof_url`/
  `payment_reminder_sent_at` via `db.query(UPDATE orders ...)` after
  creation, same pattern `releaseExpiredOrders`'s own tests already use):
  - queues a reminder for an order inside the lead window
  - does not queue for an order outside the lead window (too far out)
  - does not queue for an order already past `expires_at` (expired)
  - does not queue for a COD order (`expires_at IS NULL`)
  - does not queue when `payment_proof_url` is already set
  - does not queue a second time when `payment_reminder_sent_at` is already set
  - does not queue for a non-`pending` order (e.g. `confirmed`)
  - actually inserts a row into `email_queue` with `type = 'payment_reminder'`
    and sets `payment_reminder_sent_at`
- [ ] Run `cd backend && npx vitest run tests/orderRepo.test.js -t "sendDuePaymentReminders"` - expect all green.
- [ ] Run the full `orderRepo.test.js` file to confirm no regressions.
- [ ] Commit.

---

### Task 3: Worker integration

**Files:**
- Modify: `backend/worker.js`
- Test: `backend/tests/worker.test.js`

- [ ] Add `async function sendPaymentReminders()` mirroring
  `sweepExpiredOrders`'s try/catch/log shape, calling
  `orderRepo.sendDuePaymentReminders(new Date())`.
- [ ] Call it from `run()`, right after `sweepExpiredOrders()` and before
  `dispatchEmails()`.
- [ ] Export `sendPaymentReminders` from `module.exports`.
- [ ] Add/extend a `worker.test.js` case asserting `run()` invokes
  `orderRepo.sendDuePaymentReminders` once (mock the module the same way
  the existing `sweepExpiredOrders`/`releaseExpiredOrders` assertion
  already mocks `orderRepo`).
- [ ] Run `cd backend && npx vitest run tests/worker.test.js` - expect green.
- [ ] Commit.

---

### Task 4: Email template

**Files:**
- Modify: `backend/shop/email/templates.js`
- Modify: `frontend/src/components/AdminEmailTemplates.jsx` (label only)
- Test: `backend/tests/sender.test.js` (or wherever existing per-template
  render assertions live - check the file first)

- [ ] Add to `DEFAULT_TEMPLATES`, after `payment_confirmed`:

```js
payment_reminder: {
  subject: "Đơn #{{order_id}} sắp hết hạn thanh toán",
  body_html: wrap(`
    <p style="margin:0 0 12px">Chào <strong>{{buyer_name}}</strong>, đơn hàng của bạn vẫn đang <strong>chờ thanh toán</strong> và sắp đến hạn.</p>
    <p style="margin:0 0 12px">Vui lòng chuyển khoản rồi tải ảnh chuyển khoản lên trang đơn hàng trước khi hết hạn - quá hạn đơn sẽ tự động bị hủy và kho hàng được hoàn lại.</p>
    {{items}}
    ${TOTAL_ROW}
    {{shipping_fee_note}}`),
},
```

- [ ] Add `payment_reminder: "Nhắc hạn thanh toán"` to `LABELS` in
  `AdminEmailTemplates.jsx`.
- [ ] Confirm (read, don't guess) whether `sender.test.js` or another file
  already parametrizes over `Object.keys(DEFAULT_TEMPLATES)` for a generic
  "every default template renders without stray placeholders" check - if
  so, the new type is covered automatically; if not, add one explicit case
  for `payment_reminder`.
- [ ] Run `cd backend && npx vitest run tests/sender.test.js` (and
  `tests/adminEmailRoutes.test.js` if that's the actual filename - check
  first) - expect green.
- [ ] Commit.

---

### Task 5: Full suite + manual sanity check

- [ ] Run `cd backend && npm test` - full suite green (baseline: the
  pre-existing MinIO-dependent image-upload failures are expected in a
  sandbox with no MinIO; everything else must pass).
- [ ] Sanity-check `worker.js`'s `run()` ordering by reading it once more:
  `sweepExpiredOrders()` before `sendPaymentReminders()` before
  `dispatchEmails()`.
- [ ] Update `docs/AUTOMATED_FEATURES_LOG.md` with this feature's entry.
- [ ] Push branch, open PR.
