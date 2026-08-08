# Merch Shop — Plan 4 Verification (post-implementation QA)

Run after every task in `2026-08-08-merch-shop-4-stats.md` is implemented and committed, against a running stack. This is the final gate before the Thống kê tab goes live.

**Blocking sections: B, C, F, H.** A wrong money classification (B) or a view that disagrees with another view (C) is the single worst outcome this phase can produce — a wrong number that looks authoritative is worse than no number. A timezone misfile (F) silently corrupts a bookkeeping figure for real date ranges the seller actually uses. An unauthenticated stats endpoint (H) leaks the seller's revenue. Nothing ships with an open failure in those.

**Honesty note, carried over from Plan 3's verification:** several items below need a real browser (viewport sizing, actual rendering, clicking through the UI) and this pass may be run in an environment without one. Every such item is marked **NOT VERIFIED — needs a browser** rather than silently checked off; do not mark an item PASS on the strength of an API-level or code-inspection substitute unless that substitute is explicitly called out as sufficient.

## Setup

```bash
docker compose up -d --build
cd frontend && npm run dev
```

```bash
API=http://localhost:5000/api
TOKEN=$(curl -s -X POST $API/login -d '{"username":"'"$ADMIN_USERNAME"'","password":"'"$ADMIN_PASSWORD"'"}' -H 'Content-Type: application/json' | jq -r .token)
AUTH="Authorization: Bearer $TOKEN"
DBX="docker compose exec -T mysql mysql -uroot -p$DB_PASS cosplay -N -B -e"
```

---

## A. Automated suite

- [ ] **A1** `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` — full suite passes, including every new `stats*` test file.
- [ ] **A2** Record the total test count and confirm it grew by the number of tests added in the plan (money 27, drop 12, restock 8, bookkeeping 14, csv 10, routes 10 = 81 new backend tests).
- [ ] **A3** `cd frontend && npm test` — passes, including `AdminStats`, `StatsDrop`, `StatsRestock`, `StatsBookkeeping` (14 new frontend tests).
- [ ] **A4** `cd frontend && npm run build` — succeeds. A pre-existing >500KB chunk-size warning is not a failure.
- [ ] **A5** `cd frontend && npm run lint` — shows exactly the one pre-existing `Portfolio.jsx` error from Plan 1 and **no other** error. Any new lint error in a `stats/*` file or `adminStats.js` blocks sign-off.
- [ ] **A6** Re-run Plan 1–3 acceptance-relevant automated checks are covered by A1/A3 already passing in full (Plan 4 adds no migration and modifies no existing runtime file besides two mount points and one tab list).

---

## B. Money classification (blocking)

This is the foundation every other view is built on. Confirm it, not just the numbers it produces.

- [ ] **B1** Open `backend/shop/stats/money.js` and manually walk all 20 `(status, payment_method)` cells against the spec's Money Definitions table. Confirm the code's own comment table matches the spec exactly, cell for cell.
- [ ] **B2** `backend/tests/statsMoney.test.js` asserts all 20 cases individually (not via a shared loop that could hide a wrong expectation) and asserts `CASES.length === 20`. Confirm by reading the file, not just by the test passing — a wrong `expected` value in the fixture table would still "pass."
- [ ] **B3** A pending bank order is `awaiting_payment`, **not** received. Confirmed by placing a real order and checking `GET /api/admin/stats/drop/:id`.
- [ ] **B4** A confirmed bank order is `received.bank`. A shipped one is too. A completed one is too.
- [ ] **B5** A confirmed **COD** order is `to_collect`, **not** `received`. A completed COD order **is** `received.cod`.
- [ ] **B6** A cancelled order — of any payment method, at any prior status — is `lost`, and contributes to nothing else.
- [ ] **B7** A pending COD order contributes to **none** of `received`, `awaiting_payment`, `to_collect`, or `lost` on the drop view (it is the deliberate `other` bucket). Confirm `stats.order_counts.pending` still counts it, so it isn't invisible — only excluded from money buckets.
- [ ] **B8** `shipping_fee` never appears inside `received`, `awaiting_payment`, `to_collect`, or `lost` — it only appears as `shipping_cost` on the bookkeeping view. Confirm by setting a shipping fee on a shipped order and checking `received_total` is unchanged.

**Section verdict: ___**

---

## C. Cross-view reconciliation (blocking)

- [ ] **C1** Create two collections. Place a mix of orders across both (some bank-confirmed, some COD-confirmed, some prepaid-pending, one cancelled) so every money bucket has a non-zero value in at least one collection.
- [ ] **C2** Call `GET /api/admin/stats/drop/:id` for each collection and hand-record `received_total`, `awaiting_payment`, `to_collect`, `lost`.
- [ ] **C3** Call `GET /api/admin/stats/bookkeeping?date_from=...&date_to=...` for a range covering every order placed in C1. For each collection, confirm its entry in `by_collection` matches C2's recorded numbers **exactly**, field for field.
- [ ] **C4** Summing all `by_collection` entries' `received_total` equals the bookkeeping view's top-level `received_total`. Repeat for `awaiting_payment`, `to_collect`, `lost`.
- [ ] **C5** Place an order with `collection_id = NULL` (or null it out on an existing one) and confirm it appears in `by_collection` as `collection_title: "Không thuộc bộ sưu tập"`, and is included in the top-level totals from C4 — the sum does not silently drop it.
- [ ] **C6** `backend/tests/statsRepoBookkeeping.test.js`'s reconciliation test (§4.2 of the test strategy) passes, and its assertions actually compare against an independent `getDropStats` call rather than only checking `by_collection` sums against the same object's own top-level fields (open the test file and confirm — a self-consistency check alone would not catch a real divergence between the two aggregation code paths).

**Section verdict: ___**

---

## D. Drop view — non-money numbers

- [ ] **D1** Order counts by status (`pending`/`confirmed`/`shipped`/`completed`/`cancelled`) sum to the total number of orders in the collection.
- [ ] **D2** `units_sold` excludes a cancelled order's quantity. Place and cancel a 3-unit order; confirm `units_sold` does not include those 3 units.
- [ ] **D3** Ship vs pickup mix counts match a hand count of the collection's orders by `fulfillment_method`.
- [ ] **D4** Expiry rate: create a prepaid order, force it overdue and expired (`expires_at` in the past, `cancelled_at` at/after it, `status = 'cancelled'`), plus a second still-pending prepaid order, plus a COD order. Confirm `expiry_rate = 0.5`, `prepaid_order_count = 2` (COD excluded), `expired_order_count = 1`.
- [ ] **D5** A collection with zero prepaid orders (only COD, or no orders at all) shows `expiry_rate: null`, not `0` and not `NaN`.
- [ ] **D6** A manually-cancelled order that happened to already be overdue is still counted as expired (per spec, accepted as indistinguishable from the sweep) — confirm this is the actual, deliberate behavior, not an oversight, by re-reading the spec's Expiry detection paragraph.

**Section verdict: ___**

---

## E. Edge cases — unlimited and deleted variants

- [ ] **E1** Create a variant with `stock_qty = NULL` (unlimited), sell some units. Drop view and restock view both show `remaining: null` / `unlimited: true`, and the frontend renders "không giới hạn" — never a number, never `0%`.
- [ ] **E2** Place and fully complete an order against a variant, then delete that variant (now legal since Plan 3's `VariantInUseError` guard only blocks live orders). Confirm the drop view still shows that variant's row with its correct `product_name`/`variant_label`/`sold` from the order snapshot, `variant_id: null`, `deleted: true`, `remaining: null` — and the frontend renders "—", never `0`.
- [ ] **E3** Create two separate deleted variants with the **same** product name and variant label (a genuine, if rare, coincidence). Confirm they either correctly merge as one indistinguishable row (acceptable, since nothing in `order_items` can tell them apart) or the situation is at least not silently dropping revenue — total `sold` across all rows still reconciles with actual units sold.
- [ ] **E4** A deleted variant is **absent** from the restock view (it starts its query from `product_variants`, which no longer has the row) — confirm this is intentional (a deleted variant cannot be restocked) rather than a bug, by checking the drop view still shows its history.
- [ ] **E5** A collection with zero orders shows an explicit empty state ("chưa có đơn hàng nào"), not a blank panel, not a JS error in the console.
- [ ] **E6** A bookkeeping date range with zero orders shows an explicit empty state ("Không có đơn hàng nào trong khoảng ngày này"), not a blank panel.

**Section verdict: ___**

---

## F. Timezone boundaries (blocking)

`created_at` is UTC; the seller is Asia/Ho_Chi_Minh, fixed UTC+7.

- [ ] **F1** Place an order with `created_at` set to `2026-07-31T17:05:00Z` (= `2026-08-01T00:05:00+07:00`, five minutes into the seller's August 1st). Query the bookkeeping view for `date_from=2026-08-01&date_to=2026-08-01` — the order **is** included. Query `date_from=2026-07-31&date_to=2026-07-31` — the order is **not** included.
- [ ] **F2** Place an order with `created_at` set to `2026-07-31T16:55:00Z` (= `2026-07-31T23:55:00+07:00`, five minutes before the seller's midnight). Query for `2026-08-01` — **not** included. Query for `2026-07-31` — **is** included.
- [ ] **F3** A `date_to` of a single day (`date_from == date_to`) includes the **entire** local day, not just its first instant — confirmed by F1/F2 already using single-day ranges successfully.
- [ ] **F4** A range spanning a month boundary (e.g. `date_from=2026-07-25&date_to=2026-08-05`) correctly includes orders from both months without an off-by-one at the boundary — spot check with an order placed at `2026-07-31T23:58:00+07:00` and one at `2026-08-01T00:02:00+07:00`, both included.
- [ ] **F5** `GET /api/admin/stats/bookkeeping` with a missing `date_to` → `400 invalid_input`.
- [ ] **F6** `GET /api/admin/stats/bookkeeping` with an unparsable `date_from=not-a-date` → `400 invalid_input`.
- [ ] **F7** `GET /api/admin/stats/bookkeeping` with `date_from` after `date_to` → `400 invalid_input`.
- [ ] **F8** The same three malformed-range cases (F5–F7) also 400 on `GET /api/admin/stats/bookkeeping/export.csv`, not a silently-unbounded CSV export.
- [ ] **F9** Confirm this differs deliberately from `GET /api/admin/orders?date_from=...`, which tolerates a malformed date by silently ignoring it (see `orderRepo.js`'s `parseDateBoundary`) — the stats bookkeeping view's stricter rejection is an intentional, spec-required departure for a money view, not an inconsistency to "fix" by matching the orders list.

**Section verdict: ___**

---

## G. CSV export

- [ ] **G1** `GET /api/admin/stats/bookkeeping/export.csv?date_from=...&date_to=...` returns `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="so-quy-....csv"`.
- [ ] **G2** The CSV's numbers match the JSON view for the **identical** request, field for field (received total, per-method breakdown is not in the CSV per the plan's header set — confirm the CSV's per-collection rows plus total row match `by_collection` and the top-level totals from the JSON call).
- [ ] **G3** A collection titled with a comma in it (e.g. `Drop, mùa hè 2026`) round-trips correctly — the exported field is quoted and the comma does not create a spurious extra column when opened in a spreadsheet app.
- [ ] **G4** A collection title containing a literal `"` round-trips correctly (doubled inside the quoted field, per RFC 4180).
- [ ] **G5** Vietnamese diacritics in every collection title render correctly when the CSV is opened in Excel/Numbers/Google Sheets — **NOT VERIFIED — needs a browser/spreadsheet app** in a headless run; confirmed only at the byte level (UTF-8 BOM present, diacritics preserved as UTF-8 bytes) via `hexdump`/`file` if no spreadsheet app is available.
- [ ] **G6** The CSV opens without a "repair" prompt in Excel — **NOT VERIFIED — needs Excel specifically**, if unavailable in this environment.
- [ ] **G7** Two different date ranges produce CSVs with visibly different totals (sanity check against copy-paste of a hardcoded fixture).

**Section verdict: ___**

---

## H. Auth on every new endpoint (blocking)

- [ ] **H1** `GET /api/admin/stats/drop/1` with no `Authorization` header → `401`.
- [ ] **H2** `GET /api/admin/stats/restock` with no header → `401`.
- [ ] **H3** `GET /api/admin/stats/bookkeeping?date_from=2026-01-01&date_to=2026-01-01` with no header → `401`.
- [ ] **H4** `GET /api/admin/stats/bookkeeping/export.csv?date_from=2026-01-01&date_to=2026-01-01` with no header → `401`.
- [ ] **H5** All four routes with a malformed/garbage bearer token → `403`.
- [ ] **H6** All four routes with a token signed with the wrong `JWT_SECRET` → `403`.
- [ ] **H7** All four routes, with a **valid** token, return real data (not silently empty) — confirms the auth check isn't accidentally rejecting valid requests too.
- [ ] **H8** No stats response body contains a buyer's phone number, email, or address — these are drop/bookkeeping-level aggregates only, never per-order buyer detail (confirm by grepping a real response for a known seeded buyer's phone/email).

**Section verdict: ___**

---

## I. Error handling and resilience

- [ ] **I1** `GET /api/admin/stats/drop/999999` (unknown collection) → `404 not_found`, not a `500` and not a silently-empty `200`.
- [ ] **I2** Stop MySQL, then hit each of the four stats endpoints → clean `500 server_error` JSON, backend process stays alive, and recovers to `200` once MySQL restarts without a manual backend restart.
- [ ] **I3** With MySQL down, the **other** admin tabs (Đơn hàng, Thanh toán, Email) either also cleanly error or — if independently working — are unaffected by the stats tab's failure. The stats tab's own error never blanks the whole admin panel. **NOT VERIFIED — needs a browser** for the actual panel-level rendering check; the API-level `500`-not-`crash` behavior is verifiable via curl alone.
- [ ] **I4** A rejected fetch inside `StatsDrop`/`StatsRestock`/`StatsBookkeeping` renders that view's own error message, confirmed by the component tests in the plan (`AdminStats.test.jsx` et al. mocking a rejected promise) — cite the specific test asserting this if re-verifying by reading test output rather than a live browser.

**Section verdict: ___**

---

## J. Frontend quality

- [ ] **J1** The Thống kê tab appears in the admin header, in Vietnamese ("Thống kê"), in the same visual style as the other six tabs. **NOT VERIFIED — needs a browser.**
- [ ] **J2** Switching between Theo đợt bán / Restock / Sổ quỹ preserves no stale data from the previous view (e.g. switching from a populated drop view to restock does not flash the old drop numbers). **NOT VERIFIED — needs a browser**; component-test coverage confirms the mocked views swap correctly, which is a partial substitute.
- [ ] **J3** All three views, plus the admin payment/email/order tabs, are usable at a 375px viewport with no horizontal scroll. **NOT VERIFIED — needs a real/emulated 375px viewport; no browser available in a headless run.**
- [ ] **J4** Tables in the drop and restock views either wrap sensibly or scroll horizontally within their own container at narrow widths — never causing the whole page to scroll sideways. **NOT VERIFIED — needs a browser.**
- [ ] **J5** No new class in any `stats/*.jsx` file references a CSS custom property that isn't one of the real tokens (`--border-brand`, `--surface-card`, `--bg-page`, `--bg-sunken`, `--text-muted`, `--text-strong`, `--text-body`, `--radius-lg`, `--radius-md`) — confirmed by `grep -rn "var(--" frontend/src/components/stats frontend/src/components/AdminStats.jsx` and checking every hit against `frontend/src/index.css` (or wherever the tokens are declared).
- [ ] **J6** Console is clean (no errors/warnings) when navigating all three stats views with real data. **NOT VERIFIED — needs a browser**; `grep -rn "console\.(log|error|warn)" frontend/src/components/stats` shows no unintentional debug output, which is a partial substitute (matches the approach used in Plan 3's verification P5).
- [ ] **J7** `/`, `/shop`, `/cart`, `/checkout`, and the existing six admin tabs all still work — no regression from adding the seventh. Smoke-test via the same endpoints Plan 3's verification P6 checked, plus loading the admin panel end to end.

**Section verdict: ___**

---

## K. Spec edge cases not covered above

- [ ] **K1** Sell-through's stated caveat ("a mid-drop restock via `replaceVariants` shifts the number, since original stock isn't recorded historically") is visible on the drop view as on-page copy, per spec's Edge Cases → Sell-through honesty. Confirm the caption text is present verbatim (or equivalent Vietnamese) below the summary stats and above the variant table, not just left as a code comment — `StatsDrop.jsx`'s Task 8 implementation includes this text; verify it actually renders.
- [ ] **K2** The restock view's known-limitation note ("once sold out, true demand beyond that point is invisible") is printed on the page, per spec — confirm it's present verbatim or in equivalent Vietnamese, not just left as a code comment.
- [ ] **K3** No stats view attempts profit/margin calculation — confirm by reading `statsRepo.js` for any reference to a cost-of-goods field (there is none in the schema; this is a sanity check that scope didn't creep).
- [ ] **K4** No stats view shows a time-series/trend chart — confirm the three views are drop-scoped, cross-drop-ranked, and date-ranged respectively, never a running line graph.
- [ ] **K5** No stats route or component references `frontend/src/i18n/translations.js` — confirm via `grep -rn "translations\|useTranslation\|i18n" frontend/src/components/stats frontend/src/components/AdminStats.jsx` returning nothing.

**Section verdict: ___**

---

## L. Data integrity guarantee

- [ ] **L1** `grep -inE "INSERT|UPDATE|DELETE|TRUNCATE" backend/shop/stats/*.js backend/routes/adminStats.js` returns **no matches** — this phase is read-only by construction, not just by intention. Any hit here is an immediate stop-ship.
- [ ] **L2** Running the full stats acceptance pass (every GET request in this checklist) leaves `orders`, `order_items`, `product_variants`, `products`, and `collections` row counts and content byte-for-byte identical to before the pass started — confirm with a `SELECT COUNT(*)` and a checksum (`CHECKSUM TABLE orders, order_items, product_variants, products, collections;`) taken before and after.

**Section verdict: ___**

---

## Sign-off

- [ ] Blocking sections **B, C, F, H** fully PASS.
- [ ] The exhaustive money-classifier test (B2, backed by `backend/tests/statsMoney.test.js`) has been read line-by-line against the spec's table, not just run.
- [ ] The reconciliation test (C6) has been confirmed to compare against an independently-computed `getDropStats` call, not merely check a single object's internal consistency.
- [ ] `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` passes in full (A1).
- [ ] `cd frontend && npm test && npm run build && npm run lint` pass, modulo the one pre-existing `Portfolio.jsx` lint error (A3–A5).
- [ ] Section L (read-only guarantee) fully PASS — this is the property that makes every other failure in this phase merely "wrong number," never "corrupted data."
- [ ] Every item marked **NOT VERIFIED — needs a browser** has either been verified in a follow-up browser session, or is recorded here as an accepted gap with a named owner and date.
- [ ] Non-blocking failures and open items (K1 in particular, if the sell-through caveat text was not added) are recorded with an explicit accept/reject decision, not left ambiguous.

## Production readiness

- [ ] The seller has been shown all three views against real (or realistic staging) drop data at least once before this ships to replace their manual bookkeeping process.
- [ ] The seller understands the sell-through caveat (K1) and the restock-velocity known-limitation (K2) well enough to not over-trust either number.
- [ ] A rollback plan exists: since this phase adds no migration and no destructive change, rollback is simply reverting the commits and redeploying — confirm this is actually true by checking no other phase's code was touched beyond the two mount points and the Admin.jsx tab list.
