# Automated Features Log

Record of features shipped (or abandoned) by the daily autonomous
feature-growth agent. Each entry: date, slug, branch, PR URL, one-line
description. Read this before picking new features so we never duplicate
past work.

## 2026-09-18 - payment-reminder-email

Branch: `feature/auto-payment-reminder-email`
PR: (filled in after opening)

Sends a one-time reminder email to a buyer whose pending, unpaid,
non-COD order is approaching its payment deadline, reusing the existing
`email_queue`/`sender.js`/`templates.js` pipeline and the worker's
existing tick loop (new `orders.payment_reminder_sent_at` guard column +
`orderRepo.sendDuePaymentReminders`).
