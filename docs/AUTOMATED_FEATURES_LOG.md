# Automated Features Log

Record of features shipped (or abandoned) by the daily autonomous
feature-growth agent. Each entry: date, slug, branch, PR URL, one-line
description. Read this before picking new features so we never duplicate
past work.

## 2026-09-18 - payment-reminder-email

Branch: `feature/auto-payment-reminder-email`
PR: https://github.com/phuc16/cosplay-portfolio/pull/7

Sends a one-time reminder email to a buyer whose pending, unpaid,
non-COD order is approaching its payment deadline, reusing the existing
`email_queue`/`sender.js`/`templates.js` pipeline and the worker's
existing tick loop (new `orders.payment_reminder_sent_at` guard column +
`orderRepo.sendDuePaymentReminders`).

## 2026-09-18 - coupon-codes

Branch: `feature/auto-coupon-codes`
PR: https://github.com/phuc16/cosplay-portfolio/pull/8

Admin-creatable percent/fixed discount codes, redeemed once per order at
checkout. Validated and applied inside `createOrder`'s existing
transaction under a row lock on the coupon (race-safe against a
`max_uses` limit), snapshotted onto the order
(`coupon_code_snapshot`/`discount_amount`), shown on the buyer's order
page/emails and in a new admin coupon-management screen. A public
read-only preview endpoint lets Checkout show a discount estimate before
submitting.
