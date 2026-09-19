# Back-in-Stock Notifications Implementation Plan

**Goal:** Let a buyer request an email when a sold-out variant restocks, per
`docs/superpowers/specs/2026-09-19-back-in-stock-notify-design.md`.

**Architecture:** A new standalone `stock_notify_requests` table (own
`notified_at` marker, not the order-coupled `email_queue`). Public route
`POST /api/shop/variants/:id/notify-me` inserts/re-arms a request. The
existing worker tick gains a new step that polls for requests whose variant
is no longer sold out and emails them via the existing SMTP transport.

---

### Task 1: Migration

**Files:** Create `backend/migrations/040_create_stock_notify_requests.js`

- [ ] Create table per the design doc (id, product_variant_id FK CASCADE,
      email(255) not null, created_at, notified_at nullable, unique
      `(product_variant_id, email)`).
- [ ] Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASS=root DB_NAME=cosplay_test npm run migrate`
- [ ] Commit.

### Task 2: `backend/shop/stockNotify.js` + tests

**Files:** Create `backend/shop/stockNotify.js`, `backend/tests/stockNotify.test.js`

- [ ] `EMAIL_RE`, `VariantNotFoundError`, `NotSoldOutError`.
- [ ] `requestNotify(variantId, email)`: validate email, look up variant
      (404-equivalent throw if missing), reject if not sold out, `INSERT ...
      ON DUPLICATE KEY UPDATE notified_at = NULL, created_at = NOW()`.
- [ ] `sendPendingNotifications()`: no-op if `!sender.isConfigured()`;
      otherwise select up to 50 pending rows joined to variant/product where
      `stock_qty IS NULL OR stock_qty > 0`, send one email each via
      `sender.getTransport()`, mark `notified_at`, catch-and-log per-row
      failures without aborting the batch.
- [ ] Export `getTransport` from `backend/shop/email/sender.js` (currently
      only `sendQueued`/`isConfigured`/`listFailed` are exported).
- [ ] Write tests per the design doc's Testing section.
- [ ] Run: `cd backend && npx vitest run tests/stockNotify.test.js`

### Task 3: Public route + tests

**Files:** Modify `backend/routes/shop.js`, `backend/server.js` (only if a
new mount point is needed - `/api/shop` already exists, so likely just
adding the route inside the existing `shopRoutes()` function). Create
`backend/tests/shopNotifyRoute.test.js`.

- [ ] Add `POST /variants/:id/notify-me` to `shopRoutes()`, calling
      `stockNotify.requestNotify`, mapping `VariantNotFoundError` → 404,
      `NotSoldOutError` → 409, a plain `Error("invalid_email")` → 400.
- [ ] Tests: 400 (bad email), 404 (missing variant), 409 (not sold out), 200
      (success), 200 idempotent on repeat.
- [ ] Run: `cd backend && npx vitest run tests/shopNotifyRoute.test.js`

### Task 4: Worker integration

**Files:** Modify `backend/worker.js`

- [ ] Import `stockNotify`, call `stockNotify.sendPendingNotifications()`
      inside `run()` alongside `sweepExpiredOrders()`/`dispatchEmails()`,
      wrapped in its own try/catch (matches the existing pattern - one
      step's failure must not block the others).
- [ ] No dedicated worker test needed beyond the module-level test in Task
      2 - `run()`'s existing tests (if any) should keep passing since this
      is an additive, independently-caught step. Run
      `cd backend && npx vitest run tests/worker.test.js` if that file
      exists, to confirm no regression.

### Task 5: Frontend - API wrapper + ProductCard UI

**Files:** Modify `frontend/src/api/shop.js`, `frontend/src/components/shop/ProductCard.jsx`,
`frontend/src/components/shop/ProductCard.test.jsx`, `frontend/src/i18n/translations.js`

- [ ] `frontend/src/api/shop.js`: add `notifyMeWhenBackInStock(variantId,
      email)` → `api.post(\`/api/shop/variants/${variantId}/notify-me\`, { email })`.
- [ ] i18n keys (`en`/`vi`): `shopNotifyMe` ("Notify me when back in stock" /
      "Báo khi có hàng lại"), `shopNotifyMeEmailPlaceholder`,
      `shopNotifyMeSuccess`, `shopNotifyMeAlreadyInStock`,
      `shopNotifyMeError`.
- [ ] `ProductCard.jsx`: when `isSoldOut(detail) && orderable`, render an
      email input + submit button in place of the quantity stepper block;
      track local `notifyEmail`/`notifyState` (`idle`/`sending`/`sent`/`error`)
      state, reset on `openDetail`. Submit calls the API wrapper; success
      sets `sent`; a `409` response sets a distinct "already back in stock"
      message; any other error sets a generic one.
- [ ] Extend `ProductCard.test.jsx` per the design doc's frontend testing
      section.
- [ ] Run: `cd frontend && npx vitest run src/components/shop/ProductCard.test.jsx`
- [ ] Run full suites: `cd backend && npm test` (targeted files only if the
      full suite hits the known MariaDB `FOR UPDATE OF` environment gap -
      see PR description) and `cd frontend && npm test`.
- [ ] Commit.
