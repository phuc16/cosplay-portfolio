# Admin UI & Semantic Colour - Verification (post-implementation QA)

Run after every task in `2026-08-09-admin-ui.md` is implemented and committed, against a running stack. This is the final gate before the admin UI and shop state-colour changes go live.

**Blocking sections: B, C, D.** Section B is the destructive-vs-confirm visual distinction - a seller clicking cancel believing it is as safe as any other button is the single worst outcome this phase exists to prevent. Section C is the statistics-values-unchanged check - this phase must not be the one that quietly breaks Phase 4's verified arithmetic while claiming "emphasis only." Section D is CSS token integrity - this project has already shipped an invented-CSS-variable defect twice. Nothing ships with an open failure in those.

**Honesty note, carried over from prior phases' verification:** several items below need a real browser at a real 375px viewport, in both light and dark mode, and possibly both languages, and this pass may be run in an environment with none of those. Every such item is marked **NOT VERIFIABLE HERE - needs X** rather than silently checked off; do not mark an item PASS on the strength of a code-inspection or unit-test substitute unless that substitute is explicitly called out as sufficient.

## Setup

```bash
docker compose up -d --build
cd frontend && npm run dev
```

Open the admin panel and log in; open the shop's collection/checkout/order flow in a second tab.

---

## A. Automated suite

- [ ] **A1** `cd frontend && npm test` - full suite passes, including `semanticTokens.test.js` (25), `statusVariant.test.js` (11), `StatusBadge.test.jsx` (6), `orderLabels.test.js` (9), the 9 new tests in `AdminOrders.test.jsx`, the 3 new tests in `StatsDrop.test.jsx`, and the 4 new tests in `Order.test.jsx`. Record the total: expect 201 (134 + 67).
- [ ] **A2** `cd frontend && npm run build` - succeeds. A pre-existing >500KB chunk-size warning is not a failure.
- [ ] **A3** `cd frontend && npm run lint` - shows exactly the 3 pre-existing problems noted in the plan's Global Constraints (`Portfolio.jsx` x2, `AdminAlbumImages.jsx` x1) and **no other** error. Any new lint problem in `index.css`, `statusVariant.js`, `StatusBadge.jsx`, `orderLabels.js`, `AdminOrders.jsx`, `StatsDrop.jsx`, `Order.jsx`, `PaymentInstructions.jsx`, or their test files blocks sign-off.
- [ ] **A4** `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` - passes at its pre-existing count (586). This phase should not change this number at all.
- [ ] **A5** Confirm this phase's changes are limited to: `frontend/src/index.css`, `frontend/src/utils/semanticTokens.test.js` (new), `frontend/src/constants/statusVariant.js` (new), `frontend/src/constants/statusVariant.test.js` (new), `frontend/src/components/StatusBadge.jsx` (new), `frontend/src/components/StatusBadge.test.jsx` (new), `frontend/src/admin/orderLabels.js` (new), `frontend/src/admin/orderLabels.test.js` (new), `frontend/src/components/stats/StatsDrop.jsx`, `frontend/src/components/stats/StatsDrop.test.jsx`, `frontend/src/components/AdminOrders.jsx`, `frontend/src/components/AdminOrders.test.jsx`, `frontend/src/pages/Order.jsx`, `frontend/src/pages/Order.test.jsx`, `frontend/src/components/shop/PaymentInstructions.jsx`. Run `git diff --stat <base>...HEAD` and confirm no other path appears; **any file under `backend/` is a scope surprise** - investigate and record it here, do not assume it's fine.

**Section verdict:** ___

---

## B. Destructive vs. confirm action styling (blocking)

- [ ] **B1** Read `frontend/src/components/AdminOrders.jsx`'s `ACTION_BUTTON_CLASSES` map. Confirm `danger` and `success` are two genuinely different class strings (not the same string assigned to two keys).
- [ ] **B2** Confirm `variantForAction("cancelled")` returns `"danger"` and `variantForAction("confirmed")`/`("shipped")`/`("completed")` all return `"success"`, by reading `frontend/src/constants/statusVariant.js` directly.
- [ ] **B3** Load the admin orders list with a real order in `pending` status (has both `confirmed` and `cancelled` as legal transitions). Visually confirm the "Hủy" button and the "Xác nhận" button are unmistakably different colours (one reads as red/danger-toned, one as green/success-toned) - not merely a shade of the same hue. - NOT VERIFIABLE HERE without a browser; a partial substitute is B1+B4 (class-string and token-value inspection), which proves the styling *should* differ but not that it renders distinguishably to a human eye at the shop's actual colour scheme.
- [ ] **B4** Confirm `--border-danger` and `--border-success` resolve to visually distinct colours in both light and dark mode by reading their values in `frontend/src/index.css` (danger traces to the red ramp, success to the new green ramp) - not merely that they're different token names.
- [ ] **B5** Confirm the "Chi tiết" button is styled with the neutral class set, not accidentally sharing a class string with either the danger or success buttons.
- [ ] **B6** Click "Hủy" on a real pending order. Confirm the existing `confirm()` browser dialog still appears before anything is sent to the API, and cancelling that dialog leaves the order unchanged. - NOT VERIFIABLE HERE without a browser; the unit-level substitute (`AdminOrders.test.jsx`'s `confirm()`-guard test) is not a full substitute since it doesn't prove the real `window.confirm` dialog text is legible or the click target is correctly sized on a real screen.
- [ ] **B7** Confirm `AdminOrders.test.jsx`'s "fails if cancel and a confirm-type action ever render with the same class string again" test is present, passes, and its assertion is a direct string inequality (`.not.toBe(...)`), not a substring/partial check that could pass even if the two strings converged on their meaningful parts.

**Section verdict:** ___

---

## C. Statistics values unchanged (blocking)

- [ ] **C1** Read the diff to `frontend/src/components/stats/StatsDrop.jsx`. Confirm every `stats.*` field read (`received_total`, `awaiting_payment`, `to_collect`, `lost`, `pending_cod`) is identical to before this phase - no field renamed, removed, added, or wrapped in new arithmetic.
- [ ] **C2** Load the drop statistics view for a real collection with non-zero figures in all five categories. Confirm all five numbers are visible on screen and match what they showed before this phase (compare against a note of the pre-change values, or against the same data via `adminGetDropStats`'s raw API response). - NOT VERIFIABLE HERE without a browser and either a pre-change screenshot or a direct API comparison; the automated substitute is C3.
- [ ] **C3** Confirm `StatsDrop.test.jsx`'s "still renders all five money figures with their original values" test is present and passes, and that it asserts on all five `formatVnd(...)` strings, not a subset.
- [ ] **C4** Confirm the received figure is visually larger/more prominent than the other four (larger text size, a distinguishing surface colour) without any of the other four being removed from view. - NOT VERIFIABLE HERE without a browser; partial substitute is C3 plus reading the `text-3xl` vs. `text-base` class assignment directly in the component.
- [ ] **C5** Confirm no statistics figure elsewhere in the admin panel (if any other view reads the same `adminGetDropStats` response) was touched by this phase - grep `git diff --stat` for any file outside `StatsDrop.jsx`/`StatsDrop.test.jsx` that references `received_total`, `awaiting_payment`, `to_collect`, `lost`, or `pending_cod`; expect none.

**Section verdict:** ___

---

## D. CSS token integrity (blocking)

- [ ] **D1** Open `frontend/src/index.css` and manually confirm all 12 new tokens (`--surface-success`, `--border-success`, `--text-success`, `--surface-danger`, `--border-danger`, `--text-danger`, `--surface-warning`, `--border-warning`, `--text-warning`, `--surface-neutral`, `--border-neutral`, `--text-neutral`) are defined in `:root` **and** overridden in `.dark`. Twelve tokens, two blocks each, 24 definitions total.
- [ ] **D2** Confirm `frontend/src/utils/semanticTokens.test.js` is present, passes, and its 24 existence assertions plus its brand-independence assertion actually run (not skipped) - check the test output line count, not just the file's presence.
- [ ] **D3** Grep every component this phase touches (`StatusBadge.jsx`, `AdminOrders.jsx`, `StatsDrop.jsx`, `Order.jsx`, `PaymentInstructions.jsx`) for every `var(--...)` reference and confirm each name appears in D1's list of 12, or is a pre-existing token this phase did not introduce (e.g. `--border-brand`, `--text-error`). Any name that appears in a component but not in `index.css` is a Blocker.
- [ ] **D4** Load the admin panel and the shop in a browser with the OS/browser set to light mode. Confirm the status badge, action buttons, and the statistics dominant card all show actual colour (not black/white/transparent, which would indicate an unresolved custom property). - NOT VERIFIABLE HERE without a browser; D1–D3 are the code-level substitute and are not a full replacement for seeing the rendered page.
- [ ] **D5** Repeat D4 with the OS/browser set to dark mode (or toggle the site's own dark-mode control if it has one independent of the OS). - NOT VERIFIABLE HERE without a browser.

**Section verdict:** ___

---

## E. Unknown-status fallback

- [ ] **E1** Confirm `frontend/src/constants/statusVariant.js`'s `variantForStatus` and `variantForAction` both return `"neutral"` for an unrecognized input, by reading the functions and their tests.
- [ ] **E2** Confirm `frontend/src/admin/orderLabels.js`'s `labelFor` returns the raw key (not `undefined`, not an empty string) for an unrecognized key, by reading the function and its tests.
- [ ] **E3** Confirm `frontend/src/components/StatusBadge.jsx` falls back to the neutral class set for any variant value it doesn't recognize, including when no `variant` prop is passed at all.
- [ ] **E4** Confirm `AdminOrders.test.jsx`'s "falls back to the raw value for an unknown status, never rendering blank" test is present and passes - this proves the fallback chain survives actual component rendering, not just the three unit-level pieces individually.
- [ ] **E5** Confirm `Order.test.jsx`'s equivalent fallback test is present and passes on the shop side.
- [ ] **E6** If feasible, manually create or view an order in a status outside the known five (e.g. via a direct DB edit in a disposable test row) and load both the admin orders list and the buyer's order page. Confirm both show the raw status text with a neutral-toned badge, not a blank space. - NOT VERIFIABLE HERE without a live stack and a disposable test order; E1–E5 are the code-level substitute.

**Section verdict:** ___

---

## F. Admin/shop language boundary

- [ ] **F1** `grep -rn "admin/orderLabels" frontend/src/pages frontend/src/components/shop` returns no matches - the shop never imports the admin's hardcoded-Vietnamese label module.
- [ ] **F2** Confirm no new key was added to `frontend/src/i18n/translations.js` by this phase - `git diff` on that file (if it appears in the diff at all) shows no change; this phase's Global Constraints state it adds no i18n keys.
- [ ] **F3** Confirm `frontend/src/constants/statusVariant.js` (the module the shop *does* use) contains no Vietnamese or English copy - colour names only (`"success"`, `"warning"`, `"danger"`, `"neutral"`).
- [ ] **F4** Load the shop's order page with the language toggle set to `en`, then to `vi`. Confirm the status badge's label text changes language appropriately (it comes from `t(STATUS_KEY[...])`, unaffected by this phase) while its colour stays the same in both languages. - NOT VERIFIABLE HERE without a browser.

**Section verdict:** ___

---

## G. Mobile usability (375px)

- [ ] **G1** Emulate a 375px-wide viewport. Load the admin orders list with several orders, at least one with multiple legal transitions. Confirm the status badge, payment/fulfilment text, and action buttons wrap within their row with no horizontal scroll introduced on the page itself. - NOT VERIFIABLE HERE without a browser/device emulator.
- [ ] **G2** At the same viewport, load the buyer order page for a pending order. Confirm the status badge and the warning-toned payment-instructions box wrap cleanly with no horizontal scroll. - NOT VERIFIABLE HERE without a browser/device emulator.
- [ ] **G3** At the same viewport, load the drop statistics view. Confirm the dominant received card and the four secondary cards below it stack/wrap without horizontal scroll, and the existing wide variant table still scrolls only within its own `overflow-x-auto` container, not the page. - NOT VERIFIABLE HERE without a browser/device emulator.
- [ ] **G4** As a partial substitute for G1–G3, confirm by code inspection that `StatusBadge` is `inline-block` with `whitespace-nowrap` and no fixed `width`, that `AdminOrders.jsx`'s badge/text row uses `flex-wrap`, and that no new element in this phase introduces a fixed pixel width or `overflow-x: hidden` that could clip content - this proves nothing about actual rendered wrapping, only that no obviously scroll-inducing class was introduced.

**Section verdict:** ___

---

## H. No scope creep

- [ ] **H1** `git diff --stat <base>...HEAD -- backend/` returns no output - no backend file, route, migration, or query was touched.
- [ ] **H2** Confirm no new admin navigation item, admin page, or admin feature beyond colour/label/layout changes to the two existing pages (`AdminOrders.jsx`, `StatsDrop.jsx`) was added.
- [ ] **H3** Confirm the portfolio's own (non-admin, non-shop-state) visual design is untouched - `git diff --stat` shows no change to any file outside `frontend/src/index.css` (token-only addition), `frontend/src/components/`, `frontend/src/pages/Order.jsx`, `frontend/src/constants/`, `frontend/src/admin/`.
- [ ] **H4** Confirm `--brand`, `--brand-hover`, `--brand-strong`, `--brand-soft` in `frontend/src/index.css` are byte-for-byte unchanged from before this phase.
- [ ] **H5** Confirm no payment deep link (Momo, bank, PayPal click-to-pay) was added anywhere in the diff - this phase's spec explicitly excludes it.

**Section verdict:** ___

---

## Sign-off

- [ ] Blocking sections **B, C, D** fully PASS.
- [ ] The test strategy's §4 highest-value tests (destructive-vs-confirm inequality, statistics-values-unchanged, token-existence) have been read line-by-line against their test files, not just run - confirmed present, confirmed asserting what they claim to assert.
- [ ] `cd frontend && npm test && npm run build && npm run lint` pass, modulo the 3 pre-existing lint problems (A1–A3).
- [ ] `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` passes at its unchanged pre-existing count (A4).
- [ ] Every item marked **NOT VERIFIABLE HERE - needs X** has either been verified in a follow-up session with the needed tool/access, or is recorded here as an accepted gap with a named owner and target date. This is expected to include at minimum B3, B6, C2, C4, D4, D5, E6, F4, and G1–G3.
- [ ] Non-blocking findings (any Minor from this pass) are recorded with an explicit accept/reject decision, not left ambiguous.

### Production readiness

- [ ] A seller has seen the live orders list - with the coloured badges and the distinct cancel/confirm buttons - on their actual admin panel at least once before this is considered fully rolled out in spirit (not a blocking requirement to ship code, but recommended to close the loop the same way prior phases recommended a real round trip before retiring the old view).
