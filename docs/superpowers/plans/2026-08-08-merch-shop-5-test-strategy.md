# Merch Shop — Plan 5 Test Strategy: ViettelPost Export & Shipping Handoff

Covers `2026-08-08-merch-shop-5-shipping.md` only. Builds on, and does not repeat, `2026-08-07-merch-shop-test-strategy.md` (Plans 1–3) and `2026-08-08-merch-shop-4-test-strategy.md` (Plan 4) — read those first for the risk-weighting philosophy, environments, and regression-suite conventions this document assumes.

Plan 4 was entirely read-only, which capped its worst outcome at "the seller sees a wrong number." **This phase is not read-only.** It generates a spreadsheet a courier acts on with a real parcel, and its tracking-code importer moves real orders to `shipped` and sends real emails. The two failure modes that matter here are physical and financial, not merely cosmetic:

1. A shipment booked to the **wrong address**, or with a **wrong COD amount** — real money and a real parcel that may never come back.
2. A bulk tracking-code import that **silently half-fails** while the seller believes every buyer was notified their order shipped.

Every other risk in this phase is downstream of one of those two.

---

## 1. Risk register

| # | Risk | Consequence | Severity | Primary defense |
|---|---|---|---|---|
| T1 | Wrong or blank shipping address exported | Parcel misdelivered or undeliverable; buyer never receives paid merch | **High** | `assembleAddress` returns `null` on no usable address; `mapOrderToRow` rejects rather than exports blank (blocking) |
| T2 | COD order exported with a blank or wrong collection amount | Seller ships merch and collects nothing, or the wrong amount, at the door | **High** | `resolveCod` treats a null `cod_amount` on a COD order as an export error, never a blank J (blocking) |
| T3 | `order_token` leaks into an exported artifact | A third party (a courier, or anyone who later opens the spreadsheet) gains a working bearer credential to a buyer's order page | **High** | `mapOrderToRow` never reads `order.order_token`; dedicated tests scan the mapped row AND the raw generated xlsx buffer for a planted token (blocking) |
| T4 | Wrong intra/inter-province service selected | Wrong price charged, or (intra selected for an inter-province address) the booking fails at the courier's counter | Medium | Exhaustive HCM-keyword matrix in `vtpMapping.test.js`; unknown/empty province defaults to the safer inter-province service |
| T5 | Tracking import re-applied after a timeout retry, double-emailing a buyer | Buyer gets two "your order shipped" emails, confusing and unprofessional; seller loses trust in the tool | **High** | `resolvePreview` reports `already_shipped` for any order not in `confirmed`; `transitionOrder`'s own state machine additionally refuses a second `confirmed -> shipped` transition even if a caller retried (blocking) |
| T6 | One bad row in a tracking import silently blocks or corrupts the whole batch | Seller believes an import failed entirely and re-tries by hand, or a batch of good rows never gets applied | **High** | Per-order isolation in the confirm route (each row goes through its own `transitionOrder` call in its own `try/catch`, mirroring `adminOrders.js`'s bulk-cancel) (blocking) |
| T7 | An unmatched tracking code is silently guessed onto a nearby order | Wrong order marked shipped with someone else's tracking code; buyer A is told buyer B's parcel is theirs | **High** | `resolvePreview` never applies a code whose order id does not resolve to a real, confirmed order — `not_found`/`invalid_code` always land in `skipped`, never `toApply` |
| T8 | Duplicate tracking codes in one file applied to two different orders | Two orders share a courier tracking number; delivery status becomes unreliable for both | Medium | `resolvePreview` rejects **both** rows sharing a duplicated tracking code, not just the second |
| T9 | Migration 017 changes payer semantics for existing orders | An order created before this phase silently becomes marked as freeship or vice versa | Medium | Column default `'buyer'` matches current behavior (buyer always paid before this phase existed); dedicated migration test asserts the default |
| T10 | Roster shows a COD order without an amount as "collect ₫0" | Buyer collects merch at the booth without paying, seller only notices after the event | **High** | `buildRoster` excludes and reports a COD order with a null `cod_amount`, mirroring T2's guard, rather than defaulting to 0 |
| T11 | Roster mixes up which orders are prepaid vs collect-at-handover | Buyer over- or under-charged at handover, or merch given away that should have been paid for | **High** | Dedicated paid/not-paid tests per payment method; the field is boolean and directly rendered, no derived guesswork on the frontend |
| T12 | Export/roster reachable without auth | Third party sees the seller's whole order book — names, phones, addresses, money owed | **High** | 401/403 probes on every new route (blocking) |
| T13 | Export includes an order that changed status between listing and generating (race) | An already-cancelled or already-shipped order gets exported and re-booked | Medium | `POST /shipping/export` re-fetches and re-validates every order server-side before generating, never trusting the client-sent snapshot |
| T14 | The `Thời gian hẹn lấy` option list drifts from the template's reference sheet (a value edited, reordered or "tidied") | Import into the real VTP portal fails on a value that looks plausible; VTP validates this field server-side, so nothing in this app catches it | Medium | The 11 values are transcribed verbatim into the plan's Global Constraints and asserted against the template itself by verification item K6 |
| T15 | Weight/goods-type/service value not accepted by VTP's real dropdown validation | Import rejected at the VTP portal despite passing every automated test here | Medium | `LOAI_HANG_HOA_VALUES` and the two exact service strings are the only enumerations verified against the real template; flagged as needing the real-import recheck (Outstanding Question 1) |
| T16 | Roster or export queries slow down as orders accumulate | Feature becomes unusable before a large event | Low | Both routes scope by `collection_id`/`status`, small result sets by nature (a single event's confirmed orders); revisit only if it ever measurably matters |
| T17 | `exceljs`'s zip/XML internals silently corrupt Vietnamese diacritics on write | Courier prints a garbled name/address label | Medium | Dedicated diacritics round-trip test in `vtpWorkbook.test.js`, asserted by reopening the generated buffer, not by inspecting the writer's input |

Risks T1, T2, T3, T5, T6, T12 get coverage at multiple levels and are called out as **blocking** in the verification checklist — a failure in any of them stops the phase from shipping, full stop. Everything else gets coverage proportional to severity.

---

## 2. Test levels

### L1 — Unit

Pure logic, no I/O. Vitest, `backend/tests/*.test.js`.

**Scope:**
- `vtpMapping.js` — `orderCode`, the full HCM-keyword matrix for `isHoChiMinh`/`selectService` (7 recognised variants, case-insensitivity, a non-HCM province, null/undefined/empty), `assembleAddress`'s four branches (all parts present, partial, raw fallback, both empty → null), `resolveCod`'s three branches (prepaid always blank, COD with value, COD with null → error), `selectPayer`'s two values plus the default, `mapOrderToRow`'s composition (two full hand-computed rows, phone whitespace stripping, both error paths) and its **security test** (`order_token` absent from the mapped row and from a `JSON.stringify` of it, even when the input object carries the token or other unexpected fields).
- `trackingImport.js` — `parseOrderCode` (well-formed, case-insensitive, whitespace-tolerant, four invalid forms), `parsePastedText` (tab-separated, comma-separated, blank-line skipping, empty/non-string input), `extractPairsFromSheetRows` (header-text column matching regardless of position, missing-header empty result, header-only/empty-array empty result, blank-row skipping), and `resolvePreview`'s full outcome matrix (apply, invalid code, missing tracking code, not found, already-shipped, not-confirmed, duplicate tracking code, per-row isolation, and the idempotency case where every order is already `shipped`).
- `roster.js` — paid vs COD `amount_due`, the COD-with-null-`cod_amount` exclusion, item mapping, Vietnamese-locale sort, empty input.

### L2 — Integration

A module or route against the real `cosplay_test` MySQL schema. Vitest, same tooling and isolation as Plans 1–4 (`resetTables` before every test).

**Scope:**
- `vtpWorkbook.buildExportWorkbook` — reopens its own output with `exceljs` rather than inspecting the writer's internal state, so the assertions prove the *file on disk* is correct, not just the code that produced it: sheet name, row-8 start, every mandatory column populated, batch columns repeated per row, COD/prepaid J handling, exclusion-and-continue behavior, diacritics survival, and the buffer-level `order_token` security scan (T3).
- `backend/migrations/017_add_order_shipping_payer.js` — default value on a freshly created order, updatability, enum rejection of an out-of-range value.
- `adminShipping.js` routes (Tasks 8–10) — auth on every route; the export listing's three exclusion rules (has tracking code, wrong fulfillment method, wrong status); the payer toggle's validation and 404; the export route's server-side re-validation of stale client state (T13) and its 400s on missing/invalid batch fields; the tracking-import preview and confirm routes' full request/response contract including the **idempotency** test (import, then re-preview, then re-confirm, asserting no double-write and no double-email trigger) and the **per-order isolation** test (one order races to `cancelled` between preview and confirm; the other order in the same batch still succeeds); the roster route's fulfillment/status filtering and its COD-exclusion passthrough from `roster.js`.

### L3 — Component

Frontend, Vitest + `react-dom`'s `createRoot`/`act` (this codebase does not use Testing Library — see `AdminOrders.test.jsx`/Plan 4's `StatsDrop.test.jsx` for the established pattern; this phase's component tests follow it exactly).

**Scope:**
- `AdminShipping` — view switcher, defaults to export, switches on click.
- `ShippingExport` — empty state, order listing with checkboxes, freeship toggle wired to the payer-update call, batch-field-driven generate call, base64-to-download flow (mocked `URL.createObjectURL`), excluded-orders-after-generate display.
- `ShippingTrackingImport` — preview rendering of `toApply`/`skipped`, **no confirm call fires from preview alone** (a dedicated negative assertion, since the whole point of the preview step is that nothing is written until the seller explicitly confirms), confirm sends exactly the previewed `toApply` array, per-order results rendering, empty-preview state.
- `ShippingRoster` — collection-gated fetch, paid-vs-collect-at-handover rendering per row, excluded-orders display, presence of the print action.

### L4 — API contract

Supertest against the exported Express `app`, folded into the same integration test files as L2 above (this phase does not split contract tests into a separate file per route group the way Plan 4 did, since each route group's contract and its business-logic assertions are inseparable here — e.g. the export route's 400 on an invalid `loai_hang_hoa` *is* the contract test).

**Scope:** auth required on all seven routes (401 no token, 403 bad/wrong-secret token — spot-checked per route group, exhaustively on at least one representative route per group); 400 on malformed export/import/roster input; 404 on an unknown order id (payer toggle) or an unknown/malformed collection id (roster).

### L5 — End-to-end / acceptance

Manual, scripted by `2026-08-08-merch-shop-5-verification.md`. No new automated E2E — same rationale as Plans 1–4.

**Journeys:**
1. Seller confirms a mix of ship orders (prepaid HCM, COD inter-province, one freeship, one with no structured address, one COD with no `cod_amount`) → opens Vận chuyển → selects all eligible orders → fills batch fields → exports → downloaded file opens in a spreadsheet app, rows match a hand-computed table, the two bad orders are reported excluded and absent from the file.
2. Seller (simulating a returned VTP result) pastes order-code/tracking-code pairs, including one unmatched code and one duplicate → previews → confirms → orders move to `shipped`, buyer emails are queued, the result screen shows per-order outcomes → seller re-pastes the **same** file → preview shows nothing to apply (idempotency).
3. Seller opens the roster for a collection with a mix of prepaid and COD pickup orders → printed/print-previewed page shows every item and the correct paid-vs-collect distinction, sorted by name → seller confirms this matches a hand count of the admin Đơn hàng list filtered to that collection and `pickup`.
4. **The two Outstanding Questions from the spec, tracked as standing follow-ups, not closed by this test suite**: (a) a real import of a generated file into the ViettelPost portal, confirming every column the automated tests can only assert shape/value for, actually accepted; (b) the VTP API-access question, which determines whether a future phase can replace this spreadsheet round trip.

### L6 — Non-functional

| Area | Method |
|---|---|
| **Security** | Auth probes on all seven routes (T12); `order_token` absence proven at three layers — the pure mapping function, the generated xlsx buffer, and (spot-check) the JSON responses of every new route (T3) |
| **Data integrity** | Confirm the tracking-import confirm route writes `status`/`tracking_code` **only** through `transitionOrder` — grep `adminShipping.js` for a direct `UPDATE orders SET status` or `UPDATE orders SET tracking_code` outside the one legitimate direct write (the payer toggle, which is not a status-machine field) |
| **Resilience** | Stop MySQL, hit each of the seven routes → clean `500` JSON, backend process stays alive, other admin tabs unaffected (matching Plan 4's I2/I3 pattern) |
| **Performance** | `buildExportWorkbook` and `buildRoster` timed against a few dozen orders (realistic single-drop/single-event scale); confirm the export route does one `getOrderById` per requested order (bounded by the request's own `order_ids` length, not the whole table) rather than an unbounded scan |

---

## 3. What this plan must prove before shipping

- No order is ever exported with a blank, guessed, or fallback-to-nothing address (T1) — an order with no usable address is excluded and reported, always.
- No COD order is ever exported, or listed on the roster, with a blank or invalid collection amount (T2, T10) — this is treated as an export/roster **error**, not a zero.
- `order_token` cannot reach a courier, a downloaded file, or any JSON response this phase adds, under any input (T3) — proven at the mapping-function level and the raw-generated-file-bytes level, not just "the code doesn't reference it."
- Re-importing the same tracking-code file twice is a safe no-op: no order is transitioned twice, no buyer is emailed twice (T5).
- A batch tracking import reports **exactly** what happened to every row it was given — never a blanket "success," and one bad row never silently drops or corrupts a good one (T6, T7, T8).
- Every new route requires the same auth as every existing admin route (T12).
- Service selection defaults to the safer of its two wrong guesses when the input is ambiguous (T4).
- The roster never conflates a paid order with a collect-at-handover one (T11).

---

## 4. The three highest-value tests — all blocking

### 4.1 `order_token` never exported (`vtpMapping.test.js` + `vtpWorkbook.test.js`)

Two layers, deliberately redundant: `mapOrderToRow`'s test plants a real-looking token on the input order and asserts it is absent from both the returned row object's keys and a `JSON.stringify` of its values (catching a token that leaked into, say, an address field by a future refactor). `buildExportWorkbook`'s test goes one level further and scans the **raw generated xlsx buffer's bytes** for the same planted token — proving the property holds after `exceljs` has serialized everything into its zip/XML internals, not just in the JavaScript object the writer was handed. A pure unit test of the mapping function alone could pass while a bug in the workbook-writing step still leaked the token into a hidden cell, a comment, or shared-string table entry; the buffer-level scan is what actually rules that out.

**Any failure here is a Blocker per §8** — `order_token` is a bearer credential; its presence in an exported file is a live account-takeover vector for whichever buyer's order it belongs to, handed to a third party (the courier) by construction.

### 4.2 Address and COD export-error guards (`vtpMapping.test.js`, `vtpWorkbook.test.js`, `adminShipping.js`'s export-route tests)

`assembleAddress` returning `null` and `resolveCod` returning `{ok: false}` are each tested at the pure-function level, then again at the workbook level (an excluded order writes no row and is reported, a good order after it still lands at row 8), then again at the route level (the export response's `excluded` array is what the frontend renders — Task 12's component test confirms the seller actually sees the reason, not just that the backend computed one). The same three-layer pattern covers the roster's identical COD guard (`roster.test.js`, `adminShippingRoster.test.js`, `ShippingRoster.test.jsx`).

**Any failure here is a Blocker per §8** — this is the literal "wrong address / wrong COD amount" risk named at the top of this document, the single worst outcome the phase can produce.

### 4.3 Tracking-import idempotency and per-order isolation (`trackingImport.test.js` + `adminShippingTrackingImport.test.js`)

`resolvePreview`'s unit test simulates re-running preview against orders already moved to `shipped` and asserts `toApply` is empty. The route-level test goes further and actually runs `confirm` once, then runs `confirm` again with the identical payload, and asserts (a) the second call's result reports failure for that row rather than silently succeeding, and (b) the order's `tracking_code` in the database is unchanged — not overwritten a second time. A separate route-level test forces one order in a two-order batch to race to `cancelled` between preview and confirm and asserts the *other* order in the same request still succeeds, proving per-order isolation is real at the HTTP layer, not just in the pure resolver.

**Any failure here is a Blocker per §8** — this is the "seller believes every buyer was notified" risk; a regression here means a batch of buyers can silently not receive their shipped email while the admin UI reports success.

---

## 5. Test data

- Same conventions as Plans 1–4: `resetTables("order_items", "orders", "product_variants", "products", "collections")` before every integration test that touches orders.
- Orders are created through `orderRepo.createOrder`/`transitionOrder` wherever a test doesn't specifically need to force a column those functions don't expose directly (this phase introduces none — unlike Plan 4's `expires_at` backdating, every field this phase reads is either set at order creation or by `transitionOrder`/the new payer-toggle route).
- Vietnamese fixtures use real diacritic-bearing names and addresses (`Đặng Thị Ngọc Ánh`, `45 Đường Điện Biên Phủ`, `Ánh Dương`) specifically chosen to exercise combining-mark normalization (`normalize("NFD")`) in `isHoChiMinh` and round-trip fidelity through `exceljs`.
- The HCM-recognition test matrix (`vtpMappingAddress.test.js`) is deliberately built from every variant string a real Goong autocomplete result plausibly returns (`Hồ Chí Minh`, `TP. Hồ Chí Minh`, `Thành phố Hồ Chí Minh`, `Ho Chi Minh`, `HCM`, `TPHCM`, `Sài Gòn`), not an invented list — chosen to mirror the seller's existing Python script's keyword list, restricted to the structured province field per the spec's stated departure from that script.
- A dedicated "planted secret" fixture (`order_token: "extremely-unique-bearer-token-xyz987"` or similar) is reused across the three layers of §4.1 specifically because a shared, greppable, obviously-not-organic string makes a false negative (the scan finding something else that happens to look like a token) effectively impossible.
- Route-level tests build real confirmed orders through the full `createOrder`/`transitionOrder` path — no hand-inserted `status = 'confirmed'` rows — so a test failure can never be explained away as "that state isn't reachable through the real API."

---

## 6. Regression suite

Runs on every change, same commands as Plans 1–4:

```bash
cd backend  && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test
cd frontend && npm test && npm run build && npm run lint
```

`npm run lint` carries 3 known pre-existing problems (`Portfolio.jsx` x2, `AdminAlbumImages.jsx` x1) from earlier phases — see the plan's Global Constraints. No task in this phase may introduce a fourth without fixing it before its own commit.

Approximate new backend test count by file (for tracking regression as the phase lands — exact counts are in each task's "Run to verify it passes" step): `vtpTemplate` 4, `vtpMappingAddress` 20, `vtpMapping` 17, `migrationShippingPayer` 3, `vtpWorkbook` 9, `trackingImport` 24, `roster` 8, `adminShippingExport` 12, `adminShippingTrackingImport` 10, `adminShippingRoster` 7 — **114 new backend tests**, bringing the suite from 420 to 534. Frontend: `AdminShipping` 3, `ShippingExport` 5, `ShippingTrackingImport` 4, `ShippingRoster` 4 — **16 new frontend tests**, bringing the suite from 88 to 104.

---

## 7. Entry and exit criteria

**A task is done when:** its own tests pass, the full backend and frontend suites pass with no regression, and it is committed.

**Plan 5 is done when:**
- All fourteen tasks are done.
- §4.1, §4.2, and §4.3 all pass, with no accepted-failure exception for any of them.
- The acceptance checklist (`2026-08-08-merch-shop-5-verification.md`) is fully PASS, or every open item has a recorded accept/reject decision — including the items that explicitly cannot be verified without a browser, a real VTP portal account, or a printer.
- No High-severity risk from §1 is unmitigated.
- Both Outstanding Questions from the spec (the real-import mapping recheck, the VTP API-access question) are recorded as open standing follow-ups with an owner, not silently dropped — this phase does not require them resolved to ship, but it does require them tracked.

**The phase ships when Plan 5 is done and Plans 1–4's own exit criteria still hold** (re-run their regression suites; this phase adds a migration, two mount-point lines, and one Admin.jsx tab entry, and touches no other existing file's behavior).

---

## 8. Defect handling

Same severity table as Plans 1–4 (`Blocker` / `Major` / `Minor`), with this phase's own reading: **because this phase writes real shipment data and moves real orders, "Blocker" here includes both the money-classification-style "wrong number" failures Plan 4 defined AND physical/security failures unique to this phase** — a wrongly-addressed or wrongly-valued export row, an `order_token` leak, a re-sent shipped email, or an auth gap on any new route are all Blockers. A cosmetic roster table misalignment on mobile, are Minor.

Every Blocker and Major gets a regression test before the fix is considered complete, matching the Plans 1–4 convention. Given this phase's stakes, a Blocker found during manual acceptance (§verification) additionally requires the specific hand-computed fixture that caught it to be added as an automated test before sign-off — "fixed and verified once by hand" is not sufficient closure for a wrong-address or wrong-COD-amount class of bug.
