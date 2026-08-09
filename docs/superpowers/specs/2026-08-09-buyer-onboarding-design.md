# Buyer Onboarding Guidance (Phase 6) — Design

## Context

Phases 1–5 built the shop, its payments, statistics and shipping handoff. The
original merch-shop spec listed Phase 6 only as "Buyer onboarding guide
(first-visit walkthrough)" — named twice, never defined. An earlier scoping
decision dropped a FAQ chatbot for resource reasons and kept the onboarding
guide alone.

Asked what buyers actually get confused about, the seller named four things,
all of them real:

1. Payment isn't instant — buyers transfer and expect immediate confirmation.
2. The transfer note — buyers omit it, so payments can't be matched to orders.
3. Losing the order link — there is no account; the link is the only way back.
4. Orders expiring unpaid — buyers don't know a deadline exists.

**Every one of these happens after the buyer clicks "order".** None concerns
browsing or adding to cart. That reshapes the phase: a first-visit walkthrough
on the shop homepage would appear a full journey before any of these bite, and
would be dismissed unread.

## The Central Finding

Three of the four problems are missing *explanations* beside things already on
screen. The fourth is missing *data*.

**`orders.expires_at` is never sent to the buyer and never displayed.** It is
absent from `toPublicOrder`'s allowlist in `backend/routes/orders.js` and
referenced nowhere in the frontend. The order reserves stock against a deadline
and the expiry sweep cancels it automatically when that deadline passes — and
the buyer is never told the deadline exists.

So "orders expiring unpaid" is not a communication failure. The information
required to avoid it has never been available to the person who needs it.

## Approach

Guidance appears **at the moment each problem occurs**, not in a modal or a
separate page:

- **No first-visit modal.** It would arrive before the confusion exists, and
  dismissible overlays are dismissed.
- **No standalone help page.** It only helps buyers who click it, and these
  problems hit buyers who are already mid-transaction.
- **No "find my order" lookup.** The spec makes `order_token` the only thing
  protecting an order page; a phone-and-email lookup is guessable by comparison
  and would expose a buyer's address and order history to anyone knowing their
  details. The seller can resend a link from the admin when asked.

## What Already Exists

Building on what is there rather than duplicating it:

- The transfer note is **displayed** on the order page (Phase 3) — but never
  explained.
- `orderSaveLink` ("Save this link to check your order later") **exists** — but
  does not mention the link was also emailed.
- An "Đang chờ xác nhận thanh toán" status **exists** — but nothing says a
  human checks transfers by hand.
- The payment deadline does not exist on the buyer's side at all.

## The Four Changes

| Problem | Change |
|---|---|
| **Orders expiring** | Add `expires_at` to the public order projection; show the deadline prominently on the order page with what happens when it passes; state the payment window at checkout, *before* the buyer commits. |
| **Payment isn't instant** | Beside the pending status, say plainly that the seller checks transfers manually, and that uploading a screenshot speeds confirmation up. |
| **Transfer note** | State outright that the exact note must be included or the payment cannot be matched. |
| **Losing the link** | Extend the existing line to say the link was also emailed. |

## Deadline Display

Rendered as an absolute local time **with** the remaining time:
`Hạn thanh toán: 20:30 09/08 (còn 3 giờ)`.

An absolute time alone is easy to misread at a glance; a remaining-time figure
alone becomes wrong if the tab sits open. Both together are unambiguous.

Interpreted in **Asia/Ho_Chi_Minh**, matching the convention Phase 4
established, so a buyer near midnight is never shown a date that disagrees with
their own clock.

### The sweep window

The expiry sweep runs on the worker every ~5 seconds, so there is a real
interval in which `expires_at` has passed while `status` is still `pending`.

During that interval the page must **not** show "còn 0 giờ" or otherwise imply
time remains. It must say the deadline has passed and the order is being
cancelled. Otherwise a buyer transfers money against an order that is already
dead — the worst outcome this feature can produce.

### Null deadlines

COD orders never expire and carry a null `expires_at`. When it is null, the
deadline block renders **nothing at all** — no placeholder, no "no deadline"
text. A missing deadline must never be mistakable for an urgent one.

## Architecture

Deliberately small. One backend change and copy at two points in the buyer
flow:

- **`backend/routes/orders.js`** — add `expires_at` to `toPublicOrder`'s
  returned fields. That function is a deliberate allowlist, not a blocklist,
  and has already been the subject of one security finding in this project, so
  the change is one field and nothing else.
- **`frontend/src/pages/Order.jsx`** — the deadline block, the manual-confirmation
  note, the transfer-note explanation, and the extended save-the-link line.
- **`frontend/src/pages/Checkout.jsx`** — the payment window stated before the
  buyer commits.
- **`frontend/src/i18n/translations.js`** — new keys in both `en` and `vi`.
  Buyer-facing UI is bilingual in this project (unlike the admin panel, which
  is hardcoded Vietnamese).

Date formatting for the deadline lives in one small helper so the timezone rule
is applied in exactly one place rather than repeated at each call site.

## Error Handling

- `expires_at` null → render nothing.
- `expires_at` in the past while still `pending` → the passed-deadline state,
  never a zero or negative remaining time.
- An unparsable date → render nothing rather than an error or `Invalid Date`.
  A buyer seeing a broken deadline is worse than seeing none.

## Testing

- The deadline block renders for a prepaid order and is **absent** for COD.
- The passed-deadline state renders differently from the has-time state.
- The time formats in Asia/Ho_Chi_Minh regardless of the browser's timezone.
- A null and an unparsable `expires_at` both render nothing, not a placeholder.
- **`toPublicOrder` now includes `expires_at` and still excludes everything it
  excluded before** — in particular `order_token` must not leak. This
  projection's allowlist has already produced one security finding in this
  project, so its test asserts both the addition and the continued exclusion.
- New translation keys exist in both `en` and `vi`.

Backend tests use Vitest 3 ESM imports; implementation files stay CommonJS.

## Out of Scope

- A first-visit modal or dismissible walkthrough
- A standalone help/FAQ page
- Any order lookup by phone or email
- FAQ chatbot (dropped in the original brainstorming for resource reasons)
- Changing the reservation window itself, the expiry sweep, or any email
