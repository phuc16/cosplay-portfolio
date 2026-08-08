# Merch Shop — Plan 4 Test Strategy: Admin Statistics Dashboard

Covers `2026-08-08-merch-shop-4-stats.md` only. Builds on, and does not repeat, `2026-08-07-merch-shop-test-strategy.md` (Plans 1–3) — read that first for the risk-weighting philosophy, environments, and regression-suite conventions this document assumes.

This phase is entirely **read-only**: no stats code path writes to `orders`, `order_items`, `product_variants`, or any other table. That single fact caps the ceiling of every risk below at "the seller sees a wrong number," never "the seller's data is corrupted" — which is exactly why the effort here goes almost entirely into proving the numbers are right, rather than into transactional safety, which Plans 1–3 already own.

---

## 1. Risk register

| # | Risk | Consequence | Severity | Primary defense |
|---|---|---|---|---|
| S1 | Wrong money classification for a (status, payment_method) combination | Seller believes money is in hand that isn't, or vice versa — a wrong number that *looks authoritative* is worse than no number | **High** | Exhaustive 20-case unit matrix on `money.js` (blocking) |
| S2 | Views disagree with each other (drop sums ≠ bookkeeping total) | Seller loses trust in the whole dashboard the moment two screens contradict each other | **High** | Reconciliation test cross-checking independently-computed per-collection sums (blocking) |
| S3 | Timezone misfiling — an order lands in the wrong local day/month | Bookkeeping figure is wrong for a boundary date, silently | **High** | Explicit before/after-midnight boundary tests against Asia/Ho_Chi_Minh |
| S4 | Deleted-variant sales lost or merged with an unrelated deleted variant | Revenue undercounted, or two products' sales history conflated | Medium | `GROUP BY` including snapshot columns, dedicated test |
| S5 | Unlimited variant shows a misleading 0% sell-through or a stock number | Seller makes a restock decision off a number that means nothing | Medium | Explicit `unlimited` flag, tested at both repo and component level |
| S6 | CSV export disagrees with the on-screen numbers | Seller reconciles a bank statement against a wrong figure | **High** | CSV built server-side from the *same* `BookkeepingStats` object the JSON endpoint returns; API test asserts both come from one call |
| S7 | CSV corrupts Vietnamese diacritics, or a comma in a name breaks column alignment | Exported file is unusable or misleading in Excel | Medium | RFC 4180 escaping + BOM, explicit diacritics/comma/quote round-trip test |
| S8 | Admin stats endpoints reachable without auth | Buyer sees the seller's revenue and payment-method breakdown | **High** | 401/403 test on every new route |
| S9 | Malformed or backwards date range silently returns unbounded or wrong data | A "this week" query quietly becomes "all time," inflating every figure | Medium | `InvalidRangeError`, explicit 400 test on both JSON and CSV endpoints |
| S10 | Expiry rate denominator includes COD orders, understating the real rate | Seller misreads drop health (COD never expires, and including it as a "successful" non-expired order dilutes the rate) | Medium | Dedicated test excluding COD from both numerator and denominator |
| S11 | A stats query error blanks the whole admin panel | Seller locked out of Đơn hàng/Thanh toán/Email tabs by an unrelated stats bug | Medium | Per-view error state, not a page-level throw; component test for the error path |
| S12 | Slow query on a growing orders table | Dashboard becomes unusable as drops accumulate | Low | Scoped `WHERE` clauses on indexed columns (`collection_id`, `created_at`); revisit if it ever measurably matters, per spec's explicit no-caching rationale |

Risks S1, S2, S3, S6, S8 get coverage at multiple levels and are called out as blocking in the verification checklist. Everything else gets single-level coverage proportional to its severity.

---

## 2. Test levels

### L1 — Unit

Pure logic, no I/O. Vitest, `backend/tests/*.test.js`.

**Scope:**
- `money.js` — `isPrepaid`, the full 20-case `classify` matrix, `isExpired` boundary cases (exactly-at-deadline, before, after, non-cancelled status, missing timestamps). **This is the single highest-value test file in the phase.**
- `csv.js` — escaping (comma, quote, newline, null/undefined), BOM presence, `bookkeepingToCsv` header/row/total shape, a full round-trip of a name containing a comma, a quote, and diacritics together.
- `statsRepo.parseLocalDateRange` — missing date, unparsable date, backwards range, and the exact UTC instant a local day boundary resolves to (asserted as a literal ISO string, not just "no throw").

### L2 — Integration

A module against the real `cosplay_test` MySQL schema. Vitest, same tooling and isolation as Plans 1–3 (`resetTables` before every test).

**Scope:**
- `statsRepo.getDropStats` — money buckets over real orders created through `orderRepo.createOrder`/`transitionOrder` (never hand-inserted rows, except where a test needs to force a specific `expires_at`/`cancelled_at`/`created_at` — those three columns have no other way to backdate them for a test), order counts, units sold excluding cancelled, expiry rate, fulfillment mix, per-variant table including unlimited and deleted-variant rows.
- `statsRepo.getRestockStats` — velocity for a sold-out variant (days to last sale) vs. a still-selling one (days to now), unlimited-variant velocity without sell-through, exclusion of deleted variants and cancelled-order quantity, descending sort.
- `statsRepo.getBookkeepingStats` — timezone boundary tests (an order 5 minutes after local midnight vs. 5 minutes before), received-by-method split, shipping cost as a cost not income, the explicit no-collection bucket, an empty-range zero state.
- **The reconciliation test** (§4) — its own subsection below; this is not an ordinary integration test.

### L3 — Component

Frontend, Vitest + `react-dom`'s `createRoot`/`act` (this codebase does not use Testing Library's render helpers — see `AdminOrders.test.jsx` for the established pattern; stats components' tests follow it exactly).

**Scope:**
- `AdminStats` — view switcher, defaults to drop view, switches on click.
- `StatsDrop` — collection picker gating the fetch, unlimited/deleted-variant display rules, per-view error state on a rejected fetch.
- `StatsRestock` — empty state, row order matches API order, unlimited-variant display.
- `StatsBookkeeping` — load-on-click, empty-range state, CSV download invoked with the exact date params on screen.

### L4 — API contract

Supertest against the exported Express `app`. `backend/tests/adminStatsRoutes.test.js`.

**Scope:** auth required on all four routes (401 no token, 403 bad token); 404 on an unknown collection; 400 on a malformed/backwards bookkeeping range on **both** the JSON and CSV endpoints; CSV response headers (`Content-Type: text/csv`, `Content-Disposition: attachment`) and body content matching the JSON view for the same request.

### L5 — End-to-end / acceptance

Manual, scripted by `2026-08-08-merch-shop-4-verification.md`. No new automated E2E — same rationale as Plans 1–3 (Playwright is a heavy dependency for a solo-maintained project; L1–L4 plus scripted manual acceptance already cover the critical paths).

**Journeys:**
1. Seller runs a drop, confirms some orders, cancels one, lets one expire → opens Thống kê → Theo đợt bán → numbers match a hand-computed fixture.
2. Seller checks Restock after two drops with different sell-through → makes a restock/stop-printing call from the ranked table.
3. Seller picks a date range spanning month-end → Sổ quỹ shows figures that reconcile against a manual sum of the admin Đơn hàng list filtered to the same range → exports CSV → opens it in a spreadsheet app → diacritics and commas render correctly.

### L6 — Non-functional

| Area | Method |
|---|---|
| **Security** | Auth probes on all four routes; confirm no stats route returns buyer PII beyond what Đơn hàng already exposes |
| **Data integrity** | Confirm a stats query never issues an `UPDATE`/`INSERT`/`DELETE` — grep the three new backend files for write verbs as a sanity check before sign-off |
| **Performance** | `getBookkeepingStats` and `getRestockStats` timed against a seeded few-hundred-order table; confirm no N+1 (both do exactly two or three queries total, not one per row) |
| **Resilience** | Stop MySQL, hit each stats endpoint → clean `500` JSON, not a hang or a crash; per Global Constraints, other admin tabs stay usable |

---

## 3. What this plan must prove before shipping

- `money.js`'s classification is correct for **every** `(status, payment_method)` combination, not just the common ones.
- The three views cannot disagree: a per-collection sum from the bookkeeping view's `by_collection` matches an independent call to `getDropStats` for the same collection and range.
- A date range is interpreted in the seller's local day, not UTC, at both boundaries (just after midnight, just before midnight).
- Unlimited variants never show a stock number or a computed percentage; deleted variants never show `0` where they mean "unknown."
- The CSV a seller downloads contains exactly the numbers the screen showed, and survives real Vietnamese product names.
- No stats endpoint is reachable without the same auth every other admin route requires.
- A stats query failure degrades to an error message inside that one view, never a blank admin panel.

---

## 4. The two highest-value tests — both blocking

### 4.1 Exhaustive money-classifier matrix (`backend/tests/statsMoney.test.js`)

All 5 statuses × 4 payment methods = 20 combinations, each asserted individually against the table in the spec's Money Definitions section (reproduced as a comment in `money.js` itself, so the code and the test can be diffed against the same table by eye). A test asserting `CASES.length === 20` guards against someone "helpfully" trimming the matrix down to "the interesting cases" in a future edit — with a pure classifier this cheap to test, there is no excuse for a gap.

**Any failure here is a Blocker per §11** (money classified into the wrong bucket, in a phase whose entire purpose is showing the seller correct money).

### 4.2 Cross-view reconciliation (`backend/tests/statsRepoBookkeeping.test.js`)

Seeds two collections with a mix of prepaid-confirmed, COD-confirmed, and prepaid-pending orders, then asserts:

1. `getBookkeepingStats(range).by_collection` contains one entry per collection whose four money fields (`received_total`, `awaiting_payment`, `to_collect`, `lost`) **exactly equal** the corresponding fields from an independent call to `getDropStats(collectionId)` for the same collection.
2. Summing `by_collection` across all entries reproduces the bookkeeping view's own top-level totals.

This deliberately exercises **two independently written aggregation code paths** (`getDropStats`'s per-order loop and `getBookkeepingStats`'s per-order loop) computing the same underlying orders and checks they agree — not merely that a single object is internally consistent with itself. A regression here means the dashboard can show two different "truths" for the same drop, which is the failure mode most likely to make a seller stop trusting the feature entirely.

**Any failure here is a Blocker per §11.**

---

## 5. Test data

- Same conventions as Plans 1–3: `resetTables("order_items", "orders", "product_variants", "products", "collections")` before every test that touches orders; no test depends on another's leftovers.
- Orders are created through `orderRepo.createOrder` / `transitionOrder` wherever the test doesn't specifically need to control a timestamp column those functions manage internally (`created_at`, `expires_at`, `cancelled_at`) — those three are set with a direct `UPDATE` after creation, matching the pattern already used in `backend/tests/expirySweep.test.js`.
- Timezone tests use literal UTC ISO strings chosen so the ±7-hour local conversion crosses a real local-day boundary (e.g. `2026-07-31T17:05:00Z` = `2026-08-01T00:05:00+07:00`), with the exact arithmetic spelled out in a code comment so a reviewer can verify it without running the test.
- Restock velocity tests backdate `collections.created_at` directly, since velocity depends on wall-clock elapsed time and a test cannot wait days for a realistic value.
- Realistic fixtures (Vietnamese names, `35.000₫`–`350.000₫` price range) are reused from Plans 1–3's factories where a test doesn't need a specific number for its assertion.

---

## 6. Regression suite

Runs on every change, same commands as Plans 1–3:

```bash
cd backend  && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test
cd frontend && npm test && npm run build && npm run lint
```

`npm run lint` carries one pre-existing, unrelated failure (`Portfolio.jsx`, Plan 1) — see Global Constraints in the plan. No task in this phase may introduce a **second** lint error without fixing it before its own commit.

---

## 7. Entry and exit criteria

**A task is done when:** its own tests pass, the full backend and frontend suites pass with no regression, and it is committed.

**Plan 4 is done when:**
- All ten tasks are done.
- §4.1 and §4.2 both pass, with no accepted-failure exception for either — they are the two tests this whole test strategy exists to guarantee.
- The acceptance checklist (`2026-08-08-merch-shop-4-verification.md`) is fully PASS, or every open item has a recorded accept/reject decision.
- No High-severity risk from §1 is unmitigated.

**The phase ships when Plan 4 is done and Plans 1–3's own exit criteria still hold** (re-run their regression suites; this phase adds routes and a tab but touches no existing file's behavior other than the two mount points and one tab list).

---

## 8. Defect handling

Same severity table as the Plans 1–3 test strategy (`Blocker` / `Major` / `Minor`), with one phase-specific reading: **because this feature is entirely read-only, "Blocker" here means a wrong or disagreeing money number, not data loss** — there is no oversell or corrupted-order failure mode possible in this phase. A wrong classification, a reconciliation mismatch, or a timezone misfile is still a Blocker; a cosmetic table-alignment issue on mobile is a Minor even in the bookkeeping view.

Every Blocker and Major gets a regression test before the fix is considered complete, matching the Plans 1–3 convention.
