# Custom Transfer-Note Sentence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the auto-generated per-order transfer code with a single admin-set sentence (reusing the existing `payment_note` setting), shown as the transfer-content row for bank/momo and embedded as the VietQR `addInfo`.

**Architecture:** Delete `instructions.js`'s `transferNote()` code-generator; source the same `note` variable from `settings.payment_note` instead. No schema change, no new settings field. Frontend's `Row` component already hides on a falsy value, so "hide when blank" needs no new code — only the footer-duplication guard needs a change.

**Tech Stack:** Same as the rest of the shop backend/frontend (Express/mysql2, React/Vite, Vitest).

## Global Constraints

- One shared sentence across bank/momo/paypal — no per-method fields.
- Reuses `payment_note` — no migration, no new settings column.
- VietQR's `sanitizeInfo` (in `backend/shop/payments/vietqr.js`) strips diacritics/non-alphanumerics and truncates to 25 chars before embedding — a Vietnamese `payment_note` with diacritics will appear in the QR payload in its *sanitized* form, not verbatim. Tests must assert against the sanitized value, not the raw one.
- Accepted tradeoff (already confirmed with the user): every order's QR/transfer-content is now identical — no more per-order matching by transfer content.

---

### Task 1: Backend — source the transfer note from `payment_note`

**Files:**
- Modify: `backend/shop/payments/instructions.js`
- Modify: `backend/tests/paymentInstructions.test.js`

**Interfaces:**
- Produces: `buildInstructions(order, settings)` returns `transfer_note: settings.payment_note || null` for bank/momo/paypal (was the auto-generated code). `transferNote()` no longer exists (removed from exports).

- [ ] **Step 1: Update the failing/changed tests first**

Replace the entire contents of `backend/tests/paymentInstructions.test.js` with:

```js
import { describe, it, expect } from "vitest"
import { buildInstructions } from "../shop/payments/instructions.js"
import { crc16 } from "../shop/payments/vietqr.js"

const order = { order_token: "abc123def456", total: 35000, payment_method: "bank" }
const settings = {
  bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
  bank_account_number: "123456789", bank_account_holder: "NGUYEN VAN A",
  momo_enabled: true, momo_phone: "0900000000", momo_account_holder: "NGUYEN VAN A",
  paypal_enabled: true, paypal_link: "https://paypal.me/x",
  cod_enabled: true, payment_note: "Chuyen tien don hang",
}

describe("buildInstructions", () => {
  it("returns a scannable VietQR payload for bank transfer", () => {
    const i = buildInstructions(order, settings)
    expect(i.method).toBe("bank")
    expect(i.bank_name).toBe("ACB")
    expect(i.account_number).toBe("123456789")
    expect(i.amount).toBe(35000)
    expect(i.vietqr_payload).toContain("970416")
    expect(i.vietqr_payload.slice(-4)).toBe(crc16(i.vietqr_payload.slice(0, -4)))
  })

  it("uses the admin-configured payment_note as the transfer note, embedded in the QR", () => {
    const i = buildInstructions(order, settings)
    expect(i.transfer_note).toBe("Chuyen tien don hang")
    expect(i.vietqr_payload).toContain("Chuyen tien don hang")
  })

  it("sanitizes diacritics in payment_note before embedding it in the QR, but keeps the raw text in transfer_note", () => {
    const i = buildInstructions(order, { ...settings, payment_note: "Ghi chú đơn hàng" })
    expect(i.transfer_note).toBe("Ghi chú đơn hàng")
    expect(i.vietqr_payload).toContain("Ghi chu don hang")
  })

  it("returns transfer_note as null when payment_note is not set", () => {
    const i = buildInstructions(order, { ...settings, payment_note: null })
    expect(i.transfer_note).toBeNull()
  })

  it("returns Momo details with the same payment_note as its transfer note", () => {
    const i = buildInstructions({ ...order, payment_method: "momo" }, settings)
    expect(i.method).toBe("momo")
    expect(i.momo_phone).toBe("0900000000")
    expect(i.transfer_note).toBe("Chuyen tien don hang")
    expect(i.vietqr_payload).toBeUndefined()
  })

  it("returns the PayPal link", () => {
    const i = buildInstructions({ ...order, payment_method: "paypal" }, settings)
    expect(i.paypal_link).toBe("https://paypal.me/x")
  })

  it("returns an amount due for COD and no account details", () => {
    const i = buildInstructions({ ...order, payment_method: "cod" }, settings)
    expect(i.method).toBe("cod")
    expect(i.amount).toBe(35000)
    expect(i.account_number).toBeUndefined()
    expect(i.vietqr_payload).toBeUndefined()
  })

  it("never returns bank details for a Momo order", () => {
    const i = buildInstructions({ ...order, payment_method: "momo" }, settings)
    expect(JSON.stringify(i)).not.toContain("123456789")
  })

  it("degrades gracefully when the bank is misconfigured", () => {
    const i = buildInstructions(order, { ...settings, bank_bin: null })
    expect(i.method).toBe("bank")
    expect(i.vietqr_payload).toBeNull()
    expect(i.account_number).toBe("123456789")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/paymentInstructions.test.js`
Expected: FAIL — `transfer_note` is still the auto-generated `DH...` code, not `payment_note`'s value.

- [ ] **Step 3: Update `instructions.js`**

Replace the full contents of `backend/shop/payments/instructions.js` with:

```js
const { buildVietQrPayload } = require("./vietqr")

/**
 * Only the details for the order's own method are returned. A Momo order never
 * receives bank account details, so a leaked order page exposes the minimum.
 */
function buildInstructions(order, settings) {
  // Admin-authored, shared across every payment method — not per-order, by
  // design (the seller matches transfers by amount/timing/buyer contact
  // instead of a unique code).
  const note = settings.payment_note || null
  const base = { method: order.payment_method, amount: order.total, payment_note: settings.payment_note || null }

  if (order.payment_method === "bank") {
    let payload = null
    try {
      payload = buildVietQrPayload({
        bankBin: settings.bank_bin,
        accountNumber: settings.bank_account_number,
        amount: order.total,
        addInfo: note,
      })
    } catch (err) {
      // Misconfiguration must not blank the page — the buyer can still
      // transfer manually using the printed details below.
      console.warn("[PAYMENTS] Không tạo được VietQR:", err.message)
    }

    return {
      ...base,
      bank_name: settings.bank_name,
      account_number: settings.bank_account_number,
      account_holder: settings.bank_account_holder,
      transfer_note: note,
      vietqr_payload: payload,
    }
  }

  if (order.payment_method === "momo") {
    return {
      ...base,
      momo_phone: settings.momo_phone,
      momo_account_holder: settings.momo_account_holder,
      momo_qr_image: settings.momo_qr_image,
      transfer_note: note,
    }
  }

  if (order.payment_method === "paypal") {
    return { ...base, paypal_link: settings.paypal_link, transfer_note: note }
  }

  // COD: nothing to pay online; the amount is collected on handover.
  return base
}

module.exports = { buildInstructions }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run tests/paymentInstructions.test.js`
Expected: all pass.

- [ ] **Step 5: Check for any other reference to `transferNote`**

Run: `cd backend && grep -rn "transferNote" --include=*.js .` (excluding `node_modules`). Expected: no matches remain anywhere in the codebase (it was only ever imported by `instructions.js` itself and this test file). If any other file still imports it, that's a signal this task's brief is incomplete — stop and report rather than guessing a fix.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run`
Expected: all pass (no other file depended on the removed function).

- [ ] **Step 7: Commit**

```bash
git add backend/shop/payments/instructions.js backend/tests/paymentInstructions.test.js
git commit -m "feat(shop): source the transfer note from admin-set payment_note, not an auto-generated code"
```

---

### Task 2: Frontend — avoid duplicate footer note, update admin label

**Files:**
- Modify: `frontend/src/components/shop/PaymentInstructions.jsx`
- Modify: `frontend/src/components/shop/PaymentInstructions.test.jsx`
- Modify: `frontend/src/components/AdminPaymentSettings.jsx`

**Interfaces:**
- Consumes: `instructions.transfer_note`/`instructions.payment_note` (Task 1's backend, same field names as before — only the value's source changed, so this task has no cross-task type/shape changes to worry about).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/shop/PaymentInstructions.test.jsx`, find the existing test(s) covering `payment_note` (search for `"always shows payment_note when present"`) and add nearby, matching that test's existing `renderWith`/mock conventions:

```js
  it("does not duplicate the note as a footer paragraph when it's already shown as the bank transfer-content row", async () => {
    const container = await renderWith({
      method: "bank", amount: 100000, payment_note: "Chuyen tien don hang",
      bank_name: "ACB", account_number: "123456789", account_holder: "A",
      transfer_note: "Chuyen tien don hang", vietqr_payload: null,
    })
    const occurrences = container.textContent.split("Chuyen tien don hang").length - 1
    expect(occurrences).toBe(1)
  })

  it("does not duplicate the note as a footer paragraph when it's already shown as the momo transfer-content row", async () => {
    const container = await renderWith({
      method: "momo", amount: 50000, payment_note: "Chuyen tien don hang",
      momo_phone: "0900000000", momo_account_holder: "A",
      transfer_note: "Chuyen tien don hang",
    })
    const occurrences = container.textContent.split("Chuyen tien don hang").length - 1
    expect(occurrences).toBe(1)
  })

  it("still shows the footer note for paypal, which has no transfer-content row", async () => {
    const container = await renderWith({
      method: "paypal", amount: 20000, payment_note: "Chuyen tien don hang",
      paypal_link: "https://paypal.me/x", transfer_note: "Chuyen tien don hang",
    })
    expect(container.textContent).toContain("Chuyen tien don hang")
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/shop/PaymentInstructions.test.jsx`
Expected: the bank/momo tests FAIL (footer currently always renders `payment_note` regardless of method, so "Chuyen tien don hang" appears twice).

- [ ] **Step 3: Update `PaymentInstructions.jsx`**

Change the footer line:

```jsx
      {payment_note && <p className="text-sm mt-3 italic opacity-70">{payment_note}</p>}
```

to:

```jsx
      {payment_note && method !== "bank" && method !== "momo" && (
        <p className="text-sm mt-3 italic opacity-70">{payment_note}</p>
      )}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run src/components/shop/PaymentInstructions.test.jsx`
Expected: all pass, including every pre-existing test (COD's existing "always shows payment_note when present" test uses `method: "cod"`, unaffected by the new `method !== "bank" && method !== "momo"` guard).

- [ ] **Step 5: Update the admin settings label**

In `frontend/src/components/AdminPaymentSettings.jsx`, change:

```jsx
        <span className="block text-sm mb-1 opacity-70">Ghi chú thanh toán (hiển thị cho khách)</span>
```

to:

```jsx
        <span className="block text-sm mb-1 opacity-70">Ghi chú thanh toán / Nội dung chuyển khoản (hiển thị cho khách, dùng cho cả mã QR)</span>
```

This is a plain label-text change with no test coverage expected (this file has no dedicated test for exact label strings — confirm by checking `AdminPaymentSettings.test.jsx` if it exists; if a test asserts this exact string, update it to match).

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all pass (aside from the documented pre-existing `AdminOrders.test.jsx` debounce-timer flake, unrelated to this change).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/shop/PaymentInstructions.jsx frontend/src/components/shop/PaymentInstructions.test.jsx frontend/src/components/AdminPaymentSettings.jsx
git commit -m "feat(shop): avoid duplicate transfer-note display, clarify admin label's dual purpose"
```

---

### Task 3: Verification and staging build

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_DB=15 npx vitest run`
Expected: all pass.

- [ ] **Step 2: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all pass (known pre-existing `AdminOrders.test.jsx` flake aside).

- [ ] **Step 3: Build and push to `:staging`**

Run in the background:
```bash
cd /Users/phucth/vibes/cosplay-portfolio && bash scripts/build-push.sh staging > /tmp/build-push-transfer-note.log 2>&1; echo EXIT:$?
```

- [ ] **Step 4: Report to the user**

Confirm both suites passed, note the staging push, and remind the user that any Redis-cached payment settings (if cached — check `shop/payments/settingsRepo.js` for a cache layer; if none exists, no cache-flush note is needed) would need invalidation, and that this change is purely additive/no migration, so no DB action is needed at deploy.
