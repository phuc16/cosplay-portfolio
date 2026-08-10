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

Add a "tap to open your bank app, pre-filled" button alongside the existing
QR for bank transfer, so a mobile buyer can complete payment without a second
device or manual retyping. The QR stays exactly as it is today — this is a
pure addition, shown to every buyer regardless of device, not a
device-detected replacement.

PayPal and Momo are both out of scope for this work (see Out of Scope) —
Momo was originally in scope but is cut after verification found there is no
prefillable link available (see the note below).

## Bank Deep Link

There is no single URL scheme that opens "any" Vietnamese bank app — each
bank publishes its own. The practical mechanism, confirmed directly against
VietQR's own documentation, is their public redirector `dl.vietqr.io/pay`,
which takes a bank app code, account, amount, and note as query parameters
and hands off to that specific bank's app (installed or not — VietQR shows
its own fallback page either way). Confirmed real parameters: `app` (VietQR's
short bank code, e.g. `VCB`), `ba` (`<accountNumber>@<appCode>`), `am`
(amount), `tn` (note/description), all case-insensitive per the documented
example. This is the same NAPAS/VietQR interbank standard the existing local
QR payload already targets, so it fits the project's existing trust boundary
— but unlike the locally-built QR, it's a real dependency on an external
service being reachable.

**The `app` parameter is VietQR's own short bank code (e.g. `VCB`, `ICB`,
`MB`), not the numeric BIN (`970436`) already stored in
`payment_settings.bank_bin`.** These are different identifier namespaces.
`backend/shop/payments/bankCodes.js` (new) exports a static
`BANK_CODE_BY_BIN` lookup object mapping BIN → VietQR app code, sourced from
`api.vietqr.io/v2/banks` (fetched once during this plan's writing, baked in
as a literal object — not fetched at runtime, since this list changes rarely
and a runtime dependency on a second external service is unwarranted
complexity for a table that's stable for months at a time). Covers the ~65
Vietnamese banks/e-wallets VietQR's own registry lists as of 2026-08-10. A
`bank_bin` not present in the table (an obscure/new bank VietQR hasn't added,
or the table going stale) means the deep link is simply unavailable for that
seller — same graceful-degradation shape as everything else here; the QR and
manual details are unaffected.

`backend/shop/payments/deepLinks.js` exports `buildBankDeepLink({ bankBin,
accountNumber, amount, addInfo })`, returning a `dl.vietqr.io/pay` URL, or
`null` if `bankBin`/`accountNumber` are missing OR `bankBin` isn't in
`BANK_CODE_BY_BIN`. Never throws. Pure and isolated — if VietQR ever changes
`dl.vietqr.io`'s parameter names, fixing it is a one-function change.

## Momo — cut from scope after verification

The spec originally planned a Momo deep link via `nhantien.momo.vn/<phone>`.
Direct verification (fetching that URL and reading its actual page source)
found this assumption was wrong on two counts: the page reads **no query
string at all** — no `amount`, `note`, or any other parameter — so nothing
can be pre-filled; and the page's real payment target is a static
per-account short link (`page.momoapp.vn/<code>`) that isn't derivable from
a phone number by any formula. A working, prefillable Momo link would
require onboarding as a Momo Business API merchant (API keys, webhook
handling for payment confirmation) — a materially larger project than a UI
convenience button, out of scope here. Momo keeps exactly what it has today:
QR image + phone number, unchanged, no regression.

## Data Flow

No new admin field for the deep link itself, no migration — the bank deep
link is derived entirely from settings the admin already provides to enable
bank transfer at all: `bank_bin`/`bank_account_number` — see
`backend/shop/payments/settingsRepo.js` and the existing validation in
`backend/routes/adminPayments.js`. If those fields are present and the BIN
is in `BANK_CODE_BY_BIN`, the link appears; if not, it's simply absent from
the response, exactly like the existing VietQR-payload-generation-failure
fallback in `buildInstructions()`.

`backend/shop/payments/instructions.js`'s `buildInstructions(order, settings)`
gains one field on its return value: `bank_deeplink` (only when
`order.payment_method === "bank"`), built from the same `transferNote`
reference code already generated for bank transfer today. No other field or
branch of `buildInstructions` changes.

## Frontend

`frontend/src/components/shop/PaymentInstructions.jsx` renders a button
("Mở app ngân hàng" / "Open banking app") directly below the existing QR
block, only when `instructions.bank_deeplink` is present. Same component, no
new page, no device/viewport detection — the QR keeps working for a
second-device scan, the button works when the buyer is on their own phone.

Implemented as `<a href={deeplink} target="_blank" rel="noreferrer">`,
matching the existing PayPal button's pattern in the same file
(`PaymentInstructions.jsx:104-108`). New i18n keys go in
`frontend/src/i18n/translations.js` alongside the existing `payment*` keys,
in both `en` and `vi`.

## Error Handling

Link-building must never throw and must never blank the page. Missing
required settings fields, or an unmapped bank BIN → the builder returns
`null` → the frontend simply doesn't render the button, identical in shape
to the existing QR-unavailable fallback (`paymentQrUnavailable`) already
shown when VietQR payload generation fails.

If `dl.vietqr.io` ever changes its URL format or goes down, the worst case
is the button silently stops being useful (a dead or broken link) — the QR
code and the manual account details, which are unaffected by this work,
remain the buyer's guaranteed fallback. Nothing existing is replaced or made
to depend on the external service.

## Testing

- `backend/shop/payments/bankCodes.test.js` (new): `BANK_CODE_BY_BIN` is a
  plain object; spot-check a handful of real BIN→code pairs (e.g. `970436`
  → `VCB`, `970415` → `ICB`) resolve correctly.
- `backend/shop/payments/deepLinks.test.js` (new): `buildBankDeepLink` gets
  tests for correct URL/query construction (proper encoding of amount/note,
  correct `app`/`ba` values for a known BIN), returning `null` when
  `bankBin`/`accountNumber` is missing, and returning `null` when `bankBin`
  isn't in `BANK_CODE_BY_BIN`. Never throws, for any input including
  `undefined`/`null` fields.
- `backend/tests/paymentInstructions.test.js` (existing, extended):
  `buildInstructions` now asserts `bank_deeplink` appears for `bank` orders
  when settings are complete, and is `null` (same convention as
  `vietqr_payload`'s existing failure case) when the underlying settings are
  incomplete or the BIN is unmapped. `momo`/`paypal`/`cod` cases must show no
  new field at all — not even `null`.
- `frontend/src/components/shop/PaymentInstructions.test.jsx` (existing,
  extended): a bank instructions payload with `bank_deeplink` present
  renders a button whose `href` equals that link; a payload without one
  renders no such button. Existing QR-rendering and Momo tests are
  unaffected — this is additive.

## Out of Scope

- **Momo deep link** — cut after verification found no prefillable link
  exists without full Momo Business API onboarding (see above). Momo is
  unchanged by this plan.
- **PayPal deep-link/amount pre-fill** — no VND→USD exchange-rate handling;
  the existing static `paypal_link` button
  (`frontend/src/components/shop/PaymentInstructions.jsx:102-113`) is
  untouched.
- **A new admin toggle for the deep link** — it auto-appears whenever
  `bank_enabled` is on and the existing bank settings are complete; no new
  on/off control.
- **Device/viewport detection** — the button and the QR both always render;
  no logic decides which one a given buyer "should" see.
- **Live-fetching `api.vietqr.io/v2/banks` at runtime** — the BIN→code table
  is a static, baked-in snapshot; keeping it current is a manual update if
  VietQR ever adds a bank this project's sellers use.
- Any change to Momo, PayPal, COD, or the existing VietQR QR-generation path.
- Any change to `payment_settings` schema/migration.
