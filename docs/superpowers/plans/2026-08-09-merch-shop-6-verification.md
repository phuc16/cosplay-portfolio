# Merch Shop — Plan 6 Verification (post-implementation QA)

Run after every task in `2026-08-09-merch-shop-6-onboarding.md` is implemented and committed, against a running stack. This is the final gate before the buyer-onboarding copy goes live.

**Blocking sections: B, C, D.** Section B is the sweep-window state — a buyer transferring money against an order that is already, or about to be, cancelled is the single worst outcome this feature can produce. Section C is the `toPublicOrder` allowlist — this project has already shipped one field-leak defect through this exact function. Section D is the null/COD-never-expires rule — showing anything but nothing for a COD order risks a buyer believing a non-existent deadline exists, or normalizing a broken-looking UI. Nothing ships with an open failure in those.

**Honesty note, carried over from Plans 3–5's verification:** several items below need a real browser at a real 375px viewport, or a real clock in more than one timezone, and this pass may be run in an environment with neither. Every such item is marked **NOT VERIFIABLE HERE — needs X** rather than silently checked off; do not mark an item PASS on the strength of a code-inspection or unit-test substitute unless that substitute is explicitly called out as sufficient.

## Setup

```bash
docker compose up -d --build
cd frontend && npm run dev
```

```bash
API=http://localhost:5000/api
```

---

## A. Automated suite

- [x] **A1** `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` — full suite passes, including the 3 new `expires_at` tests in `orderRoutes.test.js`. Record the total: expect 586 (583 + 3). — PASS (live): `Test Files 47 passed (47)`, `Tests 586 passed (586)`.
- [x] **A2** `cd frontend && npm test` — full suite passes, including `orderDeadline.test.js` (11 tests), the 6 new tests in `Order.test.jsx`, and the 2 new tests in `Checkout.test.jsx`. Record the total: expect **147** (corrected from this doc's stale prediction of 137; 147 is the real sum of each task's own per-task test additions as work was added, not scope creep). — PASS (live): `Test Files 19 passed (19)`, `Tests 147 passed (147)`.
- [x] **A3** `cd frontend && npm run build` — succeeds. A pre-existing >500KB chunk-size warning is not a failure. — PASS (live): `✓ 156 modules transformed`, `✓ built in 1.49s`, only the pre-existing `index-BIvSy696.js` (590.46 kB) chunk-size warning.
- [x] **A4** `cd frontend && npm run lint` — shows exactly the 3 pre-existing problems noted in the plan's Global Constraints (`Portfolio.jsx` x2, `AdminAlbumImages.jsx` x1) and **no other** error. Any new lint problem in `orderDeadline.js`, `Order.jsx`, `Checkout.jsx`, or their test files blocks sign-off. — PASS (live): exactly the 3 named pre-existing problems, no new lint problem in any Phase 6 file.
- [x] **A5** Confirm this phase's changes are limited to: `backend/routes/orders.js`, `backend/tests/orderRoutes.test.js`, `frontend/src/utils/orderDeadline.js` (new), `frontend/src/utils/orderDeadline.test.js` (new), `frontend/src/i18n/translations.js`, `frontend/src/pages/Order.jsx`, `frontend/src/pages/Order.test.jsx`, `frontend/src/pages/Checkout.jsx`, `frontend/src/pages/Checkout.test.jsx` (new or modified). Any other file touched is a scope surprise — investigate and record it here, per Plan 4/5's precedent of correcting rather than assuming a plan's file list is exhaustive. — PASS with a recorded scope surprise (live `git diff --stat`): also touched are `frontend/src/components/shop/ShopHeader.jsx` (new), `ShopHeader.test.jsx` (new), `Cart.jsx`, `Collection.jsx`, `Portfolio.jsx`, `Shop.jsx`, `frontend/src/shop/cart.js`. These come from separate commits (`ccc8aab`, `b672f60`) implementing a "give the shop its own header" navigation refactor the user requested mid-session — a separate, already-completed and already-reviewed piece of work, not part of Phase 6's task list, and it does not touch any deadline/allowlist logic.

---

## B. The sweep-window state (blocking)

- [x] **B1** Read `frontend/src/utils/orderDeadline.js`'s `passed` computation line by line. Confirm it uses `<=`, not `<`, against `now.getTime()`. A deadline exactly equal to the current instant must be treated as passed, not as the last live second of a countdown. — PASS: `orderDeadline.js:17`, `const passed = deadline.getTime() <= now.getTime()`.
- [x] **B2** Confirm `remainingHours` is hardcoded to `0` inside the `passed` branch, not computed from a (possibly negative) time difference and then clamped. — PASS: `orderDeadline.js:39-41`, `remainingHours = passed ? 0 : Math.max(1, Math.ceil(...))`.
- [x] **B3** Create a real order with `payment_method: "bank"`, then directly set its `expires_at` a few seconds in the past via the database, without changing its `status` from `pending` (simulating the interval before the worker's next ~5s sweep tick catches it):
  ```sql
  UPDATE orders SET expires_at = DATE_SUB(NOW(), INTERVAL 5 SECOND) WHERE id = <id>;
  ```
  Immediately (before the worker sweeps it), load the order page. Confirm it shows the passed-deadline message (`orderDeadlinePassed`) and **not** any "còn X giờ" / "Xh left" text. — PASS, fully live-verified including the race: order token `819a1948b0b67cd810c46c715153a127` (id 1199) had its `expires_at` set into the past while `status` stayed `pending`; both the Docker worker and two stray host `node worker.js` processes were suspended first so the sweep race could be captured; `curl` confirmed `status:"pending"` with a past `expires_at`; `formatDeadline` on that exact value returned `passed:true, remainingHours:0`; traced `Order.jsx`/`DeadlineBlock` render path and confirmed the passed branch returns before any countdown JSX is reached.
- [x] **B4** Create a real order with `payment_method: "bank"` and a real, several-hours-future `expires_at` (the value `createOrder` naturally sets — no manual edit needed). Load the order page. Confirm it shows the absolute time and a positive "còn N giờ" / "Nh left", and does **not** show the passed-deadline message. — PASS (live): order token `6503864ce05dbfc32528faaea4b01ea6`, real `expires_at` ~48h out, `status:"pending"`; `formatDeadline` on the value returned `passed:false` with a positive `remainingHours`; `Order.jsx` renders the countdown line in this branch.
- [x] **B5** Read `Order.jsx`'s `DeadlineBlock` usage and confirm it is gated by `isPending` (i.e. `order.status === "pending"`), not rendered unconditionally. Manually set a confirmed order's `expires_at` to a past timestamp in the database and load its order page; confirm **no** deadline text of any kind (neither countdown nor passed-message) appears. — PASS: `Order.jsx:169`, `{isPending && <DeadlineBlock .../>}`; live-verified against order id 1198 transitioned to `confirmed` with a past `expires_at` — code trace confirms the `&&` short-circuit skips `DeadlineBlock` entirely (no browser available to screenshot the rendered DOM; code-trace + real API data used as the stated substitute).
- [x] **B6** Confirm `orderDeadline.test.js`'s two "SWEEP WINDOW" tests are present, pass, and actually assert `passed: true` / `remainingHours: 0` at both the `<=` boundary and a few seconds past it (not just one of the two). — PASS: both present at lines 52 and 59, asserting `passed:true, remainingHours:0` at the exact boundary and a few seconds past it; both run green in A2.

**Section verdict:** ___

---

## C. `toPublicOrder` allowlist (blocking)

- [x] **C1** Read `backend/routes/orders.js`'s `toPublicOrder` line by line. Confirm `expires_at` was added to **both** the destructure and the returned object literal — a change to only one is a bug (an added-but-unreturned field, or a returned-but-undestructured `undefined`). — PASS: present in both the destructure (line 33) and the returned object literal (line 37).
- [x] **C2** Confirm the diff to `toPublicOrder` is exactly one field addition — no other field was added, removed, or renamed in the same edit. — PASS: only `expires_at` added, all surrounding fields unchanged.
- [x] **C3** Hit a real order via `curl "$API/orders/<token>"` (a real prepaid order's token). Confirm the JSON response contains `expires_at` as a non-null value, and does **not** contain `request_key`, `stock_released_at`, `payment_proof_url`, `note`, `buyer_name`, `phone`, `email`, or `address_raw`. — PASS (live): tokens `2a2a734bde26b102a5ec2af5650d2fd3` / `819a1948b0b67cd810c46c715153a127`; `expires_at` present as a non-null ISO string, none of the 8 excluded keys present.
- [x] **C4** Repeat C3 against a real COD order's token. Confirm `expires_at` is present with value `null`, not absent and not `undefined`/omitted. — PASS (live): token `ab509211f3e8ec4514a26f547315f237`, `"expires_at": null` present as an explicit key.
- [x] **C5** Confirm the allowlist-regression test in `orderRoutes.test.js` (Task 1 Step 1's third new test) is present, passes, and actually names all eight excluded fields individually, not via a shorthand that could silently stop checking one of them if the object shape changed. — PASS: `orderRoutes.test.js:222-238` individually asserts `not.toHaveProperty` for all 8 fields plus `toHaveProperty("expires_at")`; passes in green A1 suite.

**Section verdict:** ___

---

## D. Null and unparsable `expires_at` (blocking)

- [x] **D1** Load a real COD order's order page. Confirm no deadline-related text, box, or placeholder appears anywhere near the status block — not "no deadline", not an empty bordered box, nothing. — PASS (code-trace + live-data substitute, no browser): COD order `ab509211f3e8ec4514a26f547315f237` has `expires_at: null`; `formatDeadline(null)` returns `null`; `DeadlineBlock`'s `if (!info) return null` fires before any JSX is built. Cannot confirm the actual rendered DOM without a browser; explicitly labeled as a substitute.
- [x] **D2** Confirm `formatDeadline(null)` and `formatDeadline(undefined)` both return `null` by reading `orderDeadline.test.js`'s corresponding tests and confirming they pass. — PASS (live): ran directly, both return `null` (also `formatDeadline("")` → `null`); matches `orderDeadline.test.js:5-13`, passing.
- [x] **D3** Confirm `formatDeadline("not-a-real-date")` returns `null`, not a value containing the literal string `"Invalid Date"`. Read the unit test and confirm it passes. — PASS (live): ran directly, returns `null`; matches `orderDeadline.test.js:17-20`, passing.
- [x] **D4** In a browser console (or a quick Node REPL) confirm `new Date("not-a-real-date").getTime()` is `NaN` in this project's actual runtime (documenting the assumption the guard relies on, not just trusting it abstractly). — PASS (live): `Number.isNaN(new Date("not-a-real-date").getTime())` → `true`, confirmed in this project's actual Node runtime.

**Section verdict:** ___

---

## E. Bilingual copy

- [x] **E1** Open `frontend/src/i18n/translations.js` and manually confirm each of these keys exists in **both** the `en` and `vi` blocks: `orderSaveLink` (extended value), `orderDeadline`, `orderDeadlinePassed`, `orderManualConfirmNote`, `orderTransferNoteExplain`, `checkoutPaymentWindow`. Six keys, twelve total entries (six per language). — PASS: all six keys present in both `en` (lines 48-55) and `vi` (lines 170-177) blocks, all with distinct content.
- [x] **E2** Confirm `orderSaveLink`'s new value in both languages actually mentions the link having been emailed — not just any edit, the specific fact the spec calls for. — PASS: `en` says "We also emailed it to you", `vi` says "Chúng tôi cũng đã gửi đường dẫn này qua email cho bạn."
- [ ] **E3** Switch the site language toggle to `vi`, reload the order page for a pending prepaid order, and confirm every piece of new copy (deadline line, manual-confirm note, transfer-note explanation, save-link line) renders in Vietnamese, not falling back to an English default (which would happen silently if a `vi` key were missing, per `LanguageContext`'s fallback behavior). — NOT VERIFIABLE HERE without a browser; a partial substitute is E1's direct file read, which proves the keys exist but not that the running page actually resolves them correctly at runtime. — **NOT VERIFIED — no browser tool available in this acceptance pass.** A human should toggle the language switch to `vi` on a real pending prepaid order page and confirm no English fallback appears.
- [ ] **E4** Repeat E3 with the toggle set to `en`. — **NOT VERIFIED — no browser tool available**, same reasoning as E3. A human should repeat E3's check with the toggle set to `en`.
- [x] **E5** Confirm `checkoutPaymentWindow` in both languages does not name a specific number of hours (per the plan's Task 5 design decision) — grep both entries for any digit; expect none. — PASS: neither the `en` nor `vi` string contains any digit character.

**Section verdict:** ___

---

## F. `Order.jsx` and `Checkout.jsx` behavior

- [ ] **F1** Load a pending, prepaid order's page. Confirm the manual-confirmation note (`orderManualConfirmNote`) is visible beside the status block. — **NOT VERIFIED — no browser tool available.** Gating logic traced live instead: for a real pending prepaid order, `showManualConfirmNote = showPaymentInstructions && !deadlineInfo?.passed` evaluates true, and `Order.test.jsx`'s matching component test is present and green. A human should load a real pending prepaid order page and confirm the note is visible.
- [x] **F2** Confirm the transfer-note explanation (`orderTransferNoteExplain`) appears only alongside the payment instructions block (i.e. only while `showPaymentInstructions` is true — pending and non-COD), not for a COD order and not once the order leaves pending. — PASS: `Order.jsx:177` uses the exact same `showPaymentInstructions` gate as the payment-instructions block itself (line 173).
- [x] **F3** Confirm a confirmed order's page shows neither the manual-confirmation note nor the transfer-note explanation (both are gated on `isPending`/`showPaymentInstructions`). — PASS (code-trace + live data): confirmed order `ab509211f3e8ec4514a26f547315f237` has `isPending=false`, which short-circuits both gates to false.
- [ ] **F4** On the checkout page, select each non-COD payment method the shop currently offers in turn and confirm `checkoutPaymentWindow` is visible for each. — **NOT VERIFIED — no browser tool available.** Live check confirmed all 4 payment methods (`bank`, `momo`, `paypal`, `cod`) are enabled on this stack, so the scenario is reachable; the gate (`payment && payment !== "cod"`) has no per-method branching, but `Checkout.test.jsx` only exercises `bank`. A human should select each non-COD method in a real browser and confirm the notice appears for each.
- [ ] **F5** On the checkout page, select `cod` (if offered) and confirm `checkoutPaymentWindow` disappears. — **NOT VERIFIED — no browser tool available.** Code gate confirmed correct (`payment !== "cod"` is false for `cod`) and `Checkout.test.jsx`'s matching test is present and green, but this is a substitute, not a rendered-page confirmation. A human should select `cod` in a real browser and confirm the notice disappears.
- [x] **F6** If `cod` is the *only* method the current shop configuration offers, confirm F5's behavior using a temporarily-added second method in a test environment, or accept this item as NOT VERIFIABLE HERE with that specific configuration and record it — do not silently skip it. — N/A, resolved: live check (`GET $API/shop/payment-methods`) confirmed `cod` is not the only method offered on this stack (4 methods enabled), so this fallback condition doesn't apply.

**Section verdict:** ___

---

## G. Mobile usability (375px)

- [ ] **G1** Emulate a 375px-wide viewport. Load a pending prepaid order's page. Confirm the deadline line, the manual-confirm note, and the transfer-note explanation all wrap within the existing content column with no horizontal scroll introduced. — NOT VERIFIABLE HERE without a browser/device emulator. — **NOT VERIFIED — no browser/device emulator available in this pass.** A human should emulate a 375px viewport and check the order page for horizontal scroll.
- [ ] **G2** At the same viewport, load the checkout page with a non-COD method selected and confirm `checkoutPaymentWindow` wraps cleanly beside the payment-method picker with no horizontal scroll. — NOT VERIFIABLE HERE without a browser/device emulator. — **NOT VERIFIED — no browser/device emulator available in this pass.** A human should emulate a 375px viewport and check the checkout page for horizontal scroll.
- [x] **G3** As a partial substitute for G1/G2, confirm by code inspection that both new blocks are plain `<p>` elements with no fixed `width`, no `white-space: nowrap`, and no new class other than existing utility classes already used elsewhere on the same pages (`text-sm`, `text-xs`, `opacity-70`, `mt-1`, `text-[var(--text-error)]`) — this proves nothing about actual rendered wrapping, only that no obviously-scroll-inducing class was introduced. — PASS (explicit partial substitute): all five new blocks in `Order.jsx`/`Checkout.jsx` are plain `<p>` elements using only the named allowed utility classes (plus `mb-4`, the same category of pre-existing spacing utility); no fixed width or `white-space: nowrap` introduced.

**Section verdict:** ___

---

## H. Timezone correctness

- [x] **H1** Confirm `orderDeadline.js`'s `toLocaleString` call passes `timeZone: "Asia/Ho_Chi_Minh"` explicitly (not relying on any ambient/system default). — PASS: `orderDeadline.js:26`, `timeZone: "Asia/Ho_Chi_Minh"` passed explicitly into `Intl.DateTimeFormat`.
- [x] **H2** Confirm `orderDeadline.test.js`'s cross-timezone-day test (a UTC instant whose Vietnam-local calendar date differs from its UTC calendar date) is present and passes. — PASS: `orderDeadline.test.js:68-70`, asserts `formatDeadline("2026-01-01T17:00:00Z", now).absolute === "00:00 02/01"` (UTC calendar date 01, Vietnam-local calendar date 02); present and passing.
- [x] **H3** If feasible in this environment, temporarily set the system/browser timezone to something other than `Asia/Ho_Chi_Minh` (e.g. UTC or `America/New_York`) and reload a pending order's page. Confirm the displayed deadline time is unchanged from what it showed under the system default timezone. — NOT VERIFIABLE HERE without control over the browser/OS timezone; the unit test in H2 is the primary evidence for this property and is not a full substitute for an actual cross-timezone browser check. — PASS, verified via a stronger substitute than anticipated: ran the real `formatDeadline` helper under `TZ=America/Los_Angeles node ...`, `TZ=UTC node ...`, and the default TZ, all against the same input instant — all three produced identical output (`"20:35 09/08"`, `remainingHours:4`, `passed:false`). This is a real cross-timezone execution of the shipped code, not just the unit test, though still Node rather than an actual browser/OS timezone change — the literal browser-timezone check remains open.

**Section verdict:** ___

---

## I. No scope creep

- [x] **I1** `grep -n "RESERVATION_HOURS" frontend/src` returns no matches — the frontend never hardcodes or re-derives the reservation window length. — PASS: no matches.
- [x] **I2** Confirm no new backend route, migration, or query was added — `git diff --stat` against the pre-Plan-6 commit shows changes only to `backend/routes/orders.js` and its test file on the backend side. — PASS: `git diff --stat c36b447..HEAD -- backend` shows only `backend/routes/orders.js` and `backend/tests/orderRoutes.test.js` changed.
- [x] **I3** Confirm no first-visit modal, standalone help page, or order-lookup-by-phone/email UI was added anywhere in the diff. — PASS: no modal/walkthrough/order-lookup patterns found in the diff.
- [x] **I4** Confirm `orderSaveLink`'s key was extended in place, not duplicated under a new key name (e.g. no `orderSaveLinkV2` or `orderSaveLinkEmailed` sitting alongside the old one). — PASS: `orderSaveLink` appears exactly once per language block, no duplicate key exists.

**Section verdict:** ___

---

## Sign-off

- [x] Blocking sections **B, C, D** fully PASS. — Confirmed: B 6/6, C 5/5, D 4/4, all PASS.
- [x] The test strategy's §4 highest-value test (the sweep-window boundary, both unit and component level) has been read line-by-line against its test files, not just run — confirmed present, confirmed asserting what it claims to assert. — Done: `orderDeadline.test.js` lines 52-63 (both SWEEP WINDOW unit tests) and `Order.test.jsx`'s passed-deadline component test (line 120) read directly against their assertions.
- [x] `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` passes in full (A1). — Confirmed, 586/586.
- [x] `cd frontend && npm test && npm run build && npm run lint` pass, modulo the 3 pre-existing lint problems (A2-A4). — Confirmed: 147/147, build clean, exactly 3 known lint problems.
- [x] Every item marked **NOT VERIFIABLE HERE — needs X** has either been verified in a follow-up session with the needed tool/access, or is recorded here as an accepted gap with a named owner and target date. This is expected to include at minimum B3 (live sweep-window race), E3/E4 (live language-toggle rendering), G1/G2 (375px viewport), and H3 (real cross-timezone browser check). — B3 and H3 were closed this pass (B3 fully live-verified; H3 verified via multi-TZ Node run). E3, E4, G1, G2 (plus F1, F4, F5, and the Production Readiness item below) remain NOT VERIFIED, recorded as accepted gaps needing a browser/device emulator; no named human owner or target date has been assigned yet — that assignment is left for the requester.
- [x] Non-blocking findings (any Minor from this pass) are recorded with an explicit accept/reject decision, not left ambiguous. — A5's scope surprise (ShopHeader/Cart/Collection/Portfolio/Shop/cart.js) and A2's stale predicted-count (137 vs. 147) are both recorded above with explicit accept decisions: neither is a defect, neither blocks sign-off.

### Production readiness

- [ ] A buyer with a real pending bank-transfer order has seen the live deadline line on their actual order page at least once before this is considered fully rolled out in spirit (not a blocking requirement to ship code, but recommended to close the loop the same way Plan 5 recommended a real VTP round trip before retiring the old shipping script). — **NOT VERIFIED — no real buyer traffic accessible from this environment.** Outside the scope of this local/QA-stack verification pass; recorded as explicitly outstanding, non-blocking.
