# Merch Shop — Plan 5 Verification (post-implementation QA)

Run after every task in `2026-08-08-merch-shop-5-shipping.md` is implemented and committed, against a running stack. This is the final gate before the Vận chuyển tab goes live.

**Blocking sections: B, C, D, F, I.** A wrongly-addressed or wrong-COD-amount export row (B) is a real parcel and real money, not a cosmetic bug. An `order_token` leak (C) is a live bearer-credential exposure. A tracking-import that half-fails silently or double-emails a buyer (D) breaks the seller's trust in the whole tool. A roster that conflates paid and collect-at-handover orders (F) either gives away merch or double-charges a buyer. An unauthenticated route (I) leaks the seller's whole order book. Nothing ships with an open failure in those.

**Honesty note, carried over from Plans 3–4's verification:** several items below need a real browser, a real spreadsheet application, a real ViettelPost portal account, or a printer, and this pass may be run in an environment with none of those. Every such item is marked **NOT VERIFIED — needs X** rather than silently checked off; do not mark an item PASS on the strength of an API-level or code-inspection substitute unless that substitute is explicitly called out as sufficient.

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

- [ ] **A1** `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` — full suite passes, including every new `vtp*`/`trackingImport`/`roster`/`adminShipping*`/`migrationShippingPayer` test file.
- [ ] **A2** Record the total test count and confirm it grew by roughly the number of tests the plan and test strategy estimated (114 new backend tests, 420 → ~534). A shortfall means a task's tests were trimmed somewhere along the way — investigate before signing off, per the test strategy's Blocker-closure rule (§8).
- [ ] **A3** `cd frontend && npm test` — passes, including `AdminShipping`, `ShippingExport`, `ShippingTrackingImport`, `ShippingRoster` (16 new frontend tests, 88 → ~104).
- [ ] **A4** `cd frontend && npm run build` — succeeds. A pre-existing >500KB chunk-size warning is not a failure.
- [ ] **A5** `cd frontend && npm run lint` — shows exactly the 3 pre-existing problems noted in the plan's Global Constraints and **no other** error. Any new lint error in a `shipping/*` file, `AdminShipping.jsx`, or `adminShipping.js` blocks sign-off.
- [ ] **A6** Confirm this phase's changes outside its own new files are limited to: `backend/server.js` (one mount line), `backend/package.json`/`package-lock.json` (exceljs), `frontend/src/api/shop.js` (six appended functions), `frontend/src/pages/Admin.jsx` (one import, one tab button, one tab body line). Any other pre-existing file touched is a scope surprise — investigate and record it here, per Plan 4's A6 precedent of correcting an inaccurate "no other file touched" claim rather than assuming the parenthetical is right.

---

## B. Export mapping correctness (blocking)

- [ ] **B1** Open `backend/shop/shipping/vtpMapping.js` and manually re-derive the two exact service strings and two payer strings against the spec's Template — Verified Facts section, character for character (including the exact spacing/hyphenation of `PHS - Nội tỉnh tiết kiệm thỏa thuận` and `VTK - CP tiết kiệm thỏa thuận`). A string that "looks right" but has a stray space will fail a real VTP import silently.
- [ ] **B2** Create a confirmed ship order with a full structured address in Ho Chi Minh City, prepaid (`bank`), not freeship. Export it. Confirm the downloaded row's B/C/D/E/I/J/M/S columns match a hand-computed row exactly: `B=DH<id>`, `C=`buyer name, `D=`phone with all whitespace stripped, `E=`street, ward, district, province joined by `, `, `I=`order total, `J=`blank, `M=PHS - Nội tỉnh tiết kiệm thỏa thuận`, `S=Người nhận trả`.
- [ ] **B3** Create a second confirmed ship order in Hà Nội (or any non-HCM province), COD, marked freeship. Export it alongside B2's order. Confirm `M=VTK - CP tiết kiệm thỏa thuận`, `J=`the order's `cod_amount` exactly, `S=Người gửi trả`.
- [ ] **B4** Create an order whose `address_province` is empty or an unrecognised string, but which has a usable `address_raw`. Confirm the exported service is `VTK` (the safe default per spec), not `PHS`.
- [ ] **B5** Create an order with no structured address fields **and** no `address_raw`. Confirm it is **excluded** from the exported file (no row for it, `STT` sequence has no gap) and appears in the response's `excluded` array with `reason: "no_address"`.
- [ ] **B6** Create a COD order with `cod_amount` left `null`. Confirm it is excluded with `reason: "cod_missing_amount"`, never exported with a blank column J.
- [ ] **B7** Export a batch containing both a good order and a B5/B6-style bad order. Confirm the good order still appears starting at row 8 with the correct `STT`, and the bad order's exclusion did not shift or corrupt the good row.
- [ ] **B8** Confirm batch-level columns F (Tên hàng hóa), H (Trọng lượng), K (Loại hàng hóa), U (Thời gian hẹn lấy) are identical across every exported row in one export, matching exactly what was typed into the export form — and column G (Số lượng) is `1` for every row.
- [ ] **B9** Confirm `npm run migrate` has been run against the environment under test (`orders.shipping_payer` exists) before any of the above — B3's freeship assertion is meaningless against a database still missing the column.

**Section verdict: ___**

---

## C. `order_token` security (blocking)

- [ ] **C1** Read `vtpMapping.js`'s `mapOrderToRow` line by line and confirm it never references `order.order_token` anywhere, and only destructures/reads the specific fields it needs off the `order` argument.
- [ ] **C2** Generate a real export for a real order. Base64-decode the downloaded file and `grep`/search the raw bytes for that order's `order_token` value (fetch it via `SELECT order_token FROM orders WHERE id = ?` against the test DB, never from a production buyer's real order). Confirm zero matches.
- [ ] **C3** Repeat C2 against every other new JSON response this phase adds (`GET /shipping/export/orders`, `POST /shipping/export`'s JSON envelope excluding the embedded file, `POST /shipping/tracking-import/preview`, `POST /shipping/tracking-import/confirm`, `GET /shipping/roster/:id`) — confirm none contains `order_token` as a key or a value.
- [ ] **C4** Confirm `backend/tests/vtpMapping.test.js`'s and `backend/tests/vtpWorkbook.test.js`'s `order_token` security tests (per the test strategy's §4.1) are present, pass, and actually plant a distinctive, greppable secret string rather than testing with a realistic-but-guessable token that could coincidentally not appear for unrelated reasons.

**Section verdict: ___**

---

## D. Tracking-code import (blocking)

- [ ] **D1** Create 3 confirmed ship orders. Paste `DH<id1>\tVTP001`, `DH<id2>\tVTP002` (omit the third) into the tracking-import view and preview. Confirm the preview shows exactly 2 rows in "will apply" and the third order is simply absent (not listed as skipped — it was never mentioned in the input).
- [ ] **D2** Confirm the D1 preview. Confirm both orders move to `shipped` with the correct `tracking_code` each, and the result screen shows a distinct success line per order (not one blanket "success").
- [ ] **D3** **Idempotency.** Re-paste the exact same D1 text and preview again. Confirm both rows now show as `skipped` with `reason: already_shipped`, and `toApply` is empty. Confirm no second email was queued (check `email_queue` table row count for those two orders' shipped-notification type before/after the re-preview — it should not grow, since preview alone never writes; then additionally attempt to re-confirm with the (empty) `toApply` and confirm the confirm route rejects an empty `rows` array with 400, never silently no-op-succeeding on nothing).
- [ ] **D4** **Idempotency at the confirm layer specifically.** Manually re-submit `POST /shipping/tracking-import/confirm` with the exact same `rows` payload used in D2 (bypassing the preview step, simulating a double-submit/retry). Confirm the response reports `ok: false` for both rows, and `SELECT tracking_code FROM orders WHERE id IN (...)` shows the original values unchanged, not overwritten.
- [ ] **D5** **Unmatched code.** Include a row with an order code matching no real order (`DH999999`). Confirm it is reported `skipped` with `reason: not_found`, and confirm no other order in the same file is affected.
- [ ] **D6** **Invalid code format.** Include a row with a garbage order code (not `DH<digits>`). Confirm `reason: invalid_code`.
- [ ] **D7** **Duplicate tracking codes.** Include two rows with different valid order codes but the identical tracking code. Confirm **both** are skipped with `reason: duplicate_tracking_code`, neither applied.
- [ ] **D8** **Already-shipped skip.** Create an order, move it to `shipped` directly via the normal admin transition (not through this import), then include its code with a *new* tracking code in an import. Confirm it is skipped with `reason: already_shipped`, and its `tracking_code` is not overwritten with the new value.
- [ ] **D9** **Per-order isolation.** Preview a 2-row batch, then before confirming, cancel one of the two orders via the normal admin order view. Confirm on the resulting confirm call the other (still-confirmed) order still succeeds, and the cancelled one reports `ok: false` with a clear reason — not a whole-batch failure.
- [ ] **D10** **Row-count guard.** Attempt a preview and a confirm each with more than 200 rows (script this — paste 201 generated lines). Confirm both 400 with a clear message rather than accepting an unbounded batch.
- [ ] **D11** Confirm the tracking-import UI genuinely blocks writing until "Xác nhận" is clicked — pasting and previewing alone must not change any order's status (cross-check against D1's orders still being `confirmed`, not `shipped`, immediately after the preview step, before D2's confirm).

**Section verdict: ___**

---

## E. Migration and payer toggle

- [ ] **E1** `SELECT shipping_payer FROM orders LIMIT 5;` on a database that already had orders before this migration ran — confirm every existing row shows `buyer` (the safe, behavior-preserving default), not `NULL` or an error.
- [ ] **E2** Create a new order through the normal buyer checkout flow (not the admin). Confirm its `shipping_payer` is `buyer` by default.
- [ ] **E3** Toggle an order's freeship checkbox in the export view. Confirm `shipping_payer` becomes `seller` in the database, and the checkbox state is reflected immediately in the UI without a full page reload.
- [ ] **E4** Attempt `PATCH /shipping/export/orders/:id/payer` with `shipping_payer: "nobody"` — confirm `400`, and the column's value is unchanged.
- [ ] **E5** Attempt the payer toggle against a non-existent order id — confirm `404`.

**Section verdict: ___**

---

## F. Pickup roster (blocking)

- [ ] **F1** Create one confirmed pickup order paid by `bank` and one confirmed pickup order paid by `cod` with a `cod_amount` set, both in the same collection. Load the roster. Confirm the prepaid order shows "Đã thanh toán" and the COD order shows "Thu khi giao" with the exact `cod_amount` — the two are visually distinguishable at a glance, not just by reading fine print.
- [ ] **F2** Create a confirmed pickup COD order with `cod_amount` left `null`. Confirm it does **not** appear in the roster's row list, and instead appears in an `excluded` section with a reason mentioning the missing COD amount — never rendered as "collect ₫0".
- [ ] **F3** Confirm every roster row's items list matches that order's actual `order_items` (product name, variant label, quantity) — spot-check against the admin Đơn hàng detail view for the same order.
- [ ] **F4** Create pickup orders for at least 3 differently-named buyers, including one whose name starts with a Vietnamese letter that sorts differently than its base Latin letter under a naive comparator (e.g. `Ánh` vs `Bùi` vs `Trần`). Confirm the roster is sorted by buyer name in correct Vietnamese-locale order, not raw byte/codepoint order.
- [ ] **F5** Confirm a `ship`-fulfillment confirmed order in the same collection does **not** appear on the roster (roster is pickup-only).
- [ ] **F6** Confirm a `pending` (not yet confirmed) pickup order does **not** appear on the roster.
- [ ] **F7** Confirm a collection with zero eligible pickup orders shows an explicit empty state, not a blank panel or a JS error.

**Section verdict: ___**

---

## G. Workbook and file-format integrity

- [ ] **G1** Open a generated export file in a real spreadsheet application (Excel, Numbers, or Google Sheets). — **NOT VERIFIED — needs a spreadsheet app** if none is available in this environment; confirmed only that `exceljs` can reopen its own output at the byte level (covered by the automated suite).
- [ ] **G2** Confirm the file opens **without** a "repair" or "corrupted file" prompt in Excel specifically. — **NOT VERIFIED — needs Excel specifically**, if unavailable.
- [ ] **G3** Confirm the `Danh sách` sheet's header row (row 7) is untouched from the template, and data genuinely starts at row 8 with no stray leftover example-data row from the template underneath it.
- [ ] **G4** Confirm Vietnamese diacritics in every exported name/address render correctly when opened in a spreadsheet app. — **NOT VERIFIED — needs a spreadsheet app**; byte-level UTF-8 preservation is confirmed by the automated suite (`vtpWorkbook.test.js`'s diacritics test) as a partial substitute.
- [ ] **G5** **Real ViettelPost import.** Take one generated export file and actually attempt to import it into the ViettelPost portal (or the closest available sandbox/test import flow VTP offers) using a small number of real or test orders. Confirm ViettelPost accepts the file and every column is interpreted as intended (name, phone, address, service, COD amount, payer). — **NOT VERIFIED — needs a real VTP portal account.** This is Outstanding Question 1 from the spec and cannot be closed by this checklist alone; record who will perform this and by when in the Sign-off section.

**Section verdict: ___**

---

## H. Frontend quality

- [ ] **H1** The Vận chuyển tab appears in the admin header, in Vietnamese, in the same visual style as the other seven tabs. — **NOT VERIFIED — needs a browser.**
- [ ] **H2** Switching between the export / tracking-import / roster views preserves no stale data from the previous view. — **NOT VERIFIED — needs a browser**; component-test coverage (`AdminShipping.test.jsx`) confirms the mocked views swap correctly, a partial substitute.
- [ ] **H3** All three views, plus the other seven admin tabs, are usable at a 375px viewport with no horizontal scroll. — **NOT VERIFIED — needs a real/emulated 375px viewport.**
- [ ] **H4** The export order table and the roster table either wrap sensibly or scroll horizontally within their own `overflow-x-auto` container at narrow widths — confirmed present in `ShippingRoster.jsx` by code inspection; `ShippingExport.jsx`'s order table should be checked for the same wrapper if it was not added — **NOT VERIFIED (visual scroll behavior) — needs a browser.**
- [ ] **H5** No new class in any `shipping/*.jsx` file or `AdminShipping.jsx` references a CSS custom property that isn't one of the real tokens — confirm via `grep -rn "var(--" frontend/src/components/shipping frontend/src/components/AdminShipping.jsx` and check every hit against the declared tokens.
- [ ] **H6** Console is clean (no errors/warnings) when navigating all three shipping views with real data, including after a generate/preview/confirm/print action. — **NOT VERIFIED — needs a browser**; `grep -rn "console\.(log|error|warn)" frontend/src/components/shipping` shows no unintentional debug output as a partial substitute.
- [ ] **H7** The "In" (print) button on the roster view actually opens a usable print preview, and the collection picker plus buttons are hidden from the printed output (`print:hidden`) so only the roster table prints. — **NOT VERIFIED — needs a browser and/or a printer.**
- [ ] **H8** `/`, `/shop`, `/cart`, `/checkout`, and the existing seven admin tabs all still work — no regression from adding the eighth. Smoke-test via the same endpoints Plan 4's verification A6/J7 checked, plus loading the admin panel end to end.

**Section verdict: ___**

---

## I. Auth on every new endpoint (blocking)

- [ ] **I1** `GET /api/admin/shipping/export/orders` with no `Authorization` header → `401`.
- [ ] **I2** `PATCH /api/admin/shipping/export/orders/1/payer` with no header → `401`.
- [ ] **I3** `POST /api/admin/shipping/export` with no header → `401`.
- [ ] **I4** `POST /api/admin/shipping/tracking-import/preview` with no header → `401`.
- [ ] **I5** `POST /api/admin/shipping/tracking-import/confirm` with no header → `401`.
- [ ] **I6** `GET /api/admin/shipping/roster/1` with no header → `401`.
- [ ] **I7** All six routes with a malformed/garbage bearer token → `403`.
- [ ] **I8** All six routes with a token signed with the wrong `JWT_SECRET` → `403`.
- [ ] **I9** All six routes, with a **valid** token, return real data (not silently empty) — confirms the auth check isn't accidentally rejecting valid requests too.
- [ ] **I10** No response body from any of the six routes contains a buyer's `order_token`, a *different* buyer's phone/email beyond what's relevant to the requested order/collection, or any field not already exposed by the existing admin Đơn hàng endpoints.

**Section verdict: ___**

---

## J. Error handling and resilience

- [ ] **J1** `POST /shipping/export` with an empty `order_ids` array → `400`, not `500`.
- [ ] **J2** `POST /shipping/export` with a missing or invalid `loai_hang_hoa` value → `400` with a clear message.
- [ ] **J3** `PATCH .../payer` for an order id that does not exist → `404`, not `500` and not a silent `200`.
- [ ] **J4** `GET /shipping/roster/abc` (non-numeric collection id) → `400`, not `500`.
- [ ] **J5** Stop MySQL, then hit each of the six routes → clean `500 server_error` JSON, backend process stays alive, and recovers to `200` once MySQL restarts without a manual backend restart.
- [ ] **J6** With MySQL down, the other admin tabs either also cleanly error or are unaffected — the shipping tab's own error never blanks the whole admin panel. — **NOT VERIFIED (panel-level rendering) — needs a browser**; the API-level `500`-not-crash behavior is verifiable via curl alone (J5).
- [ ] **J7** A rejected fetch inside `ShippingExport`/`ShippingTrackingImport`/`ShippingRoster` renders that view's own error message — confirmed by each component's test file's rejected-promise case (per Plan 4's I4 precedent, verify this test actually exists in each file, not just that the component's `.catch` handling looks correct by inspection).

**Section verdict: ___**

---

## K. Spec edge cases not covered above

- [ ] **K1** Confirm no code in this phase parses `"freeship"` out of `buyer_name` anywhere (`grep -rn "freeship" backend/shop backend/routes frontend/src` should show only this phase's own new `shipping_payer`-based logic and comments referencing the old approach, never a live regex against the name field).
- [ ] **K2** Confirm the shipping export never attempts ViettelPost API booking (`grep -rn "partner.viettelpost.vn\|viettelpost.vn/api" backend` returns nothing) — this phase is spreadsheet-only, per the spec's explicit Out of Scope.
- [ ] **K3** Confirm no label-printing or rate-quoting code was added (scope check, mirroring Plan 4's K3/K4 sanity checks).
- [ ] **K4** Confirm the roster is genuinely browser-printed HTML, not a server-generated PDF (`grep -rn "puppeteer\|pdfkit\|wkhtmltopdf" backend/package.json backend/shop/shipping` returns nothing) — per the spec's explicit rationale (no new heavy dependency on a 2GB droplet).
- [ ] **K5** No stats/shipping route or component references `frontend/src/i18n/translations.js` — confirm via `grep -rn "translations\|useTranslation\|i18n" frontend/src/components/shipping frontend/src/components/AdminShipping.jsx` returning nothing.
- [ ] **K6** Confirm the `Thời gian hẹn lấy` field is genuinely free-text in the shipped UI, not a `<select>` with invented option values (grep `ShippingExport.jsx` for a hardcoded array of slot strings — there should be none, per the plan's Global Constraints).

**Section verdict: ___**

---

## L. Data integrity guarantee

- [ ] **L1** `grep -inE "INSERT|UPDATE|DELETE|TRUNCATE" backend/shop/shipping/*.js` returns **no matches** in `vtpMapping.js`, `vtpWorkbook.js`, `trackingImport.js`, or `roster.js` — all four are pure/read-only by construction; only `adminShipping.js` (the route layer) may write, and only through `transitionOrder` (status/tracking_code) or the one direct `shipping_payer` UPDATE.
- [ ] **L2** `grep -n "UPDATE orders" backend/routes/adminShipping.js` shows **exactly one** direct `UPDATE orders` statement (the payer toggle) — confirm there is no second direct write to `status` or `tracking_code` bypassing `transitionOrder`.
- [ ] **L3** Running the full shipping acceptance pass leaves every table this phase does not intend to write — `product_variants`, `products`, `collections`, `email_queue`'s unrelated rows — unaffected, and leaves `orders`/`order_items` changed **only** in the ways this checklist explicitly exercised (payer toggles, tracking-code/status transitions from confirmed imports). Confirm with a targeted `SELECT` diff, not a blanket checksum (unlike Plan 4, this phase is intentionally not read-only, so a byte-for-byte-unchanged assertion would be wrong).

**Section verdict: ___**

---

## Sign-off

- [ ] Blocking sections **B, C, D, F, I** fully PASS.
- [ ] The three highest-value tests from the test strategy's §4 (`order_token` security, address/COD export-error guards, tracking-import idempotency/isolation) have been read line-by-line against their test files, not just run — confirmed present, confirmed asserting what they claim to assert.
- [ ] `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` passes in full (A1).
- [ ] `cd frontend && npm test && npm run build && npm run lint` pass, modulo the 3 pre-existing problems (A3–A5).
- [ ] Section L (write-scope guarantee) fully PASS — this is the property that makes every other failure in this phase bounded to "one wrong export/import," never "unrelated data corrupted."
- [ ] Every item marked **NOT VERIFIED — needs X** has either been verified in a follow-up session with the needed tool/access, or is recorded here as an accepted gap with a named owner and target date. This is expected to include at minimum G1/G2/G4/G5 (spreadsheet app, Excel, real VTP portal) and the browser-dependent H/J items — no browser, spreadsheet app, or VTP portal account is assumed available in an automated pass.
- [ ] Non-blocking findings (T14's free-text `Thời gian hẹn lấy` field, any Minor from the automated pass) are recorded with an explicit accept/reject decision, not left ambiguous.

### Outstanding Questions from the spec — both must be tracked, neither blocks shipping this phase

- [ ] **Recheck the full VTP field mapping against a real import** (spec Outstanding Question 1; this checklist's G5). Owner: _____________. Target date: _____________.
- [ ] **API integration availability** (spec Outstanding Question 2) — attempt login at `partner.viettelpost.vn`, look for *Tích hợp / Kết nối API* in the business portal, or ask the account manager. Owner: _____________. Target date: _____________.

## Production readiness

- [ ] The seller has performed at least one real export → real VTP import → real tracking-code round trip before this replaces their existing Python-script workflow entirely (do not retire `/Users/phucth/vibes/vtp/fill_vtp_orders.py` until this has happened at least once).
- [ ] The seller understands the free-text `Thời gian hẹn lấy` field must be copied exactly from the template's own dropdown (T14) — a plausible-looking wrong value fails silently on VTP's side, not this app's.
- [ ] A rollback plan exists: migration 017 is additive-only (`shipping_payer` with a safe default) and reversible via `exports.down`; confirm rollback is genuinely "revert the commits, roll back the migration, redeploy" by checking no other phase's code was touched beyond the mount lines and tab entry noted in A6.
