# Merch Shop — Plan 6: Buyer Onboarding Guidance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell buyers, at the moment each problem occurs, the four things they currently aren't told — when their payment deadline is, that the seller confirms transfers by hand, that the transfer note must match exactly, and that their order link was emailed to them — by exposing `orders.expires_at` to the buyer and adding copy at exactly two points in the buyer flow.

**Architecture:** One backend allowlist addition (`expires_at` in `toPublicOrder`), one small pure formatting helper on the frontend so the Asia/Ho_Chi_Minh timezone rule and the sweep-window edge case are both handled in exactly one place, and copy changes in `Order.jsx` and `Checkout.jsx` plus their translation keys. No migration, no new endpoint, no new query — `getOrderByToken` already does `SELECT o.*`, so `expires_at` is already on the order object the route handler holds; only the outbound allowlist is missing it.

**Tech Stack:** As Plans 1–5. No new dependency.

**Depends on:** Plans 1–5 complete, `feature/order` branch.

**Spec:** `docs/superpowers/specs/2026-08-09-buyer-onboarding-design.md` — read it before touching this plan; the Deadline Display, Error Handling, and Out of Scope sections are the source of truth for every branch below.

## Global Constraints

- **Backend implementation files are CommonJS** (`module.exports` / `require`). **Test files are Vitest 3 ESM** (`import { describe, it, expect } from "vitest"`). Vitest 3 refuses `require("vitest")` inside a test file.
- **`toPublicOrder` in `backend/routes/orders.js` is a deliberate allowlist**, not a blocklist — it destructures named fields off `order` and returns exactly those. Adding a field means adding it to **both** the destructure and the returned object literal. This function has already produced one security finding in this project (a payment-proof-URL leak in an earlier phase), so any test touching it must assert both the addition and the continued exclusion of everything not on the list, in particular `order_token`.
- **No query change is needed anywhere in this phase.** `orderRepo.getOrderByToken` already runs `SELECT o.*`, so `expires_at` is already present on the `order` object passed into `toPublicOrder`. Do not add a column to a `SELECT` list, write a migration, or touch `orderRepo.js` — there is nothing there to change.
- **COD orders have a `NULL expires_at`** (`domain.computeExpiry` returns `null` for `payment_method === "cod"`) and never expire. **The expiry sweep runs in `backend/worker.js` roughly every 5 seconds**, which means `expires_at` can be in the past while `status` is still `pending` for a real, observable interval — this is not a hypothetical race, it is the phase's central edge case.
- **Buyer-facing UI is bilingual.** Every new translation key in `frontend/src/i18n/translations.js` needs both an `en` and a `vi` entry. The admin panel is hardcoded Vietnamese and is untouched by this phase.
- **`orderSaveLink` already exists** and must be **extended, not duplicated**: `"Save this link to check your order later."` (en, line ~48) / `"Lưu lại đường dẫn này để kiểm tra đơn hàng sau."` (vi, line ~165). The order-confirmation email already contains the order link (`backend/shop/email/templates.js`'s `order_url` field) — extending this line to mention that is documenting an existing fact, not building a new one.
- **`LanguageContext`'s `t(key, params)` supports `{placeholder}` interpolation** (`frontend/src/contexts/LanguageContext.jsx`) — a key may contain `{time}`, `{remaining}`, `{hours}` etc., substituted from the `params` object passed at the call site.
- **Never invent a CSS variable.** `--border-brand` is real and is the one used throughout the buyer pages (`Order.jsx`, `Checkout.jsx`). Grep `frontend/src` before adding a class referencing any other custom property.
- **Money via `formatVnd`** (`frontend/src/utils/money.js`) — unrelated to this phase's fields, but any code touching the same files must not introduce a float where an integer VND amount is expected.
- **Mobile: usable at 375px.** Both `Order.jsx` and `Checkout.jsx` already render inside a `max-w-2xl mx-auto px-4` container; new blocks must fit that container without introducing horizontal scroll.
- **Do not clear state inside a fetch effect; guard refetch paths against out-of-order responses.** Not directly exercised by this phase's changes (no new fetch is added — the existing `fetchOrder` effect in `Order.jsx` already carries `expires_at` once the backend sends it), but any test file touching `Order.test.jsx` must not regress this pattern.
- **Test commands:** backend `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` (**583 passing** before this phase starts); frontend `cd frontend && npm test && npm run build && npm run lint` (**118 passing** before this phase starts). `npm run lint` has 3 known pre-existing problems in `Portfolio.jsx`/`AdminAlbumImages.jsx` (2 warnings, 1 error) from earlier phases — not this plan's problem; do not fix them here, and do not let a new task introduce a fourth.
- **Commits:** Conventional Commits, descriptive body, **no `Co-Authored-By` trailer**.

---

### Task 1: Add `expires_at` to the public order projection

**Files:**
- Modify: `backend/routes/orders.js`
- Test: `backend/tests/orderRoutes.test.js`

**Interfaces:**
- Produces: `GET /api/orders/:token`'s JSON response now includes `expires_at` (an ISO datetime string or `null`, whatever `mysql2` returns for the column — no coercion is added).
- Consumed by: Task 2's helper and Task 4's `Order.jsx` read `order.expires_at` from the API response shape this task produces.

- [ ] **Step 1: Write the failing tests**

Open `backend/tests/orderRoutes.test.js` and add these two `it` blocks inside the existing `describe("GET /api/orders/:token", ...)` block, right after the `"does not echo internal fields (request_key, stock_released_at)"` test:

```js
  it("includes expires_at for a prepaid (non-COD) order", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))

    const res = await request(app).get(`/api/orders/${created.body.order_token}`)
    expect(res.body).toHaveProperty("expires_at")
    expect(res.body.expires_at).not.toBeNull()
  })

  it("returns a null expires_at for a COD order, which never expires", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v, { payment_method: "cod" }))

    const res = await request(app).get(`/api/orders/${created.body.order_token}`)
    expect(res.body).toHaveProperty("expires_at")
    expect(res.body.expires_at).toBeNull()
  })

  it("allowlist regression: expires_at is now present and order_token, request_key, stock_released_at are still absent or as before", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))

    const res = await request(app).get(`/api/orders/${created.body.order_token}`)
    expect(res.body).toHaveProperty("expires_at")
    // order_token IS present on this response by design (the buyer already
    // holds it — it's in the URL they just requested), but nothing this
    // phase adds may widen that: these fields must still never appear.
    expect(res.body).not.toHaveProperty("request_key")
    expect(res.body).not.toHaveProperty("stock_released_at")
    expect(res.body).not.toHaveProperty("payment_proof_url")
    expect(res.body).not.toHaveProperty("note")
    expect(res.body).not.toHaveProperty("buyer_name")
    expect(res.body).not.toHaveProperty("phone")
    expect(res.body).not.toHaveProperty("email")
    expect(res.body).not.toHaveProperty("address_raw")
  })
```

Note: `body(v, {...})` is this file's existing helper for building a request body with overrides — confirm its exact signature by reading the top of `orderRoutes.test.js` before adding these tests; do not invent a different helper name.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- orderRoutes`
Expected: the two new `expires_at`-asserting tests FAIL (`expect(res.body).toHaveProperty("expires_at")` fails because the key is absent); the allowlist regression test's `not.toHaveProperty` assertions already pass since those fields were never present.

- [ ] **Step 3: Add `expires_at` to `toPublicOrder`**

In `backend/routes/orders.js`, find `toPublicOrder`:

```js
function toPublicOrder(order) {
  const {
    id, order_token, status, total, fulfillment_method, tracking_code, created_at, items,
    // Spec (Fulfillment): pickup location/note must be shown on the order
    // page, not just the pre-purchase collection browse page. Sourced from
    // the order's own collection (joined in getOrderByToken), same content
    // that is already public on the collection page — no new exposure.
    pickup_location, pickup_note,
  } = order
  return {
    id, order_token, status, total, fulfillment_method, tracking_code, created_at, items,
    pickup_location, pickup_note,
  }
}
```

Change it to:

```js
function toPublicOrder(order) {
  const {
    id, order_token, status, total, fulfillment_method, tracking_code, created_at, items,
    // Spec (Fulfillment): pickup location/note must be shown on the order
    // page, not just the pre-purchase collection browse page. Sourced from
    // the order's own collection (joined in getOrderByToken), same content
    // that is already public on the collection page — no new exposure.
    pickup_location, pickup_note,
    // Spec (Buyer Onboarding, Phase 6): the payment deadline the reservation
    // and the expiry sweep already enforce, but never told to the buyer
    // before now. NULL for COD (domain.computeExpiry never sets a deadline
    // for it). This is the only line this phase adds to this allowlist.
    expires_at,
  } = order
  return {
    id, order_token, status, total, fulfillment_method, tracking_code, created_at, items,
    pickup_location, pickup_note, expires_at,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- orderRoutes`
Expected: PASS, all tests in the file including the 3 new ones.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, 586 tests (583 + 3), no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/orders.js backend/tests/orderRoutes.test.js
git commit -F - <<'EOF'
feat(shop): expose expires_at on the public order projection

toPublicOrder's allowlist now includes expires_at, so the order page can
tell a buyer when their payment deadline is. No query change: getOrderByToken
already runs SELECT o.*, so expires_at was already on the order object this
function was handed — only the outbound allowlist was missing it.

NULL for COD orders (they never expire, per domain.computeExpiry).

A dedicated allowlist-regression test asserts expires_at is now present
while request_key, stock_released_at, payment_proof_url, note, buyer_name,
phone, email, and address_raw remain absent, matching this project's
convention (an earlier phase's payment-proof-URL leak) of never trusting an
allowlist addition without a test proving nothing else widened alongside it.
EOF
```

---

### Task 2: `formatDeadline` — the one place the timezone rule and the sweep-window edge live

**Files:**
- Create: `frontend/src/utils/orderDeadline.js`
- Test: `frontend/src/utils/orderDeadline.test.js`

**Interfaces:**
- Produces: `frontend/src/utils/orderDeadline.js` exporting `formatDeadline(expiresAt: string | null | undefined, now?: Date): { absolute: string, remainingHours: number, passed: boolean } | null`.
  - Returns `null` when `expiresAt` is `null`/`undefined`/empty, or when it does not parse to a valid `Date` — the caller renders nothing in both cases (per spec: a missing deadline and a broken deadline must both be silent, never a placeholder or `Invalid Date`).
  - `absolute` is the deadline formatted in `Asia/Ho_Chi_Minh`, e.g. `"20:30 09/08"` (`HH:mm dd/MM`), independent of the runtime/browser timezone.
  - `passed` is `true` when `expiresAt <= now`. When `passed` is `true`, `remainingHours` is always `0` and the caller must never render it as if time remains (the sweep-window edge case).
  - `remainingHours` is `Math.ceil` of the hours remaining when not yet passed, floored at `1` so a deadline 20 minutes away never reads "còn 0 giờ" (the spec's explicit "never imply zero or negative time remains" rule applies for any not-yet-passed instant, not only exactly at the boundary).
- Consumed by: Task 4 (`Order.jsx`) calls `formatDeadline(order.expires_at)` and renders based on its return value.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/utils/orderDeadline.test.js`:

```js
import { describe, it, expect } from "vitest"
import { formatDeadline } from "./orderDeadline"

describe("formatDeadline", () => {
  it("returns null for a null expires_at (COD orders never expire)", () => {
    expect(formatDeadline(null)).toBeNull()
  })

  it("returns null for an undefined expires_at", () => {
    expect(formatDeadline(undefined)).toBeNull()
  })

  it("returns null for an empty string", () => {
    expect(formatDeadline("")).toBeNull()
  })

  it("returns null for an unparsable date string, never Invalid Date", () => {
    const result = formatDeadline("not-a-real-date")
    expect(result).toBeNull()
  })

  it("formats a future deadline as HH:mm dd/MM in Asia/Ho_Chi_Minh", () => {
    // 2026-08-09T13:30:00Z is 20:30 in Asia/Ho_Chi_Minh (UTC+7) on the same day.
    const now = new Date("2026-08-09T10:30:00Z")
    const result = formatDeadline("2026-08-09T13:30:00Z", now)
    expect(result.passed).toBe(false)
    expect(result.absolute).toBe("20:30 09/08")
  })

  it("formats the Asia/Ho_Chi_Minh wall-clock time correctly regardless of the runtime's own timezone", () => {
    // A UTC instant that lands on a different calendar day in Asia/Ho_Chi_Minh
    // than it does in UTC — proves the +7 offset is applied, not passed
    // through as whatever the test runner's local TZ happens to be.
    const now = new Date("2026-08-09T00:00:00Z")
    const result = formatDeadline("2026-08-09T23:00:00Z", now) // 06:00 on 08/10 in UTC+7
    expect(result.absolute).toBe("06:00 10/08")
  })

  it("rounds remaining time up so a deadline minutes away never reads as 0 hours left", () => {
    const now = new Date("2026-08-09T10:00:00Z")
    const result = formatDeadline("2026-08-09T10:20:00Z", now) // 20 minutes away
    expect(result.passed).toBe(false)
    expect(result.remainingHours).toBe(1)
  })

  it("reports exactly 3 hours remaining for a deadline 3 hours away", () => {
    const now = new Date("2026-08-09T10:00:00Z")
    const result = formatDeadline("2026-08-09T13:00:00Z", now)
    expect(result.remainingHours).toBe(3)
  })

  it("SWEEP WINDOW: a deadline in the past reports passed:true and remainingHours:0, never a negative or zero-looking 'time left'", () => {
    const now = new Date("2026-08-09T10:00:05Z") // 5 seconds after the deadline
    const result = formatDeadline("2026-08-09T10:00:00Z", now)
    expect(result.passed).toBe(true)
    expect(result.remainingHours).toBe(0)
  })

  it("SWEEP WINDOW: a deadline exactly equal to now is treated as passed, not as 0 hours of a still-live countdown", () => {
    const now = new Date("2026-08-09T10:00:00Z")
    const result = formatDeadline("2026-08-09T10:00:00Z", now)
    expect(result.passed).toBe(true)
  })

  it("defaults now to the current time when not passed explicitly", () => {
    // A far-future deadline is always "not passed" under a real current now.
    const result = formatDeadline("2099-01-01T00:00:00Z")
    expect(result.passed).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- orderDeadline`
Expected: FAIL — `frontend/src/utils/orderDeadline.js` does not exist.

- [ ] **Step 3: Implement**

Create `frontend/src/utils/orderDeadline.js`:

```js
/**
 * Formats orders.expires_at for the buyer-facing order page.
 *
 * The single place the Asia/Ho_Chi_Minh timezone rule (matching the
 * convention Plan 4's bookkeeping cutoff established) and the sweep-window
 * edge case are applied — see the spec's Deadline Display and Error
 * Handling sections. Every call site renders nothing when this returns
 * null: a missing or unparsable deadline must never be mistakable for an
 * urgent one, and must never render as the literal string "Invalid Date".
 */
export function formatDeadline(expiresAt, now = new Date()) {
  if (!expiresAt) return null

  const deadline = new Date(expiresAt)
  if (Number.isNaN(deadline.getTime())) return null

  const passed = deadline.getTime() <= now.getTime()

  const absolute = deadline.toLocaleString("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit", minute: "2-digit",
    day: "2-digit", month: "2-digit",
    hour12: false,
  }).replace(",", "").replace(/^(\d{2}:\d{2}) (\d{2})\/(\d{2})\/\d{4}$/, "$1 $2/$3")

  // Never a countdown once the deadline has passed — the sweep window (the
  // worker cancels a pending order every ~5s) means expires_at can be in
  // the past while status is still pending. Showing "còn 0 giờ" here would
  // read as "there's still time," which is the one outcome this feature
  // must never produce.
  const remainingHours = passed
    ? 0
    : Math.max(1, Math.ceil((deadline.getTime() - now.getTime()) / (60 * 60 * 1000)))

  return { absolute, remainingHours, passed }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- orderDeadline`
Expected: PASS, 11 tests.

If the `absolute` format assertion (`"20:30 09/08"`) fails because `toLocaleString("en-GB", ...)` in the test environment's ICU data emits a different separator or ordering, adjust the `.replace(...)` chain (not the test's expected value — the test's expected string is the spec's own worked example, `Hạn thanh toán: 20:30 09/08 (còn 3 giờ)`) until the two match exactly.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/orderDeadline.js frontend/src/utils/orderDeadline.test.js
git commit -F - <<'EOF'
feat(shop): add formatDeadline, the single place the deadline timezone
rule and sweep-window edge case are handled

Formats orders.expires_at as an absolute Asia/Ho_Chi_Minh time plus
remaining whole hours, per the spec's worked example
("Hạn thanh toán: 20:30 09/08 (còn 3 giờ)"). Two rules live here so they
are applied in exactly one place rather than at every call site:

- A deadline already in the past reports passed:true and
  remainingHours:0, never a countdown — the worker's ~5s expiry sweep
  means expires_at can be behind status=pending for a real interval, and
  showing time remaining then is the single worst outcome this feature
  can produce (a buyer transferring against an already-dead order).
- A null, undefined, empty, or unparsable expires_at returns null, so
  every call site renders nothing rather than a placeholder or the
  literal "Invalid Date".
EOF
```

---

### Task 3: Translation keys — extend `orderSaveLink`, add the three new buyer-facing strings

**Files:**
- Modify: `frontend/src/i18n/translations.js`

**Interfaces:**
- Produces: updated `orderSaveLink` value, plus four new keys, each present in both `en` and `vi`: `orderDeadline`, `orderDeadlinePassed`, `orderManualConfirmNote`, `orderTransferNoteExplain`, `checkoutPaymentWindow`. (Five new keys total.)
- Consumed by: Task 4 (`Order.jsx`) reads `orderDeadline`, `orderDeadlinePassed`, `orderManualConfirmNote`, `orderTransferNoteExplain`, and the extended `orderSaveLink`. Task 5 (`Checkout.jsx`) reads `checkoutPaymentWindow`.

- [ ] **Step 1: Edit the `en` block**

In `frontend/src/i18n/translations.js`, find (around line 48):

```js
    orderSaveLink: "Save this link to check your order later.",
```

Replace with:

```js
    orderSaveLink: "Save this link to check your order later. We also emailed it to you.",
    orderDeadline: "Payment deadline: {time} ({remaining})",
    orderDeadlinePassed: "The payment deadline has passed — this order is being cancelled automatically.",
    orderManualConfirmNote: "Payments are checked manually by the seller, which can take a little time. Uploading a screenshot of your transfer helps confirm it faster.",
    orderTransferNoteExplain: "Please include the exact transfer note above — without it, we can't match your payment to this order.",
```

Also add, near the other `checkout*` keys in the `en` block (e.g. next to `checkoutShippingNote`):

```js
    checkoutPaymentWindow: "Bank transfer / Momo / PayPal orders must be paid within a limited window after you order, or they're cancelled automatically. The exact deadline will appear on your order page after checkout.",
```

- [ ] **Step 2: Edit the `vi` block**

Find (around line 165):

```js
    orderSaveLink: "Lưu lại đường dẫn này để kiểm tra đơn hàng sau.",
```

Replace with:

```js
    orderSaveLink: "Lưu lại đường dẫn này để kiểm tra đơn hàng sau. Chúng tôi cũng đã gửi đường dẫn này qua email cho bạn.",
    orderDeadline: "Hạn thanh toán: {time} ({remaining})",
    orderDeadlinePassed: "Đã quá hạn thanh toán — đơn hàng đang được tự động hủy.",
    orderManualConfirmNote: "Người bán kiểm tra chuyển khoản thủ công nên có thể mất chút thời gian. Tải lên ảnh chụp màn hình chuyển khoản sẽ giúp xác nhận nhanh hơn.",
    orderTransferNoteExplain: "Vui lòng ghi đúng nội dung chuyển khoản ở trên — nếu không, chúng tôi sẽ không thể đối chiếu thanh toán với đơn hàng này.",
```

Also add, near the other `checkout*` keys in the `vi` block:

```js
    checkoutPaymentWindow: "Đơn hàng thanh toán qua chuyển khoản/Momo/PayPal cần được thanh toán trong một khoảng thời gian giới hạn sau khi đặt hàng, nếu không sẽ tự động bị hủy. Hạn cụ thể sẽ hiển thị trên trang đơn hàng của bạn sau khi đặt.",
```

Note: this task adds no `remainingHours`-specific key — the sentence is built from `orderDeadline`'s `{remaining}` placeholder, which Task 4 fills with a plain string it composes itself (`"còn {n} giờ"` / `"{n}h left"`) rather than a sixth translation key, since that string is itself locale-dependent phrasing wrapped around a number, not a fixed label. See Task 4 Step 3 for the exact composition.

- [ ] **Step 3: Verify both locales have matching key sets**

Run:

```bash
cd frontend && node -e "
const { translations } = require('./src/i18n/translations.js')
const enKeys = Object.keys(translations.en).sort()
const viKeys = Object.keys(translations.vi).sort()
const missingInVi = enKeys.filter((k) => !viKeys.includes(k))
const missingInEn = viKeys.filter((k) => !enKeys.includes(k))
console.log('missing in vi:', missingInVi)
console.log('missing in en:', missingInEn)
"
```

Expected: both arrays empty. (If `translations.js` uses `export const` rather than `module.exports`, run the equivalent check via a quick Vitest test instead — do not leave this step unverified.)

- [ ] **Step 4: Run the frontend suite**

Run: `cd frontend && npm test`
Expected: PASS, no regressions — this task changes no component, only data.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/translations.js
git commit -F - <<'EOF'
feat(shop): add buyer-onboarding translation keys, extend orderSaveLink

Extends the existing orderSaveLink line to mention the order link was also
emailed (it already is, via order_url in the confirmation email template —
this documents an existing fact, not a new behavior).

Adds four new bilingual keys used by the order and checkout pages: the
payment deadline label, the passed-deadline message, the manual-
confirmation note, and the transfer-note explanation, plus a fifth
(checkoutPaymentWindow) for the payment-window notice shown before checkout.
No key is duplicated — each extends or sits beside its existing neighbors.
EOF
```

---

### Task 4: `Order.jsx` — render the deadline, the manual-confirm note, and the transfer-note explanation

**Files:**
- Modify: `frontend/src/pages/Order.jsx`
- Test: `frontend/src/pages/Order.test.jsx`

**Interfaces:**
- Consumes: `formatDeadline` (Task 2); `orderDeadline`, `orderDeadlinePassed`, `orderManualConfirmNote`, `orderTransferNoteExplain`, extended `orderSaveLink` (Task 3); `order.expires_at`, `order.status` (Task 1's API response shape).
- Produces: no new exports — this task changes only `Order.jsx`'s rendered output.

- [ ] **Step 1: Read the existing test file's conventions**

Open `frontend/src/pages/Order.test.jsx` and note its render/mock/assert pattern (this codebase does not use Testing Library — it uses `react-dom`'s `createRoot`/`act`, matching `AdminOrders.test.jsx`) before writing new assertions, so the new tests match the file's existing style exactly rather than introducing a second pattern.

- [ ] **Step 2: Write the failing tests**

Add to `frontend/src/pages/Order.test.jsx` (adapting the mock-order fixture already used in that file to include `expires_at`, and following its existing render helper):

```js
describe("Order — payment deadline (Phase 6)", () => {
  it("renders the deadline block for a pending, prepaid order with a future expires_at", async () => {
    const order = mockOrder({ status: "pending", expires_at: futureIso(3) }) // e.g. 3 hours out
    // ... render Order with this order mocked from fetchOrder, following the file's existing pattern
    // Assert the container includes the deadline label text and does NOT
    // include the passed-deadline message.
  })

  it("renders nothing deadline-related for a COD order (null expires_at)", async () => {
    const order = mockOrder({ status: "pending", expires_at: null, payment_method: "cod" })
    // Assert no deadline block, no "Invalid Date", no empty placeholder text.
  })

  it("renders the passed-deadline message, not a countdown, when expires_at is in the past but status is still pending (the sweep window)", async () => {
    const order = mockOrder({ status: "pending", expires_at: pastIso(1) })
    // Assert the passed-deadline text is present and no "còn"/hours-remaining text is rendered.
  })

  it("does not render the deadline block once the order is confirmed", async () => {
    const order = mockOrder({ status: "confirmed", expires_at: futureIso(3) })
    // Assert no deadline block at all — expires_at stops being relevant once
    // the seller has confirmed the transfer, and re-showing a stale
    // countdown here would be confusing rather than helpful.
  })

  it("renders the manual-confirmation note and the transfer-note explanation while pending", async () => {
    const order = mockOrder({ status: "pending", expires_at: futureIso(3) })
    // Assert both t("orderManualConfirmNote") and t("orderTransferNoteExplain") text are present.
  })

  it("renders the extended save-the-link line mentioning the email", async () => {
    const order = mockOrder({ status: "pending", expires_at: futureIso(3) })
    // Assert the rendered orderSaveLink text contains the email mention
    // (i.e. matches the full updated string, not the old pre-Phase-6 one).
  })
})
```

Replace the `// Assert ...` comments and the `mockOrder`/`futureIso`/`pastIso` helper calls with real code matching this file's existing fixture and rendering helpers — read the file first (Step 1) and use its actual mock/render function names, not placeholder names invented here. `futureIso(hours)` and `pastIso(hours)` are two tiny helpers this task adds at the top of the test file:

```js
function futureIso(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

function pastIso(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `cd frontend && npm test -- Order.test`
Expected: FAIL — none of the new text (deadline label, passed-deadline message, manual-confirm note, transfer-note explanation, extended save-link text) is in `Order.jsx`'s current output.

- [ ] **Step 4: Implement**

In `frontend/src/pages/Order.jsx`, add the import:

```js
import { formatDeadline } from "../utils/orderDeadline"
```

Add a small local component near the top of the file (after `ProofUpload`, before `export default function Order()`):

```js
function DeadlineBlock({ expiresAt }) {
  const { t } = useLanguage()
  const info = formatDeadline(expiresAt)
  if (!info) return null

  if (info.passed) {
    return <p className="text-sm text-[var(--text-error)] mt-1">{t("orderDeadlinePassed")}</p>
  }

  // "còn {n} giờ" / "{n}h left" is composed here, not stored as a sixth
  // translation key — see Task 3 Step 2's note: this phrase is a number
  // wrapped in locale-specific phrasing, not a fixed label on its own.
  const { lang } = useLanguage()
  const remaining = lang === "vi" ? `còn ${info.remainingHours} giờ` : `${info.remainingHours}h left`
  return (
    <p className="text-sm mt-1">
      {t("orderDeadline", { time: info.absolute, remaining })}
    </p>
  )
}
```

Note: `useLanguage()` is called twice in that snippet (once destructuring `t`, once destructuring `lang`) — before committing, replace this with a single `const { t, lang } = useLanguage()` at the top of `DeadlineBlock`, since calling the same hook twice in one component is redundant, not because the double call is broken.

Now update the status block and the pending-only section. Find:

```js
      <div className="p-4 rounded-xl border border-[var(--border-brand)] mb-6">
        <p className="text-sm opacity-70">{t("orderStatus")}</p>
        <p className="font-semibold">{t(STATUS_KEY[order.status])}</p>
        {order.tracking_code && <p className="text-sm mt-1">#{order.tracking_code}</p>}
      </div>

      {showPaymentInstructions && <PaymentInstructions instructions={instructions} token={token} />}

      {/* Hidden entirely once the order leaves pending — the API itself
          refuses uploads past that point, so this mirrors the server rule. */}
      {isPending && <ProofUpload token={token} />}
```

Replace with:

```js
      <div className="p-4 rounded-xl border border-[var(--border-brand)] mb-6">
        <p className="text-sm opacity-70">{t("orderStatus")}</p>
        <p className="font-semibold">{t(STATUS_KEY[order.status])}</p>
        {order.tracking_code && <p className="text-sm mt-1">#{order.tracking_code}</p>}
        {/* Deadline is only meaningful while the seller hasn't yet confirmed
            the transfer — expires_at is never cleared on confirm, so this
            gate (not the helper) is what stops a stale countdown from
            reappearing on a confirmed/shipped/completed order. */}
        {isPending && <DeadlineBlock expiresAt={order.expires_at} />}
        {isPending && <p className="text-sm opacity-70 mt-1">{t("orderManualConfirmNote")}</p>}
      </div>

      {showPaymentInstructions && <PaymentInstructions instructions={instructions} token={token} />}

      {/* The exact transfer note only exists on PaymentInstructions, so this
          explanation is only relevant alongside it. */}
      {showPaymentInstructions && <p className="text-xs opacity-70 mb-4">{t("orderTransferNoteExplain")}</p>}

      {/* Hidden entirely once the order leaves pending — the API itself
          refuses uploads past that point, so this mirrors the server rule. */}
      {isPending && <ProofUpload token={token} />}
```

`isPending` is already defined earlier in the component (`const isPending = order.status === "pending"`) — no new variable is introduced.

The `orderSaveLink` line itself needs no code change — Task 3 already updated its value; `Order.jsx` already renders `{t("orderSaveLink")}` verbatim.

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npm test -- Order.test`
Expected: PASS, all tests in the file including the 6 new ones.

- [ ] **Step 6: Manually check 375px usability**

This step cannot be scripted in this plan — flag it for the verification pass (`2026-08-09-merch-shop-6-verification.md` item C1). Visually confirm in a 375px-wide viewport that the deadline text and the two new notes wrap without causing the page to scroll sideways.

- [ ] **Step 7: Run the full frontend suite**

Run: `cd frontend && npm test && npm run build && npm run lint`
Expected: PASS; lint shows exactly the same 3 pre-existing problems noted in Global Constraints, none new.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Order.jsx frontend/src/pages/Order.test.jsx
git commit -F - <<'EOF'
feat(shop): show the payment deadline and manual-confirmation copy on the
order page

Adds a DeadlineBlock that renders formatDeadline's output beside the order
status while the order is pending: an absolute Asia/Ho_Chi_Minh time plus
remaining hours when there's still time, or the passed-deadline message
(never a countdown) once expires_at has passed — covering the sweep-window
interval where the worker hasn't yet caught up to cancel the order.

Gated on status === "pending" rather than inside the helper itself, since
expires_at is never cleared on confirm: without this gate a confirmed order
would keep showing a stale countdown or an incorrect "passed" message.

Also adds the manual-confirmation note and the transfer-note explanation
(shown only alongside PaymentInstructions, since that's the only place the
exact transfer note itself is displayed) — both new translation keys added
in the previous commit.
EOF
```

---

### Task 5: `Checkout.jsx` — state the payment window before the buyer commits; final regression pass

**Files:**
- Modify: `frontend/src/pages/Checkout.jsx`
- Test: `frontend/src/pages/Checkout.test.jsx` (create if it does not already exist, following `Order.test.jsx`'s render pattern — check first)

**Interfaces:**
- Consumes: `checkoutPaymentWindow` (Task 3).
- Produces: no new exports — this task changes only `Checkout.jsx`'s rendered output.

- [ ] **Step 1: Confirm whether `Checkout.test.jsx` already exists**

```bash
ls frontend/src/pages/Checkout.test.jsx 2>/dev/null && echo EXISTS || echo MISSING
```

If `MISSING`, this task creates it from scratch using the exact same `react-dom` `createRoot`/`act` pattern as `Order.test.jsx` (no Testing Library, matching this codebase's established convention) — copy that file's render-harness boilerplate rather than inventing a new one.

- [ ] **Step 2: Write the failing test**

Add (to the existing or newly created `Checkout.test.jsx`):

```js
describe("Checkout — payment window notice (Phase 6)", () => {
  it("shows the payment-window notice when a non-COD payment method is selected", async () => {
    // Render Checkout with a non-empty cart and fetchPaymentMethods mocked
    // to resolve ["bank", "cod"]; assert the rendered output includes the
    // t("checkoutPaymentWindow") text once "bank" (the default first
    // method) is selected.
  })

  it("hides the payment-window notice when cod is the selected payment method", async () => {
    // Render Checkout with fetchPaymentMethods mocked to resolve ["cod"];
    // assert the checkoutPaymentWindow text is absent, since a COD order
    // never expires.
  })
})
```

Replace the two `// Render ...` comments with real code once Step 1 establishes the file's mocking pattern for `fetchPaymentMethods`/`fetchCollection` (both already mocked elsewhere in this codebase's test suite for `Checkout`-adjacent components — search for existing mocks of `../api/shop` before writing new ones).

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npm test -- Checkout.test`
Expected: FAIL — `checkoutPaymentWindow` text is not yet rendered anywhere in `Checkout.jsx`.

- [ ] **Step 4: Implement**

In `frontend/src/pages/Checkout.jsx`, find the payment method `<label>` block:

```js
      <label className="block mb-4">
        <span className="block text-sm mb-1">{t("checkoutPayment")}</span>
        <select value={payment} onChange={(e) => setPayment(e.target.value)}
          disabled={!methods || methods.length === 0}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent disabled:opacity-50">
          {(methods || []).map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
        </select>
        {methods && methods.length === 0 && (
          <p className="text-sm text-[var(--text-error)] mt-1">{t("checkoutNoMethods")}</p>
        )}
      </label>
```

Replace with:

```js
      <label className="block mb-4">
        <span className="block text-sm mb-1">{t("checkoutPayment")}</span>
        <select value={payment} onChange={(e) => setPayment(e.target.value)}
          disabled={!methods || methods.length === 0}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent disabled:opacity-50">
          {(methods || []).map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
        </select>
        {methods && methods.length === 0 && (
          <p className="text-sm text-[var(--text-error)] mt-1">{t("checkoutNoMethods")}</p>
        )}
        {/* Stated before the buyer commits — cod never expires, so the
            notice is only shown for the payment methods that actually
            carry a deadline. */}
        {payment && payment !== "cod" && (
          <p className="text-xs opacity-70 mt-1">{t("checkoutPaymentWindow")}</p>
        )}
      </label>
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npm test -- Checkout.test`
Expected: PASS, both new tests.

- [ ] **Step 6: Run the full regression suite (backend and frontend)**

```bash
cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test
cd frontend && npm test && npm run build && npm run lint
```

Expected: backend 586/586 (583 + Task 1's 3); frontend passing count grows by this phase's total new tests (Task 2's 11 + Task 4's 6 + Task 5's 2 = 19, so 118 → 137); `npm run build` succeeds; `npm run lint` shows only the same 3 pre-existing problems, none new.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Checkout.jsx frontend/src/pages/Checkout.test.jsx
git commit -F - <<'EOF'
feat(shop): state the payment window at checkout before the buyer commits

Shows checkoutPaymentWindow beside the payment-method picker whenever a
non-COD method is selected, so a buyer learns a deadline exists before
placing the order rather than discovering it only after. Deliberately
generic about the exact number of hours (RESERVATION_HOURS is a backend-
only env var, not exposed to the frontend, and hardcoding a duplicate of
its default here would drift silently if that env var ever changes) — the
exact deadline is what Order.jsx's DeadlineBlock (previous commit) shows
once the order exists.

Hidden entirely for cod, which never expires.

This is the last of Plan 6's four buyer-facing changes; full backend and
frontend regression suites pass with no new lint problems beyond the 3
pre-existing ones noted in earlier phases.
EOF
```

---

## Out of Scope (carried from the spec — do not implement)

- A first-visit modal or dismissible walkthrough.
- A standalone help/FAQ page.
- Any order lookup by phone or email.
- An FAQ chatbot.
- Changing the reservation window itself, the expiry sweep, or any email content.
- Exposing `RESERVATION_HOURS` (or any other env-derived constant) to the frontend — `Checkout.jsx`'s notice is deliberately generic about the exact hour count for this reason.
