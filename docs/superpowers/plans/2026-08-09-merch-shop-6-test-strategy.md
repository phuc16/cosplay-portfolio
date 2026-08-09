# Merch Shop — Plan 6 Test Strategy: Buyer Onboarding Guidance

Covers `2026-08-09-merch-shop-6-onboarding.md` only. Builds on, and does not repeat, `2026-08-07-merch-shop-test-strategy.md` (Plans 1–3), `2026-08-08-merch-shop-4-test-strategy.md` (Plan 4), and `2026-08-08-merch-shop-5-test-strategy.md` (Plan 5) — read those first for the risk-weighting philosophy, environments, and regression-suite conventions this document assumes.

This phase is much smaller than Plan 5: one allowlist field, one pure formatting helper, and copy in two files. Its worst outcome is not physical or a mis-sent shipment — it is informational: a buyer who transfers money against an order the system has already, or is about to, cancel, believing they still have time.

---

## 1. Risk register

| # | Risk | Consequence | Severity | Primary defense |
|---|---|---|---|---|
| R1 | The sweep-window edge: `expires_at` has passed but `status` is still `pending`, and the page shows a countdown or "còn 0 giờ" instead of the passed-deadline state | Buyer transfers money against an order that is already dead or about to be auto-cancelled — money sent for nothing, with no easy recovery path (there is no account, only the token) | **High** | `formatDeadline`'s `passed` branch is checked before any remaining-hours arithmetic and always yields `remainingHours: 0`; two dedicated "SWEEP WINDOW" unit tests (`<=` boundary and just-past); `Order.jsx` renders the passed-deadline message, never a countdown, when `passed` is true (blocking) |
| R2 | `toPublicOrder`'s allowlist widens further than `expires_at` — a future edit near this line accidentally exposes `order_token`'s sibling fields (`request_key`, `buyer_name`, `phone`, `email`, `address_raw`, `payment_proof_url`) | A third party with only the shareable order link gains the buyer's PII or an internal field; this project has already had one such leak (payment-proof-URL) in an earlier phase | **High** | A dedicated allowlist-regression test in `orderRoutes.test.js` asserts `expires_at` is now present **and** eight specific previously-absent fields remain absent, in the same request/response cycle (blocking) |
| R3 | Null `expires_at` (COD) renders a placeholder, an empty box, or `"null"` instead of nothing | A COD buyer sees a broken-looking UI element and may believe their order — which never expires — has a deadline problem, or conversely a buyer with a real deadline learns to ignore the block because "it usually shows nothing weird" | Medium | `formatDeadline(null)` returns `null` at the unit level; `Order.jsx`'s `DeadlineBlock` returns `null` (renders nothing) when the helper returns `null`; a dedicated component test asserts no deadline-related text renders for a COD order |
| R4 | An unparsable `expires_at` renders `Invalid Date` or throws | A malformed date (e.g. from a future migration or manual DB edit) crashes or visibly embarrasses the order page in front of a buyer | Medium | `formatDeadline` checks `Number.isNaN(deadline.getTime())` and returns `null`; unit test with a garbage string |
| R5 | The deadline is shown in the browser's local timezone instead of Asia/Ho_Chi_Minh | A buyer in a different timezone (or a browser misconfigured to UTC) sees a deadline that disagrees with their own clock, especially confusing near midnight | Medium | `toLocaleString` is called with an explicit `timeZone: "Asia/Ho_Chi_Minh"` option, which does not depend on the runtime's default timezone; a dedicated unit test picks a UTC instant that lands on a *different calendar day* in Vietnam than in UTC, so a bug that silently dropped the `timeZone` option would fail the test regardless of which timezone the test runner itself happens to run in |
| R6 | A confirmed/shipped/completed order still shows a stale deadline (countdown or passed-message), because `expires_at` is never cleared on confirm | A buyer who already paid and was confirmed sees an alarming "your deadline has passed, this order is being cancelled" message on an order that is in no danger of cancellation | Medium | `Order.jsx` gates `DeadlineBlock` on `order.status === "pending"`, not inside the helper; dedicated component test asserts nothing renders for a `confirmed` order even with a past `expires_at` |
| R7 | New translation keys exist in only one language | A buyer using the other language sees the raw key string (e.g. `orderDeadline`) instead of copy, or `LanguageContext`'s `en` fallback silently masks a missing `vi` key during manual testing in English | Medium | A key-set-parity check (Task 3 Step 3) run once at authoring time; verification item E1 re-checks by reading the file directly |
| R8 | `checkoutPaymentWindow` implies a specific number of hours that drifts from the real, env-configurable `RESERVATION_HOURS` | Buyer is told a wrong deadline length; worse, the wrongness is silent since nothing re-derives the frontend string from the backend constant | Low | The copy is deliberately generic ("a limited window... the exact deadline will appear on your order page") and contains no number; this is a design decision recorded in the plan's Task 5, not left to an implementer's judgment |
| R9 | The two new UI blocks break 375px layout (horizontal scroll, overlapping text) | Buyer on a phone — the majority of this shop's traffic, per Plans 1–4's precedent — can't read or is embarrassed by a broken page at the exact moment they need the information most | Medium | Both new blocks are plain wrapped text (`<p>`) inside the existing `max-w-2xl mx-auto px-4` container, no fixed-width elements introduced; manual 375px check is verification item C1 (blocking — NOT VERIFIABLE without a browser) |

R1 and R2 are called out as **blocking** in the verification checklist — R1 because it is the single worst outcome this feature can produce (real money sent against a dead order), R2 because this project has already shipped this exact class of defect once. Everything else gets coverage proportional to severity.

---

## 2. Test levels

### L1 — Unit

Pure logic, no I/O, no DOM.

**Scope:**
- `frontend/src/utils/orderDeadline.js`'s `formatDeadline` — the full outcome matrix: null/undefined/empty input, unparsable input, a future deadline's absolute-time formatting, the cross-timezone-day case (proving `Asia/Ho_Chi_Minh` is genuinely applied rather than passed through from the runtime default), sub-hour rounding-up to `1`, an exact-hour case, the sweep-window boundary (`<=`) and just-past case, and the no-`now`-argument default path.

### L2 — Integration

A route against the real `cosplay_test` MySQL schema, via `supertest` against the exported Express `app`, matching Plans 1–5's tooling and isolation (`resetTables` before every test — though this phase's own new tests reuse the existing `orderRoutes.test.js` fixtures and add no new table dependency).

**Scope:**
- `GET /api/orders/:token` (`backend/tests/orderRoutes.test.js`) — `expires_at` present and non-null for a prepaid order; `expires_at` present and `null` for a COD order; the allowlist-regression test asserting `expires_at`'s presence alongside the continued absence of `request_key`, `stock_released_at`, `payment_proof_url`, `note`, `buyer_name`, `phone`, `email`, `address_raw`.

### L3 — Component

Frontend, `react-dom`'s `createRoot`/`act` (this codebase does not use Testing Library — matching `Order.test.jsx`'s and `AdminOrders.test.jsx`'s established pattern).

**Scope:**
- `Order.jsx` — deadline block renders for a pending prepaid order with a future `expires_at`; renders nothing deadline-related for a COD (`null`) order; renders the passed-deadline message (not a countdown) for a pending order whose `expires_at` is in the past; renders nothing at all once `status` is `confirmed` even with a past `expires_at`; the manual-confirmation note and transfer-note explanation appear while pending; the extended `orderSaveLink` text (mentioning the email) is what's actually rendered, not the old pre-Phase-6 string.
- `Checkout.jsx` — the payment-window notice appears when a non-COD method is selected; it is absent when `cod` is selected.

### L4 — Non-functional

| Area | Method |
|---|---|
| **Security** | R2's allowlist-regression test is the entire security surface this phase touches — no new route, no new auth boundary, no new write path. Re-run alongside the existing `orderRoutes.test.js` suite, which already exercises 401/404/noindex on this same endpoint. |
| **i18n completeness** | The key-set-parity script from the plan's Task 3 Step 3, re-run manually at verification time (item E1) by reading `translations.js` directly rather than trusting the authoring-time run alone. |
| **Timezone correctness** | R5's cross-day unit test is designed to fail under *any* test-runner default timezone if the `timeZone` option were ever dropped — this is deliberately not a "run CI in UTC" mitigation, since a real buyer's browser can be in any timezone. |
| **Layout at 375px** | Manual only — verification item C1, explicitly marked NOT VERIFIABLE without a browser. |

There is no L5 (end-to-end/acceptance) beyond what the verification checklist's manual sections cover — this phase is too small to warrant a distinct scripted E2E journey beyond the acceptance checklist itself, unlike Plan 5's spreadsheet-round-trip journeys.

---

## 3. What this plan must prove before shipping

- **The sweep-window state never shows a countdown.** Any `expires_at <= now` state, regardless of how many seconds past, renders the passed-deadline message and never `remainingHours` as if time remains. This is the single fact this whole phase exists to get right — see the spec's own words: "the worst outcome this feature can produce."
- **A null `expires_at` renders nothing** — no placeholder, no blank box, no `"null"` text — and neither does an unparsable one.
- **`toPublicOrder` gained exactly one field.** The allowlist-regression test must show `expires_at` present and the same fields absent that were absent before this phase touched the function.
- **Both languages have every new key**, checked directly against the file, not only by the authoring-time script.
- **The deadline stops rendering once the seller has confirmed the order**, since `expires_at` is never cleared on confirm — the gate lives in the page, not the helper, and both need a test proving the gate actually works (the helper alone would still report `passed`/hours correctly on a confirmed order's stale `expires_at`; only the page-level gate makes that irrelevant).

---

## 4. The highest-value test — blocking

### 4.1 The sweep-window boundary (`orderDeadline.test.js` + `Order.test.jsx`)

Two layers. The unit level plants two instants: one 5 seconds past the deadline and one exactly at it, and asserts `passed: true` and `remainingHours: 0` for both — proving the boundary is `<=`, not `<` (an off-by-one here would let the exact expiry second show as "còn 0 giờ" instead of the passed state, right at the moment the worker's next sweep tick is about to fire). The component level goes one step further and asserts `Order.jsx` actually renders the passed-deadline *message text*, not merely that the helper computed the right flag — a correct helper wired to the wrong conditional in the component would still show a countdown.

**Any failure here is a Blocker per §6** — this is literally the scenario the spec names as the worst thing this feature could produce: a buyer transferring money against an order that is already, or is about to be, cancelled.

### 4.2 The allowlist regression (`orderRoutes.test.js`)

`toPublicOrder`'s test asserts, in the same response body, that `expires_at` is now present **and** that eight specific fields (`request_key`, `stock_released_at`, `payment_proof_url`, `note`, `buyer_name`, `phone`, `email`, `address_raw`) remain absent. This project has shipped exactly this class of defect once already (a payment-proof-URL leak through this same function in an earlier phase) — the test exists specifically so that a future one-line "just add this field too" edit to `toPublicOrder` cannot land without failing a test that names the fields it must not touch.

**Any failure here is a Blocker per §6.**

---

## 5. Test data

- Backend: reuses `orderRoutes.test.js`'s existing `seed()`/`body()` helpers — no new fixture infrastructure. A prepaid order comes from the default `body(v)`; a COD order from `body(v, { payment_method: "cod" })`.
- Frontend unit tests use fixed ISO instants (`"2026-08-09T13:30:00Z"` etc.) rather than relative `Date.now()` math wherever the assertion depends on the exact rendered string, so a test never becomes flaky near a real day boundary; the sub-hour and cross-timezone-day cases are deliberately chosen to fail if `Asia/Ho_Chi_Minh` or the `<=` boundary were ever silently changed.
- Component tests use small `futureIso(hours)`/`pastIso(hours)` helpers (relative to real "now") where the exact clock value doesn't matter, only its sign relative to the current instant — appropriate for "is a deadline block visible at all," not for exact-string assertions (those live at the unit level, per the layering above).

---

## 6. Entry and exit criteria

**A task is done when:** its own tests pass, the full backend and frontend suites pass with no regression, and it is committed.

**Plan 6 is done when:**
- All five tasks are done.
- §4.1 and §4.2 both pass, with no accepted-failure exception for either.
- The acceptance checklist (`2026-08-09-merch-shop-6-verification.md`) is fully PASS, or every open item has a recorded accept/reject decision — including items that explicitly cannot be verified without a browser.
- No High-severity risk from §1 (R1, R2) is unmitigated.

**The phase ships when Plan 6 is done and Plans 1–5's own exit criteria still hold** (re-run their regression suites; this phase touches one backend route file, one new frontend util, one translations file, and two existing pages — no other file's behavior changes).

---

## 7. Defect handling

Same severity table as Plans 1–5 (`Blocker` / `Major` / `Minor`). For this phase specifically: any failure of §4.1 (sweep-window) or §4.2 (allowlist regression) is a **Blocker**. A translation key present in only one language, or a confirmed-order stale-deadline display, is **Major**. A 375px wrapping/spacing issue that doesn't cause horizontal scroll or hide information is **Minor**.

Every Blocker and Major gets a regression test before the fix is considered complete, matching the Plans 1–5 convention.

## Regression suite

```bash
cd backend  && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test
cd frontend && npm test && npm run build && npm run lint
```

`npm run lint` carries 3 known pre-existing problems (`Portfolio.jsx` x2, `AdminAlbumImages.jsx` x1) from earlier phases. No task in this phase may introduce a fourth without fixing it before its own commit.

Expected new test counts: backend 583 → 586 (3 new, `orderRoutes.test.js`); frontend 118 → 137 (19 new: 11 in `orderDeadline.test.js`, 6 in `Order.test.jsx`, 2 in `Checkout.test.jsx`).
