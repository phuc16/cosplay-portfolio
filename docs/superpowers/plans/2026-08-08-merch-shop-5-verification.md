# Merch Shop - Plan 5 Verification (post-implementation QA)

Run after every task in `2026-08-08-merch-shop-5-shipping.md` is implemented and committed, against a running stack. This is the final gate before the Vận chuyển tab goes live.

**Blocking sections: B, C, D, F, I.** A wrongly-addressed or wrong-COD-amount export row (B) is a real parcel and real money, not a cosmetic bug. An `order_token` leak (C) is a live bearer-credential exposure. A tracking-import that half-fails silently or double-emails a buyer (D) breaks the seller's trust in the whole tool. A roster that conflates paid and collect-at-handover orders (F) either gives away merch or double-charges a buyer. An unauthenticated route (I) leaks the seller's whole order book. Nothing ships with an open failure in those.

**Honesty note, carried over from Plans 3–4's verification:** several items below need a real browser, a real spreadsheet application, a real ViettelPost portal account, or a printer, and this pass may be run in an environment with none of those. Every such item is marked **NOT VERIFIED - needs X** rather than silently checked off; do not mark an item PASS on the strength of an API-level or code-inspection substitute unless that substitute is explicitly called out as sufficient.

**Acceptance run completed 2026-08-09** against branch `feature/order`, HEAD `5c982d1`, live Docker stack. Full report: `.superpowers/sdd/phase5-acceptance-report.md`. Checkboxes below reflect that run's verdicts; NOT VERIFIED and FAIL items carry an inline annotation per the acceptance report, matching Plan 4's annotation convention.

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

- [x] **A1** `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` - full suite passes, including every new `vtp*`/`trackingImport`/`roster`/`adminShipping*`/`migrationShippingPayer` test file. - PASS: `Test Files 47 passed (47)`, `Tests 583 passed (583)`.
- [x] **A2** Record the total test count and confirm it grew by roughly the number of tests the plan and test strategy estimated (114 new backend tests, 420 → ~534). A shortfall means a task's tests were trimmed somewhere along the way - investigate before signing off, per the test strategy's Blocker-closure rule (§8). - PASS: 583 total, +163 new backend tests - well above the ~114 estimate, not a shortfall; no investigation needed.
- [x] **A3** `cd frontend && npm test` - passes, including `AdminShipping`, `ShippingExport`, `ShippingTrackingImport`, `ShippingRoster` (16 new frontend tests, 88 → ~104). - PASS: `Test Files 17 passed (17)`, `Tests 114 passed (114)` at acceptance time (26 new tests, above the 16 estimate). Now 118/118 after the follow-up commit `098602d` closed the J7 error-path gap (see J7) - 4 more tests added.
- [x] **A4** `cd frontend && npm run build` - succeeds. A pre-existing >500KB chunk-size warning is not a failure. - PASS: build succeeded, only the pre-existing `index-BsoUElSo.js` (586.81 kB) chunk-size warning.
- [x] **A5** `cd frontend && npm run lint` - shows exactly the 3 pre-existing problems noted in the plan's Global Constraints and **no other** error. Any new lint error in a `shipping/*` file, `AdminShipping.jsx`, or `adminShipping.js` blocks sign-off. - PASS: exactly 3 pre-existing problems, all in `Portfolio.jsx`/`AdminAlbumImages.jsx`. Zero problems in any `shipping/*`, `AdminShipping.jsx`, or `adminShipping.js` file.
- [x] **A6** Confirm this phase's changes outside its own new files are limited to: `backend/server.js`, `backend/package.json`/`package-lock.json` (exceljs), `frontend/src/api/shop.js` (six appended functions), `frontend/src/pages/Admin.jsx` (one import, one tab button, one tab body line). Any other pre-existing file touched is a scope surprise - investigate and record it here, per Plan 4's A6 precedent of correcting an inaccurate "no other file touched" claim rather than assuming the parenthetical is right. - **CORRECTED CLAIM:** the same 5 pre-existing files were touched, no scope surprise there - but `backend/server.js`'s diff is **not** "one mount line". Commit `3ba3732` ("feat(shipping): add file upload to the tracking-import UI, route it to a bigger body limit") also added a dedicated `IMPORT_LIMIT` (10mb) body-parser branch keyed on the `tracking-import/preview` path, and extended the 413-payload-too-large handler to report a shipping-specific message for that path. This is a legitimate, deliberate, well-commented change needed for the file-upload feature, not a bug - but the plan's "one mount line" characterization of `server.js` undersold the real scope. `backend/server.js`'s actual Phase 5 diff is: one route-mount line, plus the `IMPORT_LIMIT` body-size branch, plus the 413-handler's shipping-specific message extension.

---

## B. Export mapping correctness (blocking)

- [x] **B1** Open `backend/shop/shipping/vtpMapping.js` and manually re-derive the two exact service strings and two payer strings against the spec's Template - Verified Facts section, character for character (including the exact spacing/hyphenation of `PHS - Nội tỉnh tiết kiệm thỏa thuận` and `VTK - CP tiết kiệm thỏa thuận`). A string that "looks right" but has a stray space will fail a real VTP import silently. - PASS: exact match, read line-by-line.
- [x] **B2** Create a confirmed ship order with a full structured address in Ho Chi Minh City, prepaid (`bank`), not freeship. Export it. Confirm the downloaded row's B/C/D/E/I/J/M/S columns match a hand-computed row exactly. - PASS (live): order 1173, decoded row matched exactly (`M="PHS - Nội tỉnh tiết kiệm thỏa thuận"`, `S="Người nhận trả"`, phone whitespace stripped).
- [x] **B3** Create a second confirmed ship order in Hà Nội, COD, marked freeship. Export it alongside B2's order. Confirm `M=VTK - CP tiết kiệm thỏa thuận`, `J=`the order's `cod_amount` exactly, `S=Người gửi trả`. - PASS (live): order 1174, exact match.
- [x] **B4** Create an order whose `address_province` is empty or an unrecognised string, but which has a usable `address_raw`. Confirm the exported service is `VTK` (the safe default), not `PHS`. - PASS (live): order 1175.
- [x] **B5** Create an order with no structured address fields **and** no `address_raw`. Confirm it is **excluded** with `reason: "no_address"`, no `STT` gap. - PASS (live): order 1176.
- [x] **B6** Create a COD order with `cod_amount` left `null`. Confirm it is excluded with `reason: "cod_missing_amount"`. - PASS (live): order 1177.
- [x] **B7** Export a batch containing both a good order and a B5/B6-style bad order. Confirm the good order still appears with correct `STT`, no corruption. - PASS (live): rows 8-11 held the 4 good orders, `STT` 1-4, no gap/corruption; confirmed all-null past row 11 to the template's last row (1341).
- [x] **B8** Confirm batch-level columns F/H/K/U are identical across every exported row, and column G is `1` for every row. - PASS (live).
- [x] **B9** Confirm `npm run migrate` has been run against the environment under test (`orders.shipping_payer` exists) before any of the above. - PASS: `DESCRIBE orders` confirms the column; migration 017 has run.

**Section verdict: PASS (9/9)** - plus an explicitly-requested highway-name edge case (street containing "Hồ Chí Minh" in a non-HCM province) confirmed correctly NOT matched as HCM.

---

## C. `order_token` security (blocking)

- [x] **C1** Read `vtpMapping.js`'s `mapOrderToRow` line by line and confirm it never references `order.order_token` anywhere. - PASS: zero references, confirmed by full read of `mapOrderToRow` (vtpMapping.js:114-144).
- [x] **C2** Generate a real export for a real order. Base64-decode the downloaded file and search the raw bytes and every decoded cell for that order's `order_token` value. Confirm zero matches. - PASS (live): order 1173's real `order_token`, walked every cell of every sheet via `exceljs` - zero matches.
- [x] **C3** Repeat C2 against every other new JSON response this phase adds. Confirm none contains `order_token` as a key or a value. - PASS: all five other routes' JSON envelopes grepped clean.
- [x] **C4** Confirm `vtpMapping.test.js`'s and `vtpWorkbook.test.js`'s `order_token` security tests are present, pass, and actually plant a distinctive, greppable secret string. - PASS: both files confirmed to plant distinctive secrets (`supersecret-bearer-token-abcdef1234567890`, `extremely-unique-bearer-token-xyz987`) and assert their absence; `vtpWorkbook.test.js` walks every cell via a documented `workbookText()` helper rather than scanning the raw (deflated-zip) buffer.

**Section verdict: PASS (4/4)**

---

## D. Tracking-code import (blocking)

- [x] **D1** Create 3 confirmed ship orders. Paste two of three tracking codes, omit the third. Confirm preview shows exactly 2 rows in "will apply" and the third is simply absent. - PASS (live): orders 1179/1180 applied, 1181 absent from both `toApply` and `skipped`.
- [x] **D2** Confirm the D1 preview. Confirm both orders move to `shipped` with correct `tracking_code`, distinct success line per order. - PASS (live): 2 distinct `ok:true` results, DB confirms both `shipped` with correct codes, 2 `email_queue` rows created.
- [x] **D3** **Idempotency.** Re-paste the exact same D1 text and preview again. Confirm both rows skip with `already_shipped`, `toApply` empty, no new email, confirm rejects an empty `rows` array with 400. - PASS (live, full): re-preview → both `skipped`; `email_queue` count unchanged; empty-array confirm → `400 invalid_input`.
- [x] **D4** **Idempotency at the confirm layer specifically.** Re-submit the exact same confirm payload (with different tracking-code values). Confirm `ok:false` for both, DB unchanged. - PASS (live): both `reason:"not_confirmed"`, original tracking codes unchanged.
- [x] **D5** **Unmatched code.** Include a row with an order code matching no real order. Confirm `skipped, reason: not_found`, no effect on other rows. - PASS (live): `DH999999` skipped `not_found`, order 1181 unaffected.
- [x] **D6** **Invalid code format.** Include a garbage order code. Confirm `reason: invalid_code`. - PASS (live).
- [x] **D7** **Duplicate tracking codes.** Two different valid order codes, identical tracking code. Confirm **both** skipped `duplicate_tracking_code`. - PASS (live): orders 1182/1183, both skipped, `toApply` empty.
- [x] **D8** **Already-shipped skip.** Move an order to `shipped` directly, then include it with a *new* tracking code in an import. Confirm skipped `already_shipped`, not overwritten. - PASS (live): order 1184, original tracking code untouched.
- [x] **D9** **Per-order isolation.** Preview a 2-row batch, cancel one before confirming. Confirm the other still succeeds, cancelled one reports `ok:false` - not a whole-batch failure. - PASS (live): orders 1185 (`ok:true`) / 1186 (`ok:false, reason:"not_confirmed"`).
- [x] **D10** **Row-count guard.** Attempt preview and confirm each with >200 rows. Confirm both 400. - PASS (live): 201-line payload → `400 invalid_input "Chỉ có thể nhập tối đa 200 dòng mỗi lần"` on both routes, before any DB lookup.
- [x] **D11** Confirm the tracking-import UI genuinely blocks writing until "Xác nhận" is clicked. - PASS (live): D1's orders confirmed still `confirmed` (not `shipped`) immediately after preview, before D2's confirm.

**Section verdict: PASS (11/11)**

---

## E. Migration and payer toggle

- [x] **E1** `SELECT shipping_payer FROM orders LIMIT 5;` on a pre-existing database - confirm every existing row shows `buyer`, not `NULL` or an error. - PASS (live): all `buyer`, no `NULL`s, no error.
- [x] **E2** Create a new order through the normal buyer checkout flow. Confirm its `shipping_payer` is `buyer` by default. - PASS (live): a real checkout order (id 1187) defaulted to `buyer`.
- [ ] **E3** Toggle an order's freeship checkbox in the export view. Confirm `shipping_payer` becomes `seller` in the database, and the checkbox state is reflected immediately in the UI without a full page reload. - API/DB half PASS (live): `PATCH .../payer {"shipping_payer":"seller"}` → `{"ok":true}`, DB confirms flip. **UI-reactivity half NOT VERIFIED (UI reactivity) - needs a browser** - `ShippingExport.test.jsx`'s freeship-toggle tests (asserting `freeshipToggle.checked === true` post-click against a mocked API, in the passing A3 suite) are a partial substitute, not a live browser confirmation. A human should toggle the checkbox in a real browser and confirm it updates without a page reload.
- [x] **E4** Attempt the payer toggle with `shipping_payer: "nobody"` - confirm `400`, column unchanged. - PASS (live): `400 {"error":"invalid_input","message":"shipping_payer phải là 'buyer' hoặc 'seller'"}`, column unchanged (verified before/after).
- [x] **E5** Attempt the payer toggle against a non-existent order id - confirm `404`. - PASS (live).

**Section verdict: PASS (E1/E2/E4/E5 full; E3 API+DB half PASS, UI-reactivity half NOT VERIFIED - needs a browser)**

---

## F. Pickup roster (blocking)

- [x] **F1** Create one confirmed pickup order paid by `bank` and one by `cod` with `cod_amount` set. Load the roster. Confirm the prepaid order shows "Đã thanh toán" and the COD order shows "Thu khi giao" with the exact `cod_amount`, distinguishable at a glance. - PASS (live): orders 1188/1189, distinguished via the `paid` boolean field, not just free text.
- [x] **F2** Create a confirmed pickup COD order with `cod_amount` left `null`. Confirm it does **not** appear in `rows`, appears in `excluded` with a reason mentioning the missing COD amount, never "collect ₫0". - PASS (live): order 1190.
- [x] **F3** Confirm every roster row's items list matches that order's actual `order_items`, spot-checked against the admin order-detail view. - PASS (live): order 1188 cross-checked against `GET /admin/orders/1188`, exact match.
- [x] **F4** Create pickup orders for 3+ differently-named buyers including a Vietnamese-diacritic name that sorts differently under a naive comparator. Confirm correct Vietnamese-locale sort. - PASS (live): `Ánh Thị Sort, Bùi Thị F1B, Proof Buyer, Trần Văn F1A` - correct `"vi"`-locale order, confirmed `roster.js` uses `localeCompare(..., "vi")`.
- [x] **F5** Confirm a `ship`-fulfillment confirmed order in the same collection does **not** appear on the roster. - PASS (live): order 1191 absent.
- [x] **F6** Confirm a `pending` (not yet confirmed) pickup order does **not** appear on the roster. - PASS (live): order 1192 absent.
- [x] **F7** Confirm a collection with zero eligible pickup orders shows an explicit empty state, not a blank panel or a JS error. - PASS: `GET /admin/shipping/roster/1` → `{"rows":[],"excluded":[]}`; `ShippingRoster.jsx` renders the explicit Vietnamese empty-state message (code inspection - static conditional render, not a visual/layout claim, so no browser needed for this specific check).

**Section verdict: PASS (7/7)** - plus an explicitly-requested completed-COD edge case confirmed correct at the pure-function level (currently unreachable via the live route, since its `WHERE status='confirmed'` already excludes `completed` orders before `buildRoster()` runs - noted as dead defense-in-depth code, not a bug).

---

## G. Workbook and file-format integrity

- [ ] **G1** Open a generated export file in a real spreadsheet application (Excel, Numbers, or Google Sheets). - **NOT VERIFIED - needs a spreadsheet app**: none available in this environment; confirmed only that `exceljs` can reopen its own output (automated suite + this pass's own cell-walks). A human with Excel/Numbers/Sheets access should open a real export and confirm it opens cleanly.
- [ ] **G2** Confirm the file opens **without** a "repair" or "corrupted file" prompt in Excel specifically. - **NOT VERIFIED - needs Excel specifically**: unavailable in this environment. A human with Excel should confirm no repair prompt appears.
- [x] **G3** Confirm the `Danh sách` sheet's header row (row 7) is untouched from the template, and data genuinely starts at row 8 with no stray leftover example-data row underneath. - PASS: header cells match the template exactly (bold/red `(*)` markers unchanged); rows 12/15/50/200/500/1000 all confirmed `null` in columns A/B/C, all the way to the template's original last row (1341).
- [ ] **G4** Confirm Vietnamese diacritics in every exported name/address render correctly when opened in a spreadsheet app. - **NOT VERIFIED - needs a spreadsheet app**: byte-level UTF-8 preservation confirmed both by this pass's own live export (B2-B4's Vietnamese names/addresses round-tripped correctly through `exceljs`) and by `vtpWorkbook.test.js`'s dedicated diacritics test, as a partial substitute - actual visual rendering needs a human with a spreadsheet app.
- [ ] **G5** **Real ViettelPost import.** Actually attempt to import a generated export file into the ViettelPost portal. Confirm ViettelPost accepts the file and every column is interpreted as intended. - **NOT VERIFIED - needs a real VTP portal account**: no account access in this environment. This is spec Outstanding Question 1, tracked below, unresolved - record who will perform this and by when.

**Section verdict: 1 PASS (G3), 4 NOT VERIFIED (all require tools genuinely unavailable in this environment - spreadsheet app, Excel, VTP portal)**

---

## H. Frontend quality

- [ ] **H1** The Vận chuyển tab appears in the admin header, in Vietnamese, in the same visual style as the other seven tabs. - **NOT VERIFIED - needs a browser.** Partial substitute: code inspection (A6 diff) shows the tab button uses the identical conditional class pattern as the other seven tabs in `Admin.jsx`. A human should confirm visually.
- [ ] **H2** Switching between the export / tracking-import / roster views preserves no stale data from the previous view. - **NOT VERIFIED - needs a browser**; `AdminShipping.test.jsx`'s three passing tests (mocked child views swap correctly, no co-rendering) are a partial substitute already in the automated suite, but do not prove "no stale data" in a real fetch/render cycle. A human should click through the real tabs and confirm no stale-data flash.
- [ ] **H3** All three views, plus the other seven admin tabs, are usable at a 375px viewport with no horizontal scroll. - **NOT VERIFIED - needs a real/emulated 375px viewport**; none available in this pass. A human should emulate a 375px viewport and check all three shipping views plus the other admin tabs.
- [x] **H4** The export order table and the roster table either wrap sensibly or scroll horizontally within their own `overflow-x-auto` container at narrow widths. - PASS (as a code-inspection substitute per this checklist's own carve-out): confirmed present in both `ShippingRoster.jsx` (line 78) and `ShippingExport.jsx` (line 129, added this phase). **Visual scroll behavior itself remains NOT VERIFIED - needs a browser** - only the markup's presence is confirmed here.
- [x] **H5** No new class in any `shipping/*.jsx` file or `AdminShipping.jsx` references a CSS custom property that isn't one of the real tokens. - PASS: every `var(--` hit references `--border-brand` only, a declared token; no undeclared custom property used.
- [ ] **H6** Console is clean (no errors/warnings) when navigating all three shipping views with real data, including after a generate/preview/confirm/print action. - **NOT VERIFIED (live console) - needs a browser.** Partial substitute: `grep -rn "console\.(log|error|warn)"` across the shipping components shows zero matches - no unintentional debug output left in the code, but this does not prove the live browser console stays clean during real interaction. A human should navigate all three views with a browser console open.
- [ ] **H7** The "In" (print) button on the roster view actually opens a usable print preview, and the collection picker plus buttons are hidden from the printed output. - **NOT VERIFIED - needs a browser and/or a printer.** Partial substitute: `ShippingRoster.jsx` has `print:hidden` on both the collection-picker/buttons row and the excluded-orders notice, consistent with the intent that only the roster table prints. A human should confirm the actual print preview.
- [x] **H8** `/`, `/shop`, `/cart`, `/checkout`, and the existing seven admin tabs all still work - no regression from adding the eighth. - PASS (API-level smoke; full page-load smoke not run, no browser): `/` → 200, `GET /api/shop/collections` → 200, all seven other admin tabs' routes respond correctly with a valid admin token. One route (`stats/bookkeeping`) returned 400 on both tried parameter shapes - pre-existing parameter-shape behavior unrelated to this phase (its own test file is part of the passing 583 backend tests), not a Phase-5 regression.

**Section verdict: 3 PASS (H4, H5, H8), 5 NOT VERIFIED (all genuinely browser/printer/viewport-dependent)**

---

## I. Auth on every new endpoint (blocking)

- [x] **I1** `GET /api/admin/shipping/export/orders` with no `Authorization` header → `401`. - PASS (live).
- [x] **I2** `PATCH /api/admin/shipping/export/orders/1/payer` with no header → `401`. - PASS (live).
- [x] **I3** `POST /api/admin/shipping/export` with no header → `401`. - PASS (live).
- [x] **I4** `POST /api/admin/shipping/tracking-import/preview` with no header → `401`. - PASS (live).
- [x] **I5** `POST /api/admin/shipping/tracking-import/confirm` with no header → `401`. - PASS (live).
- [x] **I6** `GET /api/admin/shipping/roster/1` with no header → `401`. - PASS (live).
- [x] **I7** All six routes with a malformed/garbage bearer token → `403`. - PASS (live).
- [x] **I8** All six routes with a token signed with the wrong `JWT_SECRET` → `403`. - PASS (live).
- [x] **I9** All six routes, with a **valid** token, return real data (not silently empty). - PASS (live): real, non-empty data throughout the pass on all six routes.
- [x] **I10** No response body from any of the six routes contains a buyer's `order_token`, a *different* buyer's phone/email beyond what's relevant, or any field not already exposed by existing admin endpoints. - PASS: covered by C3's grep sweep (no `order_token` anywhere) plus a read of each route's SQL confirming scoping to the relevant order(s)/collection.

**Section verdict: PASS (10/10)**

---

## J. Error handling and resilience

- [x] **J1** `POST /shipping/export` with an empty `order_ids` array → `400`, not `500`. - PASS (live): `400 invalid_input "order_ids phải là mảng khác rỗng"`.
- [x] **J2** `POST /shipping/export` with a missing or invalid `loai_hang_hoa` value → `400` with a clear message. - PASS (live): `400 invalid_input "Loại hàng hóa không hợp lệ"`.
- [x] **J3** `PATCH .../payer` for an order id that does not exist → `404`, not `500` and not a silent `200`. - PASS (live).
- [x] **J4** `GET /shipping/roster/abc` (non-numeric collection id) → `400`, not `500`. - PASS (live): `400 invalid_input "collectionId không hợp lệ"`.
- [ ] **J5** Stop MySQL, then hit each of the six routes → clean `500 server_error` JSON, backend process stays alive, recovers to `200` once MySQL restarts without a manual backend restart. - Five of six routes PASS this exactly (live). **Accepted, not fixed:** `POST /shipping/tracking-import/confirm` instead returns HTTP `200` with each row individually reporting `{"ok":false,"reason":"server_error",...}`, because each row's DB call is wrapped in its own try/catch **by design**, for the per-order isolation this same checklist's D9 requires. This is a deliberate consequence of that isolation, not an oversight - recorded here as an accepted deviation from this item's literal "clean 500" expectation, not a defect to fix. Backend process stayed `Up` throughout on all six routes; full recovery to `200` confirmed on restart with no manual backend restart.
- [ ] **J6** With MySQL down, the other admin tabs either also cleanly error or are unaffected - the shipping tab's own error never blanks the whole admin panel. - **NOT VERIFIED (panel-level rendering) - needs a browser**; the API-level `500`-not-crash behavior is verifiable via curl alone and was confirmed by J5 (other admin routes, e.g. orders/collections, also returned clean errors during the same outage in Plan 4's analogous check). A human should reproduce the MySQL outage with a browser open on the admin panel.
- [x] **J7** A rejected fetch inside `ShippingExport`/`ShippingTrackingImport`/`ShippingRoster` renders that view's own error message - confirmed by each component's test file's rejected-promise case. - **Gap found and closed during this acceptance run.** At acceptance time none of the three test files had a rejected-fetch test, even though all three components' `.catch`/`setError` handling was already correct (confirmed by source reading). Closed in follow-up commit `098602d2b98a724665bbb420fe32ec7deb181fc0`, which adds a rejected-fetch test to `ShippingRoster.test.jsx` and `ShippingTrackingImport.test.jsx` (preview + confirm) and to `ShippingExport.test.jsx` (export-generation failure), each asserting the actual rendered Vietnamese error text, and mutation-verifies all of them (test fails when the corresponding component's `.catch` is broken, passes when restored). `ShippingExport`'s order-list mount fetch was deliberately left uncovered by a dedicated test: its `.catch` silently falls back to `setOrders([])`, which renders the identical empty-state message as a legitimately empty list - there is no distinguishable error text for that specific fetch, so no test could be written that fails under a broken-catch mutation; the export-generation failure (which does have real, mutation-provable error text) was covered instead.

**Section verdict: 4 PASS (J1-J4), 1 accepted-deviation (J5), 1 NOT VERIFIED (J6), 1 fixed (J7)**

---

## K. Spec edge cases not covered above

- [x] **K1** Confirm no code in this phase parses `"freeship"` out of `buyer_name` anywhere. - PASS: only a code comment describing the *old* replaced approach, plus this phase's own `data-testid="freeship-N"` UI hooks and tests. No live regex against `buyer_name`.
- [x] **K2** Confirm the shipping export never attempts ViettelPost API booking. - PASS: `grep -rn "partner.viettelpost.vn\|viettelpost.vn/api" backend` → no matches.
- [x] **K3** Confirm no label-printing or rate-quoting code was added. - PASS: no matches.
- [x] **K4** Confirm the roster is genuinely browser-printed HTML, not a server-generated PDF. - PASS: `grep -rn "puppeteer\|pdfkit\|wkhtmltopdf"` → no matches.
- [x] **K5** No stats/shipping route or component references `frontend/src/i18n/translations.js`. - PASS: no matches.
- [x] **K6** Confirm the `Thời gian hẹn lấy` `<select>` offers exactly the 11 values from the template's own reference sheet, byte-for-byte. - PASS: ran the checklist's own verification script against the real template - exact match, same order, all 11 present, no invented/reordered/tidied values.

**Section verdict: PASS (6/6)**

---

## L. Data integrity guarantee

- [x] **L1** `grep -inE "INSERT|UPDATE|DELETE|TRUNCATE" backend/shop/shipping/*.js` returns **no matches** in `vtpMapping.js`, `vtpWorkbook.js`, `trackingImport.js`, or `roster.js`. - PASS: zero actual SQL write statements across all four files.
- [x] **L2** `grep -n "UPDATE orders" backend/routes/adminShipping.js` shows **exactly one** direct `UPDATE orders` statement (the payer toggle). - PASS: exactly one hit, the payer-toggle route; status/tracking_code writes confirmed to go through `transitionOrder()`.
- [x] **L3** Running the full shipping acceptance pass leaves every table this phase does not intend to write unaffected, and leaves `orders`/`order_items` changed **only** in the ways this checklist explicitly exercised. - PASS (targeted verification): `product_variants`/`products`/`collections` untouched by shipping code (grep-confirmed no reference at all); `orders`/`order_items` changed only via payer toggles and confirmed-import transitions exercised by this checklist; `email_queue` gained exactly 2 rows matching the 2 real confirms run, no growth on re-preview/re-confirm attempts.

**Section verdict: PASS (3/3)**

---

## Sign-off

- [x] Blocking sections **B, C, D, F, I** fully PASS. - Confirmed: B (9/9), C (4/4), D (11/11), F (7/7), I (10/10), all PASS.
- [x] The three highest-value tests from the test strategy's §4 (`order_token` security, address/COD export-error guards, tracking-import idempotency/isolation) have been read line-by-line against their test files, not just run - confirmed present, confirmed asserting what they claim to assert. - Done; see C4 (security tests), B1 (address/COD branch tests reviewed alongside B1), and D1-D11 (idempotency/isolation tests cross-checked against `trackingImport.test.js`'s doc comment and the live behavior).
- [x] `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` passes in full (A1). - Confirmed, 583/583.
- [x] `cd frontend && npm test && npm run build && npm run lint` pass, modulo the 3 pre-existing problems (A3-A5). - Confirmed; test count now 118/118 after the J7 follow-up commit `098602d2b98a724665bbb420fe32ec7deb181fc0` (was 114/114 at acceptance time).
- [x] Section L (write-scope guarantee) fully PASS - this is the property that makes every other failure in this phase bounded to "one wrong export/import," never "unrelated data corrupted." - Confirmed, L1-L3 all PASS with hard evidence.
- [ ] Every item marked **NOT VERIFIED - needs X** has either been verified in a follow-up session with the needed tool/access, or is recorded here as an accepted gap with a named owner and target date. This is expected to include at minimum G1/G2/G4/G5 (spreadsheet app, Excel, real VTP portal) and the browser-dependent H/J items - no browser, spreadsheet app, or VTP portal account is assumed available in an automated pass. - **NOT SATISFIED:** 12 items remain NOT VERIFIED (G1, G2, G4, G5, H1, H2, H3, H6, H7, J6, plus the UI-reactivity half of E3) - no browser, spreadsheet app, or VTP portal account was available during this acceptance pass. None has a named human owner or target date assigned yet; that assignment is a prerequisite for checking this box and is left for the requester.
- [x] Non-blocking findings (any Minor from the automated pass) are recorded with an explicit accept/reject decision, not left ambiguous. - Both findings resolved with an explicit decision: J7 (test-coverage gap) fixed in commit `098602d2b98a724665bbb420fe32ec7deb181fc0`, not merely accepted; J5 (confirm route's 200-with-per-row-failure shape under a DB outage) explicitly accepted as a deliberate consequence of per-order isolation, not fixed - see J5.

### Outstanding Questions from the spec - both must be tracked, neither blocks shipping this phase

- [ ] **Recheck the full VTP field mapping against a real import** (spec Outstanding Question 1; this checklist's G5). Owner: _unassigned_. Target date: _unassigned_. Not resolvable by this automated pass - no ViettelPost portal account available in this environment.
- [ ] **API integration availability** (spec Outstanding Question 2) - attempt login at `partner.viettelpost.vn`, look for *Tích hợp / Kết nối API* in the business portal, or ask the account manager. Owner: _unassigned_. Target date: _unassigned_. Not resolvable by this automated pass.

## Production readiness

- [ ] The seller has performed at least one real export → real VTP import → real tracking-code round trip before this replaces their existing Python-script workflow entirely (do not retire `/Users/phucth/vibes/vtp/fill_vtp_orders.py` until this has happened at least once). - **Not performed** - no VTP account access in this environment. Remains an open pre-launch step.
- [x] The `Thời gian hẹn lấy` options were re-checked against the template's reference sheet (K6) - VTP validates this field server-side, so a drifted string fails at upload time, not in this app's tests. - Done; see K6, exact match confirmed.
- [x] A rollback plan exists: migration 017 is additive-only (`shipping_payer` with a safe default) and reversible via `exports.down`; confirm rollback is genuinely "revert the commits, roll back the migration, redeploy" by checking no other phase's code was touched beyond the mount lines and tab entry noted in A6. - Confirmed: migration 017 additive-only (`shipping_payer ENUM('buyer','seller') NOT NULL DEFAULT 'buyer'`, confirmed via `DESCRIBE orders`). A6's corrected scope note applies here too: rollback would also revert the `IMPORT_LIMIT` body-parser branch and 413-handler extension in `server.js`, both additive and isolated to the new tracking-import upload path - this widens A6's originally-claimed blast radius slightly but does not change the rollback conclusion; no other phase's code was touched.

---

## Consistency check (counts)

Counted directly against this file's checkbox lines (`grep -cE '^\s*- \[[ x]\]'`):

- **Whole document (A-L + Sign-off + Outstanding Questions + Production readiness): 93 items total - 77 ticked, 16 unticked.**
- **Sections A-L only: 81 items - 69 ticked, 12 unticked.** The 12 unticked A-L items are: **E3**, **G1**, **G2**, **G4**, **G5**, **H1**, **H2**, **H3**, **H6**, **H7**, **J5**, **J6**.
- The remaining 4 unticked items live outside A-L: 1 in Sign-off ("every NOT VERIFIED item has a named owner/date"), 2 in Outstanding Questions, 1 in Production readiness (real VTP round trip).

Cross-checking against the acceptance report's claims:

- **Blocking sections B, C, D, F, I fully PASS** - confirmed: all 41 of their items (9+4+11+7+10) are ticked, zero unticked in any of the five.
- **12 NOT VERIFIED items** - the report's own list is "G1, G2, G4, G5, H1, H2, H3, H6, H7, J6, and the UI half of E3" (11 named checklist lines) plus H4's residual "visual scroll behavior NOT VERIFIED" sub-note, even though **H4's own checkbox is ticked** (PASS, via this checklist's own code-inspection carve-out for that item). That sub-note is what brings the report's tally to "12."
- **1 FAIL now closed** - J7, ticked here, annotated with commit `098602d2b98a724665bbb420fe32ec7deb181fc0`.

**My count disagrees slightly with the report's framing, and I'm reporting that rather than forcing a match:** counting only unticked checkboxes, sections A-L have **12 unticked items**, but they are E3, G1, G2, G4, G5, H1, H2, H3, H6, H7, **J5**, J6 - i.e. **11** of the report's 12-item NOT VERIFIED list (everything except H4, which is ticked) **plus J5**, which the report explicitly does not count among the "12 NOT VERIFIED" (J5 is a distinct accepted-deviation/finding, not a tools-unavailable gap). So by a strict "unticked checkbox" count there are 12 unticked A-L items, but they are not the same 12 the report enumerates - the report's 12 includes a sub-note on an item whose checkbox is actually ticked (H4), and excludes J5 (which is unticked here for a different, deliberate reason). The blocking-sections-PASS and J7-closed claims match exactly; the "12 NOT VERIFIED" claim matches in count but not in exact membership once J5's different unticked status is accounted for.
