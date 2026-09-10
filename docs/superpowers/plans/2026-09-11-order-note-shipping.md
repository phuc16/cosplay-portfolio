# Buyer Order Note in Shipping Export + Pickup Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the buyer's existing checkout note (`orders.note`) in the two admin views staff actually use while fulfilling an order - the ViettelPost shipping export table and the printed pickup roster - neither of which currently includes it.

**Architecture:** No schema change - `orders.note` already exists and is already captured at checkout. Three backend read-path additions thread the column through to the two admin routes that don't currently select/return it, then two frontend display additions render it.

**Tech Stack:** Node/Express, mysql2, React, Vitest/supertest.

## Global Constraints

- No schema/migration change - `orders.note` already exists (confirmed in `backend/migrations/*orders*.js`).
- No change to the actual ViettelPost `.xlsx` export file (`vtpWorkbook.js`) - the note is for the seller's own staff, never the courier.
- No change to how the buyer enters/edits the note (`Checkout.jsx`'s existing textarea is untouched).
- Follow existing repo style: plain hyphens (` - `), never em dashes, in all comments/messages.
- This branch (`feature/order-note-shipping`) is based on `main`, which does not yet include the separate, still-pending `feature/custom-select-dropdown` branch - `ShippingExport.jsx`/`ShippingRoster.jsx` still use native `<select>` elements here. That other branch will need a merge/rebase against this one (or vice versa) before both land, since they touch overlapping files - not this plan's concern, just noted for whoever finishes both.

---

### Task 1: Backend - thread `note` through the export queue and pickup roster reads

**Files:**
- Modify: `backend/routes/adminShipping.js:77-93` (export queue route's mapped response)
- Modify: `backend/routes/adminShipping.js:388` (roster route's SQL column list)
- Modify: `backend/shop/shipping/roster.js:38-62` (`buildRoster()`'s pushed row shape)
- Test: `backend/tests/adminShippingExport.test.js`
- Test: `backend/tests/adminShippingRoster.test.js`
- Test: `backend/tests/roster.test.js`

**Interfaces:**
- Produces: every row returned by `GET /api/admin/shipping/export/orders` gains a `note` field (string or `null`). Every row returned by `GET /api/admin/shipping/roster/:collectionId` (via `buildRoster()`) gains a `note` field (string or `null`).

- [ ] **Step 1: Write the failing test for the export queue route**

In `backend/tests/adminShippingExport.test.js`, find the `seed()` helper (line 52-63):

```javascript
async function seed() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 120000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  const o = await orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank",
  })
  await orders.transitionOrder(o.id, "confirmed")
  return o.id
}
```

Replace with (adds an optional `over` param, merged into the `createOrder` call, matching the identical pattern already used in `adminShippingRoster.test.js`'s `seedPickupOrder`):

```javascript
async function seed(over = {}) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 120000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  const o = await orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank", ...over,
  })
  await orders.transitionOrder(o.id, "confirmed")
  return o.id
}
```

Then add a new test right after the `"lists a confirmed ship order with no tracking code"` test (after line 96):

```javascript
  it("includes the buyer's checkout note, and null when none was left", async () => {
    const withNote = await seed({ note: "Nhờ shop ký lên card giúp em" })
    const withoutNote = await seed()

    const res = await authed(request(app).get("/api/admin/shipping/export/orders"))
    expect(res.status).toBe(200)
    expect(res.body.find((o) => o.id === withNote).note).toBe("Nhờ shop ký lên card giúp em")
    expect(res.body.find((o) => o.id === withoutNote).note).toBeNull()
  })
```

- [ ] **Step 2: Write the failing test for the roster route**

In `backend/tests/adminShippingRoster.test.js`, add a new test right after the `"the roster SQL selects status..."` test (after line 159):

```javascript
  it("includes the buyer's checkout note, and null when none was left", async () => {
    const { collectionId: c1, orderId: withNote } = await seedPickupOrder({ note: "Giao buổi tối, tránh giờ hành chính" })
    const { collectionId: c2, orderId: withoutNote } = await seedPickupOrder()

    const res1 = await authed(request(app).get(`/api/admin/shipping/roster/${c1}`))
    expect(res1.body.rows.find((r) => r.order_id === withNote).note).toBe("Giao buổi tối, tránh giờ hành chính")

    // seedPickupOrder always creates its own fresh collection, so the
    // no-note order needs its own roster fetch to check the null case.
    const res2 = await authed(request(app).get(`/api/admin/shipping/roster/${c2}`))
    expect(res2.body.rows.find((r) => r.order_id === withoutNote).note).toBeNull()
  })
```

- [ ] **Step 3: Write the failing test for `buildRoster()`**

In `backend/tests/roster.test.js`, the file's `order()` fixture helper (top of file) is:

```javascript
function order(over = {}) {
  return {
    id: 1, buyer_name: "Nguyễn An", phone: "0901111111",
    payment_method: "bank", cod_amount: null, created_at: "2026-01-01T00:00:00.000Z",
    items: [{ product_name_snapshot: "Photocard", variant_label_snapshot: "A1", qty: 2 }],
    ...over,
  }
}
```

Add a new `describe` block at the end of the file:

```javascript
describe("buildRoster - note", () => {
  it("carries the order's note through, and null when absent", () => {
    const { rows } = buildRoster([order({ note: "Ký tên lên card" }), order({ id: 2, note: null })])
    expect(rows.find((r) => r.order_id === 1).note).toBe("Ký tên lên card")
    expect(rows.find((r) => r.order_id === 2).note).toBeNull()
  })
})
```

- [ ] **Step 4: Run all three test files to verify they fail**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/adminShippingExport.test.js tests/adminShippingRoster.test.js tests/roster.test.js`

Expected: the 3 new tests FAIL (`note` is `undefined`, not the expected string/`null`), all pre-existing tests in these files still PASS.

- [ ] **Step 5: Implement - export queue route**

In `backend/routes/adminShipping.js`, find (around line 77-93):

```javascript
      res.json(eligible.map((o) => ({
        id: o.id,
        order_code: domain.formatOrderCode(o.id, o.created_at),
        buyer_name: o.buyer_name,
        phone: o.phone,
        address_province: o.address_province,
        total: o.total,
        cod_amount: o.cod_amount,
        payment_method: o.payment_method,
        shipping_payer: o.shipping_payer,
        prepared: Boolean(o.prepared),
        // A mixed cart (physical item shipped here + a digital one) still
        // needs its digital delivery link sent - nothing else about this
        // export queue would tell staff that, since it only ever handles
        // the physical side of the order.
        has_digital_item: o.has_digital_item,
      })))
```

Replace with:

```javascript
      res.json(eligible.map((o) => ({
        id: o.id,
        order_code: domain.formatOrderCode(o.id, o.created_at),
        buyer_name: o.buyer_name,
        phone: o.phone,
        address_province: o.address_province,
        total: o.total,
        cod_amount: o.cod_amount,
        payment_method: o.payment_method,
        shipping_payer: o.shipping_payer,
        prepared: Boolean(o.prepared),
        // A mixed cart (physical item shipped here + a digital one) still
        // needs its digital delivery link sent - nothing else about this
        // export queue would tell staff that, since it only ever handles
        // the physical side of the order.
        has_digital_item: o.has_digital_item,
        // The buyer's own checkout note (e.g. "please sign the card",
        // a preferred delivery time) - for staff packing/labeling, never
        // sent to the courier itself.
        note: o.note || null,
      })))
```

- [ ] **Step 6: Implement - roster route SQL**

In `backend/routes/adminShipping.js`, find (around line 388):

```javascript
        `SELECT id, buyer_name, phone, status, payment_method, cod_amount, pickup_code, created_at, prepared
           FROM orders o
```

Replace with:

```javascript
        `SELECT id, buyer_name, phone, status, payment_method, cod_amount, pickup_code, created_at, prepared, note
           FROM orders o
```

- [ ] **Step 7: Implement - `buildRoster()`**

In `backend/shop/shipping/roster.js`, find (around line 38-43):

```javascript
    rows.push({
      order_id: order.id,
      order_code: formatOrderCode(order.id, order.created_at),
      buyer_name: order.buyer_name,
      phone: order.phone,
      pickup_code: order.pickup_code,
```

Replace with:

```javascript
    rows.push({
      order_id: order.id,
      order_code: formatOrderCode(order.id, order.created_at),
      buyer_name: order.buyer_name,
      phone: order.phone,
      pickup_code: order.pickup_code,
      // The buyer's own checkout note - for staff handing the order over,
      // never sent to a courier (this is a pickup order, there is no
      // courier involved at all).
      note: order.note || null,
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/adminShippingExport.test.js tests/adminShippingRoster.test.js tests/roster.test.js`

Expected: PASS (all tests in all 3 files)

- [ ] **Step 9: Commit**

```bash
git add backend/routes/adminShipping.js backend/shop/shipping/roster.js backend/tests/adminShippingExport.test.js backend/tests/adminShippingRoster.test.js backend/tests/roster.test.js
git commit -m "feat(shop): thread buyer order note through shipping export + pickup roster

orders.note already exists and is already captured at checkout -
it just wasn't selected/returned by either of the two admin read
paths staff actually use while fulfilling an order."
```

---

### Task 2: Frontend - show the note in the ViettelPost export table

**Files:**
- Modify: `frontend/src/components/shipping/ShippingExport.jsx:213-286`
- Test: `frontend/src/components/shipping/ShippingExport.test.jsx`

**Interfaces:**
- Consumes: `note` field on each order object from Task 1 (`GET /api/admin/shipping/export/orders`'s response, already flowing into this component's existing `visibleOrders`/`o` objects with no code change needed to fetch it - only rendering is added).

- [ ] **Step 1: Write the failing test**

In `frontend/src/components/shipping/ShippingExport.test.jsx`, add a new test in the `describe("ShippingExport", ...)` block, right after the `"shows a '+ Sản phẩm số' badge..."` test:

```javascript
  it("shows the buyer's note in its own column, and nothing when there isn't one", async () => {
    adminListShippingExportOrders.mockResolvedValue([
      order({ id: 1, note: "Nhờ shop ký lên card giúp em" }),
      order({ id: 2, order_code: "DH2", note: null }),
    ])
    const container = await renderShippingExport()
    await flush()

    expect(container.textContent).toContain("Nhờ shop ký lên card giúp em")
    const rows = container.querySelectorAll("tbody tr")
    // Row 2 (no note) should render an empty note cell, not the string "null".
    expect(rows[1].textContent).not.toContain("null")
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/shipping/ShippingExport.test.jsx`

Expected: FAIL - the note text never appears anywhere in the rendered output.

- [ ] **Step 3: Implement**

In `frontend/src/components/shipping/ShippingExport.jsx`, find the table header (around line 213-225):

```jsx
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left opacity-70">
                    <th></th>
                    <th className="pr-2">Mã đơn</th>
                    <th className="pr-2">Người nhận</th>
                    <th className="pr-2">SĐT</th>
                    <th className="pr-2">Tỉnh/Thành</th>
                    <th className="pr-2">Giá trị</th>
                    <th className="pr-2">Miễn phí ship</th>
                    <th className="pr-2">Sản phẩm</th>
                    <th>Chuẩn bị</th>
                  </tr>
                </thead>
```

Replace with (new "Ghi chú" column added between "Sản phẩm" and "Chuẩn bị"):

```jsx
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left opacity-70">
                    <th></th>
                    <th className="pr-2">Mã đơn</th>
                    <th className="pr-2">Người nhận</th>
                    <th className="pr-2">SĐT</th>
                    <th className="pr-2">Tỉnh/Thành</th>
                    <th className="pr-2">Giá trị</th>
                    <th className="pr-2">Miễn phí ship</th>
                    <th className="pr-2">Sản phẩm</th>
                    <th className="pr-2">Ghi chú</th>
                    <th>Chuẩn bị</th>
                  </tr>
                </thead>
```

Find the data row (around line 258-267):

```jsx
                        <td className="pr-2 py-1">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(o.id)}
                            className="text-xs underline"
                          >
                            {expandedId === o.id ? "Ẩn" : "Sản phẩm"}
                          </button>
                        </td>
                        <td className="py-1">
```

Replace with (new "Ghi chú" cell inserted between the "Sản phẩm" cell and the "Chuẩn bị" cell - truncated with a native `title` tooltip for the full text, per the spec's design):

```jsx
                        <td className="pr-2 py-1">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(o.id)}
                            className="text-xs underline"
                          >
                            {expandedId === o.id ? "Ẩn" : "Sản phẩm"}
                          </button>
                        </td>
                        <td className="pr-2 py-1 max-w-[160px] truncate" title={o.note || ""}>
                          {o.note || ""}
                        </td>
                        <td className="py-1">
```

Find the expanded-detail row's `colSpan` (around line 282-285):

```jsx
                      {expandedId === o.id && (
                        <tr className="border-t border-[var(--border-brand)]">
                          <td></td>
                          <td colSpan={7} className="py-2 text-sm">
```

Replace with (bumped by 1 to account for the new column, keeping the row correctly spanning the full table width):

```jsx
                      {expandedId === o.id && (
                        <tr className="border-t border-[var(--border-brand)]">
                          <td></td>
                          <td colSpan={8} className="py-2 text-sm">
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/shipping/ShippingExport.test.jsx`

Expected: PASS (this test, plus every pre-existing test in the same file)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shipping/ShippingExport.jsx frontend/src/components/shipping/ShippingExport.test.jsx
git commit -m "feat(shop): show buyer's order note as a column in the shipping export table"
```

---

### Task 3: Frontend - show the note in the pickup roster

**Files:**
- Modify: `frontend/src/components/shipping/ShippingRoster.jsx:206-228`
- Test: `frontend/src/components/shipping/ShippingRoster.test.jsx`

**Interfaces:**
- Consumes: `note` field on each roster row from Task 1 (`GET /api/admin/shipping/roster/:collectionId`'s response via `buildRoster()`).

- [ ] **Step 1: Write the failing test**

In `frontend/src/components/shipping/ShippingRoster.test.jsx`, add a new test in the `describe("ShippingRoster", ...)` block, right after the `"renders one row per pickup order..."` test:

```javascript
  it("shows the buyer's note in the order's detail row, visible on print regardless of expand state", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [{ product_name: "Photocard", variant_label: "A1", qty: 2 }], paid: true, amount_due: 0,
          note: "Nhờ shop ký lên card giúp em",
        },
      ],
      excluded: [],
    })
    const container = await renderComponent()
    await flush()
    await setSelectValue(container.querySelector("select"), "1")
    await flush()

    const detailRow = container.querySelector('[data-testid="order-detail-1"]')
    expect(detailRow.textContent).toContain("Nhờ shop ký lên card giúp em")
    // Must not be gated behind print:hidden - staff hand the printed page
    // over at pickup and need this visible without any on-screen interaction.
    expect(detailRow.className).not.toContain("print:hidden")
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/shipping/ShippingRoster.test.jsx`

Expected: FAIL - the note text never appears in the detail row.

- [ ] **Step 3: Implement**

In `frontend/src/components/shipping/ShippingRoster.jsx`, find the detail row (around line 206-228):

```jsx
                          <tr
                            data-testid={`order-detail-${r.order_id}`}
                            className={`border-t border-[var(--border-brand)] ${detailVisible ? "" : "hidden"} print:table-row`}
                          >
                            <td></td>
                            <td colSpan={8} className="pb-2">
                              <ul className="pl-0">
                                {r.items.map((i, idx) => (
                                  <li key={idx} className="flex items-center gap-1.5 py-0.5">
                                    {i.image_url
                                      ? <img src={i.image_url} alt="" className="w-6 h-6 object-cover rounded print:hidden" />
                                      : <span className="w-6 h-6 rounded bg-[var(--surface-neutral)] print:hidden" />}
                                    {i.product_name} · {i.variant_label} × {i.qty}
                                    {i.delivery_link && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--brand-soft)]">
                                        Sản phẩm số
                                      </span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
```

Replace with (note rendered below the items list, inside the same row - this row's own class already puts it on-screen only when expanded but always in the printed page via `print:table-row`, exactly the behavior a buyer's "please sign the card" instruction needs):

```jsx
                          <tr
                            data-testid={`order-detail-${r.order_id}`}
                            className={`border-t border-[var(--border-brand)] ${detailVisible ? "" : "hidden"} print:table-row`}
                          >
                            <td></td>
                            <td colSpan={8} className="pb-2">
                              <ul className="pl-0">
                                {r.items.map((i, idx) => (
                                  <li key={idx} className="flex items-center gap-1.5 py-0.5">
                                    {i.image_url
                                      ? <img src={i.image_url} alt="" className="w-6 h-6 object-cover rounded print:hidden" />
                                      : <span className="w-6 h-6 rounded bg-[var(--surface-neutral)] print:hidden" />}
                                    {i.product_name} · {i.variant_label} × {i.qty}
                                    {i.delivery_link && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--brand-soft)]">
                                        Sản phẩm số
                                      </span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                              {r.note && <p className="text-sm italic opacity-80 mt-1">Ghi chú: {r.note}</p>}
                            </td>
                          </tr>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/shipping/ShippingRoster.test.jsx`

Expected: PASS (this test, plus every pre-existing test in the same file)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shipping/ShippingRoster.jsx frontend/src/components/shipping/ShippingRoster.test.jsx
git commit -m "feat(shop): show buyer's order note in the pickup roster's detail row"
```

---

### Task 4: Full-branch verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run`

Expected: PASS, all files (note: `adminStatsRoutes.test.js`'s bookkeeping tests are known to intermittently fail only during ~17:00-23:59 UTC due to a pre-existing, unrelated UTC/Asia-Ho_Chi_Minh boundary flake documented in `docs/EDGE_CASE_CHECKLIST.md` - if seen, confirm current UTC time and treat as unrelated rather than a regression from this branch)

- [ ] **Step 2: Run the full frontend suite**

Run: `cd frontend && npx vitest run`

Expected: PASS, all files

- [ ] **Step 3: Run frontend lint**

Run: `cd frontend && npm run lint`

Expected: no new errors (the pre-existing `Portfolio.jsx`/`LanguageContext.jsx`/`Admin.jsx`/`ProductCard.jsx` warnings from earlier sessions are expected to remain, unrelated to this branch)

- [ ] **Step 4: Manual verification note for the human**

This plan cannot verify the printed pickup roster's visual layout (font size, page-break behavior, whether "Ghi chú: ..." reads clearly on paper next to the items list) from an automated test - flag this in the final report as something the user should glance at (Ctrl/Cmd+P print preview on `/admin` → Shipping → Danh sách nhận hàng, with a seeded order carrying a note) before considering this fully done.
