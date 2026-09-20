# Gacha Product — Design

## Goal

Sellers can create a "gacha" product — a random-prize draw mechanic sold
per-turn — usable two ways: sold online through the normal shop
(checkout → draw on the buyer's own order page → prizes shipped) and run
live at a festival booth on a tablet/TV (staff enters a paid turn count →
buyer draws in person → prizes handed over on the spot). A public,
unauthenticated "try it free" practice mode lets anyone experience the
draw with real odds and zero stakes. The visual/audio design and reel
mechanics are ported from the exported mockup at
`/Users/phucth/Downloads/export` (`Concept B - Case Reel.dc.html`).

## Scope decisions (from brainstorming)

- **Two real purchase paths, one shared draw UI.** Online (ship-fulfilled)
  and booth-cash (handed over immediately) are the only two ways to get
  real turns. There is no "buy online, redeem at booth" flow — that
  would need a separate claim-code/redemption mechanism and was
  deliberately dropped once the delivery model was clarified: online
  buyers draw on their own device right after payment is confirmed, and
  the resulting prizes ship to them like a normal physical order.
- **Odds are pure quantity-weighted, live.** A prize's chance = its
  `quantity_remaining` ÷ the sum of all prizes' `quantity_remaining` in
  that gacha product, recomputed after every single draw (by anyone,
  online or at the booth) — not snapshotted per session. Tier
  (Common/Rare/Epic/Legendary/Ancient) is a **display-only** grouping
  (color + summed %), not an independent weight.
- **Every real session is a real order.** Both online and booth-cash
  sessions create a genuine row in `orders`, so gacha revenue
  automatically appears in Admin Orders, drop stats, and the bookkeeping
  export — no separate reporting surface. Practice-mode draws never
  create an order or touch stock.
- **Prize pool is editable anytime**, including after draws have
  happened. Increasing a prize's total quantity increases its remaining
  quantity by the same delta; the seller can never reduce
  `quantity_total` below what's already been drawn
  (`quantity_total - quantity_remaining` is immutable history).
- **Booth kiosk reuses the full admin JWT**, not a narrower device-scoped
  token. The tablet is treated as a physically-supervised device for the
  festival's duration, same trust model as a POS terminal — accepted
  explicitly, not an oversight.
- **All draws are server-authoritative.** The server picks the winning
  prize (never trusts a client-reported result), inside the same
  row-locked transaction used to decrement stock. See "Anti-cheat"
  below.
- **A gacha product's single "turn" variant is hidden**, exactly like a
  digital product's hidden variant — it exists so the existing
  cart/checkout/payment pipeline needs no changes to sell turns, but it
  never appears as a normal pickable variant in any UI.

## Data model

### `products.type` gains `'gacha'`

Alongside existing `'physical'`/`'digital'`. A gacha product has exactly
one `product_variants` row (hidden, same convention as digital products'
hidden variant), representing "1 turn" at the configured price. Buyer
quantity at checkout = number of turns purchased.

### New table: `gacha_prizes`

| Column | Type | Notes |
|---|---|---|
| `id` | int, PK | |
| `product_id` | int, FK → `products.id`, not null | |
| `name` | string(191), not null | |
| `description` | text, nullable | |
| `image_url` | string(512), nullable | Same MinIO upload pipeline as every other product/variant image |
| `tier` | enum/string, not null | `common`/`rare`/`epic`/`legendary`/`ancient` — display grouping only, drives badge color + summed odds shown in UI |
| `display_price` | int unsigned, not null, default 0 | VND. Shown as the prize's "value" — informational only, never charged separately |
| `quantity_total` | int unsigned, not null | Lifetime total ever stocked for this prize |
| `quantity_remaining` | int unsigned, not null | Decremented atomically on each real draw; never touched by practice draws |
| `sort_order` | int, not null, default 0 | |

`quantity_total - quantity_remaining` = lifetime drawn count for this
prize; edits can only ever increase `quantity_total` or reduce it down to
(but not below) this drawn count.

### New table: `gacha_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | int, PK | |
| `product_id` | int, FK → `products.id`, not null | |
| `order_id` | int, FK → `orders.id`, nullable | Set for `online` and `booth_cash`; always null for `practice` |
| `buyer_name` | string(191), nullable | Optional, booth-cash convenience field |
| `turns_total` | int unsigned, not null | |
| `turns_used` | int unsigned, not null, default 0 | |
| `status` | enum, not null | `active` / `completed` |
| `source` | enum, not null | `online` / `booth_cash` / `practice` |
| `created_at` / `completed_at` | timestamp | |

For `online`, `turns_total` = the quantity of the "1 turn" variant on the
order once it reaches `confirmed`, and the session is created at that
transition (same trigger point as digital-delivery-link reveal). For
`booth_cash`, the session and its order are created together by the
Staff Panel's "Start session" action.

### New table: `gacha_draws`

| Column | Type | Notes |
|---|---|---|
| `id` | int, PK | |
| `session_id` | int, FK → `gacha_sessions.id`, not null | |
| `gacha_prize_id` | int, FK → `gacha_prizes.id`, not null | |
| `drawn_at` | timestamp, not null | |

One row per real pull. This is the source of truth for a session's
"drops" list and claim summary. Practice draws are **not** persisted
here at all (see Anti-cheat/isolation below) — they're computed and
returned in the response only.

### `orders` / `order_items`

- `orders.fulfillment_method` gains `'booth'` for booth-cash sessions —
  skips address/shipping entirely (distinct from `'pickup'`, which drags
  in pickup-location/QR copy that doesn't apply to an on-the-spot
  festival handover).
- Online gacha orders use the normal `'ship'`/`'pickup'` fulfillment
  values and go through the existing address/checkout flow exactly like
  a physical product order.
- Each `gacha_draws` row, once written, immediately inserts a matching
  `order_items` row (snapshotted: `product_name_snapshot` = prize name,
  `image_url_snapshot` = prize image, `unit_price_snapshot` =
  `display_price`, `qty` = 1, `product_variant_id` = null — same
  established pattern as the free gift's null-variant snapshot row).
  This is what makes drops show up automatically in the admin order
  detail, shipping export, and pickup/prep roster with zero new render
  paths.
- An order created for a gacha product starts with **no** `order_items`
  until draws happen — order detail/shipping views need a distinct
  "not yet drawn" state (see Edge cases) rather than treating zero items
  as an error.

## Odds & draw algorithm

- Weight of a prize = `quantity_remaining`. Odds = weight ÷ sum of all
  prizes' `quantity_remaining` for that product. If total remaining
  reaches 0, the product is sold out: no further turns can be purchased
  online, and the Staff Panel refuses to start a new booth session.
- A draw is a transaction: `SELECT ... FOR UPDATE` over the product's
  `gacha_prizes` rows (ascending id, matching the existing stock-lock
  ordering convention) → weighted-random pick using server-side
  crypto-quality randomness → decrement the winner's
  `quantity_remaining` → increment the session's `turns_used` → insert
  the `gacha_draws` row and its `order_items` row → if
  `turns_used == turns_total`, transition the order (online: continues
  through the normal `confirmed → shipped → completed` lifecycle once
  packed by admin; booth-cash: transitions straight to `completed`).
  All of this happens in one DB transaction, same discipline as
  `createOrder`'s existing stock-reservation code.
- Practice draws use a **separate, non-transactional function** that
  computes the same weighted pick against a read-only snapshot of
  current odds, but never opens a write transaction, never touches
  `gacha_prizes.quantity_remaining`, and never writes a `gacha_draws` or
  `order_items` row.

## Purchase flow: online

1. Buyer adds N of the gacha product's hidden "1 turn" variant to cart
   (product page shows a turn-count stepper instead of a variant picker,
   same UI shape as a digital product's simple add-to-cart). Checkout
   proceeds exactly as today — payment method, address (ship or pickup,
   COD excluded, same reasoning as digital: nothing to hand over on
   delivery until the draw happens and something physical exists to
   ship), payment proof, PIN-gated order page.
2. On the order transitioning to `confirmed` (admin verifies payment,
   same trigger as every other confirmation), a `gacha_session`
   (`source: 'online'`, `turns_total` = the ordered quantity) is created.
3. The buyer's order page shows a "Open your case" section once the
   session exists — same `GachaMachine` UI component as the booth kiosk
   and practice mode, gated behind the existing order-access PIN/session
   check (no new auth mechanism). Each spin calls the real draw
   endpoint; drops accumulate into the order's item list live.
4. Once fully drawn, the order now has real `order_items` (the drawn
   prizes) and proceeds through the **existing** ship pipeline —
   admin packs and ships/hands over at pickup exactly like any physical
   order, no gacha-specific admin shipping work needed.

## Purchase flow: booth cash

1. Staff opens the kiosk route for a specific gacha product (admin JWT
   required — logged in once for the day on the booth tablet).
2. Staff Panel screen (ported from the mockup): optional buyer name,
   turn-count stepper + presets (+5/+10/+20/+50), "Start session" —
   creates the order (`payment_method: 'cash'`, `status: 'confirmed'`
   immediately since staff already collected payment in person,
   `fulfillment_method: 'booth'`, no address) and its `gacha_session`
   (`source: 'booth_cash'`) together, in one transaction.
3. Tablet is handed to the buyer: reel, spin button, reveal modal,
   running drops list — identical component to the online/practice
   paths. Draws call the same real draw endpoint; ownership check here
   is "caller holds a valid admin JWT for this session's product,"
   since the buyer has no independent credential on this device.
4. Once fully drawn, the order auto-completes (handed over on the spot);
   session summary screen shows the drops + "show this to staff" (staff
   is already standing there — this screen mainly gives the buyer a
   take-away view). Staff taps "Next buyer" to return to the Staff
   Panel.

## Practice mode

- Public route per gacha product (e.g. linked from its shop listing),
  no authentication.
- Renders the same `GachaMachine` component with `source: 'practice'`:
  real prize list, images, tiers, and current live odds (so it feels
  authentic and doubles as an odds/catalog preview), but every draw uses
  the non-transactional practice pick function described above —
  unlimited spins, no payment, no turns tracked, no order, no session
  row, no stock effect.
- "Spin again" loop with no session end — the buyer just closes the
  page when done browsing.

## Admin prize editor

- New section on the gacha product's edit screen, visually matching the
  existing variant editor (`AdminVariants.jsx`): table of prize rows
  (photo, name, tier, quantity, display price), add/remove/reorder
  (same natural-sort + manual up/down convention as the photocard
  variant editor), batch-image upload (filename → name, same convention
  as batch variant upload).
- Editable at any time per the scope decision above; the save path
  validates `quantity_total >= quantity_total_old - quantity_remaining`
  (i.e. never below lifetime-drawn count) per prize, rejecting the whole
  save with a clear per-row error otherwise — mirrors the existing
  variant-in-use delete guard's philosophy of protecting already-committed
  history.

## Anti-cheat / security threat model

- **Server-authoritative draw, always.** The draw endpoint picks the
  winning prize server-side (crypto-quality RNG, never client-supplied
  or client-seedable) inside the same row-locked transaction as the
  stock decrement described above. The client never sends "I won X" —
  it receives the server's chosen prize in the response and plays the
  reel animation toward it. No code path trusts a client-reported
  result.
- **Turn accounting is atomic.** `turns_used < turns_total` is checked
  and incremented inside the same transaction as the pick/decrement —
  never a separate check-then-act round trip a client could race.
- **Ownership per path.** Online draws go through the same
  PIN/session-token/admin-bypass gate every other buyer-order route
  already uses. Booth draws require a valid admin JWT (the kiosk
  device's session) — accepted as reusing the full admin session per
  the scope decision above, not a narrower token.
- **Idempotent draw requests.** A network retry or double-tap on the
  spin button must not consume two turns for one spin — same
  request-key/idempotency pattern `createOrder` already uses, scoped
  per draw attempt (client generates a per-tap key; a retried request
  with the same key returns the original result instead of drawing
  again).
- **Dedicated rate limit** on the draw endpoint (same
  Redis-backed-limiter family as every other action limiter in
  `server.js`) to blunt scripted rapid-fire probing for timing/race
  windows.
- **Practice mode is a structurally separate function**, not a flag
  branch inside the real draw path — this makes it provably incapable of
  touching `quantity_remaining` or writing `gacha_draws`/`order_items`
  rows, rather than relying on every future edit to remember to check
  the flag.
- **Odds transparency is not a cheat vector.** Showing exact live
  odds/remaining stock publicly (as designed, matching the mockup's
  "what's in the case" panel) doesn't let anyone influence the outcome —
  the pick is still server-random within those odds regardless of who's
  watching them.
- **Kiosk device risk is accepted, not solved in software**: the booth
  tablet is a physically-exposed admin credential for the festival's
  duration. Mitigation is operational (staff supervises the device), not
  a v1 code change — explicitly decided over building a scoped-down
  booth-device token.

## Edge cases

- **Order with zero draws yet** (online buyer paid but hasn't opened
  their case, or a booth session was started but the tablet was handed
  over before any tap): order detail/shipping/roster views must render
  a distinct "not yet drawn" state, not treat an empty item list as
  broken data.
- **Abandoned online session**: buyer pays, confirms, never opens the
  case. Turns remain owed indefinitely — admin order list flags
  "incomplete session" (turns_used < turns_total) so this is visible
  rather than silently stuck.
- **Interrupted booth session** (staff force-closes, tablet reloads,
  browser crash mid-spin): on reload, the session resumes from its
  persisted `turns_used` — the server-side session row is the sole
  source of truth, never client state, so no turns are lost or
  double-granted.
- **Pool sold out mid-purchase**: total `quantity_remaining` across a
  product's prizes hits 0 — product shows sold-out on the storefront
  (can't add more turns to cart), and the Staff Panel refuses "Start
  session" for that product.
- **Delete guard**: a gacha product/prize can't be deleted while any
  `gacha_sessions` row referencing it is `active`, extending the
  existing `LIVE_ORDER_STATUSES` delete-guard philosophy already used
  for variants/collections.
- **Mid-session prize edit**: seller adds/restocks a prize while a
  session is `active` — the next draw in that (or any other concurrent)
  session immediately sees the updated pool, since odds are live and
  recomputed per-draw, not cached per-session.

## Testing plan

- **Backend**: concurrency test proving two simultaneous draws can't
  both win the last unit of a prize (row-lock correctness); odds-math
  unit tests (weight → probability, tier aggregation for display);
  order-lifecycle tests for both purchase paths mirroring existing
  `orderRepo.test.js` conventions (online: confirm → session created →
  draws → ship pipeline; booth-cash: start → draws → auto-complete);
  practice-mode isolation test asserting zero stock/order/session side
  effects across many draws; idempotent-draw-request test; delete-guard
  test for a product/prize with an active session.
- **Frontend**: `GachaMachine` component tests (draw-triggering logic
  and state transitions, not pixel-perfect animation timing); Staff
  Panel start-session flow; order-page gacha section gating (only
  renders once the session exists / order is `confirmed`); practice page
  renders and spins with no network calls beyond the practice-draw
  endpoint.

## Out of scope (explicitly deferred)

- Buy-online-redeem-at-booth flow (claim codes) — dropped once online
  sessions were scoped to draw-and-ship instead.
- Scoped-down "booth device" JWT — kiosk reuses the full admin session.
- Multiple simultaneous active gacha "campaigns" sharing one prize pool
  across different collections — each gacha product owns its own
  independent pool.
- Any cross-product prize pool sharing or prize transfer between gacha
  products.
