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

- [ ] **A1** `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` — full suite passes, including the 3 new `expires_at` tests in `orderRoutes.test.js`. Record the total: expect 586 (583 + 3).
- [ ] **A2** `cd frontend && npm test` — full suite passes, including `orderDeadline.test.js` (11 tests), the 6 new tests in `Order.test.jsx`, and the 2 new tests in `Checkout.test.jsx`. Record the total: expect 137 (118 + 19).
- [ ] **A3** `cd frontend && npm run build` — succeeds. A pre-existing >500KB chunk-size warning is not a failure.
- [ ] **A4** `cd frontend && npm run lint` — shows exactly the 3 pre-existing problems noted in the plan's Global Constraints (`Portfolio.jsx` x2, `AdminAlbumImages.jsx` x1) and **no other** error. Any new lint problem in `orderDeadline.js`, `Order.jsx`, `Checkout.jsx`, or their test files blocks sign-off.
- [ ] **A5** Confirm this phase's changes are limited to: `backend/routes/orders.js`, `backend/tests/orderRoutes.test.js`, `frontend/src/utils/orderDeadline.js` (new), `frontend/src/utils/orderDeadline.test.js` (new), `frontend/src/i18n/translations.js`, `frontend/src/pages/Order.jsx`, `frontend/src/pages/Order.test.jsx`, `frontend/src/pages/Checkout.jsx`, `frontend/src/pages/Checkout.test.jsx` (new or modified). Any other file touched is a scope surprise — investigate and record it here, per Plan 4/5's precedent of correcting rather than assuming a plan's file list is exhaustive.

---

## B. The sweep-window state (blocking)

- [ ] **B1** Read `frontend/src/utils/orderDeadline.js`'s `passed` computation line by line. Confirm it uses `<=`, not `<`, against `now.getTime()`. A deadline exactly equal to the current instant must be treated as passed, not as the last live second of a countdown.
- [ ] **B2** Confirm `remainingHours` is hardcoded to `0` inside the `passed` branch, not computed from a (possibly negative) time difference and then clamped.
- [ ] **B3** Create a real order with `payment_method: "bank"`, then directly set its `expires_at` a few seconds in the past via the database, without changing its `status` from `pending` (simulating the interval before the worker's next ~5s sweep tick catches it):
  ```sql
  UPDATE orders SET expires_at = DATE_SUB(NOW(), INTERVAL 5 SECOND) WHERE id = <id>;
  ```
  Immediately (before the worker sweeps it), load the order page. Confirm it shows the passed-deadline message (`orderDeadlinePassed`) and **not** any "còn X giờ" / "Xh left" text. — NOT VERIFIABLE HERE without a live stack and a race against the worker's own sweep timing; if the worker sweeps the order to `cancelled` before the page loads, re-run with a longer artificial past offset relative to the worker's poll interval, or stop the worker process temporarily for this one check.
- [ ] **B4** Create a real order with `payment_method: "bank"` and a real, several-hours-future `expires_at` (the value `createOrder` naturally sets — no manual edit needed). Load the order page. Confirm it shows the absolute time and a positive "còn N giờ" / "Nh left", and does **not** show the passed-deadline message.
- [ ] **B5** Read `Order.jsx`'s `DeadlineBlock` usage and confirm it is gated by `isPending` (i.e. `order.status === "pending"`), not rendered unconditionally. Manually set a confirmed order's `expires_at` to a past timestamp in the database and load its order page; confirm **no** deadline text of any kind (neither countdown nor passed-message) appears.
- [ ] **B6** Confirm `orderDeadline.test.js`'s two "SWEEP WINDOW" tests are present, pass, and actually assert `passed: true` / `remainingHours: 0` at both the `<=` boundary and a few seconds past it (not just one of the two).

**Section verdict:** ___

---

## C. `toPublicOrder` allowlist (blocking)

- [ ] **C1** Read `backend/routes/orders.js`'s `toPublicOrder` line by line. Confirm `expires_at` was added to **both** the destructure and the returned object literal — a change to only one is a bug (an added-but-unreturned field, or a returned-but-undestructured `undefined`).
- [ ] **C2** Confirm the diff to `toPublicOrder` is exactly one field addition — no other field was added, removed, or renamed in the same edit.
- [ ] **C3** Hit a real order via `curl "$API/orders/<token>"` (a real prepaid order's token). Confirm the JSON response contains `expires_at` as a non-null value, and does **not** contain `request_key`, `stock_released_at`, `payment_proof_url`, `note`, `buyer_name`, `phone`, `email`, or `address_raw`.
- [ ] **C4** Repeat C3 against a real COD order's token. Confirm `expires_at` is present with value `null`, not absent and not `undefined`/omitted.
- [ ] **C5** Confirm the allowlist-regression test in `orderRoutes.test.js` (Task 1 Step 1's third new test) is present, passes, and actually names all eight excluded fields individually, not via a shorthand that could silently stop checking one of them if the object shape changed.

**Section verdict:** ___

---

## D. Null and unparsable `expires_at` (blocking)

- [ ] **D1** Load a real COD order's order page. Confirm no deadline-related text, box, or placeholder appears anywhere near the status block — not "no deadline", not an empty bordered box, nothing.
- [ ] **D2** Confirm `formatDeadline(null)` and `formatDeadline(undefined)` both return `null` by reading `orderDeadline.test.js`'s corresponding tests and confirming they pass.
- [ ] **D3** Confirm `formatDeadline("not-a-real-date")` returns `null`, not a value containing the literal string `"Invalid Date"`. Read the unit test and confirm it passes.
- [ ] **D4** In a browser console (or a quick Node REPL) confirm `new Date("not-a-real-date").getTime()` is `NaN` in this project's actual runtime (documenting the assumption the guard relies on, not just trusting it abstractly).

**Section verdict:** ___

---

## E. Bilingual copy

- [ ] **E1** Open `frontend/src/i18n/translations.js` and manually confirm each of these keys exists in **both** the `en` and `vi` blocks: `orderSaveLink` (extended value), `orderDeadline`, `orderDeadlinePassed`, `orderManualConfirmNote`, `orderTransferNoteExplain`, `checkoutPaymentWindow`. Six keys, twelve total entries (six per language).
- [ ] **E2** Confirm `orderSaveLink`'s new value in both languages actually mentions the link having been emailed — not just any edit, the specific fact the spec calls for.
- [ ] **E3** Switch the site language toggle to `vi`, reload the order page for a pending prepaid order, and confirm every piece of new copy (deadline line, manual-confirm note, transfer-note explanation, save-link line) renders in Vietnamese, not falling back to an English default (which would happen silently if a `vi` key were missing, per `LanguageContext`'s fallback behavior). — NOT VERIFIABLE HERE without a browser; a partial substitute is E1's direct file read, which proves the keys exist but not that the running page actually resolves them correctly at runtime.
- [ ] **E4** Repeat E3 with the toggle set to `en`.
- [ ] **E5** Confirm `checkoutPaymentWindow` in both languages does not name a specific number of hours (per the plan's Task 5 design decision) — grep both entries for any digit; expect none.

**Section verdict:** ___

---

## F. `Order.jsx` and `Checkout.jsx` behavior

- [ ] **F1** Load a pending, prepaid order's page. Confirm the manual-confirmation note (`orderManualConfirmNote`) is visible beside the status block.
- [ ] **F2** Confirm the transfer-note explanation (`orderTransferNoteExplain`) appears only alongside the payment instructions block (i.e. only while `showPaymentInstructions` is true — pending and non-COD), not for a COD order and not once the order leaves pending.
- [ ] **F3** Confirm a confirmed order's page shows neither the manual-confirmation note nor the transfer-note explanation (both are gated on `isPending`/`showPaymentInstructions`).
- [ ] **F4** On the checkout page, select each non-COD payment method the shop currently offers in turn and confirm `checkoutPaymentWindow` is visible for each.
- [ ] **F5** On the checkout page, select `cod` (if offered) and confirm `checkoutPaymentWindow` disappears.
- [ ] **F6** If `cod` is the *only* method the current shop configuration offers, confirm F5's behavior using a temporarily-added second method in a test environment, or accept this item as NOT VERIFIABLE HERE with that specific configuration and record it — do not silently skip it.

**Section verdict:** ___

---

## G. Mobile usability (375px)

- [ ] **G1** Emulate a 375px-wide viewport. Load a pending prepaid order's page. Confirm the deadline line, the manual-confirm note, and the transfer-note explanation all wrap within the existing content column with no horizontal scroll introduced. — NOT VERIFIABLE HERE without a browser/device emulator.
- [ ] **G2** At the same viewport, load the checkout page with a non-COD method selected and confirm `checkoutPaymentWindow` wraps cleanly beside the payment-method picker with no horizontal scroll. — NOT VERIFIABLE HERE without a browser/device emulator.
- [ ] **G3** As a partial substitute for G1/G2, confirm by code inspection that both new blocks are plain `<p>` elements with no fixed `width`, no `white-space: nowrap`, and no new class other than existing utility classes already used elsewhere on the same pages (`text-sm`, `text-xs`, `opacity-70`, `mt-1`, `text-[var(--text-error)]`) — this proves nothing about actual rendered wrapping, only that no obviously-scroll-inducing class was introduced.

**Section verdict:** ___

---

## H. Timezone correctness

- [ ] **H1** Confirm `orderDeadline.js`'s `toLocaleString` call passes `timeZone: "Asia/Ho_Chi_Minh"` explicitly (not relying on any ambient/system default).
- [ ] **H2** Confirm `orderDeadline.test.js`'s cross-timezone-day test (a UTC instant whose Vietnam-local calendar date differs from its UTC calendar date) is present and passes.
- [ ] **H3** If feasible in this environment, temporarily set the system/browser timezone to something other than `Asia/Ho_Chi_Minh` (e.g. UTC or `America/New_York`) and reload a pending order's page. Confirm the displayed deadline time is unchanged from what it showed under the system default timezone. — NOT VERIFIABLE HERE without control over the browser/OS timezone; the unit test in H2 is the primary evidence for this property and is not a full substitute for an actual cross-timezone browser check.

**Section verdict:** ___

---

## I. No scope creep

- [ ] **I1** `grep -n "RESERVATION_HOURS" frontend/src` returns no matches — the frontend never hardcodes or re-derives the reservation window length.
- [ ] **I2** Confirm no new backend route, migration, or query was added — `git diff --stat` against the pre-Plan-6 commit shows changes only to `backend/routes/orders.js` and its test file on the backend side.
- [ ] **I3** Confirm no first-visit modal, standalone help page, or order-lookup-by-phone/email UI was added anywhere in the diff.
- [ ] **I4** Confirm `orderSaveLink`'s key was extended in place, not duplicated under a new key name (e.g. no `orderSaveLinkV2` or `orderSaveLinkEmailed` sitting alongside the old one).

**Section verdict:** ___

---

## Sign-off

- [ ] Blocking sections **B, C, D** fully PASS.
- [ ] The test strategy's §4 highest-value test (the sweep-window boundary, both unit and component level) has been read line-by-line against its test files, not just run — confirmed present, confirmed asserting what it claims to assert.
- [ ] `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` passes in full (A1).
- [ ] `cd frontend && npm test && npm run build && npm run lint` pass, modulo the 3 pre-existing lint problems (A2-A4).
- [ ] Every item marked **NOT VERIFIABLE HERE — needs X** has either been verified in a follow-up session with the needed tool/access, or is recorded here as an accepted gap with a named owner and target date. This is expected to include at minimum B3 (live sweep-window race), E3/E4 (live language-toggle rendering), G1/G2 (375px viewport), and H3 (real cross-timezone browser check).
- [ ] Non-blocking findings (any Minor from this pass) are recorded with an explicit accept/reject decision, not left ambiguous.

### Production readiness

- [ ] A buyer with a real pending bank-transfer order has seen the live deadline line on their actual order page at least once before this is considered fully rolled out in spirit (not a blocking requirement to ship code, but recommended to close the loop the same way Plan 5 recommended a real VTP round trip before retiring the old shipping script).
