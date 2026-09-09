# Admin Payment-Proof-Uploaded Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin's current (wrongly-framed, buyer-copy) new-order email with a single, purpose-built `payment_proof_uploaded` email template, sent when a buyer uploads their transfer screenshot - the actual moment an order needs admin attention.

**Architecture:** A fifth entry in `shop/email/templates.js`'s `DEFAULT_TEMPLATES` map (auto-registered with the existing admin CRUD routes/UI, no new plumbing needed there), rendered through the existing `wrap()`/`buildVars()`/`renderTemplate()` pipeline with two new placeholders (`admin_url`, `payment_proof_image`). `sender.js` gains an `ADMIN_EMAIL_TYPES` set so admin-audience templates skip the two buyer-only blocks (PIN reminder, QR/pickup-code) it always spliced in before. Two existing admin-copy trigger sites are removed; one new trigger is added at the proof-upload route.

**Tech Stack:** Node/Express backend (CommonJS), MySQL via mysql2/knex, Vitest, React frontend (no changes needed to build/test tooling).

## Global Constraints

- Admin ends up with exactly **one** automated email type: `payment_proof_uploaded`. No other admin-notification trigger is added or kept.
- New placeholders: `admin_url` (`${SITE_URL}/admin`) and `payment_proof_image` (an `<img>` tag embedding `order.payment_proof_url`, ~320px wide).
- `wrap()`'s CTA button text stays exactly `"Xem đơn hàng →"` for every template, including this one.
- `ADMIN_EMAIL_TYPES = new Set(["payment_proof_uploaded"])` in `shop/email/sender.js`.
- Every enqueue to `ADMIN_EMAIL` stays guarded by `if (process.env.ADMIN_EMAIL)` and wrapped in its own try/catch (a queue failure must never fail the buyer-facing request that triggered it).

---

### Task 1: Add the `payment_proof_uploaded` template to `templates.js`

**Files:**
- Modify: `backend/shop/email/templates.js`
- Test: `backend/tests/emailTemplates.test.js`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `DEFAULT_TEMPLATES.payment_proof_uploaded` (subject/body_html pair), `buildVars(order).admin_url`, `buildVars(order).payment_proof_image`, `PLACEHOLDERS` includes `"admin_url"` and `"payment_proof_image"`. `wrap(inner, ctaUrlVar = "order_url")` - existing four callers unaffected (they omit the second argument), this task's new call passes `"admin_url"`. Later tasks (sender.js, orders.js) rely on the template type string `"payment_proof_uploaded"` matching exactly.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/emailTemplates.test.js`, after the existing `describe("digital delivery link", ...)` block (before `describe("validatePlaceholders", ...)`):

```javascript
describe("payment_proof_uploaded (admin template)", () => {
  const orderWithProof = (overrides = {}) => ({
    ...order,
    payment_proof_url: "/api/storage/shop/proofs/12/abc.webp",
    ...overrides,
  })

  it("buildVars computes admin_url from SITE_URL", () => {
    const vars = t.buildVars(orderWithProof())
    expect(vars.admin_url).toBe(`${process.env.SITE_URL || ""}/admin`)
  })

  it("buildVars embeds the proof screenshot as an <img> pointing at SITE_URL + payment_proof_url", () => {
    const vars = t.buildVars(orderWithProof())
    expect(vars.payment_proof_image).toContain("<img")
    expect(vars.payment_proof_image).toContain(`${process.env.SITE_URL || ""}/api/storage/shop/proofs/12/abc.webp`)
  })

  it("buildVars renders no <img> when there is no proof yet", () => {
    const vars = t.buildVars(orderWithProof({ payment_proof_url: null }))
    expect(vars.payment_proof_image).not.toContain("<img")
  })

  it("renders the default template with the order code, buyer name, and embedded proof image", () => {
    const out = t.renderTemplate(t.DEFAULT_TEMPLATES.payment_proof_uploaded, t.buildVars(orderWithProof()))
    expect(out.html).toContain("Nguyễn Văn A")
    expect(out.html).toContain("Mã đơn hàng")
    expect(out.html).toContain("<img")
  })

  it("the CTA button links to admin_url, not the buyer's order_url", () => {
    const out = t.renderTemplate(t.DEFAULT_TEMPLATES.payment_proof_uploaded, t.buildVars(orderWithProof()))
    expect(out.html).toContain(`href="${process.env.SITE_URL || ""}/admin"`)
  })

  it("uses only valid placeholders", () => {
    const tpl = t.DEFAULT_TEMPLATES.payment_proof_uploaded
    expect(t.validatePlaceholders(tpl.subject + tpl.body_html)).toEqual([])
  })
})
```

Also extend the existing `describe("DEFAULT_TEMPLATES", ...)` block's coverage test - find this test:

```javascript
  it("covers every lifecycle email", () => {
    expect(Object.keys(t.DEFAULT_TEMPLATES).sort())
      .toEqual(["cancelled", "order_placed", "payment_confirmed", "shipped"])
  })
```

and change its expected array to:

```javascript
  it("covers every lifecycle email", () => {
    expect(Object.keys(t.DEFAULT_TEMPLATES).sort())
      .toEqual(["cancelled", "order_placed", "payment_confirmed", "payment_proof_uploaded", "shipped"])
  })
```

The two tests immediately below it (`"uses only valid placeholders"` looping `Object.entries(t.DEFAULT_TEMPLATES)`, and `"renders every default without throwing"`) already iterate every key generically - no change needed there, they'll cover the new entry automatically. Same for `"shows the order code in the body of every lifecycle email"` - leave as-is, it also loops every type generically and this template does include `{{order_id}}` via `wrap()`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/emailTemplates.test.js`

Expected: FAIL - `t.DEFAULT_TEMPLATES.payment_proof_uploaded` is `undefined`, `vars.admin_url`/`vars.payment_proof_image` are `undefined`, and the "covers every lifecycle email" test's array mismatch.

- [ ] **Step 3: Implement**

In `backend/shop/email/templates.js`:

1. Add the two new placeholder names to the `PLACEHOLDERS` array (top of file):

```javascript
const PLACEHOLDERS = [
  "order_id", "order_token", "order_url", "buyer_name", "total", "items",
  "status", "payment_method", "fulfillment_method", "tracking_code",
  "payment_note", "shop_name", "receiver_info", "shipping_fee_note", "prep_note",
  "admin_url", "payment_proof_image",
]
```

2. Parameterize `wrap()` so its CTA button can point at a different placeholder name:

```javascript
// Header bar + card, shared by every template so the order code/receiver
// info/link show up the same way everywhere without each one repeating them.
// ctaUrlVar names the placeholder the "Xem đơn hàng" button links to -
// "order_url" (the buyer's own order page) for every buyer-facing template,
// "admin_url" for the admin-facing payment_proof_uploaded template below.
const wrap = (inner, ctaUrlVar = "order_url") => `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;background:#fff">
  <div style="background:${BRAND};padding:18px 24px;border-radius:12px 12px 0 0">
    <span style="color:#fff;font-size:17px;font-weight:700">{{shop_name}}</span>
  </div>
  <div style="padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;color:#222;font-size:14px;line-height:1.6">
    <p style="margin:0 0 14px;font-size:13px;color:#888">Mã đơn hàng: <strong style="color:#222">{{order_id}}</strong></p>
    ${inner}
    {{receiver_info}}
    <p style="margin:20px 0 0;font-size:14px">Trân trọng,<br/>{{shop_name}}</p>
    <div style="margin:24px 0 0;padding-top:16px;border-top:1px solid #eee;text-align:center">
      <a href="{{${ctaUrlVar}}}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px">Xem đơn hàng →</a>
    </div>
  </div>
</div>`
```

3. Add two new fields to `buildVars`'s return object (inside the existing `function buildVars(order) { ... }`, alongside the other fields - insert after the `receiver_info:` line):

```javascript
    receiver_info: receiverInfoHtml(order),
    admin_url: `${SITE_URL}/admin`,
    payment_proof_image: order.payment_proof_url
      ? `<img src="${escapeHtml(SITE_URL + order.payment_proof_url)}" style="max-width:320px;width:100%;border-radius:8px;display:block;margin-top:8px" />`
      : "",
```

4. Add the new template to `DEFAULT_TEMPLATES` (after the existing `cancelled` entry, before the closing `}`):

```javascript
  payment_proof_uploaded: {
    subject: "Đơn #{{order_id}} vừa gửi ảnh chuyển khoản",
    body_html: wrap(`
      <p style="margin:0 0 12px"><strong>{{buyer_name}}</strong> vừa tải ảnh chuyển khoản cho đơn hàng này - kiểm tra và xác nhận khi có thể.</p>
      {{items}}
      ${TOTAL_ROW}
      {{payment_proof_image}}`, "admin_url"),
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/emailTemplates.test.js`

Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
cd /Users/phucth/vibes/cosplay-portfolio
git add backend/shop/email/templates.js backend/tests/emailTemplates.test.js
git commit -m "feat(shop): add payment_proof_uploaded admin email template"
```

---

### Task 2: Gate buyer-only blocks out of admin-audience emails in `sender.js`

**Files:**
- Modify: `backend/shop/email/sender.js`
- Test: `backend/tests/sender.test.js`

**Interfaces:**
- Consumes: template type string `"payment_proof_uploaded"` from Task 1.
- Produces: `ADMIN_EMAIL_TYPES` (a `Set`) exported from nowhere new (module-internal is fine - nothing outside `sender.js` needs to read it). Behavior: a queued row whose `type` is in `ADMIN_EMAIL_TYPES` renders without the PIN-reminder paragraph and without the QR code attachment/caption; every other type's rendering is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/sender.test.js`, as a new `describe` block (place it after the existing pickup-location describe block, before `describe("sendQueued: PIN reminder on later lifecycle emails", ...)` - or at the end of the file, either works since describes are independent):

```javascript
describe("sendQueued: admin-audience emails skip buyer-only blocks", () => {
  it("renders payment_proof_uploaded with no PIN reminder and no QR attachment", async () => {
    const o = await seedOrder("ship")
    await queue.enqueue(o.id, "payment_proof_uploaded", "seller@example.com")

    await sender.sendQueued()

    const call = sendMailMock.mock.calls[0][0]
    expect(call.html).not.toContain("Nếu trang yêu cầu mã PIN")
    expect(call.html).not.toContain("Mã QR đơn hàng")
    expect(call.attachments.some((a) => a.cid === "orderqr")).toBe(false)
  })

  it("still gives order_placed its PIN block and QR attachment (unaffected by the new gating)", async () => {
    const o = await seedOrder("ship")
    await queue.enqueue(o.id, "order_placed", "buyer@example.com", { access_pin: "123456" })

    await sender.sendQueued()

    const call = sendMailMock.mock.calls[0][0]
    expect(call.html).toContain("123456")
    expect(call.attachments.some((a) => a.cid === "orderqr")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/sender.test.js -t "admin-audience"`

Expected: FAIL on the first test - `call.html` contains `"Nếu trang yêu cầu mã PIN"` (the reminder is currently spliced into every non-`order_placed` type) and `call.attachments` contains the QR attachment.

- [ ] **Step 3: Implement**

In `backend/shop/email/sender.js`, add near the top (after the `let transport = null` line):

```javascript
// Templates in this set are sent to the admin, not a buyer - the PIN
// reminder and QR/pickup-code block below are both meaningless to someone
// who accesses orders via their own admin login, not a PIN or a printed QR.
const ADMIN_EMAIL_TYPES = new Set(["payment_proof_uploaded"])
```

Then wrap the existing PIN if/else block (currently unconditional) in a guard. Find:

```javascript
      // access_pin_hash is one-way, so the plaintext only exists here.
      if (row.type === "order_placed") {
        let payload
        try { payload = JSON.parse(row.payload) } catch { payload = null }
        if (payload?.access_pin) {
          html = spliceBeforeCardClose(html, `
            <p style="margin:12px 0 0;font-size:13px">
              Mã PIN xác thực đơn hàng: <strong style="color:${templates.BRAND}">${templates.escapeHtml(payload.access_pin)}</strong><br/>
              <span style="font-size:12px;color:#888">Cần mã này để xem lại đơn hàng qua link nếu trang yêu cầu xác thực.</span>
            </p>`)
        }
      } else {
        html = spliceBeforeCardClose(html, `
          <p style="margin:12px 0 0;font-size:12px;color:#888">
            Nếu trang yêu cầu mã PIN, mã đã được gửi trong email xác nhận lúc bạn đặt hàng.
          </p>`)
      }
```

Replace with:

```javascript
      // access_pin_hash is one-way, so the plaintext only exists here.
      if (!ADMIN_EMAIL_TYPES.has(row.type)) {
        if (row.type === "order_placed") {
          let payload
          try { payload = JSON.parse(row.payload) } catch { payload = null }
          if (payload?.access_pin) {
            html = spliceBeforeCardClose(html, `
              <p style="margin:12px 0 0;font-size:13px">
                Mã PIN xác thực đơn hàng: <strong style="color:${templates.BRAND}">${templates.escapeHtml(payload.access_pin)}</strong><br/>
                <span style="font-size:12px;color:#888">Cần mã này để xem lại đơn hàng qua link nếu trang yêu cầu xác thực.</span>
              </p>`)
          }
        } else {
          html = spliceBeforeCardClose(html, `
            <p style="margin:12px 0 0;font-size:12px;color:#888">
              Nếu trang yêu cầu mã PIN, mã đã được gửi trong email xác nhận lúc bạn đặt hàng.
            </p>`)
        }
      }
```

Then wrap the QR block. Find:

```javascript
      // Included even for a cancelled order, so the buyer can still check its final state.
      {
        // cid: attachment rather than a data URI (Gmail strips those) or a
        // remote URL (blocked by default in many clients).
        const png = await qr.qrPngBuffer(qr.orderUrl(order.order_token))
        // A ship order's QR is just a convenient link to the order page - no
        // pickup instructions apply, so it gets a plain, ungated caption.
        const caption = !isPickup
          ? `<p style="font-size:12px;color:#888">Mã QR đơn hàng</p>`
          : isPaid
            ? `
            <p style="font-size:12px;color:#888">Đưa mã này khi nhận hàng tại sự kiện</p>
            ${order.pickup_code ? `
            <p style="font-size:14px;margin-top:8px">
              Mã xác nhận nhận hàng: <strong>${order.pickup_code}</strong>
            </p>
            <p style="font-size:12px;color:#888">
              Nếu không quét được mã QR (mạng yếu tại sự kiện), hãy đọc mã này cho nhân viên.
            </p>` : ""}`
            : `<p style="font-size:12px;color:#888">Mã QR đơn hàng - hướng dẫn nhận hàng sẽ hiển thị sau khi đơn được xác nhận thanh toán.</p>`
        html += `
          <div style="text-align:center;margin-top:16px">
            <img src="cid:orderqr" alt="QR đơn hàng" width="160" height="160">
            ${caption}
          </div>`
        attachments.push({ filename: "order-qr.png", content: png, cid: "orderqr" })
      }
```

Replace with:

```javascript
      // Included even for a cancelled order, so the buyer can still check its
      // final state - but never for an admin-audience email (no reason for
      // the seller to scan their own shop's order QR).
      if (!ADMIN_EMAIL_TYPES.has(row.type)) {
        // cid: attachment rather than a data URI (Gmail strips those) or a
        // remote URL (blocked by default in many clients).
        const png = await qr.qrPngBuffer(qr.orderUrl(order.order_token))
        // A ship order's QR is just a convenient link to the order page - no
        // pickup instructions apply, so it gets a plain, ungated caption.
        const caption = !isPickup
          ? `<p style="font-size:12px;color:#888">Mã QR đơn hàng</p>`
          : isPaid
            ? `
            <p style="font-size:12px;color:#888">Đưa mã này khi nhận hàng tại sự kiện</p>
            ${order.pickup_code ? `
            <p style="font-size:14px;margin-top:8px">
              Mã xác nhận nhận hàng: <strong>${order.pickup_code}</strong>
            </p>
            <p style="font-size:12px;color:#888">
              Nếu không quét được mã QR (mạng yếu tại sự kiện), hãy đọc mã này cho nhân viên.
            </p>` : ""}`
            : `<p style="font-size:12px;color:#888">Mã QR đơn hàng - hướng dẫn nhận hàng sẽ hiển thị sau khi đơn được xác nhận thanh toán.</p>`
        html += `
          <div style="text-align:center;margin-top:16px">
            <img src="cid:orderqr" alt="QR đơn hàng" width="160" height="160">
            ${caption}
          </div>`
        attachments.push({ filename: "order-qr.png", content: png, cid: "orderqr" })
      }
```

Leave everything else in `sendQueued` (the `cancel_reason` splice, `footerHtml()` append, the `sendMail` call) untouched - `cancel_reason` is already conditioned on `order.status === "cancelled"`, which a `payment_proof_uploaded` row can never have (it only fires against a `pending` order).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/sender.test.js`

Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
cd /Users/phucth/vibes/cosplay-portfolio
git add backend/shop/email/sender.js backend/tests/sender.test.js
git commit -m "feat(shop): skip PIN reminder and QR block for admin-audience emails"
```

---

### Task 3: Rewire the triggers - remove both old admin copies, add the new one

**Files:**
- Modify: `backend/routes/orders.js`
- Modify: `backend/shop/orders/orderRepo.js`
- Test: `backend/tests/emailTriggers.test.js`
- Test: `backend/tests/paymentProof.test.js`

**Interfaces:**
- Consumes: template type string `"payment_proof_uploaded"` (Task 1), `emailQueue.enqueue(orderId, type, toEmail, payload = null)` (existing, `backend/shop/email/queue.js` - unchanged signature).
- Produces: nothing new for later tasks - this is the last backend task.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/emailTriggers.test.js`, the test `"queues a copy to the admin when ADMIN_EMAIL is set"` (inside `describe("order placed", ...)`) currently asserts the old behavior. Replace it:

```javascript
  it("does not copy order_placed to the admin, even when ADMIN_EMAIL is set", async () => {
    process.env.ADMIN_EMAIL = "seller@example.com"
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))

    expect((await queued()).some((r) => r.to_email === "seller@example.com")).toBe(false)
    delete process.env.ADMIN_EMAIL
  })
```

Similarly, the test `"copies payment_confirmed to the admin when ADMIN_EMAIL is set"` (inside `describe("lifecycle transitions", ...)`) currently asserts the old behavior. Replace it:

```javascript
  it("does not copy payment_confirmed to the admin, even when ADMIN_EMAIL is set", async () => {
    process.env.ADMIN_EMAIL = "seller@example.com"
    try {
      const v = await seedVariant()
      await request(app).post("/api/orders").send(body(v))
      const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")
      await db.query("DELETE FROM email_queue") // drop the order_placed copies

      await orders.transitionOrder(o.id, "confirmed")

      const rows = await queued()
      expect(rows.some((r) => r.type === "payment_confirmed" && r.to_email === "buyer@example.com")).toBe(true)
      expect(rows.some((r) => r.to_email === "seller@example.com")).toBe(false)
    } finally {
      delete process.env.ADMIN_EMAIL
    }
  })
```

The two tests right after it (`"does not copy shipped to the admin..."`, `"does not copy cancelled to the admin..."`) already assert the correct (unchanged) behavior for those statuses - leave them as-is.

In `backend/tests/paymentProof.test.js`, add a new `describe` block at the end of the file (after the existing `describe("GET /api/orders/:token - has_payment_proof", ...)` block):

```javascript
describe("POST /api/orders/:token/proof - admin notification", () => {
  it("queues payment_proof_uploaded to ADMIN_EMAIL on a successful upload", async () => {
    process.env.ADMIN_EMAIL = "seller@example.com"
    try {
      const o = await seedOrder()
      await authed(request(app).post(`/api/orders/${o.order_token}/proof`)).send({ base64: await png() })

      const [rows] = await db.query(
        "SELECT type, to_email FROM email_queue WHERE order_id = ? AND type = 'payment_proof_uploaded'",
        [o.id]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].to_email).toBe("seller@example.com")
    } finally {
      delete process.env.ADMIN_EMAIL
    }
  })

  it("queues nothing when ADMIN_EMAIL is unset", async () => {
    delete process.env.ADMIN_EMAIL
    const o = await seedOrder()
    await authed(request(app).post(`/api/orders/${o.order_token}/proof`)).send({ base64: await png() })

    const [rows] = await db.query(
      "SELECT id FROM email_queue WHERE order_id = ? AND type = 'payment_proof_uploaded'",
      [o.id]
    )
    expect(rows).toHaveLength(0)
  })

  it("still returns 201 and stores the proof even if enqueueing the admin email fails", async () => {
    process.env.ADMIN_EMAIL = "seller@example.com"
    await db.query("RENAME TABLE email_queue TO email_queue_disabled_for_test")
    try {
      const o = await seedOrder()
      const res = await authed(request(app).post(`/api/orders/${o.order_token}/proof`)).send({ base64: await png() })
      expect(res.status).toBe(201)

      const [[row]] = await db.query("SELECT payment_proof_url FROM orders WHERE id = ?", [o.id])
      expect(row.payment_proof_url).toBeTruthy()
    } finally {
      await db.query("RENAME TABLE email_queue_disabled_for_test TO email_queue")
      delete process.env.ADMIN_EMAIL
    }
  })
})
```

This last test needs `db` and `request`/`app` already imported at the top of `paymentProof.test.js` - confirm they are (they are, per the existing file's imports: `db`, `request`, `app`, and `orders`/`catalog`/`settings` are already present).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/emailTriggers.test.js tests/paymentProof.test.js`

Expected: FAIL - the two rewritten `emailTriggers.test.js` tests fail because the old code still copies to admin; the three new `paymentProof.test.js` tests fail because nothing is enqueued yet on proof upload (first test: 0 rows instead of 1; third test's assertion on `payment_proof_url` alone would actually pass already, so that one may show as passing prematurely - that's fine, it becomes a genuine regression guard once Step 3 adds the enqueue call next to the code it's guarding).

- [ ] **Step 3: Implement**

**3a. Remove the `order_placed` admin copy** in `backend/routes/orders.js`. Find:

```javascript
      if (!order.reused) {
        try {
          // access_pin only goes to the buyer's own copy - admin already
          // bypasses the PIN gate via their own login, so their copy has no
          // use for it and shouldn't carry it into an inbox that doesn't need it.
          await emailQueue.enqueue(order.id, "order_placed", req.body.buyer.email, { access_pin: order.access_pin })
          if (process.env.ADMIN_EMAIL) {
            await emailQueue.enqueue(order.id, "order_placed", process.env.ADMIN_EMAIL)
          }
        } catch (err) {
          console.error("[ORDERS] Không xếp được email đơn mới:", err.message)
```

Replace with:

```javascript
      if (!order.reused) {
        try {
          await emailQueue.enqueue(order.id, "order_placed", req.body.buyer.email, { access_pin: order.access_pin })
        } catch (err) {
          console.error("[ORDERS] Không xếp được email đơn mới:", err.message)
```

(The `access_pin` comment is removed along with the code it was explaining - the admin no longer has a copy to explain the omission on.)

**3b. Add the `payment_proof_uploaded` trigger** in `backend/routes/orders.js`'s proof-upload route. Find:

```javascript
      await db.query(
        "UPDATE orders SET payment_proof_url = ?, payment_proof_uploaded_at = NOW() WHERE id = ?",
        [url, order.id]
      )
      console.log(`[ORDERS] Đã nhận ảnh chuyển khoản cho đơn ${order.id}`)
      res.status(201).json({ url })
```

Replace with:

```javascript
      await db.query(
        "UPDATE orders SET payment_proof_url = ?, payment_proof_uploaded_at = NOW() WHERE id = ?",
        [url, order.id]
      )
      console.log(`[ORDERS] Đã nhận ảnh chuyển khoản cho đơn ${order.id}`)

      // Best-effort, after the proof is already stored: a mail failure must
      // not fail an upload the buyer already completed successfully.
      if (process.env.ADMIN_EMAIL) {
        try {
          await emailQueue.enqueue(order.id, "payment_proof_uploaded", process.env.ADMIN_EMAIL)
        } catch (err) {
          console.error("[ORDERS] Không xếp được email báo admin:", err.message)
        }
      }

      res.status(201).json({ url })
```

Confirm `emailQueue` is already imported at the top of `routes/orders.js` (it is - the order-creation route above already uses it).

**3c. Remove the `payment_confirmed` admin copy** in `backend/shop/orders/orderRepo.js`. Find the variable declaration:

```javascript
  let ok = false
  let notifyEmailType = null
  let notifyAddress = null
  let notifyAdminType = null
```

Replace with:

```javascript
  let ok = false
  let notifyEmailType = null
  let notifyAddress = null
```

Find:

```javascript
    // payment_confirmed goes to buyer + admin (spec Notifications section);
    // shipped/cancelled/expired stay buyer-only, so this is confirmed-only.
    if (toStatus === "confirmed" && extra.notify !== false && process.env.ADMIN_EMAIL) {
      notifyAdminType = TRANSITION_EMAILS.confirmed
    }
```

Delete this block entirely (no replacement).

Find:

```javascript
  if (notifyAdminType) {
    try {
      await emailQueue.enqueue(id, notifyAdminType, process.env.ADMIN_EMAIL)
    } catch (err) {
      console.error("[ORDERS] Không xếp được email cho admin:", err.message)
    }
  }

  return ok
```

Replace with:

```javascript
  return ok
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/emailTriggers.test.js tests/paymentProof.test.js`

Expected: PASS (all tests in both files).

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run`

Expected: PASS, no failures anywhere in the suite (confirms nothing else in the codebase depended on the removed `notifyAdminType` mechanism or the old admin copy behavior).

- [ ] **Step 6: Commit**

```bash
cd /Users/phucth/vibes/cosplay-portfolio
git add backend/routes/orders.js backend/shop/orders/orderRepo.js backend/tests/emailTriggers.test.js backend/tests/paymentProof.test.js
git commit -m "feat(shop): admin gets payment_proof_uploaded instead of order_placed/payment_confirmed copies"
```

---

### Task 4: Wire the new template into the admin email editor UI

**Files:**
- Modify: `frontend/src/components/AdminEmailTemplates.jsx`

**Interfaces:**
- Consumes: template type string `"payment_proof_uploaded"` (Task 1) and the two new placeholder names `"admin_url"`/`"payment_proof_image"` (Task 1) - this task only needs the string literals, no runtime import from the backend.
- Produces: nothing consumed by other tasks - this is the last task in the plan.

No test file exists for this component today, and this is a two-line data change to two existing hardcoded maps (mirroring backend constants, per the file's own existing comment) - verified by manual inspection in Step 2 rather than new test infrastructure, matching how the other four entries in these same maps are (not) tested.

- [ ] **Step 1: Add the new template's label and placeholder names**

In `frontend/src/components/AdminEmailTemplates.jsx`, find:

```javascript
const LABELS = {
  order_placed: "Đã nhận đơn hàng",
  payment_confirmed: "Đã xác nhận thanh toán",
  shipped: "Đã gửi hàng",
  cancelled: "Đã hủy đơn",
}
```

Replace with:

```javascript
const LABELS = {
  order_placed: "Đã nhận đơn hàng",
  payment_confirmed: "Đã xác nhận thanh toán",
  shipped: "Đã gửi hàng",
  cancelled: "Đã hủy đơn",
  payment_proof_uploaded: "Admin: đã tải ảnh chuyển khoản",
}
```

(The `"Admin: "` prefix distinguishes this from the four buyer-facing entries in the same dropdown/list, since it's the only one that isn't sent to the buyer.)

Find:

```javascript
// Mirrors backend/shop/email/templates.js PLACEHOLDERS - shown so the seller
// knows what's available without guessing or reading source.
const PLACEHOLDERS = [
  "order_id", "order_token", "order_url", "buyer_name", "total", "items",
  "status", "payment_method", "fulfillment_method", "tracking_code",
  "payment_note", "shop_name", "receiver_info", "shipping_fee_note", "prep_note",
]
```

Replace with:

```javascript
// Mirrors backend/shop/email/templates.js PLACEHOLDERS - shown so the seller
// knows what's available without guessing or reading source.
const PLACEHOLDERS = [
  "order_id", "order_token", "order_url", "buyer_name", "total", "items",
  "status", "payment_method", "fulfillment_method", "tracking_code",
  "payment_note", "shop_name", "receiver_info", "shipping_fee_note", "prep_note",
  "admin_url", "payment_proof_image",
]
```

- [ ] **Step 2: Verify manually**

Run the full stack locally (`docker compose up -d --build` from the repo root, or `node server.js` + `npm run dev` per `CLAUDE.md`), log into `/admin`, open the email templates screen, and confirm:
- A fifth entry labeled "Admin: đã tải ảnh chuyển khoản" appears alongside the four buyer templates.
- Opening it shows the default subject/body from Task 1, and the placeholder reference list includes `admin_url` and `payment_proof_image`.
- Editing and saving it round-trips correctly (same save flow the other four already use - no new code path introduced).

- [ ] **Step 3: Run the frontend suite and lint**

Run: `cd frontend && npm test -- --run && npx eslint src/components/AdminEmailTemplates.jsx`

Expected: PASS, no lint errors (this file has no existing test suite to break, and the change is two literal-array edits).

- [ ] **Step 4: Commit**

```bash
cd /Users/phucth/vibes/cosplay-portfolio
git add frontend/src/components/AdminEmailTemplates.jsx
git commit -m "feat(shop): list the payment_proof_uploaded template in the admin email editor"
```

---

## Final Verification

After all four tasks:

1. Full backend suite: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run` - expect all files passing.
2. Full frontend suite: `cd frontend && npm test -- --run` - expect all files passing.
3. Grep for any remaining reference to the removed admin-copy mechanism, to confirm nothing was missed: `grep -rn "notifyAdminType" backend/` should return nothing.
4. Update `docs/EDGE_CASE_CHECKLIST.md` with an entry describing the fix (two wrongly-framed/wrongly-timed admin copies replaced with one purpose-built trigger) - matches this project's established convention of logging every fix there, not just committing code.
5. `bash scripts/build-push.sh staging` to push the updated images, per this project's established workflow (never push to production).
