# Gacha anti-cheat reference

A living reference for every protection that keeps a gacha draw fair and un-gameable,
covering both the **online** (buyer, ship-fulfilled) and **booth-cash** (kiosk, staff-run)
paths. Update this file whenever the draw/session/pricing code changes - it should always
reflect what's actually in the code, not what the original design intended.

Source of truth for the original design rationale: `docs/superpowers/specs/2026-09-20-gacha-product-design.md`
(section 8, "Anti-cheat / security threat model"). This file is the up-to-date, code-verified
companion to that spec.

## The core invariant: the client never decides the prize

The winning prize is chosen exclusively inside `drawForSession()`
(`backend/shop/gacha/sessionRepo.js`), via `weightedPick()` (`backend/shop/gacha/domain.js`),
which uses `crypto.randomInt` weighted by each prize's live `quantity_remaining` - never a
client-supplied value, never `Math.random()` (client-seedable/predictable), never anything
sent in the request body.

The frontend (`frontend/src/shop/gacha/GachaMachine.jsx`) only ever *displays* whatever
`prize` field the server's draw response contains. There is no code path - online, booth, or
practice - where a client value influences which prize is picked. `buildReel()` fills the
reel's non-winning filler cells with random *display* picks; the one cell that matters (the
winner) is always the server's answer, inserted verbatim.

The pick + decrement (`UPDATE gacha_prizes SET quantity_remaining = quantity_remaining - 1`)
+ record (`INSERT INTO gacha_draws`) all happen inside one DB transaction with the prize rows
locked `FOR UPDATE`, so two concurrent draws can never both win the same last unit of a prize.

## Can't roll on someone else's session

- **Buyer route** (`POST /:token/gacha-session/draw`, `backend/routes/orders.js`): gated by
  `orderAccess` middleware (`backend/shop/orders/orderAccess.js`) - requires either an admin
  JWT or a JWT scoped to that exact `order_token` (issued only after a correct PIN, or
  auto-seeded in the buyer's own browser tab right after checkout). Anything else is a 401
  `pin_required`.
- Even with a valid token for *some* order, the route resolves the session id server-side
  from that order and calls `drawForSession(session.id, { drawKey, ownerOrderId: order.id })`.
  Inside the transaction, `ownerOrderId` is re-asserted against `session.order_id` - a
  mismatch reports `GachaSessionNotFoundError` ("not found"), not "wrong owner", so session ids
  stay non-enumerable.
- **Booth/kiosk route** (`POST /api/admin/gacha-sessions/:sessionId/draw`, `backend/routes/adminGacha.js`):
  behind the admin `auth` JWT middleware, and additionally calls `drawForSession` with
  `requireSource: 'booth_cash'`. A booth-authenticated caller can never touch an online
  buyer's session (session.source !== 'booth_cash' → "not found"), and vice versa - the two
  draw surfaces are mutually walled off even though both ultimately call the same function.

## Can't get more turns than were paid for

- `turnsTotal` is never client input at draw time. For online orders,
  `startOnlineSessionIfNeeded()` sums the *paid* `order_items` qty for that order into
  `gacha_sessions.turns_total` once, right after the order is confirmed - it never changes
  afterward. For booth orders, `startBoothSession()` fixes `turns_total` at session creation
  from the staff-entered count, and the order's `total` is `product.price * turnsTotal`
  computed server-side from the catalog price, never a client-submitted price.
- `drawForSession` refuses once `turns_used >= turns_total` (`GachaSessionCompleteError`).
- `drawForSession` refuses entirely if the order was cancelled in the meantime
  (`GachaOrderCancelledError`), checked under the same row lock - an admin cancelling an order
  mid-session can't be raced by a queued draw.
- A cart can never mix a gacha item with anything else, including a second gacha product or a
  second variant of the same one (`MixedGachaCartError` in `createOrder`,
  `backend/shop/orders/orderRepo.js`) - this is also what guarantees `startOnlineSessionIfNeeded`
  always sums exactly one gacha product's turns, never accidentally combines two.
- COD is rejected for any cart containing a gacha item (`NoCodForGachaError`) - a turn is
  consumed the moment the order is confirmed, so there's never a doorstep at which to collect
  payment after the fact.
- A gacha product an admin has marked `gacha_booth_only` is rejected by `createOrder` the
  same way an unknown variant_id is - it reuses `VariantNotFoundError` verbatim, never a
  distinguishing message, so a booth-only product can't be told apart from a nonexistent one
  by probing. It's also excluded from `getPublicCollectionBySlug`'s response entirely, but
  that's a UI convenience, not the actual boundary - "hidden from the UI" is never treated as
  a security control on its own in this codebase.

## Retries can't mint extra turns (idempotency)

A draw is idempotent via `drawKey` / `gacha_sessions.last_draw_key`: if the incoming `drawKey`
matches the session's stored one, `drawForSession` replays the original recorded result
instead of drawing again. The key is generated and owned by `GachaMachine` itself (one key per
spin *cycle*, not per network attempt) - a manual retry after a dropped response, or React
batching three rapid clicks, reuses the same key rather than minting a fresh one per attempt.
This was a real bug caught in the original security audit (the initial implementation
regenerated the key per attempt, defeating replay protection) - see git history for
`pendingDrawKey` in `GachaMachine.jsx`.

## Rate limiting

Configured in `backend/server.js`, all keyed per-IP, `skipFailedRequests: true` (a rejected
request never burns the budget, since a booth tablet and every attendee's phone can share one
NAT IP on venue wifi):

| Route | Limiter | Cap |
|---|---|---|
| Real draw (buyer `POST /:token/gacha-session/draw` and admin `POST /gacha-sessions/:id/draw`) | `gachaDrawLimiter` | 60/min |
| Booth session start (`POST /gacha-products/:id/booth-sessions`) | `gachaBoothSessionLimiter` | 30/min |
| Practice draw (`POST /gacha/:id/practice-draw`, public, unauthenticated) | `gachaPracticeLimiter` | 30/min |

## Practice mode is structurally incapable of cheating anything

`practiceDraw()` (`backend/shop/gacha/sessionRepo.js`) has no transaction and no write
statement at all - it is provably incapable of touching `quantity_remaining` or writing a
`gacha_draws`/`order_items` row, rather than relying on an `if (isPractice)` flag somewhere
deep in the real draw path that a future edit could forget. It's public and unauthenticated by
design (rate-limited instead), since it costs no real stock.

## Prize/quantity edits can't retroactively rewrite history

`replacePrizes()` (`backend/shop/gacha/prizeRepo.js`) treats `quantity_total - quantity_remaining`
(the lifetime drawn count) as immutable: an admin can't set a prize's `quantity_total` below
what's already been drawn, and can't delete a prize that has any draws against it
(`GachaPrizeQuantityError`). A prize pool can be edited live during an event without being able
to erase or shrink what's already been legitimately won.

## Accepted, documented risk: pool oversell under concurrency

`createOrder` *checks* the prize pool (`SUM(quantity_remaining) >= requested turns`) but does
not *reserve* it - two buyers can both pass that check against the same remaining quantity,
both pay, and whoever draws first drains the pool, leaving the other's paid order momentarily
unable to complete its last turn(s) (`GachaSoldOutError` mid-session).

This can't lose money or let anyone steal a prize - it surfaces immediately and is
staff-recoverable (refund or restock), never silent:

- `listOrders`' `has_incomplete_gacha_session` flag (an `EXISTS` against `gacha_sessions` with
  `status = 'active'`) puts exactly this order in front of staff on the admin order list.
- The admin orders page can also be filtered to `fulfillment_method = booth` or by status to
  find these quickly.

**Deliberately not closed for v1.** A real fix needs actual reservation state on
`gacha_prizes` plus a release path on every cancel/expiry (mirroring `stock_reserved` for
ordinary variants). A cheaper derived alternative - subtracting the outstanding turns on
`order_items` belonging to this product's live-status orders - was evaluated and rejected: it
would take a locking read over `orders`/`order_items` *before* the `gacha_prizes FOR UPDATE`
inside `createOrder`, while a *draw* takes `gacha_prizes FOR UPDATE` and only then inserts into
`order_items` - the two paths would approach the same pair of tables in opposite lock orders,
a real deadlock cycle, not just a lock-ordering nitpick. Not worth introducing that hazard to
close a race whose failure mode is already visible and recoverable, for a festival whose pool
is sized well above a day's expected sales.

## What is NOT a security control (by design)

- The kiosk's `MAX_TURNS = 200` UI cap (`frontend/src/pages/GachaKiosk.jsx`) is a convenience
  default only. `startBoothSession` has no matching server-side ceiling on `turnsTotal` beyond
  "positive integer" - but it doesn't need one, because `startBoothSession` already rejects any
  `turnsTotal` exceeding the real live prize pool (`GachaSoldOutError`). The physical pool size
  is the real ceiling.
- The claim code shown on the booth summary screen (`generateClaimCode()` in `GachaMachine.jsx`)
  is decorative flavor text for the staff-handover moment, not a real access token - nothing
  server-side ever validates it.
- The client-generated `drawKey` doesn't need to be cryptographically unguessable - it's a
  replay-dedup token checked against session state (`last_draw_key`), not a secret credential.
