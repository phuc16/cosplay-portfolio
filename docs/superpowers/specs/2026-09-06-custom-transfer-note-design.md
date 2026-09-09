# Custom Transfer-Note Sentence - Design Spec

## Goal

Replace the auto-generated per-order transfer code (e.g. `DH12345678`) shown to buyers on bank/momo/paypal payment instructions with a single sentence the admin writes themselves, reusing the existing `payment_note` setting. The same sentence also becomes the content embedded in the bank-transfer VietQR code.

## Background

`backend/shop/payments/instructions.js`'s `buildInstructions(order, settings)` currently calls `transferNote(order.order_token)` to generate a short, unique, uppercase code per order (`DH` + first 8 hex chars of the order token). This code is:
- shown as a copyable "Nội dung chuyển khoản" row for bank and momo methods (`transfer_note` field),
- embedded as the VietQR payload's `addInfo` (the content a banking app pre-fills when the buyer scans the QR),
- also present (but unused in the UI) for paypal.

There is a separate, already-existing `payment_note` setting (admin-configurable, stored in `payment_settings`) shown as an italic footer note under every payment method's instructions.

No backend code currently parses or matches on `transfer_note`'s value (no webhook/auto-confirm handler consumes it) - it exists purely as a display convenience for the buyer and a matching aid for the seller reading their bank statement manually. Removing the per-order uniqueness is a deliberate, accepted tradeoff (see Decisions).

## Decisions (from brainstorming)

- One shared custom sentence is used across bank, momo, and paypal - not a separate sentence per method.
- The existing `payment_note` setting is reused for this - no new settings field or migration.
- If `payment_note` is blank, the transfer-content row is hidden entirely (matches the existing `Row` component's behavior of rendering nothing for a falsy value - already true today, no new code needed for this).
- The VietQR-embedded `addInfo` also becomes `payment_note`. The user has explicitly accepted that every order's QR will therefore pre-fill the same static sentence, losing the ability to distinguish orders by transfer content alone; order matching becomes a manual amount/timing/buyer-contact process instead.

## Changes

### Backend - `backend/shop/payments/instructions.js`

- Delete the `transferNote(orderToken)` function entirely.
- In `buildInstructions`, replace `const note = transferNote(order.order_token)` with `const note = settings.payment_note || null`.
- No other change: `transfer_note: note` (bank/momo/paypal branches) and the VietQR `addInfo: note` already flow from this one local variable, so they automatically pick up the new source.
- Remove `transferNote` from the module's exports.

### Frontend - `frontend/src/components/shop/PaymentInstructions.jsx`

- No change to the bank/momo `<Row label={t("paymentTransferNote")} value={instructions.transfer_note} copyable />` lines - `Row` already returns `null` when `value` is falsy, so a blank `payment_note` already hides the row with zero new code.
- The italic footer note (`{payment_note && <p ...>{payment_note}</p>}`) must not duplicate what the bank/momo copyable row already shows. Change its condition so it only renders for methods that don't already have a copyable transfer-content row: `{payment_note && method !== "bank" && method !== "momo" && <p ...>}`. Paypal and COD keep showing the footer note as before (paypal has no copyable row for it; COD never had one).

### Admin settings UI - `frontend/src/components/AdminPaymentSettings.jsx`

- Update the `payment_note` textarea's label from `"Ghi chú thanh toán (hiển thị cho khách)"` to `"Ghi chú thanh toán / Nội dung chuyển khoản (hiển thị cho khách, dùng cho cả mã QR)"` so the admin understands this one field now drives the footer note, the copyable transfer-content row, and the QR's embedded content.

## Out of Scope

- Per-method custom sentences (bank vs momo vs paypal) - explicitly rejected in favor of one shared field.
- Any automated payment-matching/webhook logic (SePay settings exist in the schema but nothing currently consumes `transfer_note`/`addInfo` for matching - unaffected either way).
- Adding a fallback default sentence when `payment_note` is blank - the row simply hides, per the accepted decision.

## Testing

- `backend/tests/paymentInstructions.test.js`: remove the `describe("transferNote", ...)` block (the function no longer exists). Update `buildInstructions` tests that currently assert a `DH...`-style code to instead assert `transfer_note` equals the configured `payment_note`, and that it's `null`/falsy when `payment_note` is unset. Update the VietQR test asserting `vietqr_payload` contains `transfer_note` to use the new `payment_note`-sourced value.
- `frontend/src/components/shop/PaymentInstructions.test.jsx`: existing tests pass a fixed `transfer_note: "DH12345678"` value - these keep passing unchanged since the component doesn't care where the value came from. Add one new test: for `method: "bank"` or `"momo"` with both `transfer_note` and `payment_note` set to the same value, the footer paragraph does NOT also render that text (only the copyable row does) - asserts on a count of occurrences, not just presence. Add a test that `method: "paypal"` with `payment_note` set still shows the footer note.
