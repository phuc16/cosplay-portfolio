# Payment Deep Links — Design

## Context

The buyer's order page (`frontend/src/components/shop/PaymentInstructions.jsx`)
already shows payment details for bank transfer, Momo, PayPal, and COD, built
from `backend/shop/payments/instructions.js`. Bank transfer renders a
locally-generated VietQR code (`backend/shop/payments/vietqr.js`); Momo shows
an admin-uploaded QR image plus a phone number; PayPal renders a static link
button the admin configures.

The gap: a buyer checking out **on their phone** cannot scan a QR code shown
on that same phone. Today their only option for bank/Momo is to manually
retype the account number, amount, and transfer note into their banking or
Momo app — slow, and a wrong amount means the payment won't auto-match the
order. This was requested verbally in the original merch-shop brainstorm
("bank (deep link,...), QR, Momo") but never specced or built.

## Goal

Add a "tap to open your app, pre-filled" button alongside the existing QR for
bank transfer and Momo, so a mobile buyer can complete payment without a
second device or manual retyping. The QR stays exactly as it is today — this
is a pure addition, shown to every buyer regardless of device, not a
device-detected replacement.

PayPal is explicitly out of scope for this work (see Out of Scope).

## Bank Deep Link

There is no single URL scheme that opens "any" Vietnamese bank app — each
bank publishes its own. The practical mechanism is VietQR's own public
redirector, `dl.vietqr.io`, which reads the account/bank/amount from query
parameters and hands off to whichever bank app is installed (falling back to
a VietQR web page if none is). This is the same NAPAS/VietQR interbank
standard the existing local QR payload already targets, so it fits the
project's existing trust boundary — but unlike the locally-built QR, it's a
real dependency on an external service being reachable.

`backend/shop/payments/deepLinks.js` exports `buildBankDeepLink({ bankBin,
accountNumber, amount, addInfo })`, returning a `dl.vietqr.io/pay` URL with
those fields as query parameters, or `null` if `bankBin`/`accountNumber` are
missing. Never throws.

## Momo Deep Link

Momo's personal-payment link (`nhantien.momo.vn/<phone>`) is a public
consumer feature, not a documented/versioned API — Momo could change its URL
shape without notice. Same fragility class as the VietQR redirector, so it
gets the same design treatment: best-effort, isolated, falls back to nothing
special if it breaks.

`buildMomoDeepLink({ phone, amount, note })` in the same module returns a
`nhantien.momo.vn/<phone>` URL with `amount`/`note` query parameters, or
`null` if `phone` is missing. Never throws.

Both builders are pure, isolated, and separately unit-testable — if either
external site changes its URL format later, fixing it is a one-function
change, not a systemic one.

## Data Flow

No new admin fields and no migration. Both links are derived entirely from
settings the admin already provides to enable bank/Momo at all:
`bank_bin`/`bank_account_number` (bank) and `momo_phone` (Momo) — see
`backend/shop/payments/settingsRepo.js` and the existing validation in
`backend/routes/adminPayments.js`. If those fields are present, the
corresponding link appears; if not, it's simply absent from the response,
exactly like the existing VietQR-payload-generation-failure fallback in
`buildInstructions()`.

`backend/shop/payments/instructions.js`'s `buildInstructions(order, settings)`
gains two fields on its return value: `bank_deeplink` (only when
`order.payment_method === "bank"`) and `momo_deeplink` (only when
`order.payment_method === "momo"`), both built from the same `transferNote`
reference code already generated for both methods today. No other field or
branch of `buildInstructions` changes.

## Frontend

`frontend/src/components/shop/PaymentInstructions.jsx` renders a button
("Mở app ngân hàng" / "Open banking app" for bank, "Mở Momo" / "Open Momo"
for Momo) directly below the existing QR block, only when
`instructions.bank_deeplink` / `instructions.momo_deeplink` is present. Same
component, no new page, no device/viewport detection — the QR keeps working
for a second-device scan, the button works when the buyer is on their own
phone.

Implemented as `<a href={deeplink} target="_blank" rel="noreferrer">`,
matching the existing PayPal button's pattern in the same file
(`PaymentInstructions.jsx:104-108`). New i18n keys go in
`frontend/src/i18n/translations.js` alongside the existing `payment*` keys,
in both `en` and `vi`.

## Error Handling

Link-building must never throw and must never blank the page. Missing
required settings fields → the builder returns `null` → the frontend simply
doesn't render that button, identical in shape to the existing
QR-unavailable fallback (`paymentQrUnavailable`) already shown when VietQR
payload generation fails.

If `dl.vietqr.io` or `nhantien.momo.vn` ever change their URL format or go
down, the worst case is the button silently stops being useful (a dead or
broken link) — the QR code and the manual account/phone details, which are
unaffected by this work, remain the buyer's guaranteed fallback. Nothing
existing is replaced or made to depend on either external service.

## Testing

- `backend/shop/payments/deepLinks.test.js` (new): `buildBankDeepLink` and
  `buildMomoDeepLink` each get tests for correct URL/query construction
  (proper encoding of amount/note/phone), and for returning `null` when a
  required field is missing. Never throws, for any input including
  `undefined`/`null` fields.
- `backend/tests/paymentInstructions.test.js` (existing, extended):
  `buildInstructions` now asserts `bank_deeplink`/`momo_deeplink` appear for
  their respective methods when settings are complete, and are `null` (same
  convention as `vietqr_payload`'s existing failure case) when the underlying
  settings are incomplete. `paypal`/`cod` cases must show no new fields at
  all — not even `null` — since those methods never build a deep link.
- `frontend/src/components/shop/PaymentInstructions.test.jsx` (existing,
  extended): a bank/Momo instructions payload with a deep link present
  renders a button whose `href` equals that link; a payload without one
  renders no such button. Existing QR-rendering tests are unaffected — this
  is additive.

## Out of Scope

- **PayPal deep-link/amount pre-fill** — no VND→USD exchange-rate handling;
  the existing static `paypal_link` button
  (`frontend/src/components/shop/PaymentInstructions.jsx:102-113`) is
  untouched.
- **A new admin toggle for deep links specifically** — links auto-appear
  whenever the underlying method's existing settings are complete; the
  existing `bank_enabled`/`momo_enabled` switches are the only on/off control.
- **Device/viewport detection** — the button and the QR both always render;
  no logic decides which one a given buyer "should" see.
- Any change to PayPal, COD, or the existing VietQR QR-generation path.
- Any change to `payment_settings` schema/migration.
