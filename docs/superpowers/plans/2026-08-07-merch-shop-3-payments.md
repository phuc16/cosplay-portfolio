# Merch Shop — Plan 3: Payments, Email, QR & Backups

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A buyer sees real payment instructions (bank VietQR / Momo / PayPal / COD) chosen by the seller, can upload proof of payment, and receives Vietnamese email at every lifecycle step; the seller confirms payments in the admin, scans a QR at event pickup, and has nightly backups of the order data.

**Architecture:** Three new tables (`payment_settings`, `email_templates`, `email_queue`). VietQR payloads are generated locally as EMVCo TLV strings — no third-party image API — so account details never leave the server and the logic is unit-testable. Email is queued to a table and dispatched by the existing `worker.js` loop with retry, so an SMTP failure can never roll back a committed order. Order QR is derived from the token on demand and never stored.

**Tech Stack:** As Plans 1–2, plus `nodemailer` (SMTP), `qrcode` (SVG/PNG generation), `jsqr` (admin camera scanning), and host `cron` + `mysqldump` for backups.

**Depends on:** Plans 1 and 2 complete, both verification checklists fully PASS.

## Global Constraints

All Plan 1 and Plan 2 Global Constraints still apply. Additionally:

- **Payment confirmation stays manual.** Admin clicks Confirm. Automatic confirmation (SePay, Momo Business API, PayPal webhooks) is explicitly **out of scope**; `payment_settings` reserves nullable credential columns for it, but no integration ships here. Adding it later must not require changing the order model.
- **SMTP credentials come from env vars only** (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) — never the database, never the admin UI.
- **Emails are Vietnamese only.** One template set, no locale dimension.
- **Email sending never blocks or rolls back an order.** Orders commit first; mail is queued and dispatched separately with retry.
- **VietQR payloads are built locally** to the EMVCo spec. No external QR image service.
- **Payment proof images** reuse the Plan 1 pipeline (`sharp` → rotate → max 1920px → WebP q82) and are served through the storage proxy.
- **Backups are verified by restoring them.** A backup that has never been restored does not count as done.

---

### Task 1: Payment settings

**Files:**
- Create: `backend/migrations/012_create_payment_settings.js`
- Create: `backend/shop/payments/settingsRepo.js`
- Test: `backend/tests/paymentSettings.test.js`

**Interfaces:**
- Produces table `payment_settings` (single row, id 1):
```
id, bank_enabled, bank_name, bank_bin, bank_account_number, bank_account_holder,
momo_enabled, momo_phone, momo_qr_image, momo_account_holder,
paypal_enabled, paypal_link,
cod_enabled,
payment_note,
sepay_api_key, sepay_webhook_secret, auto_confirm_enabled,   -- reserved, unused
updated_at
```
- Produces `settingsRepo.js` exporting `getSettings(): Promise<Settings>`, `updateSettings(data): Promise<void>`, `enabledMethods(settings): string[]`, `publicSettings(settings): object` (strips secrets).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/paymentSettings.test.js`:

```js
const { describe, it, expect, beforeEach } = require("vitest")
const db = require("../db")
const repo = require("../shop/payments/settingsRepo")

beforeEach(async () => {
  await db.query("DELETE FROM payment_settings")
})

describe("getSettings", () => {
  it("returns defaults when nothing is stored", async () => {
    const s = await repo.getSettings()
    expect(s.bank_enabled).toBe(false)
    expect(s.cod_enabled).toBe(false)
  })
})

describe("updateSettings", () => {
  it("persists bank details and survives a reload", async () => {
    await repo.updateSettings({
      bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
      bank_account_number: "123456789", bank_account_holder: "NGUYEN VAN A",
    })
    const s = await repo.getSettings()
    expect(s.bank_enabled).toBe(true)
    expect(s.bank_bin).toBe("970416")
  })

  it("keeps a single row rather than inserting repeatedly", async () => {
    await repo.updateSettings({ bank_enabled: true })
    await repo.updateSettings({ bank_enabled: false })
    const [rows] = await db.query("SELECT id FROM payment_settings")
    expect(rows).toHaveLength(1)
  })
})

describe("enabledMethods", () => {
  it("lists only enabled methods", () => {
    expect(repo.enabledMethods({
      bank_enabled: true, momo_enabled: false, paypal_enabled: false, cod_enabled: true,
    })).toEqual(["bank", "cod"])
  })

  it("returns nothing when all are off", () => {
    expect(repo.enabledMethods({
      bank_enabled: false, momo_enabled: false, paypal_enabled: false, cod_enabled: false,
    })).toEqual([])
  })
})

describe("publicSettings", () => {
  it("never exposes reserved auto-confirm secrets", () => {
    const pub = repo.publicSettings({
      bank_enabled: true, bank_name: "ACB", bank_account_number: "123",
      sepay_api_key: "SECRET", sepay_webhook_secret: "ALSO-SECRET",
    })
    expect(pub.sepay_api_key).toBeUndefined()
    expect(pub.sepay_webhook_secret).toBeUndefined()
    expect(JSON.stringify(pub)).not.toContain("SECRET")
    expect(pub.bank_name).toBe("ACB")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- paymentSettings`
Expected: FAIL — table and module missing.

- [ ] **Step 3: Create the migration**

Create `backend/migrations/012_create_payment_settings.js`:

```js
exports.up = function (knex) {
  return knex.schema.createTable("payment_settings", (table) => {
    table.increments("id").primary()

    table.boolean("bank_enabled").notNullable().defaultTo(false)
    table.string("bank_name").nullable()
    table.string("bank_bin", 16).nullable()          // NAPAS BIN, e.g. ACB = 970416
    table.string("bank_account_number", 64).nullable()
    table.string("bank_account_holder").nullable()

    table.boolean("momo_enabled").notNullable().defaultTo(false)
    table.string("momo_phone", 32).nullable()
    table.string("momo_qr_image", 512).nullable()
    table.string("momo_account_holder").nullable()

    table.boolean("paypal_enabled").notNullable().defaultTo(false)
    table.string("paypal_link", 512).nullable()

    table.boolean("cod_enabled").notNullable().defaultTo(false)

    table.text("payment_note").nullable()

    // Reserved for a future automatic-confirmation phase. Nothing reads these
    // yet; they exist so adding SePay later needs no order-model change.
    table.string("sepay_api_key", 255).nullable()
    table.string("sepay_webhook_secret", 255).nullable()
    table.boolean("auto_confirm_enabled").notNullable().defaultTo(false)

    table.timestamp("updated_at").defaultTo(knex.fn.now())
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("payment_settings")
}
```

- [ ] **Step 4: Implement the repository**

Create `backend/shop/payments/settingsRepo.js`:

```js
const db = require("./../../db")

const DEFAULTS = {
  bank_enabled: false, bank_name: null, bank_bin: null,
  bank_account_number: null, bank_account_holder: null,
  momo_enabled: false, momo_phone: null, momo_qr_image: null, momo_account_holder: null,
  paypal_enabled: false, paypal_link: null,
  cod_enabled: false,
  payment_note: null,
  auto_confirm_enabled: false,
}

const BOOLEANS = ["bank_enabled", "momo_enabled", "paypal_enabled", "cod_enabled", "auto_confirm_enabled"]

const FIELDS = [
  "bank_enabled", "bank_name", "bank_bin", "bank_account_number", "bank_account_holder",
  "momo_enabled", "momo_phone", "momo_qr_image", "momo_account_holder",
  "paypal_enabled", "paypal_link", "cod_enabled", "payment_note",
  "sepay_api_key", "sepay_webhook_secret", "auto_confirm_enabled",
]

/** Secrets that must never reach a browser. */
const SECRET_FIELDS = ["sepay_api_key", "sepay_webhook_secret"]

async function getSettings() {
  const [[row]] = await db.query("SELECT * FROM payment_settings ORDER BY id LIMIT 1")
  if (!row) return { ...DEFAULTS }

  const out = { ...row }
  for (const key of BOOLEANS) out[key] = Boolean(out[key])
  return out
}

/** Upsert the single settings row. */
async function updateSettings(data) {
  const [[existing]] = await db.query("SELECT id FROM payment_settings ORDER BY id LIMIT 1")

  const values = FIELDS.map((f) => {
    if (BOOLEANS.includes(f)) return data[f] === undefined ? false : Boolean(data[f])
    return data[f] === undefined || data[f] === "" ? null : data[f]
  })

  if (existing) {
    await db.query(
      `UPDATE payment_settings SET ${FIELDS.map((f) => `${f} = ?`).join(", ")}, updated_at = NOW() WHERE id = ?`,
      [...values, existing.id]
    )
  } else {
    await db.query(
      `INSERT INTO payment_settings (${FIELDS.join(", ")}) VALUES (${FIELDS.map(() => "?").join(", ")})`,
      values
    )
  }
}

function enabledMethods(settings) {
  return ["bank", "momo", "paypal", "cod"].filter((m) => settings[`${m}_enabled`])
}

/** Strip secrets before anything is sent to a browser. */
function publicSettings(settings) {
  const out = { ...settings }
  for (const key of SECRET_FIELDS) delete out[key]
  return out
}

module.exports = { getSettings, updateSettings, enabledMethods, publicSettings, DEFAULTS }
```

- [ ] **Step 5: Add the table to the test reset list**

In `backend/tests/setup.js`, extend the truncation list:

```js
const TABLES = [
  "email_queue", "email_templates", "payment_settings",
  "order_items", "orders", "product_variants", "products", "collections",
]
```
(The email tables arrive in Tasks 6–7; listing them now is harmless because truncation is guarded, but if it errors before those migrations exist, add them then.)

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- paymentSettings`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/012_create_payment_settings.js \
        backend/shop/payments/settingsRepo.js backend/tests/paymentSettings.test.js \
        backend/tests/setup.js
git commit -F - <<'EOF'
feat(payments): add payment settings

A single-row table holding the seller's bank, Momo, PayPal and COD
configuration, kept out of the site_settings JSON blob because it has enough
fields of its own to warrant a namespace.

bank_bin stores the NAPAS bank identifier, which the VietQR payload needs.

Three columns are reserved and deliberately unused: sepay_api_key,
sepay_webhook_secret and auto_confirm_enabled. Automatic payment confirmation
is out of scope for this plan, but reserving them now means adding it later
touches only the payment layer, never the order model.

publicSettings strips those secrets, and a test asserts the serialised output
contains no secret value at all rather than merely checking the keys are
absent.
EOF
```

---

### Task 2: VietQR payload generation

Pure logic, generated locally to the EMVCo spec so account details never pass through a third-party image service and every branch is testable.

**Files:**
- Create: `backend/shop/payments/vietqr.js`
- Test: `backend/tests/vietqr.test.js`

**Interfaces:**
- Produces `vietqr.js` exporting `crc16(payload: string): string` (4 uppercase hex) and `buildVietQrPayload({bankBin, accountNumber, amount, addInfo}): string`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/vietqr.test.js`:

```js
const { describe, it, expect } = require("vitest")
const { crc16, buildVietQrPayload } = require("../shop/payments/vietqr")

describe("crc16", () => {
  it("matches the known CRC-16/CCITT-FALSE check value", () => {
    expect(crc16("123456789")).toBe("29B1")
  })

  it("always returns four uppercase hex characters", () => {
    for (const s of ["", "a", "hello world", "0".repeat(200)]) {
      expect(crc16(s)).toMatch(/^[0-9A-F]{4}$/)
    }
  })
})

describe("buildVietQrPayload", () => {
  const base = { bankBin: "970416", accountNumber: "123456789", amount: 35000, addInfo: "DH ABC123" }

  it("starts with the EMVCo format indicator", () => {
    expect(buildVietQrPayload(base).startsWith("000201")).toBe(true)
  })

  it("marks a payload carrying an amount as dynamic", () => {
    expect(buildVietQrPayload(base)).toContain("010212")
  })

  it("marks a payload without an amount as static", () => {
    expect(buildVietQrPayload({ ...base, amount: null })).toContain("010211")
  })

  it("uses the NAPAS GUID and embeds bank and account", () => {
    const p = buildVietQrPayload(base)
    expect(p).toContain("A000000727")
    expect(p).toContain("970416")
    expect(p).toContain("123456789")
  })

  it("declares VND and Vietnam", () => {
    const p = buildVietQrPayload(base)
    expect(p).toContain("5303704")
    expect(p).toContain("5802VN")
  })

  it("encodes the amount with its own length prefix", () => {
    expect(buildVietQrPayload(base)).toContain("540535000")
  })

  it("embeds the order reference so the transfer can be matched", () => {
    expect(buildVietQrPayload(base)).toContain("DH ABC123")
  })

  it("ends with a CRC that validates against the rest of the payload", () => {
    const p = buildVietQrPayload(base)
    const body = p.slice(0, -4)
    expect(body.endsWith("6304")).toBe(true)
    expect(p.slice(-4)).toBe(crc16(body))
  })

  it("produces a different CRC when the amount changes", () => {
    const a = buildVietQrPayload(base)
    const b = buildVietQrPayload({ ...base, amount: 70000 })
    expect(a.slice(-4)).not.toBe(b.slice(-4))
  })

  it("rejects a missing bank BIN or account number", () => {
    expect(() => buildVietQrPayload({ ...base, bankBin: null })).toThrow()
    expect(() => buildVietQrPayload({ ...base, accountNumber: "" })).toThrow()
  })

  it("rejects a non-integer amount, which would corrupt the transfer", () => {
    expect(() => buildVietQrPayload({ ...base, amount: 35000.5 })).toThrow()
    expect(() => buildVietQrPayload({ ...base, amount: -1 })).toThrow()
  })

  it("strips characters that would break the TLV encoding", () => {
    const p = buildVietQrPayload({ ...base, addInfo: "DH#ABC/123 xin chào" })
    expect(p).not.toContain("#")
    expect(p).not.toContain("/")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- vietqr`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the generator**

Create `backend/shop/payments/vietqr.js`:

```js
/**
 * VietQR (EMVCo / NAPAS) payload generation.
 *
 * Built locally rather than via an image service so the seller's account
 * details never transit a third party, the QR keeps working if that service
 * disappears, and every branch is unit-testable.
 */

const GUID = "A000000727"

/** EMVCo TLV field: two-digit id, two-digit length, value. */
function tlv(id, value) {
  const v = String(value)
  return `${id}${String(v.length).padStart(2, "0")}${v}`
}

/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection. */
function crc16(payload) {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0")
}

/**
 * Additional-data text must stay inside the printable ASCII the TLV encoding
 * assumes; diacritics and punctuation are stripped rather than escaped, since
 * banking apps display this field verbatim.
 */
function sanitizeInfo(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "D")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .slice(0, 25)
}

function buildVietQrPayload({ bankBin, accountNumber, amount, addInfo }) {
  if (!bankBin) throw new Error("Thiếu mã ngân hàng (BIN)")
  if (!accountNumber) throw new Error("Thiếu số tài khoản")
  if (amount !== null && amount !== undefined) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`Số tiền không hợp lệ: ${amount}`)
    }
  }

  const merchantAccount = tlv("00", GUID) + tlv("01", tlv("00", bankBin) + tlv("01", accountNumber))

  let payload =
    tlv("00", "01") +                                   // format indicator
    tlv("01", amount ? "12" : "11") +                   // 12 dynamic (one-off), 11 static
    tlv("38", merchantAccount + tlv("02", "QRIBFTTA")) +
    tlv("53", "704") +                                  // VND
    (amount ? tlv("54", String(amount)) : "") +
    tlv("58", "VN")

  const info = sanitizeInfo(addInfo)
  if (info) payload += tlv("62", tlv("08", info))

  payload += "6304"                                     // CRC tag and length
  return payload + crc16(payload)
}

module.exports = { crc16, tlv, buildVietQrPayload, sanitizeInfo }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- vietqr`
Expected: PASS, 13 tests.

- [ ] **Step 5: Verify against a real banking app**

Generate a payload for the seller's real account with a 2.000₫ amount, render it (`npx qrcode <payload>` or the order page once Task 4 lands), and scan it with a Vietnamese banking app. Confirm the app pre-fills the correct **account number, account name, amount, and transfer note**.

**This manual check is mandatory.** The unit tests prove the encoding is internally consistent; only a real bank app proves it is correct. Do not ship an unscanned QR.

- [ ] **Step 6: Commit**

```bash
git add backend/shop/payments/vietqr.js backend/tests/vietqr.test.js
git commit -F - <<'EOF'
feat(payments): generate VietQR payloads locally

EMVCo/NAPAS TLV payloads are built in-process rather than fetched from a QR
image service. The seller's account details never transit a third party, the
feature keeps working if that service disappears, and every branch is
unit-testable.

The CRC implementation is checked against the standard CRC-16/CCITT-FALSE
check value for "123456789", and a test confirms the trailing CRC actually
validates the payload body rather than merely being four hex characters.

Amount is rejected unless it is a positive integer: a fractional or negative
value would encode a wrong transfer amount into a QR the buyer then scans and
pays, which is the worst possible place to be lenient.

The transfer note is stripped to printable ASCII and truncated to 25
characters, because banking apps display that field verbatim and the TLV
encoding assumes single-byte characters.
EOF
```

---

### Task 3: Admin payment settings API and checkout filtering

**Files:**
- Create: `backend/routes/adminPayments.js`
- Modify: `backend/routes/shop.js` (expose enabled methods)
- Modify: `backend/routes/orders.js` (reject disabled methods)
- Modify: `backend/server.js`
- Test: `backend/tests/paymentRoutes.test.js`

**Interfaces:**
- `GET /api/shop/payment-methods` → `{methods: string[], payment_note: string|null}` (public, no secrets)
- `GET /api/admin/payment-settings` → full settings **including** reserved fields
- `PUT /api/admin/payment-settings` → `{ok:true}`
- `POST /api/orders` now rejects a payment method the seller has not enabled.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/paymentRoutes.test.js`:

```js
const { describe, it, expect, beforeEach } = require("vitest")
const request = require("supertest")
const jwt = require("jsonwebtoken")
const app = require("../server")
const db = require("../db")
const settings = require("../shop/payments/settingsRepo")
const catalog = require("../shop/catalogRepo")
const { resetTables } = require("./helpers/db")

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
  await db.query("DELETE FROM payment_settings")
})

describe("GET /api/shop/payment-methods", () => {
  it("lists only enabled methods", async () => {
    await settings.updateSettings({ bank_enabled: true, cod_enabled: true })
    const res = await request(app).get("/api/shop/payment-methods")
    expect(res.status).toBe(200)
    expect(res.body.methods).toEqual(["bank", "cod"])
  })

  it("never leaks reserved secrets", async () => {
    await settings.updateSettings({ bank_enabled: true, sepay_api_key: "SECRET" })
    const res = await request(app).get("/api/shop/payment-methods")
    expect(JSON.stringify(res.body)).not.toContain("SECRET")
  })

  it("does not leak the account number to the public list endpoint", async () => {
    await settings.updateSettings({ bank_enabled: true, bank_account_number: "999888777" })
    const res = await request(app).get("/api/shop/payment-methods")
    expect(JSON.stringify(res.body)).not.toContain("999888777")
  })
})

describe("admin payment settings", () => {
  it("requires auth", async () => {
    expect((await request(app).get("/api/admin/payment-settings")).status).toBe(401)
  })

  it("saves and reads back", async () => {
    await authed(request(app).put("/api/admin/payment-settings")).send({
      bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
      bank_account_number: "123456789", bank_account_holder: "NGUYEN VAN A",
    })
    const res = await authed(request(app).get("/api/admin/payment-settings"))
    expect(res.body.bank_name).toBe("ACB")
  })

  it("rejects enabling bank without the details needed to pay it", async () => {
    const res = await authed(request(app).put("/api/admin/payment-settings"))
      .send({ bank_enabled: true })
    expect(res.status).toBe(400)
  })

  it("rejects enabling momo with neither phone nor QR image", async () => {
    const res = await authed(request(app).put("/api/admin/payment-settings"))
      .send({ momo_enabled: true })
    expect(res.status).toBe(400)
  })

  it("rejects a non-numeric bank BIN", async () => {
    const res = await authed(request(app).put("/api/admin/payment-settings")).send({
      bank_enabled: true, bank_name: "ACB", bank_bin: "abc",
      bank_account_number: "1", bank_account_holder: "A",
    })
    expect(res.status).toBe(400)
  })
})

describe("checkout respects enabled methods", () => {
  async function seed() {
    const cid = await catalog.createCollection({ title: "Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
    return v.id
  }

  const body = (v, method) => ({
    items: [{ variant_id: v, qty: 1 }],
    buyer: { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" },
    fulfillment_method: "ship", payment_method: method,
  })

  it("rejects a method the seller has not enabled", async () => {
    const v = await seed()
    await settings.updateSettings({ bank_enabled: true })

    const res = await request(app).post("/api/orders").send(body(v, "paypal"))
    expect(res.status).toBe(400)

    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(0)
  })

  it("accepts an enabled method", async () => {
    const v = await seed()
    await settings.updateSettings({
      bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
      bank_account_number: "1", bank_account_holder: "A",
    })
    expect((await request(app).post("/api/orders").send(body(v, "bank"))).status).toBe(201)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- paymentRoutes`
Expected: FAIL.

- [ ] **Step 3: Create the admin router**

Create `backend/routes/adminPayments.js`:

```js
const express = require("express")
const repo = require("../shop/payments/settingsRepo")

function validate(d) {
  if (d.bank_enabled) {
    if (!d.bank_name?.trim()) return "Cần tên ngân hàng"
    if (!/^\d{4,10}$/.test(String(d.bank_bin || ""))) return "Mã ngân hàng (BIN) phải là số"
    if (!d.bank_account_number?.trim()) return "Cần số tài khoản"
    if (!d.bank_account_holder?.trim()) return "Cần tên chủ tài khoản"
  }
  if (d.momo_enabled && !d.momo_phone?.trim() && !d.momo_qr_image?.trim()) {
    return "Momo cần số điện thoại hoặc ảnh QR"
  }
  if (d.paypal_enabled && !d.paypal_link?.trim()) return "Cần link PayPal"
  return null
}

module.exports = function adminPaymentRoutes() {
  const router = express.Router()

  router.get("/payment-settings", async (req, res) => {
    try {
      res.json(await repo.getSettings())
    } catch (err) {
      console.error("[ADMIN/PAYMENTS] Lỗi đọc cấu hình:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.put("/payment-settings", async (req, res) => {
    try {
      const invalid = validate(req.body)
      if (invalid) return res.status(400).json({ error: "invalid_input", message: invalid })

      await repo.updateSettings(req.body)
      res.json({ ok: true })
    } catch (err) {
      console.error("[ADMIN/PAYMENTS] Lỗi lưu cấu hình:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  return router
}
```

- [ ] **Step 4: Expose the public method list**

In `backend/routes/shop.js`, add the import and route:

```js
const paymentSettings = require("../shop/payments/settingsRepo")
```

```js
  // Only the method names and a free-text note. Account details are served
  // per-order (see /api/orders/:token/payment) so they are not broadcast.
  router.get("/payment-methods", async (req, res) => {
    try {
      const s = await paymentSettings.getSettings()
      res.json({ methods: paymentSettings.enabledMethods(s), payment_note: s.payment_note || null })
    } catch (err) {
      console.error("[SHOP] Lỗi lấy phương thức thanh toán:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })
```

- [ ] **Step 5: Reject disabled methods at checkout**

In `backend/routes/orders.js`, add the import:

```js
const paymentSettings = require("../shop/payments/settingsRepo")
```

Inside the `POST /` handler, after the existing `validate(req.body)` check:

```js
      // A method the seller has switched off must not be orderable, even if a
      // stale page or a crafted request still offers it.
      const settings = await paymentSettings.getSettings()
      if (!paymentSettings.enabledMethods(settings).includes(req.body.payment_method)) {
        return bad(res, "Phương thức thanh toán chưa được bật")
      }
```

- [ ] **Step 6: Mount the admin router**

In `backend/server.js`, beside the other admin mounts:

```js
app.use(`${API_PREFIX}/admin`, auth, require("./routes/adminPayments")())
```

- [ ] **Step 7: Run the suite**

Run: `cd backend && DB_PORT=3307 npm test`
Expected: PASS.

Note: Plan 2 tests that place orders will now fail unless a payment method is enabled. Update those tests' setup to enable `bank` (and `cod` where used) — this is a real behaviour change, not a test workaround.

- [ ] **Step 8: Commit**

```bash
git add backend/routes/adminPayments.js backend/routes/shop.js backend/routes/orders.js \
        backend/server.js backend/tests/paymentRoutes.test.js backend/tests
git commit -F - <<'EOF'
feat(payments): add payment settings API and enforce enabled methods

Checkout now rejects any payment method the seller has not switched on, so a
stale page or a crafted request cannot produce an order the seller has no way
to collect.

Enabling a method requires the details needed to actually pay it: bank needs a
name, a numeric BIN, an account number and a holder; Momo needs a phone or a QR
image; PayPal needs a link. Switching on an unusable method would strand
buyers at the payment step.

The public endpoint returns only method names and a note. Account numbers are
served per-order rather than broadcast on a public list, and reserved
auto-confirm secrets are stripped before anything reaches a browser.
EOF
```

---

### Task 4: Per-order payment instructions

**Files:**
- Create: `backend/shop/payments/instructions.js`
- Modify: `backend/routes/orders.js`
- Test: `backend/tests/paymentInstructions.test.js`

**Interfaces:**
- Produces `instructions.js` exporting `buildInstructions(order, settings): object`.
- `GET /api/orders/:token/payment` → method-specific instructions, including `vietqr_payload` for bank.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/paymentInstructions.test.js`:

```js
const { describe, it, expect } = require("vitest")
const { buildInstructions, transferNote } = require("../shop/payments/instructions")
const { crc16 } = require("../shop/payments/vietqr")

const order = { order_token: "abc123def456", total: 35000, payment_method: "bank" }
const settings = {
  bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
  bank_account_number: "123456789", bank_account_holder: "NGUYEN VAN A",
  momo_enabled: true, momo_phone: "0900000000", momo_account_holder: "NGUYEN VAN A",
  paypal_enabled: true, paypal_link: "https://paypal.me/x",
  cod_enabled: true, payment_note: "Ghi chú",
}

describe("transferNote", () => {
  it("derives a short uppercase reference from the token", () => {
    const note = transferNote(order.order_token)
    expect(note).toMatch(/^DH[A-Z0-9]+$/)
    expect(note.length).toBeLessThanOrEqual(25)
  })

  it("is stable for the same order", () => {
    expect(transferNote(order.order_token)).toBe(transferNote(order.order_token))
  })

  it("differs between orders", () => {
    expect(transferNote("aaaa1111")).not.toBe(transferNote("bbbb2222"))
  })
})

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

  it("embeds the transfer note in the QR so the seller can match the payment", () => {
    const i = buildInstructions(order, settings)
    expect(i.transfer_note).toBeTruthy()
    expect(i.vietqr_payload).toContain(i.transfer_note)
  })

  it("returns Momo details without a VietQR payload", () => {
    const i = buildInstructions({ ...order, payment_method: "momo" }, settings)
    expect(i.method).toBe("momo")
    expect(i.momo_phone).toBe("0900000000")
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

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- paymentInstructions`
Expected: FAIL.

- [ ] **Step 3: Implement the builder**

Create `backend/shop/payments/instructions.js`:

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

- [ ] **Step 4: Add the route**

In `backend/routes/orders.js`, add imports and the route:

```js
const paymentSettings = require("../shop/payments/settingsRepo")
const { buildInstructions } = require("../shop/payments/instructions")
```

```js
  router.get("/:token/payment", async (req, res) => {
    try {
      res.set("X-Robots-Tag", "noindex, nofollow")

      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      const settings = await paymentSettings.getSettings()
      res.json(buildInstructions(order, settings))
    } catch (err) {
      console.error("[ORDERS] Lỗi lấy hướng dẫn thanh toán:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- paymentInstructions`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/shop/payments/instructions.js backend/routes/orders.js \
        backend/tests/paymentInstructions.test.js
git commit -F - <<'EOF'
feat(payments): build per-order payment instructions

Each order gets instructions for its own method only. A Momo order never
receives bank account details, so a leaked order link exposes the minimum
necessary, and a test asserts the account number is absent from a Momo
response entirely.

Bank orders carry a VietQR payload with the amount and a short transfer note
derived from the order token, so the buyer's banking app pre-fills everything
and the seller can match an incoming transfer to an order without reading the
whole statement.

A bank misconfiguration returns a null payload rather than throwing: the
printed account details are still shown and the buyer can transfer manually,
which is far better than a blank payment page.
EOF
```

---

### Task 5: Payment proof upload

**Files:**
- Modify: `backend/migrations/` — new `013_add_payment_proof.js`
- Modify: `backend/routes/orders.js`, `backend/server.js`
- Test: `backend/tests/paymentProof.test.js`

**Interfaces:**
- Adds `orders.payment_proof_url` and `orders.payment_proof_uploaded_at`.
- `POST /api/orders/:token/proof` — body `{base64}` → `201 {url}`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/paymentProof.test.js`:

```js
const { describe, it, expect, beforeEach, vi } = require("vitest")
const request = require("supertest")
const sharp = require("sharp")
const db = require("../db")

vi.mock("../storage", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, upload: vi.fn(async (key) => key), ensureBucket: vi.fn(async () => {}) }
})

const app = require("../server")
const catalog = require("../shop/catalogRepo")
const orders = require("../shop/orders/orderRepo")
const settings = require("../shop/payments/settingsRepo")
const { resetTables } = require("./helpers/db")

async function seedOrder() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer: { buyer_name: "A", phone: "09", email: "a@example.com", address_raw: "x" },
    fulfillment_method: "ship", payment_method: "bank",
  })
}

const png = () => sharp({ create: { width: 300, height: 300, channels: 3, background: "#fff" } })
  .png().toBuffer().then((b) => b.toString("base64"))

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
  await db.query("DELETE FROM payment_settings")
  await settings.updateSettings({
    bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
    bank_account_number: "1", bank_account_holder: "A",
  })
})

describe("POST /api/orders/:token/proof", () => {
  it("stores a proof image against the order", async () => {
    const o = await seedOrder()
    const res = await request(app).post(`/api/orders/${o.order_token}/proof`).send({ base64: await png() })

    expect(res.status).toBe(201)
    expect(res.body.url).toContain("/api/storage/")

    const [[row]] = await db.query("SELECT payment_proof_url, payment_proof_uploaded_at FROM orders WHERE id = ?", [o.id])
    expect(row.payment_proof_url).toBeTruthy()
    expect(row.payment_proof_uploaded_at).not.toBeNull()
  })

  it("rejects a missing image", async () => {
    const o = await seedOrder()
    expect((await request(app).post(`/api/orders/${o.order_token}/proof`).send({})).status).toBe(400)
  })

  it("rejects a non-image payload", async () => {
    const o = await seedOrder()
    const res = await request(app).post(`/api/orders/${o.order_token}/proof`)
      .send({ base64: Buffer.from("not an image at all").toString("base64") })
    expect(res.status).toBe(400)
  })

  it("404s an unknown token", async () => {
    const res = await request(app).post(`/api/orders/${"a".repeat(32)}/proof`).send({ base64: await png() })
    expect(res.status).toBe(404)
  })

  it("refuses upload once the order is already confirmed", async () => {
    const o = await seedOrder()
    await orders.transitionOrder(o.id, "confirmed")
    const res = await request(app).post(`/api/orders/${o.order_token}/proof`).send({ base64: await png() })
    expect(res.status).toBe(409)
  })

  it("allows replacing proof while still pending", async () => {
    const o = await seedOrder()
    await request(app).post(`/api/orders/${o.order_token}/proof`).send({ base64: await png() })
    const second = await request(app).post(`/api/orders/${o.order_token}/proof`).send({ base64: await png() })
    expect(second.status).toBe(201)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- paymentProof`
Expected: FAIL.

- [ ] **Step 3: Create the migration**

Create `backend/migrations/013_add_payment_proof.js`:

```js
exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.string("payment_proof_url", 512).nullable()
    table.timestamp("payment_proof_uploaded_at").nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("payment_proof_url")
    table.dropColumn("payment_proof_uploaded_at")
  })
}
```

- [ ] **Step 4: Add the upload route**

In `backend/routes/orders.js`, add the import:

```js
const { uploadShopImage } = require("../shop/images")
```

and the route:

```js
  router.post("/:token/proof", async (req, res) => {
    try {
      const { base64 } = req.body
      if (!base64) return bad(res, "Cần ảnh chuyển khoản")

      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      // Once confirmed there is nothing left to prove, and accepting an upload
      // would let anyone with the link overwrite the evidence after the fact.
      if (order.status !== "pending") {
        return res.status(409).json({
          error: "invalid_state",
          message: "Đơn hàng đã được xử lý, không cần tải ảnh nữa",
        })
      }

      let url
      try {
        url = await uploadShopImage(`proofs/${order.id}`, Buffer.from(base64, "base64"))
      } catch {
        return bad(res, "Ảnh không hợp lệ")
      }

      await require("../db").query(
        "UPDATE orders SET payment_proof_url = ?, payment_proof_uploaded_at = NOW() WHERE id = ?",
        [url, order.id]
      )
      console.log(`[ORDERS] Đã nhận ảnh chuyển khoản cho đơn ${order.id}`)
      res.status(201).json({ url })
    } catch (err) {
      console.error("[ORDERS] Lỗi tải ảnh chuyển khoản:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })
```

- [ ] **Step 5: Allow large bodies on the proof path**

In `backend/server.js`, extend the large-body regex again:

```js
  if (req.method === "POST" && /^\/api\/(image$|upload\/|admin\/shop\/image$|orders\/[^/]+\/proof$)/.test(req.path)) {
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- paymentProof`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/013_add_payment_proof.js backend/routes/orders.js \
        backend/server.js backend/tests/paymentProof.test.js
git commit -F - <<'EOF'
feat(payments): let buyers upload proof of payment

Manual confirmation without proof would mean the seller cross-referencing a
whole bank statement against every order by hand, which is the tedium this
feature exists to remove.

Upload is only accepted while the order is pending. Once confirmed there is
nothing left to prove, and continuing to accept uploads would let anyone
holding the link overwrite the evidence after the fact.

Images run through the same sharp pipeline as product photos, so a phone
screenshot lands as a compressed WebP rather than a multi-megabyte PNG, and a
payload that is not a decodable image is rejected as invalid input rather than
crashing the route.
EOF
```

---

### Task 6: Email templates

**Files:**
- Create: `backend/migrations/014_create_email_templates.js`
- Create: `backend/shop/email/templates.js`
- Create: `backend/seeds/001_email_templates.js`
- Test: `backend/tests/emailTemplates.test.js`

**Interfaces:**
- Table `email_templates`: `id, type (unique), subject, body_html, updated_at`.
- `templates.js` exports `renderTemplate(tpl, vars): {subject, html}`, `buildVars(order): object`, `validatePlaceholders(text): string[]`, `getTemplate(type)`, `upsertTemplate(type, data)`, `DEFAULT_TEMPLATES`.
- Types: `order_placed`, `payment_confirmed`, `shipped`, `cancelled`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/emailTemplates.test.js`:

```js
const { describe, it, expect } = require("vitest")
const t = require("../shop/email/templates")

const order = {
  id: 12, order_token: "abcd1234efgh", buyer_name: "Nguyễn Văn A", total: 105000,
  status: "pending", payment_method: "bank", fulfillment_method: "ship",
  tracking_code: null,
  items: [
    { product_name_snapshot: "Photocard", variant_label_snapshot: "A1", qty: 2, unit_price_snapshot: 35000 },
    { product_name_snapshot: "Poster", variant_label_snapshot: "Std", qty: 1, unit_price_snapshot: 35000 },
  ],
}

describe("renderTemplate", () => {
  it("substitutes placeholders", () => {
    const out = t.renderTemplate(
      { subject: "Đơn {{order_id}}", body_html: "<p>Chào {{buyer_name}}</p>" },
      t.buildVars(order)
    )
    expect(out.subject).toBe("Đơn 12")
    expect(out.html).toContain("Nguyễn Văn A")
  })

  it("formats the total as VND", () => {
    const out = t.renderTemplate({ subject: "x", body_html: "{{total}}" }, t.buildVars(order))
    expect(out.html).toContain("105.000")
  })

  it("renders the item list", () => {
    const out = t.renderTemplate({ subject: "x", body_html: "{{items}}" }, t.buildVars(order))
    expect(out.html).toContain("Photocard")
    expect(out.html).toContain("A1")
    expect(out.html).toContain("Poster")
  })

  it("leaves an unknown placeholder empty rather than printing braces", () => {
    const out = t.renderTemplate({ subject: "x", body_html: "[{{nope}}]" }, t.buildVars(order))
    expect(out.html).toBe("[]")
  })

  it("escapes HTML in buyer-controlled values", () => {
    const evil = { ...order, buyer_name: "<script>alert(1)</script>" }
    const out = t.renderTemplate({ subject: "x", body_html: "{{buyer_name}}" }, t.buildVars(evil))
    expect(out.html).not.toContain("<script>")
    expect(out.html).toContain("&lt;script&gt;")
  })

  it("escapes buyer-controlled values in the subject too", () => {
    const evil = { ...order, buyer_name: "<b>x</b>" }
    const out = t.renderTemplate({ subject: "{{buyer_name}}", body_html: "x" }, t.buildVars(evil))
    expect(out.subject).not.toContain("<b>")
  })
})

describe("validatePlaceholders", () => {
  it("accepts known placeholders", () => {
    expect(t.validatePlaceholders("{{order_id}} {{buyer_name}} {{total}}")).toEqual([])
  })

  it("reports unknown placeholders so a typo cannot ship silently", () => {
    expect(t.validatePlaceholders("{{oder_id}}")).toEqual(["oder_id"])
  })

  it("reports every unknown placeholder, not just the first", () => {
    expect(t.validatePlaceholders("{{a}} {{b}}").sort()).toEqual(["a", "b"])
  })
})

describe("DEFAULT_TEMPLATES", () => {
  it("covers every lifecycle email", () => {
    expect(Object.keys(t.DEFAULT_TEMPLATES).sort())
      .toEqual(["cancelled", "order_placed", "payment_confirmed", "shipped"])
  })

  it("uses only valid placeholders", () => {
    for (const [type, tpl] of Object.entries(t.DEFAULT_TEMPLATES)) {
      expect(t.validatePlaceholders(tpl.subject + tpl.body_html), type).toEqual([])
    }
  })

  it("is written in Vietnamese", () => {
    expect(t.DEFAULT_TEMPLATES.order_placed.subject).toMatch(/[ăâđêôơư]/i)
  })

  it("renders every default without throwing", () => {
    const vars = t.buildVars(order)
    for (const tpl of Object.values(t.DEFAULT_TEMPLATES)) {
      expect(() => t.renderTemplate(tpl, vars)).not.toThrow()
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- emailTemplates`
Expected: FAIL.

- [ ] **Step 3: Create the migration**

Create `backend/migrations/014_create_email_templates.js`:

```js
exports.up = function (knex) {
  return knex.schema.createTable("email_templates", (table) => {
    table.increments("id").primary()
    table.string("type", 64).notNullable().unique()
    table.string("subject", 512).notNullable()
    table.text("body_html", "mediumtext").notNullable()
    table.timestamp("updated_at").defaultTo(knex.fn.now())
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("email_templates")
}
```

- [ ] **Step 4: Implement templates**

Create `backend/shop/email/templates.js`:

```js
const db = require("./../../db")

const PLACEHOLDERS = [
  "order_id", "order_token", "order_url", "buyer_name", "total", "items",
  "status", "payment_method", "fulfillment_method", "tracking_code",
  "payment_note", "shop_name",
]

const SHOP_NAME = process.env.SHOP_NAME || "Shop"
const SITE_URL = process.env.SITE_URL || ""

/** Buyer-controlled values reach an HTML email; escape before substitution. */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

const formatVnd = (n) => `${Number(n || 0).toLocaleString("vi-VN")}₫`

function itemsHtml(items = []) {
  const rows = items.map((i) => `
    <tr>
      <td style="padding:6px 0">${escapeHtml(i.product_name_snapshot)} · ${escapeHtml(i.variant_label_snapshot)} × ${Number(i.qty)}</td>
      <td style="padding:6px 0;text-align:right">${formatVnd(i.unit_price_snapshot * i.qty)}</td>
    </tr>`).join("")
  return `<table style="width:100%;border-collapse:collapse">${rows}</table>`
}

function buildVars(order) {
  return {
    order_id: escapeHtml(order.id),
    order_token: escapeHtml(order.order_token),
    order_url: `${SITE_URL}/order/${order.order_token}`,
    buyer_name: escapeHtml(order.buyer_name),
    total: formatVnd(order.total),
    items: itemsHtml(order.items),           // built from escaped parts above
    status: escapeHtml(order.status),
    payment_method: escapeHtml(order.payment_method),
    fulfillment_method: escapeHtml(order.fulfillment_method),
    tracking_code: escapeHtml(order.tracking_code || ""),
    payment_note: escapeHtml(order.payment_note || ""),
    shop_name: escapeHtml(SHOP_NAME),
  }
}

/** Unknown placeholders render empty, so a stale template never leaks braces. */
function substitute(text, vars) {
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "")
}

function renderTemplate(tpl, vars) {
  return {
    subject: substitute(tpl.subject, vars).replace(/<[^>]*>/g, ""),
    html: substitute(tpl.body_html, vars),
  }
}

/** Return placeholder names used in `text` that the renderer does not know. */
function validatePlaceholders(text) {
  const found = [...String(text || "").matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
  return [...new Set(found.filter((name) => !PLACEHOLDERS.includes(name)))]
}

const wrap = (inner) => `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222">
  <h2 style="margin:0 0 16px">{{shop_name}}</h2>
  ${inner}
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="font-size:12px;color:#888">Xem đơn hàng: <a href="{{order_url}}">{{order_url}}</a></p>
</div>`

const DEFAULT_TEMPLATES = {
  order_placed: {
    subject: "Đã nhận đơn hàng #{{order_id}}",
    body_html: wrap(`
      <p>Chào {{buyer_name}},</p>
      <p>Mình đã nhận được đơn hàng của bạn. Vui lòng thanh toán và tải ảnh chuyển khoản lên trang đơn hàng để mình xác nhận nhé.</p>
      {{items}}
      <p style="font-weight:bold;margin-top:12px">Tổng: {{total}}</p>
      <p style="font-size:13px;color:#666">Phí ship trả cho shipper khi nhận hàng.</p>
      <p>{{payment_note}}</p>`),
  },
  payment_confirmed: {
    subject: "Đã xác nhận thanh toán đơn #{{order_id}}",
    body_html: wrap(`
      <p>Chào {{buyer_name}},</p>
      <p>Mình đã xác nhận thanh toán cho đơn hàng của bạn. Mình sẽ chuẩn bị và gửi hàng sớm nhất có thể.</p>
      {{items}}
      <p style="font-weight:bold;margin-top:12px">Tổng: {{total}}</p>`),
  },
  shipped: {
    subject: "Đơn #{{order_id}} đã được gửi đi",
    body_html: wrap(`
      <p>Chào {{buyer_name}},</p>
      <p>Đơn hàng của bạn đã được bàn giao cho đơn vị vận chuyển.</p>
      <p>Mã vận đơn: <strong>{{tracking_code}}</strong></p>
      <p style="font-size:13px;color:#666">Phí ship trả cho shipper khi nhận hàng.</p>`),
  },
  cancelled: {
    subject: "Đơn #{{order_id}} đã bị hủy",
    body_html: wrap(`
      <p>Chào {{buyer_name}},</p>
      <p>Đơn hàng của bạn đã bị hủy. Nếu bạn đã thanh toán, vui lòng liên hệ để mình hoàn tiền.</p>
      {{items}}`),
  },
}

async function getTemplate(type) {
  const [[row]] = await db.query("SELECT * FROM email_templates WHERE type = ? LIMIT 1", [type])
  return row || DEFAULT_TEMPLATES[type] || null
}

async function upsertTemplate(type, data) {
  const [[row]] = await db.query("SELECT id FROM email_templates WHERE type = ? LIMIT 1", [type])
  if (row) {
    await db.query(
      "UPDATE email_templates SET subject = ?, body_html = ?, updated_at = NOW() WHERE id = ?",
      [data.subject, data.body_html, row.id]
    )
  } else {
    await db.query(
      "INSERT INTO email_templates (type, subject, body_html) VALUES (?, ?, ?)",
      [type, data.subject, data.body_html]
    )
  }
}

module.exports = {
  PLACEHOLDERS, DEFAULT_TEMPLATES,
  buildVars, renderTemplate, validatePlaceholders, getTemplate, upsertTemplate, escapeHtml,
}
```

- [ ] **Step 5: Seed the defaults**

Create `backend/seeds/001_email_templates.js`:

```js
const { DEFAULT_TEMPLATES } = require("../shop/email/templates")

exports.seed = async function (knex) {
  for (const [type, tpl] of Object.entries(DEFAULT_TEMPLATES)) {
    const existing = await knex("email_templates").where({ type }).first()
    // Only insert what is missing: never overwrite the seller's edits.
    if (!existing) {
      await knex("email_templates").insert({ type, subject: tpl.subject, body_html: tpl.body_html })
    }
  }
}
```

The Docker entrypoint already runs `npx knex seed:run` on start, so this applies automatically.

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- emailTemplates`
Expected: PASS, 13 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/014_create_email_templates.js backend/shop/email/templates.js \
        backend/seeds/001_email_templates.js backend/tests/emailTemplates.test.js
git commit -F - <<'EOF'
feat(email): add Vietnamese order email templates

Four templates — placed, payment confirmed, shipped, cancelled — shipped as
polished HTML defaults and stored in a table so the seller can reword them
without a code change.

Every buyer-controlled value is HTML-escaped before substitution, in the
subject as well as the body. A buyer name is attacker-controlled text that
lands in an HTML email, and there are tests proving a script tag in a name
comes out inert.

Unknown placeholders render as empty rather than printing raw braces, so a
stale template degrades quietly instead of mailing "{{oder_id}}" to a
customer. validatePlaceholders exists so the admin editor can reject a typo
before it ships, and a test asserts the shipped defaults themselves contain
only valid placeholders.

The seed inserts only missing templates, so re-running it on deploy can never
overwrite the seller's edits.
EOF
```

---

### Task 7: Email queue and sender

**Files:**
- Create: `backend/migrations/015_create_email_queue.js`
- Create: `backend/shop/email/queue.js`
- Create: `backend/shop/email/sender.js`
- Test: `backend/tests/emailQueue.test.js`

**Interfaces:**
- Table `email_queue`: `id, order_id FK CASCADE, type, to_email, status (pending|sent|failed), attempts, last_error, created_at, sent_at`.
- `queue.js` exports `enqueue(orderId, type, toEmail)`, `claimPending(limit)`, `markSent(id)`, `markFailed(id, error)`, `MAX_ATTEMPTS` (5).
- `sender.js` exports `sendQueued(limit): Promise<{sent, failed}>` and `isConfigured(): boolean`.

- [ ] **Step 1: Install nodemailer**

Run: `cd backend && npm install nodemailer@^6.10.0`

- [ ] **Step 2: Write the failing test**

Create `backend/tests/emailQueue.test.js`:

```js
const { describe, it, expect, beforeEach } = require("vitest")
const db = require("../db")
const queue = require("../shop/email/queue")
const catalog = require("../shop/catalogRepo")
const orders = require("../shop/orders/orderRepo")
const settings = require("../shop/payments/settingsRepo")
const { resetTables } = require("./helpers/db")

async function seedOrder() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer: { buyer_name: "A", phone: "09", email: "a@example.com", address_raw: "x" },
    fulfillment_method: "ship", payment_method: "bank",
  })
}

beforeEach(async () => {
  await resetTables("email_queue", "order_items", "orders", "product_variants", "products", "collections")
  await db.query("DELETE FROM payment_settings")
  await settings.updateSettings({
    bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
    bank_account_number: "1", bank_account_holder: "A",
  })
})

describe("enqueue", () => {
  it("queues a pending message", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    const [[row]] = await db.query("SELECT * FROM email_queue LIMIT 1")
    expect(row.status).toBe("pending")
    expect(row.attempts).toBe(0)
  })
})

describe("claimPending", () => {
  it("returns pending messages", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    expect(await queue.claimPending(10)).toHaveLength(1)
  })

  it("ignores sent messages", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    const [[row]] = await db.query("SELECT id FROM email_queue LIMIT 1")
    await queue.markSent(row.id)
    expect(await queue.claimPending(10)).toHaveLength(0)
  })

  it("stops retrying after MAX_ATTEMPTS", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    const [[row]] = await db.query("SELECT id FROM email_queue LIMIT 1")

    for (let i = 0; i < queue.MAX_ATTEMPTS; i += 1) await queue.markFailed(row.id, "smtp down")

    expect(await queue.claimPending(10)).toHaveLength(0)
    const [[after]] = await db.query("SELECT status, attempts, last_error FROM email_queue WHERE id = ?", [row.id])
    expect(after.status).toBe("failed")
    expect(after.attempts).toBe(queue.MAX_ATTEMPTS)
    expect(after.last_error).toContain("smtp")
  })

  it("keeps retrying below the limit", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    const [[row]] = await db.query("SELECT id FROM email_queue LIMIT 1")

    await queue.markFailed(row.id, "temporary")
    expect(await queue.claimPending(10)).toHaveLength(1)
  })
})

describe("failure isolation", () => {
  it("a queued email never affects the order it belongs to", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    const [[row]] = await db.query("SELECT id FROM email_queue LIMIT 1")
    await queue.markFailed(row.id, "boom")

    const [[order]] = await db.query("SELECT status FROM orders WHERE id = ?", [o.id])
    expect(order.status).toBe("pending") // order untouched by mail failure
  })

  it("deleting an order clears its queued mail", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    await db.query("DELETE FROM orders WHERE id = ?", [o.id])

    const [rows] = await db.query("SELECT id FROM email_queue")
    expect(rows).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- emailQueue`
Expected: FAIL.

- [ ] **Step 4: Create the migration**

Create `backend/migrations/015_create_email_queue.js`:

```js
exports.up = function (knex) {
  return knex.schema.createTable("email_queue", (table) => {
    table.increments("id").primary()

    table.integer("order_id").unsigned().notNullable()
      .references("id").inTable("orders").onDelete("CASCADE")

    table.string("type", 64).notNullable()
    table.string("to_email").notNullable()

    table.enu("status", ["pending", "sent", "failed"]).notNullable().defaultTo("pending")
    table.integer("attempts").unsigned().notNullable().defaultTo(0)
    table.text("last_error").nullable()

    table.timestamp("created_at").defaultTo(knex.fn.now())
    table.timestamp("sent_at").nullable()

    table.index(["status", "attempts"], "idx_email_queue_status")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("email_queue")
}
```

- [ ] **Step 5: Implement the queue**

Create `backend/shop/email/queue.js`:

```js
const db = require("./../../db")

const MAX_ATTEMPTS = 5

async function enqueue(orderId, type, toEmail) {
  await db.query(
    "INSERT INTO email_queue (order_id, type, to_email) VALUES (?, ?, ?)",
    [orderId, type, toEmail]
  )
}

/** Pending messages that have not exhausted their retries. */
async function claimPending(limit = 10) {
  const [rows] = await db.query(
    `SELECT * FROM email_queue
      WHERE status = 'pending' AND attempts < ?
      ORDER BY id ASC LIMIT ?`,
    [MAX_ATTEMPTS, limit]
  )
  return rows
}

async function markSent(id) {
  await db.query("UPDATE email_queue SET status = 'sent', sent_at = NOW() WHERE id = ?", [id])
}

/**
 * Record a failure. Once attempts reach MAX_ATTEMPTS the row is marked failed
 * so it stops being retried forever and stays visible for the seller.
 */
async function markFailed(id, error) {
  await db.query(
    `UPDATE email_queue
        SET attempts = attempts + 1,
            last_error = ?,
            status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END
      WHERE id = ?`,
    [String(error).slice(0, 1000), MAX_ATTEMPTS, id]
  )
}

module.exports = { enqueue, claimPending, markSent, markFailed, MAX_ATTEMPTS }
```

- [ ] **Step 6: Implement the sender**

Create `backend/shop/email/sender.js`:

```js
const nodemailer = require("nodemailer")
const db = require("./../../db")
const queue = require("./queue")
const templates = require("./templates")
const orderRepo = require("./../orders/orderRepo")
const settingsRepo = require("./../payments/settingsRepo")

let transport = null

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  }
  return transport
}

/**
 * Dispatch queued mail. Rendering happens at send time so a template edit
 * applies to anything still queued. Every failure is contained to its own
 * message — one bad address must not stall the rest of the queue.
 */
async function sendQueued(limit = 10) {
  if (!isConfigured()) return { sent: 0, failed: 0, skipped: true }

  const pending = await queue.claimPending(limit)
  let sent = 0
  let failed = 0

  for (const row of pending) {
    try {
      const order = await orderRepo.getOrderById(row.order_id)
      if (!order) { await queue.markFailed(row.id, "order không tồn tại"); failed += 1; continue }

      const settings = await settingsRepo.getSettings()
      const tpl = await templates.getTemplate(row.type)
      if (!tpl) { await queue.markFailed(row.id, `không có mẫu email: ${row.type}`); failed += 1; continue }

      const rendered = templates.renderTemplate(
        tpl,
        templates.buildVars({ ...order, payment_note: settings.payment_note })
      )

      await getTransport().sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: row.to_email,
        subject: rendered.subject,
        html: rendered.html,
      })

      await queue.markSent(row.id)
      sent += 1
      console.log(`[EMAIL] Đã gửi ${row.type} cho đơn ${row.order_id}`)
    } catch (err) {
      await queue.markFailed(row.id, err.message)
      failed += 1
      console.warn(`[EMAIL] Gửi thất bại ${row.type} đơn ${row.order_id}: ${err.message}`)
    }
  }

  return { sent, failed, skipped: false }
}

/** Failed messages, for surfacing in the admin. */
async function listFailed() {
  const [rows] = await db.query(
    "SELECT * FROM email_queue WHERE status = 'failed' ORDER BY id DESC LIMIT 50"
  )
  return rows
}

module.exports = { sendQueued, isConfigured, listFailed }
```

- [ ] **Step 7: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- emailQueue`
Expected: PASS, 7 tests.

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/015_create_email_queue.js backend/shop/email/queue.js \
        backend/shop/email/sender.js backend/package.json backend/package-lock.json \
        backend/tests/emailQueue.test.js
git commit -F - <<'EOF'
feat(email): queue order mail with retry

Mail goes to a table first and is dispatched separately, so an SMTP timeout can
never roll back a committed order. A buyer who has paid must have their order
recorded whether or not the confirmation email got out.

Retries stop after five attempts and the row is marked failed rather than
retried forever, which keeps a permanently bad address from being hammered
while leaving the failure visible to the seller instead of silently lost.

Each message is isolated: one failure marks that row and moves on, so a single
bad address cannot stall the rest of the queue.

Rendering happens at send time rather than at enqueue, so correcting a typo in
a template also fixes anything still waiting to go out. Queued mail cascades
away with its order.
EOF
```

---

### Task 8: Wire email into the order lifecycle

**Files:**
- Modify: `backend/routes/orders.js`, `backend/shop/orders/orderRepo.js`
- Modify: `backend/worker.js`
- Test: `backend/tests/emailTriggers.test.js`

**Interfaces:**
- `transitionOrder` accepts `extra.notify` (default `true`) and enqueues the matching email **after commit**.
- Order creation enqueues `order_placed` to the buyer and to `ADMIN_EMAIL` if set.
- `worker.js` exports `dispatchEmails()` and calls it in its loop.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/emailTriggers.test.js`:

```js
const { describe, it, expect, beforeEach } = require("vitest")
const request = require("supertest")
const app = require("../server")
const db = require("../db")
const catalog = require("../shop/catalogRepo")
const orders = require("../shop/orders/orderRepo")
const settings = require("../shop/payments/settingsRepo")
const { resetTables } = require("./helpers/db")

async function seedVariant() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return v.id
}

const body = (v) => ({
  items: [{ variant_id: v, qty: 1 }],
  buyer: { buyer_name: "A", phone: "09", email: "buyer@example.com", address_raw: "x" },
  fulfillment_method: "ship", payment_method: "bank",
})

const queued = async () => {
  const [rows] = await db.query("SELECT type, to_email FROM email_queue ORDER BY id ASC")
  return rows
}

beforeEach(async () => {
  await resetTables("email_queue", "order_items", "orders", "product_variants", "products", "collections")
  await db.query("DELETE FROM payment_settings")
  await settings.updateSettings({
    bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
    bank_account_number: "1", bank_account_holder: "A",
  })
})

describe("order placed", () => {
  it("queues an email to the buyer", async () => {
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))

    const rows = await queued()
    expect(rows.some((r) => r.type === "order_placed" && r.to_email === "buyer@example.com")).toBe(true)
  })

  it("queues a copy to the admin when ADMIN_EMAIL is set", async () => {
    process.env.ADMIN_EMAIL = "seller@example.com"
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))

    expect((await queued()).some((r) => r.to_email === "seller@example.com")).toBe(true)
    delete process.env.ADMIN_EMAIL
  })

  it("still creates the order if enqueueing fails", async () => {
    const v = await seedVariant()
    await db.query("DROP TABLE email_queue")
    try {
      const res = await request(app).post("/api/orders").send(body(v))
      expect(res.status).toBe(201)
    } finally {
      const knex = require("knex")(require("../knexfile").development)
      await knex.migrate.rollback(null, true)
      await knex.migrate.latest()
      await knex.destroy()
    }
  })
})

describe("lifecycle transitions", () => {
  it("queues payment_confirmed on confirm", async () => {
    const v = await seedVariant()
    const created = await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")

    await orders.transitionOrder(o.id, "confirmed")
    expect((await queued()).some((r) => r.type === "payment_confirmed")).toBe(true)
    void created
  })

  it("queues shipped with the order", async () => {
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")

    await orders.transitionOrder(o.id, "confirmed")
    await orders.transitionOrder(o.id, "shipped", { tracking_code: "VTP1" })
    expect((await queued()).some((r) => r.type === "shipped")).toBe(true)
  })

  it("queues cancelled", async () => {
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")

    await orders.transitionOrder(o.id, "cancelled")
    expect((await queued()).some((r) => r.type === "cancelled")).toBe(true)
  })

  it("queues nothing for completed, which needs no buyer email", async () => {
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")

    await orders.transitionOrder(o.id, "confirmed")
    await db.query("DELETE FROM email_queue")
    await orders.transitionOrder(o.id, "completed")

    expect(await queued()).toHaveLength(0)
  })

  it("queues nothing when a transition is refused", async () => {
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")
    await db.query("DELETE FROM email_queue")

    await orders.transitionOrder(o.id, "shipped") // illegal from pending
    expect(await queued()).toHaveLength(0)
  })

  it("sends no duplicate when the sweep cancels an order", async () => {
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?", [new Date(Date.now() - 1000), o.id])
    await db.query("DELETE FROM email_queue")

    await orders.releaseExpiredOrders(new Date())
    await orders.releaseExpiredOrders(new Date())

    expect((await queued()).filter((r) => r.type === "cancelled")).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- emailTriggers`
Expected: FAIL.

- [ ] **Step 3: Enqueue on transition**

In `backend/shop/orders/orderRepo.js`, add near the top:

```js
const emailQueue = require("./../email/queue")

const TRANSITION_EMAILS = {
  confirmed: "payment_confirmed",
  shipped: "shipped",
  cancelled: "cancelled",
  // `completed` intentionally sends nothing: the buyer already has the item.
}
```

In `transitionOrder`, capture the email address before committing and enqueue **after** the commit:

```js
    const [[full]] = await conn.query("SELECT email FROM orders WHERE id = ?", [id])

    await conn.query(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`, params)
    await conn.commit()

    // After commit, and deliberately outside the transaction: a mail failure
    // must never roll back a status change the seller already performed.
    const emailType = TRANSITION_EMAILS[toStatus]
    if (emailType && extra.notify !== false && full?.email) {
      try {
        await emailQueue.enqueue(id, emailType, full.email)
      } catch (err) {
        console.error("[ORDERS] Không xếp được email:", err.message)
      }
    }
    return true
```

- [ ] **Step 4: Enqueue on order creation**

In `backend/routes/orders.js`, inside the `POST /` handler after a successful `createOrder`, and only when the order is new:

```js
      if (!order.reused) {
        try {
          await emailQueue.enqueue(order.id, "order_placed", req.body.buyer.email)
          if (process.env.ADMIN_EMAIL) {
            await emailQueue.enqueue(order.id, "order_placed", process.env.ADMIN_EMAIL)
          }
        } catch (err) {
          // The order is already committed; mail is best-effort by design.
          console.error("[ORDERS] Không xếp được email đơn mới:", err.message)
        }
      }
```

Add the import `const emailQueue = require("../shop/email/queue")`. Note `createOrder` must now also return `id` for a reused order — it already does.

- [ ] **Step 5: Dispatch from the worker**

In `backend/worker.js`, add:

```js
const emailSender = require("./shop/email/sender")
```

```js
async function dispatchEmails() {
  try {
    const { sent, failed, skipped } = await emailSender.sendQueued(10)
    if (!skipped && (sent || failed)) {
      console.log(`[WORKER] Email: gửi ${sent}, lỗi ${failed}`)
    }
    return sent
  } catch (err) {
    console.error("[WORKER] Lỗi gửi email:", err.message)
    return 0
  }
}
```

Call `await dispatchEmails()` in `run()` after the sweep, and add it to the exports:

```js
module.exports = { run, sweepExpiredOrders, dispatchEmails }
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- emailTriggers`
Expected: PASS, 9 tests.

- [ ] **Step 7: Verify against a real SMTP capture**

Run a local capture server so nothing reaches a real inbox:
```bash
docker run -d -p 1080:1080 -p 1025:1025 maildev/maildev
```
Set `SMTP_HOST=localhost SMTP_PORT=1025 SMTP_USER=x SMTP_PASS=x SMTP_FROM=shop@example.com`, restart the worker, place an order, then open `http://localhost:1080`.

Confirm: the mail arrives, the subject shows the order id, Vietnamese diacritics render correctly, the item table and total are right, and the order link works.

- [ ] **Step 8: Commit**

```bash
git add backend/shop/orders/orderRepo.js backend/routes/orders.js backend/worker.js \
        backend/tests/emailTriggers.test.js
git commit -F - <<'EOF'
feat(email): send order mail on lifecycle events

Buyers are emailed when an order is placed, when payment is confirmed, when it
ships, and when it is cancelled. Completed deliberately sends nothing — the
buyer already has the item and another mail is just noise.

Enqueueing happens after the transaction commits and is wrapped so a failure is
logged rather than thrown. A queue problem must never undo a status change the
seller has already performed, nor fail an order a buyer has already placed;
there is a test that drops the queue table entirely and asserts the order is
still created.

Nothing is queued when a transition is refused, and the expiry sweep queues one
cancellation email even when it runs repeatedly, because the underlying
transition is itself guarded.

Dispatch runs in the existing worker loop rather than a new process, keeping to
the 2GB budget.
EOF
```

---

### Task 9: Order QR

**Files:**
- Create: `backend/shop/orders/qr.js`
- Modify: `backend/routes/orders.js`, `backend/shop/email/sender.js`
- Test: `backend/tests/orderQr.test.js`

**Interfaces:**
- `qr.js` exports `orderUrl(token)`, `qrSvg(text): Promise<string>`, `qrPngBuffer(text): Promise<Buffer>`.
- `GET /api/orders/:token/qr.svg` → inline SVG.
- Emails attach the QR as a `cid:` image.

- [ ] **Step 1: Install qrcode**

Run: `cd backend && npm install qrcode@^1.5.4`

- [ ] **Step 2: Write the failing test**

Create `backend/tests/orderQr.test.js`:

```js
const { describe, it, expect } = require("vitest")
const qr = require("../shop/orders/qr")

describe("orderUrl", () => {
  it("builds the buyer-facing order URL", () => {
    process.env.SITE_URL = "https://shop.example"
    expect(qr.orderUrl("abc123")).toBe("https://shop.example/order/abc123")
  })
})

describe("qrSvg", () => {
  it("returns an inline SVG", async () => {
    const svg = await qr.qrSvg("https://shop.example/order/abc123")
    expect(svg).toContain("<svg")
    expect(svg).toContain("</svg>")
  })

  it("differs for different tokens", async () => {
    expect(await qr.qrSvg("a")).not.toBe(await qr.qrSvg("b"))
  })
})

describe("qrPngBuffer", () => {
  it("returns a PNG buffer", async () => {
    const buf = await qr.qrPngBuffer("https://shop.example/order/abc123")
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- orderQr`
Expected: FAIL.

- [ ] **Step 4: Implement QR generation**

Create `backend/shop/orders/qr.js`:

```js
const QRCode = require("qrcode")

const SITE_URL = () => process.env.SITE_URL || ""

/** The QR encodes the buyer-facing URL, so any phone camera opens the order. */
function orderUrl(token) {
  return `${SITE_URL()}/order/${token}`
}

// Derived from the token on demand — never stored, so no disk cost.
const qrSvg = (text) => QRCode.toString(text, { type: "svg", margin: 1, width: 220 })
const qrPngBuffer = (text) => QRCode.toBuffer(text, { type: "png", margin: 1, width: 320 })

module.exports = { orderUrl, qrSvg, qrPngBuffer }
```

- [ ] **Step 5: Add the SVG route**

In `backend/routes/orders.js`:

```js
const qr = require("../shop/orders/qr")
```

```js
  router.get("/:token/qr.svg", async (req, res) => {
    try {
      res.set("X-Robots-Tag", "noindex, nofollow")

      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      res.type("image/svg+xml").send(await qr.qrSvg(qr.orderUrl(order.order_token)))
    } catch (err) {
      console.error("[ORDERS] Lỗi tạo QR:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })
```

- [ ] **Step 6: Attach the QR to emails**

In `backend/shop/email/sender.js`, add `const qr = require("./../orders/qr")` and extend the `sendMail` call:

```js
      // cid: attachment rather than a data URI (Gmail strips those) or a remote
      // URL (blocked by default in many clients).
      const png = await qr.qrPngBuffer(qr.orderUrl(order.order_token))

      await getTransport().sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: row.to_email,
        subject: rendered.subject,
        html: `${rendered.html}
          <div style="text-align:center;margin-top:16px">
            <img src="cid:orderqr" alt="QR đơn hàng" width="160" height="160">
            <p style="font-size:12px;color:#888">Đưa mã này khi nhận hàng tại sự kiện</p>
          </div>`,
        attachments: [{ filename: "order-qr.png", content: png, cid: "orderqr" }],
      })
```

- [ ] **Step 7: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- orderQr`
Expected: PASS, 4 tests.

- [ ] **Step 8: Verify the QR really resolves**

Place an order, open `/api/orders/<token>/qr.svg`, scan it with a phone camera, and confirm it opens that exact order page. Then check the emailed QR renders in MailDev and scans too.

- [ ] **Step 9: Commit**

```bash
git add backend/shop/orders/qr.js backend/routes/orders.js backend/shop/email/sender.js \
        backend/package.json backend/package-lock.json backend/tests/orderQr.test.js
git commit -F - <<'EOF'
feat(orders): add order QR

Each order gets a QR encoding its buyer-facing URL, derived from the token on
demand and never stored, so it costs no disk and needs no table.

Its real purpose is event pickup: rather than searching a queue by name at the
booth, the seller scans the buyer's phone and the order opens immediately.

Emails carry the QR as a cid: attachment rather than a data URI, which Gmail
strips, or a remote URL, which many clients block by default. The order page
serves it as an inline SVG so it stays crisp at any size.
EOF
```

---

### Task 10: Block deleting variants with pending orders

Closes the gap recorded in Plan 2's self-review: deleting a variant that holds a live reservation leaves stock that can never be returned.

**Files:**
- Modify: `backend/shop/catalogRepo.js`, `backend/routes/adminCatalog.js`
- Test: `backend/tests/variantDeleteGuard.test.js`

**Interfaces:**
- `catalogRepo` exports `variantsWithPendingOrders(variantIds): Promise<number[]>`.
- `replaceVariants` throws `VariantInUseError` when asked to remove such a variant.
- Admin variant save returns `409 variant_in_use`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/variantDeleteGuard.test.js`:

```js
const { describe, it, expect, beforeEach } = require("vitest")
const db = require("../db")
const catalog = require("../shop/catalogRepo")
const orders = require("../shop/orders/orderRepo")
const settings = require("../shop/payments/settingsRepo")
const { resetTables } = require("./helpers/db")

async function seed() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }, { label: "A2", stock_qty: 5 }])
  const [rows] = await db.query("SELECT id, label FROM product_variants ORDER BY label")
  return { pid, a1: rows[0], a2: rows[1] }
}

const place = (variantId) => orders.createOrder({
  items: [{ variant_id: variantId, qty: 1 }],
  buyer: { buyer_name: "A", phone: "09", email: "a@example.com", address_raw: "x" },
  fulfillment_method: "ship", payment_method: "bank",
})

beforeEach(async () => {
  await resetTables("email_queue", "order_items", "orders", "product_variants", "products", "collections")
  await db.query("DELETE FROM payment_settings")
  await settings.updateSettings({
    bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
    bank_account_number: "1", bank_account_holder: "A",
  })
})

describe("variant deletion guard", () => {
  it("refuses to delete a variant with a pending order", async () => {
    const { pid, a1, a2 } = await seed()
    await place(a1.id)

    await expect(
      catalog.replaceVariants(pid, [{ id: a2.id, label: "A2", stock_qty: 5 }])
    ).rejects.toThrow(catalog.VariantInUseError)

    const [rows] = await db.query("SELECT id FROM product_variants")
    expect(rows).toHaveLength(2) // nothing removed
  })

  it("allows deletion once the order is cancelled", async () => {
    const { pid, a1, a2 } = await seed()
    const o = await place(a1.id)
    await orders.transitionOrder(o.id, "cancelled")

    await catalog.replaceVariants(pid, [{ id: a2.id, label: "A2", stock_qty: 5 }])
    const [rows] = await db.query("SELECT label FROM product_variants")
    expect(rows.map((r) => r.label)).toEqual(["A2"])
  })

  it("allows deletion once the order is completed", async () => {
    const { pid, a1, a2 } = await seed()
    const o = await place(a1.id)
    await orders.transitionOrder(o.id, "confirmed")
    await orders.transitionOrder(o.id, "shipped")
    await orders.transitionOrder(o.id, "completed")

    await catalog.replaceVariants(pid, [{ id: a2.id, label: "A2", stock_qty: 5 }])
    const [rows] = await db.query("SELECT label FROM product_variants")
    expect(rows.map((r) => r.label)).toEqual(["A2"])
  })

  it("still allows editing a variant that has a pending order", async () => {
    const { pid, a1, a2 } = await seed()
    await place(a1.id)

    await catalog.replaceVariants(pid, [
      { id: a1.id, label: "A1", stock_qty: 99 },
      { id: a2.id, label: "A2", stock_qty: 5 },
    ])
    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [a1.id])
    expect(v.stock_qty).toBe(99)
  })

  it("blocks a confirmed order too, since its stock is still committed", async () => {
    const { pid, a1, a2 } = await seed()
    const o = await place(a1.id)
    await orders.transitionOrder(o.id, "confirmed")

    await expect(
      catalog.replaceVariants(pid, [{ id: a2.id, label: "A2", stock_qty: 5 }])
    ).rejects.toThrow(catalog.VariantInUseError)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 npm test -- variantDeleteGuard`
Expected: FAIL — deletions currently succeed.

- [ ] **Step 3: Add the guard**

In `backend/shop/catalogRepo.js`, add near the top:

```js
class VariantInUseError extends Error {
  constructor(labels) {
    super(`Không thể xóa phân loại đang có đơn hàng: ${labels.join(", ")}`)
    this.name = "VariantInUseError"
    this.labels = labels
  }
}

const LIVE_ORDER_STATUSES = ["pending", "confirmed", "shipped"]

/** Variant ids referenced by an order that is not yet finished or cancelled. */
async function variantsWithLiveOrders(variantIds) {
  if (!variantIds.length) return []
  const [rows] = await db.query(
    `SELECT DISTINCT oi.product_variant_id AS id, v.label
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN product_variants v ON v.id = oi.product_variant_id
      WHERE o.status IN (?, ?, ?)
        AND oi.product_variant_id IN (${variantIds.map(() => "?").join(",")})`,
    [...LIVE_ORDER_STATUSES, ...variantIds]
  )
  return rows
}
```

Inside `replaceVariants`, before opening the transaction:

```js
  // A variant holding a live reservation must not be deleted: order_items uses
  // SET NULL so the history survives, but the reserved stock could then never
  // be returned when that order is cancelled.
  const [current] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [productId])
  const keeping = new Set(list.map((v) => v.id).filter(Boolean))
  const removing = current.map((r) => r.id).filter((id) => !keeping.has(id))

  const blocked = await variantsWithLiveOrders(removing)
  if (blocked.length) throw new VariantInUseError(blocked.map((b) => b.label))
```

Export `VariantInUseError` and `variantsWithLiveOrders`.

- [ ] **Step 4: Surface it in the admin route**

In `backend/routes/adminCatalog.js`, in the variants handler:

```js
      await repo.replaceVariants(Number(req.params.id), variants)
```
wrap so the error becomes a 409:

```js
      try {
        await repo.replaceVariants(Number(req.params.id), variants)
      } catch (err) {
        if (err instanceof repo.VariantInUseError) {
          return res.status(409).json({ error: "variant_in_use", message: err.message })
        }
        throw err
      }
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 npm test -- variantDeleteGuard`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/shop/catalogRepo.js backend/routes/adminCatalog.js \
        backend/tests/variantDeleteGuard.test.js
git commit -F - <<'EOF'
fix(shop): refuse to delete variants with live orders

Closes the gap recorded in plan 2's self-review. order_items references
variants with SET NULL, so deleting one preserved the order history, but the
stock that order had reserved could then never be returned when it was
cancelled — the inventory would silently drift.

Deletion is blocked while any order referencing the variant is pending,
confirmed or shipped, and allowed once every such order is completed or
cancelled. Editing a variant's label or stock is still permitted throughout;
only removal is restricted.

The admin returns 409 naming the offending variants, so the seller can see
which codes are holding orders rather than being told the save failed.
EOF
```

---

### Task 11: Frontend — payment, proof, QR, admin

**Files:**
- Modify: `frontend/src/pages/Order.jsx`, `frontend/src/pages/Checkout.jsx`, `frontend/src/api/shop.js`
- Create: `frontend/src/components/shop/PaymentInstructions.jsx`
- Create: `frontend/src/components/AdminPaymentSettings.jsx`
- Create: `frontend/src/components/AdminEmailTemplates.jsx`
- Create: `frontend/src/components/AdminQrScanner.jsx`
- Modify: `frontend/src/components/AdminOrders.jsx`, `frontend/src/pages/Admin.jsx`, `frontend/src/i18n/translations.js`

- [ ] **Step 1: Install the QR decoder**

Run: `cd frontend && npm install jsqr@^1.4.0`

`jsqr` is ~45KB and used only on the admin scan route; `html5-qrcode` (~300KB) was rejected for size since the buyer bundle must stay small.

- [ ] **Step 2: Add API calls**

Append to `frontend/src/api/shop.js`:

```js
export const fetchPaymentMethods = () =>
  api.get("/api/shop/payment-methods").then((r) => r.data)

export const fetchPaymentInstructions = (token) =>
  api.get(`/api/orders/${token}/payment`).then((r) => r.data)

export const uploadPaymentProof = (token, base64) =>
  api.post(`/api/orders/${token}/proof`, { base64 }).then((r) => r.data)

export const adminGetPaymentSettings = () =>
  api.get("/api/admin/payment-settings").then((r) => r.data)

export const adminSavePaymentSettings = (data) =>
  api.put("/api/admin/payment-settings", data).then((r) => r.data)

export const adminListEmailTemplates = () =>
  api.get("/api/admin/email-templates").then((r) => r.data)

export const adminSaveEmailTemplate = (type, data) =>
  api.put(`/api/admin/email-templates/${type}`, data).then((r) => r.data)
```

Note: the email-template admin routes need adding to `backend/routes/adminPayments.js` (or a new `adminEmail.js`) using `templates.getTemplate` / `upsertTemplate`, rejecting a save whose `validatePlaceholders` result is non-empty with `400`. Write that route with the same test-first pattern as Task 3 before wiring this UI.

- [ ] **Step 3: Filter checkout to enabled methods**

In `frontend/src/pages/Checkout.jsx`, replace the hardcoded `PAYMENT_METHODS` with a fetch:

```jsx
const [methods, setMethods] = useState([])
useEffect(() => {
  fetchPaymentMethods()
    .then((d) => { setMethods(d.methods); setPayment(d.methods[0] || "") })
    .catch(() => setMethods([]))
}, [])
```

Render the select from `methods`, and disable submit when `methods.length === 0` with a message telling the buyer to contact the seller. A shop with no payment method configured must not silently accept orders it cannot collect.

- [ ] **Step 4: Create the payment instructions component**

Create `frontend/src/components/shop/PaymentInstructions.jsx` rendering, per method:
- **bank** — bank name, account number, holder, amount, the transfer note prominently, and the VietQR rendered from `vietqr_payload` via a client-side QR component or the `/qr.svg` pattern. Include a copy-to-clipboard button for the account number and the note.
- **momo** — phone, holder, uploaded QR image if present, amount, note.
- **paypal** — link button, amount.
- **cod** — amount due on delivery, no account details.

Always show `payment_note` when present. When `vietqr_payload` is `null`, show the printed details with a line explaining the QR is unavailable — never a blank box.

- [ ] **Step 5: Add proof upload and QR to the order page**

In `frontend/src/pages/Order.jsx`:
- Render `<PaymentInstructions />` when `order.status === "pending"` and the method is not COD.
- Show a file input that base64-encodes and calls `uploadPaymentProof`, with a thumbnail once uploaded and a "replace" affordance.
- Hide the upload entirely once `status !== "pending"`.
- Render the order QR from `/api/orders/${token}/qr.svg` with the caption about showing it at pickup.

- [ ] **Step 6: Create the admin payment settings UI**

Create `frontend/src/components/AdminPaymentSettings.jsx` — toggles per method, the fields each requires, a Momo QR image upload reusing `adminUploadImage`, and the shared payment note. Show the validation message returned by the API rather than inventing client-only rules. Do **not** render the reserved SePay fields; they are not wired to anything.

- [ ] **Step 7: Create the admin email template editor**

Create `frontend/src/components/AdminEmailTemplates.jsx` — one editor per type with subject and body, a visible list of valid placeholders, and a save that surfaces the `400` placeholder error naming the bad token. Include a "restore default" action that repopulates from the shipped default.

- [ ] **Step 8: Create the admin QR scanner**

Create `frontend/src/components/AdminQrScanner.jsx`:

```jsx
import { useEffect, useRef, useState } from "react"

/**
 * Uses the native BarcodeDetector where available and falls back to jsQR,
 * because iOS Safari does not implement BarcodeDetector. Loaded only on this
 * route so it never reaches the buyer bundle.
 */
export default function AdminQrScanner({ onToken, onClose }) {
  const videoRef = useRef(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let stream, raf, cancelled = false

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        if (cancelled) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()

        const detector = "BarcodeDetector" in window
          ? new window.BarcodeDetector({ formats: ["qr_code"] })
          : null
        const jsQR = detector ? null : (await import("jsqr")).default
        const canvas = document.createElement("canvas")
        const ctx = canvas.getContext("2d", { willReadFrequently: true })

        const tick = async () => {
          if (cancelled || !videoRef.current?.videoWidth) {
            raf = requestAnimationFrame(tick)
            return
          }
          let value = null
          if (detector) {
            const [found] = await detector.detect(videoRef.current)
            value = found?.rawValue
          } else {
            canvas.width = videoRef.current.videoWidth
            canvas.height = videoRef.current.videoHeight
            ctx.drawImage(videoRef.current, 0, 0)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            value = jsQR(img.data, img.width, img.height)?.data
          }

          // The QR holds the public order URL; extract the token and let the
          // caller open the authenticated admin view instead.
          const token = value?.match(/\/order\/([0-9a-f]{32})/)?.[1]
          if (token) return onToken(token)

          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch (e) {
        setError(e.name === "NotAllowedError" ? "Cần cho phép truy cập camera" : "Không mở được camera")
      }
    }

    start()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onToken])

  return (
    <div className="fixed inset-0 bg-black/80 flex flex-col items-center justify-center z-50 p-4">
      {error
        ? <p className="text-white mb-4">{error}</p>
        : <video ref={videoRef} playsInline muted className="max-w-full rounded-xl" />}
      <button type="button" onClick={onClose} className="mt-4 px-4 py-2 rounded-lg bg-white text-black">
        Đóng
      </button>
    </div>
  )
}
```

- [ ] **Step 9: Wire the scanner and proof display into admin orders**

In `AdminOrders.jsx`: add a "Quét QR" button opening the scanner; on token, look the order up and open its detail. In the detail panel, render `payment_proof_url` inline when present so the seller can confirm at a glance, plus the payment method and transfer note.

- [ ] **Step 10: Add tabs and translations**

Add "Thanh toán" and "Email" tabs in `Admin.jsx`; add all new UI strings to both `en` and `vi` in `translations.js`.

- [ ] **Step 11: Verify**

Run:
```bash
cd frontend && npm test && npm run build && npm run lint
cd ../backend && DB_PORT=3307 npm test
```
Expected: all pass. Then manually: configure bank in admin → place an order → scan the VietQR with a real banking app → upload a proof screenshot → confirm in admin → check the email in MailDev → scan the order QR with the admin scanner.

- [ ] **Step 12: Commit**

```bash
git add frontend/src backend/routes frontend/package.json frontend/package-lock.json
git commit -F - <<'EOF'
feat(shop): add payment, proof, QR and settings UI

Checkout now offers only the methods the seller has enabled, fetched from the
API rather than hardcoded, and refuses to submit when none are configured
instead of accepting an order nobody can collect.

The order page shows method-specific instructions: a scannable VietQR with the
amount and transfer note for bank, account details for Momo, a link for PayPal,
and an amount due for COD. When a VietQR cannot be built the printed details
are shown with an explanation rather than an empty box.

Proof upload is offered only while an order is pending, matching the API.

The admin scanner prefers the native BarcodeDetector and falls back to jsQR for
iOS Safari, loaded only on that route so the ~45KB never reaches the buyer
bundle. It extracts the token from the scanned public URL and opens the
authenticated admin view rather than the read-only buyer page.
EOF
```

---

### Task 12: Nightly backups

**Files:**
- Create: `deploy/backup.sh`
- Create: `deploy/restore.sh`
- Modify: `deploy/DEPLOY.md`

**Interfaces:** a host cron entry running `deploy/backup.sh` nightly.

- [ ] **Step 1: Write the backup script**

Create `deploy/backup.sh`:

```bash
#!/bin/sh
# Nightly MySQL backup with retention.
# Orders are financial and dispute-resolution records; DEPLOY.md previously
# only recommended backups and nothing was implemented.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/cosplay}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_NAME="${DB_NAME:-cosplay}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/${DB_NAME}-${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

docker compose exec -T mysql mysqldump \
  -uroot -p"$DB_PASS" \
  --single-transaction --quick --routines --triggers \
  "$DB_NAME" | gzip > "$OUT"

# A zero-length or truncated dump is worse than no dump, because it looks like
# a backup. Fail loudly instead.
if [ ! -s "$OUT" ]; then
  echo "[BACKUP] FAILED: $OUT is empty" >&2
  rm -f "$OUT"
  exit 1
fi

if ! gzip -t "$OUT"; then
  echo "[BACKUP] FAILED: $OUT is corrupt" >&2
  rm -f "$OUT"
  exit 1
fi

find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete

echo "[BACKUP] OK $OUT ($(du -h "$OUT" | cut -f1))"
```

- [ ] **Step 2: Write the restore script**

Create `deploy/restore.sh`:

```bash
#!/bin/sh
# Restore a dump into a scratch database so it can be verified without
# touching production. Usage: ./restore.sh <dump.sql.gz> [target_db]
set -eu

DUMP="$1"
TARGET="${2:-cosplay_restore_test}"

[ -f "$DUMP" ] || { echo "No such dump: $DUMP" >&2; exit 1; }

docker compose exec -T mysql mysql -uroot -p"$DB_PASS" \
  -e "DROP DATABASE IF EXISTS \`$TARGET\`; CREATE DATABASE \`$TARGET\`;"

gunzip -c "$DUMP" | docker compose exec -T mysql mysql -uroot -p"$DB_PASS" "$TARGET"

echo "[RESTORE] Restored into $TARGET. Verifying:"
docker compose exec -T mysql mysql -uroot -p"$DB_PASS" "$TARGET" -e "
  SELECT 'orders' AS t, COUNT(*) AS n FROM orders
  UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
  UNION ALL SELECT 'products', COUNT(*) FROM products
  UNION ALL SELECT 'variants', COUNT(*) FROM product_variants
  UNION ALL SELECT 'sum_totals', COALESCE(SUM(total),0) FROM orders;"
```

- [ ] **Step 3: Make them executable and install cron**

```bash
chmod +x deploy/backup.sh deploy/restore.sh
```

On the server, add to root's crontab (`crontab -e`):
```
0 3 * * * cd /opt/cosplay && DB_PASS='<password>' ./deploy/backup.sh >> /var/log/cosplay-backup.log 2>&1
```

- [ ] **Step 4: Perform the restore drill**

This is the acceptance criterion — a backup that has never been restored does not count.

```bash
./deploy/backup.sh
ls -lh /var/backups/cosplay/
./deploy/restore.sh /var/backups/cosplay/<newest>.sql.gz
```

Confirm the printed counts and the order-total sum match production:
```bash
docker compose exec -T mysql mysql -uroot -p"$DB_PASS" cosplay -e \
  "SELECT COUNT(*), COALESCE(SUM(total),0) FROM orders;"
```

Record the restore wall-clock time. Then drop the scratch database.

- [ ] **Step 5: Document it**

In `deploy/DEPLOY.md`, replace the line that merely recommends backups with a section covering: what is backed up and how often, where dumps live, the retention window, how to restore, and a note that the restore drill should be repeated quarterly.

- [ ] **Step 6: Commit**

```bash
git add deploy/backup.sh deploy/restore.sh deploy/DEPLOY.md
git commit -F - <<'EOF'
feat(deploy): add nightly database backups with a restore path

DEPLOY.md previously only recommended backups and nothing was implemented.
Losing gallery photos is unfortunate; losing order records means unresolvable
disputes with buyers who have already paid.

backup.sh dumps with --single-transaction so it does not lock the site, then
verifies the result is non-empty and passes a gzip integrity check before
pruning old files. A truncated dump is worse than no dump, because it looks
like a backup until the day it is needed.

restore.sh restores into a scratch database and prints row counts and the sum
of order totals, so the drill can be run against production data without
touching production. A backup that has never been restored is not a backup.

Retention is 14 days, a few MB per dump, negligible against a 50GB disk.
Off-site copies remain a deliberate later decision: this protects against
corruption, bad migrations and accidental deletion, not against losing the
droplet entirely.
EOF
```

---

## Self-Review

**Spec coverage for Plan 3's slice:**

| Requirement | Task |
|---|---|
| `payment_settings` as its own table | 1 |
| Bank details + dynamically generated VietQR | 2, 4 |
| Momo (phone or static QR), PayPal link, COD toggle | 1, 3, 4 |
| Per-method enable/disable controlling checkout | 3, 11 |
| Payment proof upload, pending only | 5 |
| Email templates seeded with polished HTML defaults, admin-editable | 6, 11 |
| Placeholder validation | 6, 11 |
| SMTP via env vars only | 7 |
| Async email that cannot roll back an order | 7, 8 |
| Vietnamese-only email | 6 |
| Order QR: inline SVG + `cid:` email attachment | 9 |
| Admin QR scanner, lazy-loaded, BarcodeDetector + jsQR | 11 |
| Nightly `mysqldump`, 14-day retention | 12 |
| Reserved auto-confirm columns, no integration | 1 |
| Plan 2 gap: variant deletion with live orders | 10 |

**Deliberately out of scope:** SePay/Momo/PayPal automatic confirmation (columns reserved, no integration); off-site backup copies; Phase 4 statistics dashboard; Phase 5 ViettelPost automation; Phase 6 onboarding guide.

**Type consistency:** money stays integer VND through `buildInstructions`, `vietqr` (which rejects non-integers), and the email formatter; `order_token` is 32 hex chars in `qr.orderUrl`, the scanner regex, and every route; email `type` values match across `DEFAULT_TEMPLATES`, `email_queue.type`, `TRANSITION_EMAILS`, and the admin editor.

**Two manual checks that cannot be automated, and must not be skipped:**
1. **Task 2 Step 5** — the VietQR must be scanned with a real Vietnamese banking app. Unit tests prove the encoding is self-consistent; only a bank app proves it is correct.
2. **Task 12 Step 4** — the restore drill.

**Carried risk:** payment confirmation remains fully manual, so a seller who does not check the admin leaves buyers waiting. Automatic confirmation is the obvious next phase, and the reserved columns plus the method-agnostic confirm step mean adding it will not require changing the order model.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-merch-shop-3-payments.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.
