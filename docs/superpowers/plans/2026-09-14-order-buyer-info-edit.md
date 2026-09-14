# Order Buyer-Info Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin (any order status) and the buyer themselves (only while `pending`) correct an order's name/phone/email/note/address, emailing the buyer exactly what changed every time.

**Architecture:** One shared `orderRepo.updateBuyerInfo(id, fields, opts)` function, called by two new routes (admin, unrestricted by status; buyer, behind the existing PIN/session gate and restricted to `pending`). A new `order_updated` email template renders a static greeting; the actual list of changed fields is spliced into the HTML at send time in `sender.js`, the same technique already used for `cancel_reason`.

**Tech Stack:** Node/Express, MySQL via mysql2, React/Vite, Vitest.

## Global Constraints

- Editable fields: `buyer_name`, `phone`, `email`, `note`, and the shipping address - **address is edited as a single free-text `address_raw` field, not the structured province/ward picker** (`AddressFields.jsx` has no mechanism to reverse-map a stored province/ward *name* back to the picker's codes, and building that is out of scope here). `address_street`/`address_ward`/`address_district`/`address_province` are never touched by this feature - they stay exactly as captured at checkout.
- Admin can edit at any order status. Buyer can only edit while `status === 'pending'`.
- Every actual change (diff non-empty) triggers one `order_updated` email to the address on record *after* the update. No email, no DB write, if nothing actually changed.
- Not editable through this feature: items, quantities, price, payment method, `tracking_code`, `shipping_fee`, `cancel_reason` (all already covered elsewhere).
- Address is edited/diffed as one field (`address_raw`) - a change there produces exactly one diff entry, not five.
- Connection-holding discipline: mirror `transitionOrder`'s exact shape - commit and release the connection *before* enqueueing the notification email (a documented invariant in this codebase; see `orderRepo.js`'s comment on `transitionOrder` and `docs/EDGE_CASE_CHECKLIST.md` item 45 on why).
- Plain hyphens, never em dashes, in all new code/comments/copy.
- Vietnamese-only strings for backend error messages and email copy (matches every existing error class/template in this codebase - no bilingual i18n on the backend). Frontend UI strings go through the existing `t()`/`translations.js` mechanism with both `vi`/`en` entries.

---

### Task 1: `orderRepo.updateBuyerInfo` core logic

**Files:**
- Modify: `backend/shop/orders/orderRepo.js`
- Test: `backend/tests/orderRepo.test.js`

**Interfaces:**
- Produces: `async function updateBuyerInfo(id, fields, { requirePending = false } = {})` → `null` if no such order; on success `{ changed: false }` (nothing actually differed) or `{ changed: true, order: <full order row via getOrderById> }`. Throws `OrderNotEditableError` (only when `requirePending` and `order.status !== 'pending'`) or `InvalidBuyerInfoError` (validation failure, carries a Vietnamese `.message`). `fields` shape: `{ buyer_name, phone, email, note, address_raw }` (all optional/strings; `note`/`address_raw` may be empty to mean "clear it").
- Consumes: nothing from other tasks - this task is self-contained business logic. Later tasks (2-4) call this function and its two new error classes.

- [ ] **Step 1: Write the failing tests**

Add near the top of `backend/tests/orderRepo.test.js`, after the existing `order` helper (reuses the file's existing `seedVariant`/`seedDigitalVariant`/`buyer` fixtures already in this file):

```js
async function orderWithBuyer(over = {}) {
  const { variantId } = await seedVariant(5)
  return repo.createOrder(order(variantId, 1, over))
}
```

Add this new `describe` block at the end of the file:

```js
describe("updateBuyerInfo", () => {
  it("updates changed fields and returns the diff-driven changed:true result", async () => {
    const res = await orderWithBuyer()
    const result = await repo.updateBuyerInfo(res.id, {
      buyer_name: "Nguyễn Văn B", phone: "0911111111", email: "b@example.com",
      note: "Giao giờ hành chính", address_raw: "2 Đường XYZ, Q2, TP.HCM",
    })
    expect(result.changed).toBe(true)
    expect(result.order.buyer_name).toBe("Nguyễn Văn B")
    expect(result.order.phone).toBe("0911111111")
    expect(result.order.email).toBe("b@example.com")
    expect(result.order.note).toBe("Giao giờ hành chính")
    expect(result.order.address_raw).toBe("2 Đường XYZ, Q2, TP.HCM")
  })

  it("leaves address_street/ward/district/province untouched even when address_raw changes", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1, {
      buyer: { ...buyer, address_street: "1 Đường ABC", address_ward: "Phường 1", address_district: "Q1", address_province: "TP.HCM" },
    }))
    await repo.updateBuyerInfo(res.id, { buyer_name: "A", phone: "09", email: "a@example.com", address_raw: "Địa chỉ mới" })

    const [[row]] = await db.query("SELECT * FROM orders WHERE id = ?", [res.id])
    expect(row.address_raw).toBe("Địa chỉ mới")
    expect(row.address_street).toBe("1 Đường ABC")
    expect(row.address_ward).toBe("Phường 1")
  })

  it("does nothing and reports changed:false when the submitted values are identical to what's stored", async () => {
    const res = await orderWithBuyer()
    const result = await repo.updateBuyerInfo(res.id, {
      buyer_name: buyer.buyer_name, phone: buyer.phone, email: buyer.email,
      note: null, address_raw: buyer.address_raw,
    })
    expect(result).toEqual({ changed: false })

    const [rows] = await db.query("SELECT id FROM email_queue")
    expect(rows).toHaveLength(0)
  })

  it("enqueues an order_updated email to the (post-update) email address, carrying the diff as payload", async () => {
    const res = await orderWithBuyer()
    await repo.updateBuyerInfo(res.id, {
      buyer_name: "Nguyễn Văn B", phone: buyer.phone, email: "new@example.com",
      note: null, address_raw: buyer.address_raw,
    })

    const [[row]] = await db.query("SELECT * FROM email_queue WHERE order_id = ? AND type = 'order_updated'", [res.id])
    expect(row).toBeTruthy()
    expect(row.to_email).toBe("new@example.com")
    const payload = JSON.parse(row.payload)
    expect(payload.changes.some((c) => c.field === "buyer_name" && c.old === buyer.buyer_name && c.new === "Nguyễn Văn B")).toBe(true)
    expect(payload.changes.some((c) => c.field === "email" && c.old === buyer.email && c.new === "new@example.com")).toBe(true)
    expect(payload.changes.some((c) => c.field === "phone")).toBe(false) // unchanged
  })

  it("rejects a blank buyer_name", async () => {
    const res = await orderWithBuyer()
    await expect(
      repo.updateBuyerInfo(res.id, { buyer_name: "  ", phone: "09", email: "a@example.com" })
    ).rejects.toThrow(repo.InvalidBuyerInfoError)
  })

  it("rejects an invalid email", async () => {
    const res = await orderWithBuyer()
    await expect(
      repo.updateBuyerInfo(res.id, { buyer_name: "A", phone: "09", email: "not-an-email" })
    ).rejects.toThrow(repo.InvalidBuyerInfoError)
  })

  it("returns null for a non-existent order id", async () => {
    const result = await repo.updateBuyerInfo(999999, { buyer_name: "A", phone: "09", email: "a@example.com" })
    expect(result).toBeNull()
  })

  it("allows the admin call (no requirePending) to edit a cancelled order", async () => {
    const res = await orderWithBuyer()
    await repo.transitionOrder(res.id, "cancelled")
    const result = await repo.updateBuyerInfo(res.id, { buyer_name: "Sửa sau khi hủy", phone: "09", email: "a@example.com" })
    expect(result.changed).toBe(true)
  })

  it("rejects the buyer path (requirePending: true) once the order is no longer pending", async () => {
    const res = await orderWithBuyer()
    await repo.transitionOrder(res.id, "confirmed")
    await expect(
      repo.updateBuyerInfo(res.id, { buyer_name: "A", phone: "09", email: "a@example.com" }, { requirePending: true })
    ).rejects.toThrow(repo.OrderNotEditableError)
  })

  it("allows the buyer path while the order is still pending", async () => {
    const res = await orderWithBuyer()
    const result = await repo.updateBuyerInfo(res.id, { buyer_name: "Sửa bởi khách", phone: "09", email: "a@example.com" }, { requirePending: true })
    expect(result.changed).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root REDIS_HOST=127.0.0.1 REDIS_PORT=6380 npx vitest run tests/orderRepo.test.js -t "updateBuyerInfo"`
Expected: FAIL - `repo.updateBuyerInfo is not a function`

- [ ] **Step 3: Implement in `backend/shop/orders/orderRepo.js`**

Add near the top, alongside the other error class definitions (after `FulfillmentRequiredError`):

```js
class InvalidBuyerInfoError extends Error {
  constructor(message) {
    super(message)
    this.name = "InvalidBuyerInfoError"
  }
}

/** Only ever thrown by the buyer-facing edit path (requirePending: true) - the admin path has no status restriction. */
class OrderNotEditableError extends Error {
  constructor() {
    super("Đơn hàng không còn ở trạng thái chờ thanh toán nên không thể chỉnh sửa.")
    this.name = "OrderNotEditableError"
  }
}
```

Add this constant near the top of the file (same level as `TRANSITION_EMAILS`):

```js
// Same regex as routes/orders.js's own buyer-field validation at create time.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const BUYER_INFO_LABELS = {
  buyer_name: "Tên người nhận",
  phone: "Số điện thoại",
  email: "Email",
  note: "Ghi chú",
  address_raw: "Địa chỉ nhận hàng",
}
```

Add the function itself, after `transitionOrder` and before `releaseExpiredOrders`:

```js
/**
 * Corrects an order's contact/address/note fields after it was placed -
 * admin (no requirePending) or the buyer themselves (requirePending: true,
 * only while the order is still 'pending'). Diffs against the row's current
 * values; a no-op diff makes no DB write and enqueues no email. Address is
 * edited/diffed as the single address_raw field - address_street/ward/
 * district/province are never touched here (see plan's Global Constraints
 * for why: AddressFields.jsx has no way to turn a stored name back into a
 * picker code).
 *
 * Mirrors transitionOrder's connection discipline: commit and release the
 * connection before enqueueing the notification email - a mail-layer issue
 * must never hold a pool connection open, and must never roll back a change
 * the caller already made.
 */
async function updateBuyerInfo(id, fields, { requirePending = false } = {}) {
  let result = null
  let notifyEmail = null
  let notifyChanges = null

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [[order]] = await conn.query("SELECT * FROM orders WHERE id = ? FOR UPDATE", [id])
    if (!order) {
      await conn.rollback()
      return null
    }

    if (requirePending && order.status !== "pending") {
      await conn.rollback()
      throw new OrderNotEditableError()
    }

    const buyerName = String(fields.buyer_name ?? "").trim()
    const phone = String(fields.phone ?? "").trim()
    const email = String(fields.email ?? "").trim()
    const note = fields.note === undefined || fields.note === null || fields.note === "" ? null : String(fields.note)
    const addressRaw = fields.address_raw === undefined || fields.address_raw === null || fields.address_raw === ""
      ? null : String(fields.address_raw)

    if (!buyerName) throw new InvalidBuyerInfoError("Cần họ tên")
    if (!phone) throw new InvalidBuyerInfoError("Cần số điện thoại")
    if (!email || !EMAIL_RE.test(email)) throw new InvalidBuyerInfoError("Email không hợp lệ")
    if (order.fulfillment_method === "ship" && !addressRaw) {
      throw new InvalidBuyerInfoError("Cần địa chỉ nhận hàng")
    }

    const diff = []
    const pushIfChanged = (field, oldVal, newVal) => {
      if ((oldVal || "") !== (newVal || "")) diff.push({ field, label: BUYER_INFO_LABELS[field], old: oldVal, new: newVal })
    }
    pushIfChanged("buyer_name", order.buyer_name, buyerName)
    pushIfChanged("phone", order.phone, phone)
    pushIfChanged("email", order.email, email)
    pushIfChanged("note", order.note, note)
    if (order.fulfillment_method === "ship") {
      pushIfChanged("address_raw", order.address_raw, addressRaw)
    }

    if (diff.length === 0) {
      await conn.commit()
      result = { changed: false }
    } else {
      await conn.query(
        "UPDATE orders SET buyer_name = ?, phone = ?, email = ?, note = ?, address_raw = ? WHERE id = ?",
        [buyerName, phone, email, note, order.fulfillment_method === "ship" ? addressRaw : order.address_raw, id]
      )
      await conn.commit()
      notifyEmail = email
      notifyChanges = diff
    }
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  if (notifyChanges) {
    try {
      await emailQueue.enqueue(id, "order_updated", notifyEmail, { changes: notifyChanges })
    } catch (err) {
      console.error("[ORDERS] Không xếp được email order_updated:", err.message)
    }
    result = { changed: true, order: await getOrderById(id) }
  }

  return result
}
```

- [ ] **Step 4: Add the new exports**

In `backend/shop/orders/orderRepo.js`'s `module.exports` block, add `updateBuyerInfo, InvalidBuyerInfoError, OrderNotEditableError,` alongside the existing exports.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root REDIS_HOST=127.0.0.1 REDIS_PORT=6380 npx vitest run tests/orderRepo.test.js -t "updateBuyerInfo"`
Expected: PASS (10/10)

- [ ] **Step 6: Run the full `orderRepo.test.js` file to confirm no regression**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root REDIS_HOST=127.0.0.1 REDIS_PORT=6380 npx vitest run tests/orderRepo.test.js`
Expected: PASS - every pre-existing test still green.

- [ ] **Step 7: Commit**

```bash
git add backend/shop/orders/orderRepo.js backend/tests/orderRepo.test.js
git commit -m "feat(shop): add orderRepo.updateBuyerInfo for correcting an order's contact/address info"
```

---

### Task 2: `order_updated` email template + sender.js splice

**Files:**
- Modify: `backend/shop/email/templates.js`
- Modify: `backend/shop/email/sender.js`
- Test: `backend/tests/emailTemplates.test.js`
- Test: `backend/tests/sender.test.js`

**Interfaces:**
- Consumes: `email_queue.payload` shaped `{ changes: [{ field, label, old, new }] }` (Task 1's `updateBuyerInfo` is what writes this).
- Produces: nothing consumed by later tasks - this closes the email-rendering half of the feature. `DEFAULT_TEMPLATES.order_updated` becomes visible in the admin template editor automatically (`adminEmail.js`'s `TYPES` list is derived from `Object.keys(DEFAULT_TEMPLATES)` - no route change needed).

- [ ] **Step 1: Write the failing template test**

Add to `backend/tests/emailTemplates.test.js`'s existing `describe("renderTemplate", ...)` block:

```js
it("renders the order_updated template's static greeting", () => {
  const out = t.renderTemplate(t.DEFAULT_TEMPLATES.order_updated, t.buildVars(order))
  expect(out.subject).toContain("đã được cập nhật")
  expect(out.html).toContain("thông tin đơn hàng của bạn vừa được cập nhật")
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root REDIS_HOST=127.0.0.1 REDIS_PORT=6380 npx vitest run tests/emailTemplates.test.js -t "order_updated"`
Expected: FAIL - `t.DEFAULT_TEMPLATES.order_updated` is undefined, `subject` is undefined.

- [ ] **Step 3: Add the template to `DEFAULT_TEMPLATES` in `backend/shop/email/templates.js`**

Add after the existing `payment_proof_uploaded` entry (still inside the `DEFAULT_TEMPLATES` object, before its closing `}`):

```js
  order_updated: {
    subject: "Thông tin đơn #{{order_id}} đã được cập nhật",
    body_html: wrap(`
      <p style="margin:0 0 12px">Chào <strong>{{buyer_name}}</strong>, thông tin đơn hàng của bạn vừa được cập nhật.</p>`),
  },
```

- [ ] **Step 4: Run the template test to verify it passes**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root REDIS_HOST=127.0.0.1 REDIS_PORT=6380 npx vitest run tests/emailTemplates.test.js`
Expected: PASS (all, including the new test)

- [ ] **Step 5: Write the failing sender tests**

Add to `backend/tests/sender.test.js`, as a new `describe` block (modeled directly on the neighboring `cancel_reason` tests - same `seedOrder`/`sendMailMock` fixtures already in this file):

```js
describe("sendQueued: order_updated changed-fields list", () => {
  it("splices in every changed field from the payload, right after the greeting", async () => {
    const o = await seedOrder("ship")
    await orders.updateBuyerInfo(o.id, { buyer_name: "Nguyễn Văn B", phone: "09", email: "a@example.com", address_raw: "x" })

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).toContain("Tên người nhận")
    expect(sentArg.html).toContain("Nguyễn Văn B")
  })

  it("does not mention a field that did not change", async () => {
    const o = await seedOrder("ship")
    await orders.updateBuyerInfo(o.id, { buyer_name: "Nguyễn Văn B", phone: "09", email: "a@example.com", address_raw: "x" })

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).not.toContain("Số điện thoại")
  })

  it("escapes HTML in a changed value", async () => {
    const o = await seedOrder("ship")
    await orders.updateBuyerInfo(o.id, { buyer_name: "<script>alert(1)</script>", phone: "09", email: "a@example.com", address_raw: "x" })

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).not.toContain("<script>")
    expect(sentArg.html).toContain("&lt;script&gt;")
  })

  it("places the changes list ahead of the link, same as cancel_reason", async () => {
    const o = await seedOrder("ship")
    await orders.updateBuyerInfo(o.id, { buyer_name: "Nguyễn Văn B", phone: "09", email: "a@example.com", address_raw: "x" })

    await sender.sendQueued()

    const html = sendMailMock.mock.calls[0][0].html
    const greetingIndex = html.indexOf("vừa được cập nhật")
    const changeIndex = html.indexOf("Nguyễn Văn B")
    const linkIndex = html.indexOf("Xem đơn hàng")
    expect(changeIndex).toBeGreaterThan(greetingIndex)
    expect(changeIndex).toBeLessThan(linkIndex)
  })
})
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root REDIS_HOST=127.0.0.1 REDIS_PORT=6380 npx vitest run tests/sender.test.js -t "order_updated"`
Expected: FAIL - the changed-fields list never appears (nothing splices it in yet).

- [ ] **Step 7: Implement the splice in `backend/shop/email/sender.js`**

Replace this existing block (inside the `for (const row of pending)` loop):

```js
      // access_pin_hash is one-way, so the plaintext only exists here.
      if (!ADMIN_EMAIL_TYPES.has(row.type)) {
        if (row.type === "order_placed") {
          let payload
          try { payload = JSON.parse(row.payload) } catch { payload = null }
          if (payload?.access_pin) {
```

with:

```js
      let payload
      try { payload = JSON.parse(row.payload) } catch { payload = null }

      // access_pin_hash is one-way, so the plaintext only exists here.
      if (!ADMIN_EMAIL_TYPES.has(row.type)) {
        if (row.type === "order_placed") {
          if (payload?.access_pin) {
```

(This only hoists the `let payload; try {...}` two lines up one level and deletes their old, now-duplicate copy - everything else in that `if` stays exactly as it was.)

Then, immediately after the existing `cancel_reason` splice block (the `if (order.status === "cancelled" && order.cancel_reason) { ... }` block), add:

```js
      // Same reasoning as cancel_reason above: a fixed set of changed fields
      // (zero to five optional lines) can't be expressed as a template
      // placeholder, so it's spliced in directly - right after the
      // greeting, ahead of the link, same insertion point.
      if (row.type === "order_updated" && payload?.changes?.length) {
        const rows = payload.changes.map((c) => `
          <p style="font-size:14px;margin:4px 0 0">
            <strong>${templates.escapeHtml(c.label)}:</strong> ${templates.escapeHtml(c.old || "-")} → ${templates.escapeHtml(c.new || "-")}
          </p>`).join("")
        const firstP = html.indexOf("</p>")
        const greetingClose = firstP === -1 ? -1 : html.indexOf("</p>", firstP + 1)
        html = greetingClose === -1
          ? html + rows
          : html.slice(0, greetingClose + "</p>".length) + rows + html.slice(greetingClose + "</p>".length)
      }
```

- [ ] **Step 8: Run sender tests to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root REDIS_HOST=127.0.0.1 REDIS_PORT=6380 npx vitest run tests/sender.test.js`
Expected: PASS - every pre-existing test in this file still green, plus the 4 new ones.

- [ ] **Step 9: Run the full backend suite**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root REDIS_HOST=127.0.0.1 REDIS_PORT=6380 npm test`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add backend/shop/email/templates.js backend/shop/email/sender.js backend/tests/emailTemplates.test.js backend/tests/sender.test.js
git commit -m "feat(shop): add order_updated email template with a spliced changed-fields list"
```

---

### Task 3: Admin route

**Files:**
- Modify: `backend/routes/adminOrders.js`
- Test: `backend/tests/adminOrderRoutes.test.js`

**Interfaces:**
- Consumes: `repo.updateBuyerInfo` (Task 1), `repo.InvalidBuyerInfoError` (Task 1).
- Produces: `PUT /api/admin/orders/:id/buyer-info` → `{ changed: false }` or `{ changed: true, order: <full order row, withAllowedTransitions-shaped> }`. Consumed by Task 5's frontend.

- [ ] **Step 1: Write the failing tests**

Find this file's existing `seedOrder`/fixture helpers (`grep -n "async function seed" backend/tests/adminOrderRoutes.test.js`) and reuse them. Add a new `describe` block:

```js
describe("PUT /api/admin/orders/:id/buyer-info", () => {
  it("requires auth", async () => {
    const o = await seedOrder()
    const res = await request(app).put(`/api/admin/orders/${o.id}/buyer-info`).send({ buyer_name: "A", phone: "09", email: "a@example.com" })
    expect(res.status).toBe(401)
  })

  it("updates the order and returns the new values", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).put(`/api/admin/orders/${o.id}/buyer-info`)).send({
      buyer_name: "Sửa bởi admin", phone: "0911111111", email: "new@example.com", note: null, address_raw: "x",
    })
    expect(res.status).toBe(200)
    expect(res.body.changed).toBe(true)
    expect(res.body.order.buyer_name).toBe("Sửa bởi admin")
  })

  it("succeeds even on a cancelled order - admin has no status restriction", async () => {
    const o = await seedOrder()
    await orders.transitionOrder(o.id, "cancelled")
    const res = await authed(request(app).put(`/api/admin/orders/${o.id}/buyer-info`)).send({
      buyer_name: "Sửa sau khi hủy", phone: "09", email: "a@example.com",
    })
    expect(res.status).toBe(200)
  })

  it("rejects an invalid email with 400", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).put(`/api/admin/orders/${o.id}/buyer-info`)).send({
      buyer_name: "A", phone: "09", email: "not-an-email",
    })
    expect(res.status).toBe(400)
  })

  it("404s for a non-existent order", async () => {
    const res = await authed(request(app).put("/api/admin/orders/999999/buyer-info")).send({
      buyer_name: "A", phone: "09", email: "a@example.com",
    })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root REDIS_HOST=127.0.0.1 REDIS_PORT=6380 npx vitest run tests/adminOrderRoutes.test.js -t "buyer-info"`
Expected: FAIL - 404 (route doesn't exist)

- [ ] **Step 3: Add the route to `backend/routes/adminOrders.js`**

Add after the existing `router.post("/orders/:id/transition", ...)` route:

```js
  router.put("/orders/:id/buyer-info", async (req, res) => {
    try {
      const { buyer_name, phone, email, note, address_raw } = req.body
      const result = await repo.updateBuyerInfo(Number(req.params.id), { buyer_name, phone, email, note, address_raw })
      if (result === null) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      res.json(result.changed ? { changed: true, order: withAllowedTransitions(result.order) } : { changed: false })
    } catch (err) {
      if (err instanceof repo.InvalidBuyerInfoError) {
        return res.status(400).json({ error: "invalid_input", message: err.message })
      }
      oops(res, err, "Lỗi sửa thông tin đơn hàng")
    }
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root REDIS_HOST=127.0.0.1 REDIS_PORT=6380 npx vitest run tests/adminOrderRoutes.test.js`
Expected: PASS - every pre-existing test still green, plus the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/adminOrders.js backend/tests/adminOrderRoutes.test.js
git commit -m "feat(shop): add admin PUT /orders/:id/buyer-info route"
```

---

### Task 4: Buyer route

**Files:**
- Modify: `backend/routes/orders.js`
- Test: `backend/tests/orderRoutes.test.js`

**Interfaces:**
- Consumes: `repo.updateBuyerInfo` (Task 1), `repo.InvalidBuyerInfoError`/`repo.OrderNotEditableError` (Task 1).
- Produces: `PUT /api/orders/:token/buyer-info` (behind `orderAccess`) → same response shape as Task 3's admin route, but the order is passed through `toPublicOrder` (this file's existing projection helper) not the admin shape. Consumed by Task 6's frontend.

- [ ] **Step 1: Write the failing tests**

Find this file's existing pattern for creating an order and obtaining its PIN-session auth header (grep `orders.test.js`-equivalent file for `issueOrderSessionToken`/`verify-pin` usage - reuse it exactly). Add:

```js
describe("PUT /api/orders/:token/buyer-info", () => {
  it("requires PIN/session auth", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))
    const res = await request(app).put(`/api/orders/${created.body.order_token}/buyer-info`).send({
      buyer_name: "A", phone: "09", email: "a@example.com",
    })
    expect(res.status).toBe(401)
  })

  it("allows a pending order's own buyer to update their info, using the access_token issued at checkout", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))
    const res = await request(app).put(`/api/orders/${created.body.order_token}/buyer-info`)
      .set("Authorization", `Bearer ${created.body.access_token}`)
      .send({ buyer_name: "Sửa bởi khách", phone: "09", email: "a@example.com", address_raw: "x" })
    expect(res.status).toBe(200)
    expect(res.body.changed).toBe(true)
  })

  it("rejects the edit once the order is no longer pending, with 409", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))
    const stored = await orders.getOrderByToken(created.body.order_token)
    await orders.transitionOrder(stored.id, "confirmed")
    const res = await request(app).put(`/api/orders/${created.body.order_token}/buyer-info`)
      .set("Authorization", `Bearer ${created.body.access_token}`)
      .send({ buyer_name: "A", phone: "09", email: "a@example.com" })
    expect(res.status).toBe(409)
  })

  it("also allows an admin JWT to use this route", async () => {
    const v = await seed()
    const created = await request(app).post("/api/orders").send(body(v))
    const res = await request(app).put(`/api/orders/${created.body.order_token}/buyer-info`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ buyer_name: "Sửa bởi admin qua route khách", phone: "09", email: "a@example.com" })
    expect(res.status).toBe(200)
  })
})
```

(`adminToken`/`authed`/`seed`/`body` are this file's own existing top-of-file fixtures - reuse them exactly, don't redefine. `created.body.access_token` is the same checkout-session-bypass JWT `POST /api/orders` already returns and other tests in this file already use - see the neighboring "also returns an access_token that unlocks this order's own page" test.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root REDIS_HOST=127.0.0.1 REDIS_PORT=6380 npx vitest run tests/orderRoutes.test.js -t "buyer-info"`
Expected: FAIL - 404 (route doesn't exist)

- [ ] **Step 3: Add the route to `backend/routes/orders.js`**

Add after the existing `router.post("/:token/proof", orderAccess, uploadSingleImage(), ...)` route:

```js
  router.put("/:token/buyer-info", orderAccess, async (req, res) => {
    try {
      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      const { buyer_name, phone, email, note, address_raw } = req.body
      const result = await repo.updateBuyerInfo(
        order.id,
        { buyer_name, phone, email, note, address_raw },
        { requirePending: true }
      )
      if (result === null) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      res.json(result.changed ? { changed: true, order: toPublicOrder(result.order) } : { changed: false })
    } catch (err) {
      if (err instanceof repo.InvalidBuyerInfoError) return bad(res, err.message)
      if (err instanceof repo.OrderNotEditableError) {
        return res.status(409).json({ error: "not_editable", message: err.message })
      }
      console.error("[ORDERS] Lỗi sửa thông tin đơn hàng:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root REDIS_HOST=127.0.0.1 REDIS_PORT=6380 npx vitest run tests/orderRoutes.test.js`
Expected: PASS - every pre-existing test still green, plus the 4 new ones.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root REDIS_HOST=127.0.0.1 REDIS_PORT=6380 npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/orders.js backend/tests/orderRoutes.test.js
git commit -m "feat(shop): add buyer PUT /orders/:token/buyer-info route, gated to pending"
```

---

### Task 5: Admin UI

**Files:**
- Modify: `frontend/src/api/shop.js`
- Modify: `frontend/src/components/AdminOrders.jsx`
- Modify: `frontend/src/components/AdminOrders.test.jsx`

**Interfaces:**
- Consumes: `PUT /api/admin/orders/:id/buyer-info` (Task 3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the API wrapper**

In `frontend/src/api/shop.js`, immediately after `adminTransitionOrder`:

```js
export const adminUpdateOrderBuyerInfo = (id, fields) =>
  api.put(`/api/admin/orders/${id}/buyer-info`, fields).then((r) => r.data)
```

- [ ] **Step 2: Write the failing test**

This codebase has no `@testing-library/react` - use `AdminOrders.test.jsx`'s existing `createRoot`/`act`/`renderAdminOrders()`/`flush()`/`order()` helpers (see the neighboring "shows a digital badge..." test for the exact shape). Add:

```js
it("edits and saves buyer info from the order detail panel", async () => {
  adminListOrders.mockResolvedValue([order({ id: 1 })])
  adminGetOrder.mockResolvedValue(order({ id: 1, buyer_name: "Nguyễn Văn A", phone: "0900000000", email: "a@b.com", note: null, items: [] }))
  const { container } = await renderAdminOrders()
  await flush()

  const detailBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Chi tiết")
  await act(async () => { detailBtn.click() })
  await flush()

  const editBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sửa thông tin")
  await act(async () => { editBtn.click() })
  await flush()

  const nameInput = container.querySelector('input[data-testid="edit-buyer-name"]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
  await act(async () => {
    setter.call(nameInput, "Nguyễn Văn B")
    nameInput.dispatchEvent(new Event("change", { bubbles: true }))
  })

  adminUpdateOrderBuyerInfo.mockResolvedValue({ changed: true, order: order({ id: 1, buyer_name: "Nguyễn Văn B", phone: "0900000000", email: "a@b.com", items: [] }) })
  const saveBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Lưu")
  await act(async () => { saveBtn.click() })
  await flush()

  expect(adminUpdateOrderBuyerInfo).toHaveBeenCalledWith(1, expect.objectContaining({ buyer_name: "Nguyễn Văn B" }))
  expect(container.textContent).toContain("Nguyễn Văn B")
})
```

Add `adminUpdateOrderBuyerInfo` to this file's existing top-of-file `vi.mock("../api/shop", () => ({ ... }))` block and its `vi.fn()` declarations, and reset it in `beforeEach` alongside the other mocks already reset there.

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/AdminOrders.test.jsx -t "edits and saves buyer info"`
Expected: FAIL - no "Sửa thông tin" button exists yet.

- [ ] **Step 4: Implement in `AdminOrders.jsx`**

Add state near the existing `detail`/`paymentInfo` state:

```js
const [editingBuyerInfo, setEditingBuyerInfo] = useState(false)
const [buyerInfoDraft, setBuyerInfoDraft] = useState(null)
const [buyerInfoError, setBuyerInfoError] = useState("")

const startEditBuyerInfo = () => {
  setBuyerInfoDraft({
    buyer_name: detail.buyer_name, phone: detail.phone, email: detail.email,
    note: detail.note || "", address_raw: detail.address_raw || "",
  })
  setBuyerInfoError("")
  setEditingBuyerInfo(true)
}

const saveBuyerInfo = async () => {
  setBuyerInfoError("")
  try {
    const result = await adminUpdateOrderBuyerInfo(detail.id, buyerInfoDraft)
    if (result.changed) setDetail(result.order)
    setEditingBuyerInfo(false)
  } catch (e) {
    setBuyerInfoError(e.response?.data?.message || "Lưu thất bại")
  }
}
```

Import `adminUpdateOrderBuyerInfo` alongside this file's other `../api/shop` imports.

Replace the existing buyer-info display block:

```jsx
<p className="opacity-70">{detail.email}</p>
{detail.fulfillment_method === "ship" && <p className="opacity-70">{detail.address_raw}</p>}
{detail.note && <p className="mt-1 italic opacity-70">"{detail.note}"</p>}
```

with:

```jsx
{!editingBuyerInfo ? (
  <>
    <p className="opacity-70">{detail.buyer_name} · {detail.phone} · {detail.email}</p>
    {detail.fulfillment_method === "ship" && <p className="opacity-70">{detail.address_raw}</p>}
    {detail.note && <p className="mt-1 italic opacity-70">"{detail.note}"</p>}
    <button type="button" onClick={startEditBuyerInfo} className="mt-1 text-xs underline opacity-70">
      Sửa thông tin
    </button>
  </>
) : (
  <div className="mt-2 p-3 rounded-lg border border-[var(--border-brand)]">
    {buyerInfoError && <p className="text-red-500 text-xs mb-2">{buyerInfoError}</p>}
    <input
      data-testid="edit-buyer-name"
      value={buyerInfoDraft.buyer_name}
      onChange={(e) => setBuyerInfoDraft({ ...buyerInfoDraft, buyer_name: e.target.value })}
      placeholder="Tên người nhận"
      className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
    />
    <input
      value={buyerInfoDraft.phone}
      onChange={(e) => setBuyerInfoDraft({ ...buyerInfoDraft, phone: e.target.value })}
      placeholder="Số điện thoại"
      className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
    />
    <input
      value={buyerInfoDraft.email}
      onChange={(e) => setBuyerInfoDraft({ ...buyerInfoDraft, email: e.target.value })}
      placeholder="Email"
      className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
    />
    {detail.fulfillment_method === "ship" && (
      <textarea
        value={buyerInfoDraft.address_raw}
        onChange={(e) => setBuyerInfoDraft({ ...buyerInfoDraft, address_raw: e.target.value })}
        placeholder="Địa chỉ nhận hàng"
        rows={2}
        className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
      />
    )}
    <textarea
      value={buyerInfoDraft.note}
      onChange={(e) => setBuyerInfoDraft({ ...buyerInfoDraft, note: e.target.value })}
      placeholder="Ghi chú"
      rows={2}
      className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
    />
    <div className="flex gap-2">
      <button type="button" onClick={saveBuyerInfo} className="px-3 py-1 rounded-lg bg-[var(--brand)] text-white text-sm">
        Lưu
      </button>
      <button type="button" onClick={() => setEditingBuyerInfo(false)} className="px-3 py-1 rounded-lg border border-[var(--border-brand)] text-sm">
        Hủy
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/AdminOrders.test.jsx`
Expected: PASS - every pre-existing test still green, plus the new one.

- [ ] **Step 6: Run the full frontend suite and lint**

Run: `cd frontend && npm test` then `npm run lint`
Expected: all pass; no new lint issues in touched files.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/shop.js frontend/src/components/AdminOrders.jsx frontend/src/components/AdminOrders.test.jsx
git commit -m "feat(admin): edit an order's buyer info inline from the order detail panel"
```

---

### Task 6: Buyer UI

**Files:**
- Modify: `frontend/src/api/shop.js`
- Modify: `frontend/src/pages/Order.jsx`
- Modify: `frontend/src/pages/Order.test.jsx`
- Modify: `frontend/src/i18n/translations.js`

**Interfaces:**
- Consumes: `PUT /api/orders/:token/buyer-info` (Task 4), `orderAuthHeaders` (existing, `frontend/src/utils/orderAuth.js`).
- Produces: nothing consumed by later tasks - final task.

- [ ] **Step 1: Add the API wrapper**

In `frontend/src/api/shop.js`, immediately after `uploadPaymentProof`:

```js
export const updateOrderBuyerInfo = (token, fields, headers = {}) =>
  api.put(`/api/orders/${token}/buyer-info`, fields, { headers }).then((r) => r.data)
```

- [ ] **Step 2: Add i18n keys**

In `frontend/src/i18n/translations.js`'s `en` block, near `orderReceiverAddress`:

```js
orderEditInfo: "Edit info", orderEditName: "Name", orderEditPhone: "Phone",
orderEditEmail: "Email", orderEditAddress: "Address", orderEditNote: "Note",
orderEditSave: "Save", orderEditCancel: "Cancel", orderEditSaveFailed: "Save failed",
```

In the `vi` block, near its own `orderReceiverAddress`:

```js
orderEditInfo: "Sửa thông tin", orderEditName: "Tên", orderEditPhone: "Số điện thoại",
orderEditEmail: "Email", orderEditAddress: "Địa chỉ", orderEditNote: "Ghi chú",
orderEditSave: "Lưu", orderEditCancel: "Hủy", orderEditSaveFailed: "Lưu thất bại",
```

- [ ] **Step 3: Write the failing test**

Add to `frontend/src/pages/Order.test.jsx`, using this file's existing `baseOrder`/`renderOrder`/`createRoot`/`act` pattern (no `@testing-library/react`):

```js
describe("Order - buyer edits their own info", () => {
  it("shows the edit button only while the order is pending", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending" }))
    const pendingContainer = await renderOrder()
    expect([...pendingContainer.querySelectorAll("button")].some((b) => b.textContent === "Sửa thông tin")).toBe(true)

    fetchOrder.mockResolvedValue(baseOrder({ status: "confirmed" }))
    const confirmedContainer = await renderOrder()
    expect([...confirmedContainer.querySelectorAll("button")].some((b) => b.textContent === "Sửa thông tin")).toBe(false)
  })

  it("saves an edit and re-fetches the order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", buyer_name: "Nguyễn Văn A" }))
    const container = await renderOrder()

    const editBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sửa thông tin")
    await act(async () => { editBtn.click() })

    const nameInput = container.querySelector('input[data-testid="edit-buyer-name"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    await act(async () => {
      setter.call(nameInput, "Nguyễn Văn B")
      nameInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    updateOrderBuyerInfo.mockResolvedValue({ changed: true, order: baseOrder({ status: "pending", buyer_name: "Nguyễn Văn B" }) })
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", buyer_name: "Nguyễn Văn B" }))
    const saveBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Lưu")
    await act(async () => { saveBtn.click() })
    await act(async () => {})

    expect(updateOrderBuyerInfo).toHaveBeenCalledWith("tok123", expect.objectContaining({ buyer_name: "Nguyễn Văn B" }), expect.anything())
    expect(container.textContent).toContain("Nguyễn Văn B")
  })

  it("shows a 409 error message and stays in edit mode when the order stopped being pending mid-edit", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending" }))
    const container = await renderOrder()

    const editBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sửa thông tin")
    await act(async () => { editBtn.click() })

    updateOrderBuyerInfo.mockRejectedValue({ response: { status: 409, data: { message: "Đơn hàng không còn ở trạng thái chờ thanh toán nên không thể chỉnh sửa." } } })
    const saveBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Lưu")
    await act(async () => { saveBtn.click() })
    await act(async () => {})

    expect(container.textContent).toContain("không còn ở trạng thái chờ thanh toán")
  })
})
```

Add `updateOrderBuyerInfo` to this file's existing top-of-file `vi.mock("../api/shop", () => ({ ... }))` block and `vi.fn()` declarations, resetting it in `beforeEach` alongside the file's other mocks.

- [ ] **Step 4: Run to verify it fails**

Run: `cd frontend && npx vitest run src/pages/Order.test.jsx -t "buyer edits their own info"`
Expected: FAIL - no "Sửa thông tin" button exists yet.

- [ ] **Step 5: Implement in `Order.jsx`**

Import `updateOrderBuyerInfo` alongside this file's other `../api/shop` imports.

Add state near this page's existing `order`/`error`-style state:

```js
const [editingBuyerInfo, setEditingBuyerInfo] = useState(false)
const [buyerInfoDraft, setBuyerInfoDraft] = useState(null)
const [buyerInfoError, setBuyerInfoError] = useState("")

const startEditBuyerInfo = () => {
  setBuyerInfoDraft({
    buyer_name: order.buyer_name, phone: order.phone, email: order.email,
    note: order.note || "", address_raw: order.address_raw || "",
  })
  setBuyerInfoError("")
  setEditingBuyerInfo(true)
}

const saveBuyerInfo = async () => {
  setBuyerInfoError("")
  try {
    await updateOrderBuyerInfo(token, buyerInfoDraft, orderAuthHeaders(token))
    const fresh = await fetchOrder(token, orderAuthHeaders(token))
    setOrder(fresh) // reuse whatever this page's existing order-fetch effect already calls its setter
    setEditingBuyerInfo(false)
  } catch (e) {
    setBuyerInfoError(e.response?.data?.message || t("orderEditSaveFailed"))
  }
}
```

(`order`/`setOrder` - `const [order, setOrder] = useState(undefined)` - is this page's existing order state, already populated by its own `fetchOrder(...).then(setOrder)` effect; `saveBuyerInfo` above reuses that exact setter rather than introducing a second, parallel piece of order state.)

Replace the existing receiver-info block:

```jsx
<p>{t("orderReceiverName")}: {order.buyer_name}</p>
<p>{t("orderReceiverPhone")}: {order.phone}</p>
{order.fulfillment_method === "ship" && order.address_raw && (
  <p>{t("orderReceiverAddress")}: {order.address_raw}</p>
```

with the receiver-info display kept as-is, but with a conditional edit button and form appended right after it (same `order.status === "pending"` gate as the design's buyer-restriction rule):

```jsx
{order.status === "pending" && !editingBuyerInfo && (
  <button type="button" onClick={startEditBuyerInfo} className="text-sm underline opacity-70 mt-1">
    {t("orderEditInfo")}
  </button>
)}

{editingBuyerInfo && (
  <div className="mt-2 p-3 rounded-lg border border-[var(--border-brand)]">
    {buyerInfoError && <p className="text-red-500 text-sm mb-2">{buyerInfoError}</p>}
    <input
      data-testid="edit-buyer-name"
      value={buyerInfoDraft.buyer_name}
      onChange={(e) => setBuyerInfoDraft({ ...buyerInfoDraft, buyer_name: e.target.value })}
      placeholder={t("orderEditName")}
      className="w-full mb-2 px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
    />
    <input
      value={buyerInfoDraft.phone}
      onChange={(e) => setBuyerInfoDraft({ ...buyerInfoDraft, phone: e.target.value })}
      placeholder={t("orderEditPhone")}
      className="w-full mb-2 px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
    />
    <input
      value={buyerInfoDraft.email}
      onChange={(e) => setBuyerInfoDraft({ ...buyerInfoDraft, email: e.target.value })}
      placeholder={t("orderEditEmail")}
      className="w-full mb-2 px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
    />
    {order.fulfillment_method === "ship" && (
      <textarea
        value={buyerInfoDraft.address_raw}
        onChange={(e) => setBuyerInfoDraft({ ...buyerInfoDraft, address_raw: e.target.value })}
        placeholder={t("orderEditAddress")}
        rows={2}
        className="w-full mb-2 px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
      />
    )}
    <textarea
      value={buyerInfoDraft.note}
      onChange={(e) => setBuyerInfoDraft({ ...buyerInfoDraft, note: e.target.value })}
      placeholder={t("orderEditNote")}
      rows={2}
      className="w-full mb-2 px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
    />
    <div className="flex gap-2">
      <button type="button" onClick={saveBuyerInfo} className="px-4 py-2 rounded-lg bg-[var(--brand)] text-white text-sm">
        {t("orderEditSave")}
      </button>
      <button type="button" onClick={() => setEditingBuyerInfo(false)} className="px-4 py-2 rounded-lg border border-[var(--border-brand)] text-sm">
        {t("orderEditCancel")}
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/Order.test.jsx`
Expected: PASS - every pre-existing test still green, plus the 3 new ones.

- [ ] **Step 7: Run the full frontend suite and lint**

Run: `cd frontend && npm test` then `npm run lint`
Expected: all pass; no new lint issues in touched files.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/shop.js frontend/src/pages/Order.jsx frontend/src/pages/Order.test.jsx frontend/src/i18n/translations.js
git commit -m "feat(shop): let a buyer edit their own info while their order is still pending"
```

---

## Final Verification (before whole-branch review)

- [ ] Run `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root REDIS_HOST=127.0.0.1 REDIS_PORT=6380 npm test` - full suite green.
- [ ] Run `cd frontend && npm test` - full suite green.
- [ ] Run `cd frontend && npm run lint` - no new issues.
- [ ] Manually walk through, against a local `docker compose up -d`:
  1. Admin: open an order's detail, click "Sửa thông tin", change the phone number, save - confirm the detail panel updates and the buyer receives an `order_updated` email listing the change.
  2. Admin: repeat on an already-cancelled order - confirm it's still allowed.
  3. Buyer: on a pending order's own page, click "Sửa thông tin", change the address, save - confirm the page reflects it and an email arrives.
  4. Buyer: confirm the order (or otherwise move it past pending), reload the order page - confirm the edit button no longer appears, and a direct API call to the buyer route now 409s.
