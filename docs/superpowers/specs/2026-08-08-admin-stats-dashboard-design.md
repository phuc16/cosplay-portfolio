# Admin Statistics Dashboard (Phase 4) — Design

## Context

Phases 1–3 built the merch shop: catalog, cart/checkout/orders, and
payments/email/QR/backups. The seller now runs drops and takes real money, but
has no way to see how a drop performed, what to make more of, or what actually
landed in each account.

This phase adds a read-only statistics dashboard to the admin panel. It reads
data the shop already records — no new order fields, no changes to the order
lifecycle.

## Purpose

The dashboard serves three decisions the seller actually makes:

1. **How did this drop go?** — a per-collection retrospective after a drop closes.
2. **What should I restock or stop making?** — per-variant sales velocity.
3. **Bookkeeping** — reconciling what came in against bank, Momo, and PayPal.

Deliberately **not** a purpose: long-term business trend lines. This shop sells
in discrete drops, and drop-level insight is what drives decisions here.

## Money Definitions

These are the most important definitions in the spec. A bookkeeping number that
is silently wrong is worse than no number at all.

**Received** — money genuinely in hand:
- Prepaid orders (`bank`, `momo`, `paypal`) with status `confirmed`, `shipped`, or `completed`
- COD orders with status `completed` only (cash changes hands at handover)

**Outstanding** — split in two, because they carry different risk:
- *Awaiting payment* (`chờ thanh toán`): prepaid orders still `pending`. Speculative — may expire.
- *To collect on handover* (`thu khi giao`): COD orders at `confirmed` or `shipped`. Committed, but not yet yours.

**Lost** — `cancelled` orders (including expiry-swept ones). Excluded from
Received and Outstanding, reported separately because drop retrospectives care
about it.

**Received is broken down by payment method.** Bank, Momo, and PayPal balances
are separate real-world accounts reconciled independently; a single merged
figure cannot be checked against anything.

**`shipping_fee` is a cost, never income.** Per the Phase 1–3 spec, the order
total is merch only and shipping is settled with the shipper. `orders.shipping_fee`
records what the seller paid, and the dashboard presents it as a recorded cost.

**All money is integer VND.** No floats anywhere, consistent with the rest of
the codebase (`vietqr.js` already rejects non-integers).

## Views

One new admin tab, **"Thống kê"**, containing three views.

### 1. Drop view (select a collection)

- Received / Outstanding (both kinds) / Lost
- Order counts by status
- Total units sold
- **Expiry rate** — expired prepaid orders ÷ *all* prepaid orders in this
  collection (COD orders never expire and are excluded from both sides). A
  genuine drop-health signal: pricing too high, payment window too short, or
  griefing.

  An order counts as expired when `status = 'cancelled'` **and**
  `expires_at IS NOT NULL` **and** `cancelled_at >= expires_at`. An admin who
  manually cancels an already-overdue order is indistinguishable from the sweep
  and will be counted as expired; this is accepted rather than adding a
  `cancel_reason` column to the order lifecycle for a single statistic.
- Ship vs pickup mix
- Per-variant table: units sold, remaining, sell-through %, time-to-sellout

### 2. Restock view

Per-variant across drops, sorted by sales velocity.

**Velocity is defined as units sold ÷ days the variant has been on sale**, where
days-on-sale runs from the collection's `created_at` to either the moment the
variant hit zero remaining (its last sale) or now, whichever comes first. This
gives one comparable number for both sold-out and still-available variants;
time-to-sellout alone would be undefined for everything that never sold out.

- High velocity, sold out → make more
- Zero or near-zero sales → stop printing

**Known limitation, stated on the page:** once a variant sells out, demand
beyond that point is invisible — nobody could place an order. Time-to-sellout is
the best available proxy, not true demand.

### 3. Bookkeeping view (select a date range)

- Received / Outstanding across all collections
- Received split by payment method
- Recorded shipping costs
- CSV export

## Architecture

Live aggregate SQL queries. No rollup tables, no derived summary state.

Rejected alternatives:
- **Rollup table updated on order transitions** — would require writing summary
  state inside or alongside `transitionOrder`, the function this project has
  already fixed three concurrency bugs in. Rollup tables drift when any edge case
  is missed, and silent drift in a money figure is the worst possible failure
  here. Unjustifiable at this data volume.
- **Fetch rows and aggregate in JavaScript** — pulls every order into memory on a
  2GB droplet and degrades as drops accumulate.

**No caching.** These `GROUP BY` queries run in milliseconds against hundreds to
low thousands of orders, and the existing indexes cover the access paths. A cache
would introduce staleness — confirm a payment, refresh, see an unchanged number —
which is a far worse failure for a reconciliation tool than a 40ms query.
Caching can be added later if it ever measurably matters.

### Files

**Backend**
- `backend/shop/stats/money.js` — received/outstanding/lost classification as
  **pure functions** over `(status, payment_method)`. Isolated from SQL because
  this is the rule most likely to be wrong or to change, and it must be testable
  exhaustively.
- `backend/shop/stats/statsRepo.js` — aggregate queries, one function per view,
  each independently testable. Raw mysql2 pool, CommonJS, matching every other
  repo in this codebase.
- `backend/shop/stats/csv.js` — pure CSV serialization (escaping commas, quotes,
  newlines, Vietnamese diacritics).
- `backend/routes/adminStats.js` — routes behind the same `auth` middleware as
  every other admin route. CSV is generated **server-side** so the export is
  guaranteed identical to what is displayed.

**Frontend**
- `frontend/src/components/AdminStats.jsx` — tab shell
- `frontend/src/components/stats/StatsDrop.jsx`
- `frontend/src/components/stats/StatsRestock.jsx`
- `frontend/src/components/stats/StatsBookkeeping.jsx`
- New "Thống kê" tab in `frontend/src/pages/Admin.jsx`
- API calls appended to `frontend/src/api/shop.js`

Split by view rather than one large file, per this project's preference for
focused files.

**Language:** hardcoded Vietnamese, matching the existing admin convention. The
admin panel has never used the i18n system; only buyer-facing UI is bilingual.

## Edge Cases

**Timezone.** `created_at` is stored UTC; the seller is in Asia/Ho_Chi_Minh
(UTC+7). Date ranges are interpreted in **Asia/Ho_Chi_Minh**, so "August" means
the seller's August. Interpreting ranges in UTC would misfile every order placed
between midnight and 7am, and would push orders across month boundaries — a
direct bookkeeping error.

**Unlimited variants.** `stock_qty IS NULL` means unlimited. Sell-through is
meaningless there — displayed as "không giới hạn", never 0% and never a division
by null.

**Deleted variants.** Plan 3's guard blocks deleting a variant with *live*
orders, but not one whose orders have all completed. Variants with sales history
and no stock row therefore exist. Revenue still resolves from `order_items`
snapshots (`product_name_snapshot`, `variant_label_snapshot`,
`unit_price_snapshot`). Remaining stock displays as "—", not 0, which would
falsely read as sold out.

**Orders with no collection.** `orders.collection_id` is nullable. These get an
explicit "không thuộc bộ sưu tập" bucket. Without it, per-drop figures would
silently fail to sum to the bookkeeping total — exactly the kind of unexplained
discrepancy that destroys trust in a financial dashboard.

**Sell-through honesty.** Original stock is not recorded historically —
`stock_qty` is *current* remaining, and the admin can edit it mid-drop via
`replaceVariants`. Sell-through is therefore computed as
`sold ÷ (sold + remaining)`, presented with a note that a mid-drop restock shifts
it. Time-to-sellout is shown only when remaining is currently 0. A caveated
number beats a confidently wrong one.

**Empty states.** A collection with no orders, and a date range with no orders,
both render as explicit zero states rather than blank panels or errors.

## Error Handling

- A failed stats query returns a clean JSON error and renders an error state in
  the view; it never blanks the whole admin panel.
- Malformed date ranges are rejected with a clear message rather than silently
  returning everything, matching how `date_from`/`date_to` already behave on the
  admin orders list.
- This is a **read-only** feature. No stats code path writes to any table, so a
  bug here cannot corrupt orders, stock, or money.

## Testing

- **Money classifier**: exhaustive `status × payment_method` matrix, every
  combination explicitly asserted. This is the highest-value test in the phase.
- **Reconciliation**: per-collection sums plus the no-collection bucket equal the
  bookkeeping total for the same range. Proves the views cannot disagree.
- **Timezone boundaries**: orders placed just before and after local midnight
  land in the correct day and month.
- **CSV**: commas, quotes, and Vietnamese diacritics in product names survive a
  round trip.
- **Edge cases**: unlimited variants, deleted variants, null collection, empty
  ranges.

Backend tests use Vitest 3 ESM `import`; implementation files stay CommonJS.

## Out of Scope

- Long-term trend charts and time-series graphs
- Profit/margin calculation (cost of goods is not recorded anywhere)
- Buyer-level analytics or repeat-customer tracking
- Real-time/live-updating figures
- Phase 5 (ViettelPost automation and its shipping-oriented export) and Phase 6
  (buyer onboarding guide)
