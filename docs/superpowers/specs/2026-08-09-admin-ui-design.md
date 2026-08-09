# Admin UI & Semantic Colour — Design

## Context

The admin panel inherits the portfolio's visual language wholesale. The
portfolio is a pink-branded showcase; the admin is a tool the seller uses to
move real money and real parcels. They have different jobs and the admin has
been losing that argument.

The concrete state today, read from the code:

- **Every order action button is visually identical.** `AdminOrders.jsx:254`
  renders each allowed transition with the same neutral brand border, and
  labels it with the **raw English enum**. In a Vietnamese admin panel the
  seller sees `Chi tiết  shipped  cancelled` — two buttons that look the same,
  one of which releases stock, emails the buyer that their order is cancelled,
  and **cannot be undone** (`TRANSITIONS.cancelled` is empty).
- **The status line is raw enums too** (`AdminOrders.jsx:245`):
  `confirmed · ship · bank · 105.000₫`.
- **There is no semantic colour vocabulary.** `frontend/src/index.css` defines
  `--brand` and friends plus a lone `--text-error`. Nothing expresses success,
  danger, warning, or neutral state.
- **The Vietnamese labels already exist** — `StatsDrop.jsx:5` has a
  `STATUS_LABELS` map (`Chờ xử lý`, `Đã xác nhận`, `Đã gửi`, `Hoàn tất`,
  `Đã hủy`). The statistics pages translate statuses correctly. The one page
  where the seller *acts* on orders does not.

The seller named three problems: fear of clicking the wrong action, difficulty
scanning the list, and statistics that are hard to read.

## Goal

An admin that is calm and neutral, where colour means something, destructive
actions look destructive, and the orders and statistics pages can be read at a
glance.

## Semantic Colour Tokens

A small set added alongside the existing tokens in `frontend/src/index.css`:
**success**, **danger**, **warning**, and **neutral**, each with a surface, a
border and a text shade, defined for both light and dark mode like every
existing token.

These are **additions, not replacements**. The portfolio's pink brand is
untouched. The admin uses semantic tokens for anything carrying meaning and
uses the brand for nothing.

Deliberately **not** a separate admin stylesheet or a second theme system. One
extra token group in the file that already holds all the others is far less to
maintain than two parallel palettes that drift apart.

## Order Actions — the wrong-click problem

This is the change with real consequences.

1. **Vietnamese labels from one shared source.** `STATUS_LABELS` moves out of
   `StatsDrop.jsx` into a shared module so the orders page and the statistics
   pages cannot drift apart. Action buttons read `Xác nhận`, `Đã gửi`,
   `Hoàn tất`, `Hủy` — never a raw enum.
2. **Destructive actions look destructive.** Cancel renders in danger styling,
   visually distinct from confirm. Confirm-type actions use success styling.
   Neutral actions (`Chi tiết`) stay neutral.
3. **Cancel keeps its typed confirmation.** It already has one; it stays.
   Cancelling is terminal, which is exactly why it must not resemble its
   neighbour.

## Scanning the Orders List

The run-on line becomes a **status badge plus structured fields**. The badge
carries the semantic colour and the Vietnamese label, so status reads down the
column instead of being parsed out of a sentence. Payment method and
fulfilment method get the same treatment.

**Orders needing action surface first.** A pending prepaid order awaiting
confirmation and a completed order from last month currently carry equal
visual weight. The actionable ones should be obvious without manual filtering.

## Statistics Readability

The numbers are correct — Phase 4 verified that thoroughly — so this is purely
emphasis, not arithmetic.

Five money figures currently render at equal weight: received, awaiting
payment, to-collect, lost, and pending COD. **Received is the figure the seller
actually cares about**; the rest are context. Making it dominant and the others
secondary turns a wall of numbers into something readable in one glance.

No figure is removed, renamed, or recomputed.

## The Shop Side

The shop keeps the pink brand — it is buyer-facing and should feel like the
seller's site.

But anywhere the shop shows **state** rather than decoration, it uses the same
semantic tokens: order status on the buyer's order page, the payment-pending
notice, and the expiry deadline Phase 6 is adding. A buyer should see "paid"
and "awaiting payment" as visually different things.

## Scope Boundary

**This is presentation only.** No API changes, no business logic changes, and
no change to what any number means. Phase 4's money rules and Phase 5's
shipping logic stay exactly as they are and as tested.

If a diff in this work touches a repo, a route, or a backend module, something
has gone wrong.

## Error Handling

Nothing in this work introduces a new failure mode: it changes how existing
state is rendered, not what state exists. A status with no label mapping must
fall back to the raw value rather than rendering blank — an unknown status
should look wrong, not invisible.

## Testing

- The shared status-label module returns the correct Vietnamese label for every
  status in the enum (`pending`, `confirmed`, `shipped`, `completed`,
  `cancelled`), and falls back visibly for an unknown one.
- An action button for a destructive transition renders with danger styling and
  a Vietnamese label; a confirm-type action does not share that styling. The
  test must fail if the two ever render identically again — that identity is
  the defect this work exists to remove.
- The statistics views still display every figure they displayed before, with
  the same values — emphasis changed, data did not.
- Every CSS variable used exists. This project has shipped non-existent ones
  twice; each new semantic token must be asserted present.
- No backend file is modified by this work.

## Out of Scope

- Payment deep links (Momo, bank, PayPal) — a separate buyer-facing gap,
  specced on its own. It was requested verbally in the original brainstorming
  ("bank (deep link,...), QR, Momo") but never reached the written spec and was
  never implemented.
- Any change to the portfolio's own visual design
- Restructuring admin navigation or adding new admin features
- Changing what statistics are computed
