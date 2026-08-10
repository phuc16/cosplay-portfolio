# Payment Deep Links (Bank) Implementation Plan

> **STATUS (2026-08-10): DEFERRED — NOT IMPLEMENTED.** After writing this
> plan, further real-world verification (VietQR's own app-deeplink registry)
> found that a single "Open banking app" button tied to the seller's own
> bank doesn't match what the user actually wants — a picker of the
> *buyer's* bank apps (like Messenger's payment sheet), each opening
> targeted at the seller's fixed account. That's achievable via the same
> `dl.vietqr.io` mechanism (confirmed: `app=<buyer's chosen bank>` +
> `ba=<seller account>@<seller bank code>` is a real, documented capability),
> but sizing the picker (6 banks? 12? all ~36?) turned out to be a genuinely
> hard call with no clearly-right answer, and the user chose to skip this
> feature for now rather than force a decision. Kept here, unexecuted, as a
> record of the investigation and a starting point if revisited — the
> task-by-task detail below assumes the single-button design that was
> superseded and would need reworking into a picker before use.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "tap to open your bank app, pre-filled" deep-link button alongside the existing bank-transfer QR on the buyer's order page, so a mobile buyer can pay without a second device or manual retyping. Momo and PayPal are unchanged (see spec's Out of Scope — Momo was cut after verification found no prefillable link exists without full Momo Business API onboarding).

**Architecture:** Two new backend files (`bankCodes.js`, a static BIN→VietQR-app-code table; `deepLinks.js`, the pure URL builder consuming it), wired into the existing `buildInstructions()` in `backend/shop/payments/instructions.js`, surfaced as one new button in `frontend/src/components/shop/PaymentInstructions.jsx`. No migration, no new admin field, no new dependency.

**Tech Stack:** CommonJS backend, Vitest 3 ESM `import` for backend tests, React 18 frontend, `createRoot`/`act` component-test pattern (no Testing Library), `dl.vietqr.io`'s public redirector (confirmed real via direct doc verification — see spec).

**Spec:** `docs/superpowers/specs/2026-08-10-payment-deep-links-design.md` — read it before touching this plan; every design decision below traces back to it, including the two corrections made after real-world verification (bank-code mapping needed; Momo cut).

## Global Constraints

- **Scope**: only `backend/shop/payments/`, `backend/shop/payments/instructions.js`, `frontend/src/components/shop/PaymentInstructions.jsx`, and `frontend/src/i18n/translations.js`. No migration, no new `payment_settings` column, no new admin route/field, no change to Momo/PayPal/COD.
- Backend implementation files stay CommonJS (`require`/`module.exports`); backend test files use Vitest 3 ESM `import` (Vitest 3 refuses `require("vitest")`).
- Every deep-link builder must **never throw** — missing or unmapped input returns `null`, exactly matching the existing `vietqr_payload: null` degradation pattern already in `instructions.js`.
- `dl.vietqr.io/pay` confirmed real parameters (from VietQR's own documentation): `app` (VietQR's short bank code, lowercase in the documented example — e.g. `vcb`), `ba` (`<accountNumber>@<appCode>`, lowercase), `am` (amount), `tn` (note). Do not invent additional parameters.
- The BIN→code table (`bankCodes.js`) is a **static, baked-in snapshot** sourced from `api.vietqr.io/v2/banks` on 2026-08-10 — not fetched at runtime. Do not add a runtime fetch to this or any other external service in this plan.
- Commits: Conventional Commits, descriptive bodies, **no `Co-Authored-By` trailer**.
- Test commands: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` (**595 passing** before this plan starts) and `cd frontend && npm test && npm run build && npm run lint` (**214 passing**, lint has exactly 3 pre-existing problems in `Portfolio.jsx`/`AdminAlbumImages.jsx` — not this plan's problem, do not fix or add a fourth).

---

### Task 1: `bankCodes.js` (BIN→VietQR-code table) and `deepLinks.js` (`buildBankDeepLink`)

**Files:**
- Create: `backend/shop/payments/bankCodes.js`
- Create: `backend/shop/payments/deepLinks.js`
- Test: `backend/tests/bankCodes.test.js`
- Test: `backend/tests/deepLinks.test.js`

**Interfaces:**
- Produces: `BANK_CODE_BY_BIN` (`{ [bin: string]: string }`, exported from `bankCodes.js`) and `buildBankDeepLink({ bankBin, accountNumber, amount, addInfo }): string | null` (exported from `deepLinks.js`).
- Consumed by: Task 2 (`instructions.js`).

- [ ] **Step 1: Write the failing test for `bankCodes.js`**

Create `backend/tests/bankCodes.test.js`:

```js
import { describe, it, expect } from "vitest"
import { BANK_CODE_BY_BIN } from "../shop/payments/bankCodes.js"

describe("BANK_CODE_BY_BIN", () => {
  it("is a plain object", () => {
    expect(typeof BANK_CODE_BY_BIN).toBe("object")
    expect(BANK_CODE_BY_BIN).not.toBeNull()
  })

  it("maps well-known BINs to their real VietQR app codes", () => {
    expect(BANK_CODE_BY_BIN["970436"]).toBe("VCB")
    expect(BANK_CODE_BY_BIN["970415"]).toBe("ICB")
    expect(BANK_CODE_BY_BIN["970422"]).toBe("MB")
    expect(BANK_CODE_BY_BIN["970418"]).toBe("BIDV")
    expect(BANK_CODE_BY_BIN["970416"]).toBe("ACB")
  })

  it("does not map an unrecognized BIN", () => {
    expect(BANK_CODE_BY_BIN["000000"]).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/bankCodes.test.js`
Expected: FAIL — `backend/shop/payments/bankCodes.js` does not exist.

- [ ] **Step 3: Implement `bankCodes.js`**

Create `backend/shop/payments/bankCodes.js`:

```js
/**
 * Static snapshot of VietQR's own BIN -> short app-code mapping, sourced
 * from api.vietqr.io/v2/banks on 2026-08-10. dl.vietqr.io/pay's `app`
 * parameter needs this short code (e.g. "VCB"), not the numeric BIN
 * (e.g. "970436") payment_settings.bank_bin already stores — the two are
 * different identifier namespaces VietQR maintains in parallel.
 *
 * Baked in rather than fetched at runtime: this list changes rarely (a
 * handful of times a year at most), and a second live external dependency
 * for a table this stable is unwarranted complexity. A BIN not in this
 * table (a very new or obscure bank/e-wallet) simply means the deep-link
 * button doesn't appear for that seller — the QR and manual details are
 * unaffected.
 */
const BANK_CODE_BY_BIN = {
  "970415": "ICB",
  "970436": "VCB",
  "970418": "BIDV",
  "970405": "VBA",
  "970448": "OCB",
  "970422": "MB",
  "970407": "TCB",
  "970416": "ACB",
  "970432": "VPB",
  "970423": "TPB",
  "970403": "STB",
  "970437": "HDB",
  "970454": "VCCB",
  "970429": "SCB",
  "970441": "VIB",
  "970443": "SHB",
  "970431": "EIB",
  "970426": "MSB",
  "546034": "CAKE",
  "546035": "Ubank",
  "971005": "VTLMONEY",
  "963388": "TIMO",
  "971011": "VNPTMONEY",
  "970400": "SGICB",
  "970409": "BAB",
  "971025": "MOMO",
  "971133": "PVDB",
  "970412": "PVCB",
  "970414": "MBV",
  "970419": "NCB",
  "970424": "SHBVN",
  "970425": "ABB",
  "970427": "VAB",
  "970428": "NAB",
  "970430": "PGB",
  "970433": "VIETBANK",
  "970438": "BVB",
  "970440": "SEAB",
  "970446": "COOPBANK",
  "970449": "LPB",
  "970452": "KLB",
  "668888": "KBANK",
  "977777": "MAFC",
  "970442": "HLBVN",
  "970467": "KEBHANAHN",
  "970466": "KEBHANAHCM",
  "533948": "CITIBANK",
  "970444": "CBB",
  "422589": "CIMB",
  "796500": "DBS",
  "970406": "VIKKI",
  "999888": "VBSP",
  "970408": "GPB",
  "970463": "KBHCM",
  "970462": "KBHN",
  "970457": "WVN",
  "970421": "VRB",
  "458761": "HSBC",
  "970455": "IBKHN",
  "970456": "IBKHCM",
  "970434": "IVB",
  "970458": "UOB",
  "801011": "NHB",
  "970410": "SCVN",
  "970439": "PBVN",
}

module.exports = { BANK_CODE_BY_BIN }
```

- [ ] **Step 4: Run to verify `bankCodes.test.js` passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/bankCodes.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing test for `deepLinks.js`**

Create `backend/tests/deepLinks.test.js`:

```js
import { describe, it, expect } from "vitest"
import { buildBankDeepLink } from "../shop/payments/deepLinks.js"

describe("buildBankDeepLink", () => {
  it("builds a dl.vietqr.io/pay URL for a known bank", () => {
    const url = buildBankDeepLink({
      bankBin: "970436", accountNumber: "113366668888", amount: 35000, addInfo: "DH12345678",
    })
    expect(url).toBeTruthy()
    const parsed = new URL(url)
    expect(parsed.hostname).toBe("dl.vietqr.io")
    expect(parsed.pathname).toBe("/pay")
    expect(parsed.searchParams.get("app")).toBe("vcb")
    expect(parsed.searchParams.get("ba")).toBe("113366668888@vcb")
    expect(parsed.searchParams.get("am")).toBe("35000")
    expect(parsed.searchParams.get("tn")).toBe("DH12345678")
  })

  it("returns null when bankBin is missing", () => {
    expect(buildBankDeepLink({ accountNumber: "113366668888", amount: 35000, addInfo: "DH1" })).toBeNull()
  })

  it("returns null when accountNumber is missing", () => {
    expect(buildBankDeepLink({ bankBin: "970436", amount: 35000, addInfo: "DH1" })).toBeNull()
  })

  it("returns null when the bank BIN isn't in BANK_CODE_BY_BIN", () => {
    expect(buildBankDeepLink({ bankBin: "000000", accountNumber: "113366668888", amount: 35000, addInfo: "DH1" })).toBeNull()
  })

  it("never throws for null/undefined input", () => {
    expect(() => buildBankDeepLink({})).not.toThrow()
    expect(buildBankDeepLink({})).toBeNull()
  })

  it("omits am/tn when amount/addInfo are not provided, without throwing", () => {
    const url = buildBankDeepLink({ bankBin: "970436", accountNumber: "113366668888" })
    expect(url).toBeTruthy()
    const parsed = new URL(url)
    expect(parsed.searchParams.has("am")).toBe(false)
    expect(parsed.searchParams.has("tn")).toBe(false)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/deepLinks.test.js`
Expected: FAIL — `backend/shop/payments/deepLinks.js` does not exist.

- [ ] **Step 7: Implement `deepLinks.js`**

Create `backend/shop/payments/deepLinks.js`:

```js
const { BANK_CODE_BY_BIN } = require("./bankCodes")

/**
 * Builds a dl.vietqr.io/pay deep link that opens the buyer's own banking
 * app with the transfer pre-filled. Parameters confirmed against VietQR's
 * own documentation: app (short bank code), ba (account@appCode), am
 * (amount), tn (note) — all lowercase per the documented example.
 *
 * Returns null, never throws, when bankBin/accountNumber are missing or
 * bankBin isn't in BANK_CODE_BY_BIN — an unmapped or misconfigured bank
 * loses only this convenience button; the existing QR and manual details
 * (built elsewhere in instructions.js) are unaffected.
 */
function buildBankDeepLink({ bankBin, accountNumber, amount, addInfo }) {
  if (!bankBin || !accountNumber) return null
  const appCode = BANK_CODE_BY_BIN[bankBin]
  if (!appCode) return null

  const app = appCode.toLowerCase()
  const params = new URLSearchParams({ app, ba: `${accountNumber}@${app}` })
  if (amount) params.set("am", String(amount))
  if (addInfo) params.set("tn", String(addInfo))

  return `https://dl.vietqr.io/pay?${params.toString()}`
}

module.exports = { buildBankDeepLink }
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/deepLinks.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 9: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, 604 tests (595 baseline + 9 new: 3 `bankCodes.test.js` + 6 `deepLinks.test.js`).

- [ ] **Step 10: Commit**

```bash
git add backend/shop/payments/bankCodes.js backend/shop/payments/deepLinks.js backend/tests/bankCodes.test.js backend/tests/deepLinks.test.js
git commit -F - <<'EOF'
feat(shop): add the bank-code table and dl.vietqr.io deep-link builder

dl.vietqr.io/pay's `app` parameter needs VietQR's own short bank code
(e.g. "VCB"), not the numeric BIN payment_settings.bank_bin already
stores — different identifier namespaces VietQR maintains in parallel.
bankCodes.js bakes in a static BIN->code snapshot sourced from
api.vietqr.io/v2/banks (2026-08-10) rather than adding a second runtime
external dependency for a table that's stable for months at a time.

buildBankDeepLink() is pure and isolated: it returns null, never throws,
for a missing account/bank or an unmapped BIN, so a misconfigured or
obscure bank just loses this one convenience button — the existing QR
and manual account details are unaffected either way.
EOF
```

---

### Task 2: Wire `bank_deeplink` into `buildInstructions()`

**Files:**
- Modify: `backend/shop/payments/instructions.js`
- Test: `backend/tests/paymentInstructions.test.js`

**Interfaces:**
- Consumes: `buildBankDeepLink` (Task 1).
- Produces: `buildInstructions()`'s return value gains one field, `bank_deeplink: string | null`, present only when `order.payment_method === "bank"`.
- Consumed by: Task 3 (`PaymentInstructions.jsx`).

The full current `backend/shop/payments/instructions.js`:

```js
const { buildVietQrPayload } = require("./vietqr")

/**
 * Short, uppercase, alphanumeric reference the buyer puts in the transfer
 * note. Derived from the order token so it is stable and unguessable, but
 * short enough for a banking app's note field.
 */
function transferNote(orderToken) {
  return `DH${String(orderToken).slice(0, 8).toUpperCase()}`
}

/**
 * Only the details for the order's own method are returned. A Momo order never
 * receives bank account details, so a leaked order page exposes the minimum.
 */
function buildInstructions(order, settings) {
  const note = transferNote(order.order_token)
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

module.exports = { buildInstructions, transferNote }
```

- [ ] **Step 1: Write the failing tests**

In `backend/tests/paymentInstructions.test.js`, add the import and two tests inside the existing `describe("buildInstructions", ...)` block (after the existing `"degrades gracefully when the bank is misconfigured"` test):

```js
import { buildInstructions, transferNote } from "../shop/payments/instructions.js"
import { crc16 } from "../shop/payments/vietqr.js"
```

becomes:

```js
import { buildInstructions, transferNote } from "../shop/payments/instructions.js"
import { crc16 } from "../shop/payments/vietqr.js"
import { buildBankDeepLink } from "../shop/payments/deepLinks.js"
```

Add, inside `describe("buildInstructions", ...)`:

```js
  it("includes a bank_deeplink for a bank order with a mapped BIN", () => {
    const i = buildInstructions(order, settings)
    const expected = buildBankDeepLink({
      bankBin: settings.bank_bin, accountNumber: settings.bank_account_number,
      amount: order.total, addInfo: i.transfer_note,
    })
    expect(i.bank_deeplink).toBe(expected)
    expect(i.bank_deeplink).toContain("dl.vietqr.io/pay")
  })

  it("bank_deeplink is null when the bank is unmapped or misconfigured", () => {
    const i = buildInstructions(order, { ...settings, bank_bin: "000000" })
    expect(i.bank_deeplink).toBeNull()
  })

  it("does not add bank_deeplink to momo, paypal, or cod orders", () => {
    const momo = buildInstructions({ ...order, payment_method: "momo" }, settings)
    const paypal = buildInstructions({ ...order, payment_method: "paypal" }, settings)
    const cod = buildInstructions({ ...order, payment_method: "cod" }, settings)
    expect(momo.bank_deeplink).toBeUndefined()
    expect(paypal.bank_deeplink).toBeUndefined()
    expect(cod.bank_deeplink).toBeUndefined()
  })
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/paymentInstructions.test.js`
Expected: FAIL — `bank_deeplink` doesn't exist on the returned object yet.

- [ ] **Step 3: Implement**

In `backend/shop/payments/instructions.js`, add the import:

```js
const { buildVietQrPayload } = require("./vietqr")
```

becomes:

```js
const { buildVietQrPayload } = require("./vietqr")
const { buildBankDeepLink } = require("./deepLinks")
```

Find:

```js
    return {
      ...base,
      bank_name: settings.bank_name,
      account_number: settings.bank_account_number,
      account_holder: settings.bank_account_holder,
      transfer_note: note,
      vietqr_payload: payload,
    }
```

Replace with:

```js
    return {
      ...base,
      bank_name: settings.bank_name,
      account_number: settings.bank_account_number,
      account_holder: settings.bank_account_holder,
      transfer_note: note,
      vietqr_payload: payload,
      bank_deeplink: buildBankDeepLink({
        bankBin: settings.bank_bin,
        accountNumber: settings.bank_account_number,
        amount: order.total,
        addInfo: note,
      }),
    }
```

No other branch (`momo`, `paypal`, `cod`) changes — `buildBankDeepLink` is only called inside the `bank` branch, so those objects never gain a `bank_deeplink` key at all (not even `undefined` as an explicit key — the tests assert `toBeUndefined()`, which passes whether the key is absent or explicitly `undefined`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npx vitest run tests/paymentInstructions.test.js`
Expected: PASS, all tests in the file including the 3 new ones.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, 607 tests (604 from Task 1 + 3 new).

- [ ] **Step 6: Commit**

```bash
git add backend/shop/payments/instructions.js backend/tests/paymentInstructions.test.js
git commit -F - <<'EOF'
feat(shop): surface bank_deeplink from buildInstructions

buildInstructions() now includes bank_deeplink (from buildBankDeepLink,
Task 1) on bank-transfer orders, built from the same transfer_note
reference code the VietQR payload already uses. Momo/paypal/cod orders
are untouched — they never gain the key at all, matching the existing
principle that only the ordering method's own method's details are ever
returned.

A misconfigured or unmapped bank yields bank_deeplink: null, same shape
as the existing vietqr_payload degradation — the printed account details
stay usable regardless.
EOF
```

---

### Task 3: Frontend button in `PaymentInstructions.jsx`

**Files:**
- Modify: `frontend/src/components/shop/PaymentInstructions.jsx`
- Modify: `frontend/src/i18n/translations.js`
- Test: `frontend/src/components/shop/PaymentInstructions.test.jsx`

**Interfaces:**
- Consumes: `instructions.bank_deeplink` (Task 2, may be `undefined` for non-bank orders or `null` for a bank order with no mapped deep link).
- Produces: no new exports — this task changes only `PaymentInstructions.jsx`'s rendered output and adds two i18n keys.

The relevant current section of `frontend/src/components/shop/PaymentInstructions.jsx` (inside the `method === "bank"` block):

```jsx
      {method === "bank" && (
        <>
          <Row label={t("paymentBankName")} value={instructions.bank_name} />
          <Row label={t("paymentAccountNumber")} value={instructions.account_number} copyable />
          <Row label={t("paymentAccountHolder")} value={instructions.account_holder} />
          <Row label={t("paymentTransferNote")} value={instructions.transfer_note} copyable />

          {instructions.vietqr_payload ? (
            <div className="mt-4 flex flex-col items-center">
              <img
                src={`/api/orders/${token}/payment/qr.svg`}
                alt={t("paymentScanQr")}
                className="w-48 h-48 rounded-lg border border-[var(--border-default)]"
              />
              <p className="text-xs opacity-60 mt-2">{t("paymentScanQrHint")}</p>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-error)] mt-3">{t("paymentQrUnavailable")}</p>
          )}
        </>
      )}
```

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/shop/PaymentInstructions.test.jsx`, add inside `describe("PaymentInstructions", ...)`, after the existing `"renders the VietQR image..."` test:

```js
  it("renders a bank deep-link button when bank_deeplink is present", async () => {
    const container = await renderWith({
      method: "bank", amount: 100000, payment_note: null,
      bank_name: "ACB", account_number: "123456789", account_holder: "NGUYEN VAN A",
      transfer_note: "DH12345678", vietqr_payload: "0002010102...",
      bank_deeplink: "https://dl.vietqr.io/pay?app=acb&ba=123456789@acb&am=100000&tn=DH12345678",
    })

    const links = [...container.querySelectorAll("a")]
    const deeplink = links.find((a) => a.href.includes("dl.vietqr.io"))
    expect(deeplink).toBeTruthy()
    expect(deeplink.target).toBe("_blank")
  })

  it("renders no deep-link button when bank_deeplink is null", async () => {
    const container = await renderWith({
      method: "bank", amount: 100000, payment_note: null,
      bank_name: "ACB", account_number: "123456789", account_holder: "NGUYEN VAN A",
      transfer_note: "DH12345678", vietqr_payload: "0002010102...",
      bank_deeplink: null,
    })

    const links = [...container.querySelectorAll("a")]
    expect(links.find((a) => a.href.includes("dl.vietqr.io"))).toBeUndefined()
  })
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd frontend && npm test -- PaymentInstructions`
Expected: FAIL — no `dl.vietqr.io` link is rendered yet.

- [ ] **Step 3: Add the i18n keys**

In `frontend/src/i18n/translations.js`, find (inside the `en` block's payment-instructions section):

```js
    paymentPaypalPay: "Pay with PayPal", paymentCodNote: "Pay in cash when you receive the order.",
```

Replace with:

```js
    paymentPaypalPay: "Pay with PayPal", paymentCodNote: "Pay in cash when you receive the order.",
    paymentOpenBankApp: "Open banking app",
```

Find (inside the `vi` block's payment-instructions section):

```js
    paymentPaypalPay: "Thanh toán qua PayPal", paymentCodNote: "Thanh toán tiền mặt khi nhận hàng.",
```

Replace with:

```js
    paymentPaypalPay: "Thanh toán qua PayPal", paymentCodNote: "Thanh toán tiền mặt khi nhận hàng.",
    paymentOpenBankApp: "Mở app ngân hàng",
```

- [ ] **Step 4: Implement the button**

In `frontend/src/components/shop/PaymentInstructions.jsx`, find:

```jsx
          {instructions.vietqr_payload ? (
            <div className="mt-4 flex flex-col items-center">
              <img
                src={`/api/orders/${token}/payment/qr.svg`}
                alt={t("paymentScanQr")}
                className="w-48 h-48 rounded-lg border border-[var(--border-default)]"
              />
              <p className="text-xs opacity-60 mt-2">{t("paymentScanQrHint")}</p>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-error)] mt-3">{t("paymentQrUnavailable")}</p>
          )}
        </>
      )}
```

Replace with:

```jsx
          {instructions.vietqr_payload ? (
            <div className="mt-4 flex flex-col items-center">
              <img
                src={`/api/orders/${token}/payment/qr.svg`}
                alt={t("paymentScanQr")}
                className="w-48 h-48 rounded-lg border border-[var(--border-default)]"
              />
              <p className="text-xs opacity-60 mt-2">{t("paymentScanQrHint")}</p>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-error)] mt-3">{t("paymentQrUnavailable")}</p>
          )}

          {instructions.bank_deeplink && (
            <a href={instructions.bank_deeplink} target="_blank" rel="noreferrer"
              className="block mt-3 text-center py-2 rounded-lg bg-[var(--brand)] text-white">
              {t("paymentOpenBankApp")}
            </a>
          )}
        </>
      )}
```

`instructions.bank_deeplink` is only ever present on a `bank`-method payload (Task 2), so no method-check is needed here — this JSX only executes inside the existing `method === "bank" && (...)` block.

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npm test -- PaymentInstructions`
Expected: PASS, all tests in the file including the 2 new ones.

- [ ] **Step 6: Run the full frontend suite, then the backend suite once as a scope check**

```bash
cd frontend && npm test && npm run build && npm run lint
cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test
```

Expected: frontend suite passes (216 tests: 214 baseline + 2 new), no new lint problems beyond the 3 pre-existing ones; backend suite passes at 607 (Task 2's count) with **zero** files changed under `backend/` in this task's diff — this task touches only frontend files, and this run exists only to prove that.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/shop/PaymentInstructions.jsx frontend/src/i18n/translations.js frontend/src/components/shop/PaymentInstructions.test.jsx
git commit -F - <<'EOF'
feat(shop): show a bank-app deep-link button on the order payment page

A buyer checking out on their own phone can't scan a QR shown on that
same screen — their only option was retyping account/amount/note by
hand. The order page now shows an "Open banking app" button beside the
existing QR whenever bank_deeplink is present, opening the buyer's bank
app pre-filled via dl.vietqr.io. The QR is unchanged and still works for
a second-device scan; this is a pure addition.

No button renders when bank_deeplink is null (unmapped or misconfigured
bank) — same fallback shape as the existing QR-unavailable notice.
EOF
```

---

## Out of Scope (carried from the spec — do not implement)

- Momo deep link — cut after verification found no prefillable link exists without full Momo Business API onboarding (see spec).
- PayPal deep-link/amount pre-fill.
- A new admin toggle for the deep link specifically.
- Device/viewport detection.
- Live-fetching `api.vietqr.io/v2/banks` at runtime.
- Any change to Momo, PayPal, COD, or the existing VietQR QR-generation path.
- Any change to `payment_settings` schema/migration.
