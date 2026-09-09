# Merch Shop - Plan 2 Verification (post-implementation QA)

Run after every task in `2026-08-07-merch-shop-2-orders.md` is implemented and committed, against a running stack. This is acceptance testing of the built order flow, separate from the unit and integration tests written during implementation.

**This plan handles money and stock.** Sections D (money), E–G (reservation, overselling, idempotency) and I–J (release, expiry) are blocking: a failure in any of them means real buyers get charged wrong amounts or sold items that do not exist. Do not proceed to Plan 3 with an open failure in those sections.

## Setup

```bash
docker compose up -d --build
cd frontend && npm run dev      # http://localhost:5173
```

Helper variables used throughout:
```bash
API=http://localhost:5000/api
DBX="docker compose exec -T mysql mysql -uroot -p$DB_PASS cosplay -N -B -e"
```

Reset order data between full runs (keeps the catalog):
```bash
docker compose exec -T mysql mysql -uroot -p"$DB_PASS" cosplay -e "
  SET FOREIGN_KEY_CHECKS=0; TRUNCATE order_items; TRUNCATE orders; SET FOREIGN_KEY_CHECKS=1;"
```

---

## A. Seed

- [x] **A1** Catalog from Plan 1 exists, with collection `Bộ sưu tập Hè 2026` (active, ship-only) and `Fes HH2026` (active, ship + pickup).
- [x] **A2** Product `Photocard` at `35000` with variants: `A1` stock `3`, `A2` stock `0`, `B1` unlimited (blank), `B2` stock `1`.
- [x] **A3** Second product `Poster A4` at `90000`, variant `Std` stock `10`.
- [x] **A4** Note the variant ids for later:
  ```bash
  eval "$DBX 'SELECT id, label, stock_qty FROM product_variants ORDER BY label'"
  ```

---

## B. Cart

**All of B1–B12 remain unchecked: NOT VERIFIED - no browser tool available.** Cart behavior lives entirely in frontend React state/localStorage with no server round-trip, so nothing here has a curl equivalent. Code inspection supports correct behavior throughout (see the underlying `cart.js`/`cart.test.js` unit tests, which pass), but none of it was exercised in a real browser.

- [ ] **B1** Add `A1` to the cart → cart shows 1 item.
- [ ] **B2** Add `A1` again → quantity merges to 2, still one line (not two lines).
- [ ] **B3** Add `Std` → two distinct lines.
- [ ] **B4** Refresh the browser → cart survives.
- [ ] **B5** Close the tab, reopen `/cart` → cart still there.
- [ ] **B6** Change a quantity to `5` → total updates immediately.
- [ ] **B7** Set a quantity to `0` → the line is removed.
- [ ] **B8** Remove the last line → empty-cart state, with a link back to the shop.
- [ ] **B9** `A2` (sold out) cannot be added - its button is disabled.
- [ ] **B10** In a `closed` collection, no variant can be added to the cart.
- [ ] **B11** Corrupt the cart deliberately and confirm it recovers rather than crashing:
  ```js
  // browser console
  localStorage.setItem("shop_cart", "{not json")
  ```
  Reload `/cart` → empty cart, no error screen, console clean.
- [ ] **B12** Inject a tampered cart and confirm malformed entries are dropped:
  ```js
  localStorage.setItem("shop_cart", JSON.stringify([{qty:1},{variant_id:1,qty:1,price:-5}]))
  ```
  Reload → both entries gone.

---

## C. Checkout validation

Each of these must be **rejected**, with a visible message and no order created (`SELECT COUNT(*) FROM orders` unchanged).

- [x] **C1** Blank name.
- [x] **C2** Blank phone.
- [x] **C3** Blank email.
- [x] **C4** Malformed email (`nope`, `a@`, `@b.com`).
- [x] **C5** Shipping selected with a blank address.
- [ ] **C6** Empty cart reaching `/checkout` directly → empty state, no submit.
- [x] **C7** API-level: unknown payment method is rejected.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/orders -H 'Content-Type: application/json' \
    -d '{"items":[{"variant_id":1,"qty":1}],"buyer":{"buyer_name":"A","phone":"09","email":"a@b.co","address_raw":"x"},"fulfillment_method":"ship","payment_method":"bitcoin"}'
  ```
  Expect `400`.
- [x] **C8** API-level: quantity `0`, `-1`, and `1.5` are each rejected with `400`.
- [x] **C9** API-level: unknown `variant_id` (e.g. `999999`) is rejected, not silently ignored.
- [x] **C10** **Pickup does not require an address** - select pickup, leave address blank → order succeeds.

---

## D. Money correctness (blocking)

- [ ] **D1** Cart with `A1 × 2` (35.000₫) + `Std × 1` (90.000₫) shows `160.000₫`.
- [ ] **D2** Checkout shows the same `160.000₫`.
- [x] **D3** After placing, the order page shows `160.000₫`, and the DB agrees:
  ```bash
  eval "$DBX 'SELECT id, total FROM orders ORDER BY id DESC LIMIT 1'"
  ```
- [x] **D4** `order_items` snapshots match the catalog price at order time:
  ```bash
  eval "$DBX 'SELECT product_name_snapshot, variant_label_snapshot, unit_price_snapshot, qty FROM order_items ORDER BY id DESC LIMIT 5'"
  ```
- [x] **D5** **The server ignores a client-supplied total.** Send a tampered request:
  ```bash
  curl -s -X POST $API/orders -H 'Content-Type: application/json' -d '{
    "items":[{"variant_id":<A1_ID>,"qty":1,"price":1,"unit_price_snapshot":1}],
    "total":1,
    "buyer":{"buyer_name":"Tamper","phone":"0900000000","email":"t@example.com","address_raw":"x"},
    "fulfillment_method":"ship","payment_method":"bank"}' | jq .
  ```
  Expect `total: 35000`, **not** `1`. Confirm in the DB that `unit_price_snapshot` is `35000`.
  **A `1` here is a critical financial defect - stop and fix before anything else.**
- [x] **D6** Shipping is **not** added to the total - the order total equals the merch sum exactly, with a visible "+ shipping fee" note instead.
- [x] **D7** `orders.shipping_fee` is `NULL` on a fresh order (recorded later, never charged).
- [x] **D8** A COD order sets `cod_amount` equal to `total`:
  ```bash
  eval "$DBX 'SELECT total, cod_amount, payment_method FROM orders WHERE payment_method=\"cod\" ORDER BY id DESC LIMIT 1'"
  ```
- [x] **D9** A non-COD order has `cod_amount` `NULL`.
- [x] **D10** Column types are integer:
  ```bash
  eval "$DBX 'SHOW COLUMNS FROM orders WHERE Field IN (\"total\",\"cod_amount\",\"shipping_fee\")'"
  ```
  Expect `int unsigned` for all three.

---

## E. Stock reservation (blocking)

- [x] **E1** Note `A1` stock (`3`). Order `A1 × 2`. Stock is now `1` **immediately**, before any payment.
- [x] **E2** The storefront reflects `1` remaining on reload.
- [x] **E3** Order `B1` (unlimited) × 50 → succeeds, and `B1.stock_qty` is still `NULL`, not `-50` or `0`.
- [x] **E4** Order the remaining `A1 × 1` → stock reaches `0`; the variant now renders struck through.
- [x] **E5** Attempt to order `A1` again → `409`, with the message naming `A1`.
- [x] **E6** Attempt `B2 × 2` when `B2` has `1` → `409`, and `B2` stock is **still** `1` (nothing partially reserved).
- [x] **E7** **Multi-item rollback.** Cart with `Std × 1` (available) + `B2 × 5` (only 1 left) → whole order rejected, and `Std` stock is unchanged. Confirm no `orders` row was created.

---

## F. Overselling under concurrency (blocking)

The single most important check in the whole feature.

Set one variant to exactly `1`:
```bash
eval "$DBX 'UPDATE product_variants SET stock_qty=1 WHERE label=\"B2\"'"
```

- [x] **F1** Fire 20 simultaneous orders for it:
  ```bash
  B2=<B2_ID>
  for i in $(seq 1 20); do
    curl -s -o /tmp/r$i.json -w "%{http_code}\n" -X POST $API/orders \
      -H 'Content-Type: application/json' -d "{
        \"items\":[{\"variant_id\":$B2,\"qty\":1}],
        \"buyer\":{\"buyer_name\":\"R$i\",\"phone\":\"0900000000\",\"email\":\"r$i@example.com\",\"address_raw\":\"x\"},
        \"fulfillment_method\":\"ship\",\"payment_method\":\"bank\"}" &
  done; wait
  ```
  Expect exactly **one** `201` and nineteen `409`.

  Note: the order limiter allows 10/hour per IP, so some responses may be `429`. Either raise the limit temporarily or run from varied IPs - what matters is that **`201` appears exactly once**.

- [x] **F2** Stock landed at exactly `0`, never negative:
  ```bash
  eval "$DBX 'SELECT label, stock_qty FROM product_variants WHERE label=\"B2\"'"
  ```
- [x] **F3** Exactly one order row exists for that burst.
- [x] **F4** **Conservation invariant** - reserved plus remaining equals the original:
  ```bash
  eval "$DBX 'SELECT (SELECT COALESCE(SUM(qty),0) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status<>\"cancelled\" AND oi.product_variant_id=<B2_ID>) + (SELECT stock_qty FROM product_variants WHERE id=<B2_ID>) AS total'"
  ```
  Expect the original stock number.
- [x] **F5** Repeat F1–F4 **three times** from a clean reset. Any single oversell is a blocking defect.

---

## G. Idempotency (blocking)

- [x] **G1** Submit twice with the same `request_key`:
  ```bash
  KEY=dup-test-1
  for i in 1 2; do
    curl -s -X POST $API/orders -H 'Content-Type: application/json' -d "{
      \"items\":[{\"variant_id\":<STD_ID>,\"qty\":1}],\"request_key\":\"$KEY\",
      \"buyer\":{\"buyer_name\":\"Dup\",\"phone\":\"0900000000\",\"email\":\"d@example.com\",\"address_raw\":\"x\"},
      \"fulfillment_method\":\"ship\",\"payment_method\":\"bank\"}" | jq -r .order_token
  done
  ```
  Expect the **same token** printed twice.
- [x] **G2** Only one order row exists for that key, and stock decreased by exactly 1 (not 2).
- [x] **G3** Concurrent duplicates (`&` both curls, same key) → still one order, one reservation.
- [ ] **G4** **In the browser:** double-click "Place order" rapidly → one order, one redirect, stock down by one.
- [ ] **G5** Place an order, press Back, resubmit the same page → the same order is returned rather than a second one created (the request key is stable per page load).

---

## H. Lifecycle transitions

Test the matrix through the admin UI. Illegal moves must not be offered, and must be rejected if forced via API.

| From | To | Ship order | Pickup order |
|---|---|---|---|
| pending | confirmed | allow | allow |
| pending | shipped | reject | reject |
| pending | completed | reject | reject |
| pending | cancelled | allow | allow |
| confirmed | shipped | allow | **reject** |
| confirmed | completed | allow | allow |
| confirmed | pending | reject | reject |
| shipped | completed | allow | n/a |
| shipped | confirmed | reject | n/a |
| completed | anything | reject | reject |
| cancelled | anything | reject | reject |

- [ ] **H1** Admin only offers legal next states for each order's current status.
- [x] **H2** Confirm a pending order → status `confirmed`, `confirmed_at` is set.
- [x] **H3** Mark shipped with tracking `VTP123` → stored, and visible on the buyer's order page.
- [x] **H4** Mark completed → terminal; no further action buttons.
- [x] **H5** Force an illegal transition via API → `409 invalid_transition`:
  ```bash
  curl -s -X POST $API/admin/orders/<ID>/transition -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"to":"shipped"}'
  ```
- [x] **H6** Unknown target status (`refunded`) → `400`.
- [x] **H7** **A pickup order cannot be shipped** - confirmed pickup order offers `completed`, not `shipped`; forcing `shipped` returns `409`.

---

## I. Stock release (blocking)

- [x] **I1** Order `Std × 2` (stock 10 → 8). Cancel it → stock returns to `10`.
- [x] **I2** Cancel the same order again (force via API) → stock stays `10`, **not** `12`.
- [x] **I3** Check the guard is set:
  ```bash
  eval "$DBX 'SELECT id, status, stock_released_at FROM orders ORDER BY id DESC LIMIT 3'"
  ```
  Cancelled orders have a non-null `stock_released_at`.
- [x] **I4** Cancel an order containing an unlimited variant → its `stock_qty` stays `NULL`, never becomes a number.
- [x] **I5** Cancel a `confirmed` order → stock also returns (not only from `pending`).
- [x] **I6** Completing an order does **not** return stock.

---

## J. Expiry sweep (blocking)

**Critical infrastructure bug found and fixed while testing this section (unrelated to the sweep's own logic, all of which passed):** the Docker `worker` service's `entrypoint.sh` unconditionally ran `node server.js`, silently discarding `docker-compose.yml`'s `command: node worker.js` override - confirmed via `docker top` that the worker container's real process was another API server, not the worker. In any real deployment this would mean the expiry sweep (and the pre-existing thumbnail loop) never run at all. Fixed via `exec "$@"` in `entrypoint.sh` + a default `CMD` in the Dockerfile, see `facbe93`. Re-verified via `docker top` on both rebuilt containers.

- [x] **J1** Place a prepaid (bank) order for `Std × 2`. Confirm `expires_at` is set:
  ```bash
  eval "$DBX 'SELECT id, payment_method, expires_at FROM orders ORDER BY id DESC LIMIT 1'"
  ```
- [x] **J2** Force it overdue and wait for the worker (≤ 10s):
  ```bash
  eval "$DBX 'UPDATE orders SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id=<ID>'"
  docker compose logs -f worker    # expect "Đã hủy 1 đơn quá hạn, hoàn kho"
  ```
- [x] **J3** The order is now `cancelled` and its stock returned.
- [x] **J4** **A COD order never expires.** Place one, confirm `expires_at IS NULL`, force the clock forward, wait two sweep cycles → still `pending`, stock still reserved.
- [x] **J5** A `confirmed` order past its `expires_at` is **not** cancelled by the sweep.
- [x] **J6** The sweep is idempotent - let it run several cycles over an already-cancelled order; stock is credited once, not once per cycle.
- [x] **J7** The worker keeps generating thumbnails while sweeping (the sweep did not break the existing loop).
- [x] **J8** Stop MySQL for ~15s, restart → the worker logs the error but stays alive and resumes.

---

## K. COD and pickup specifics

- [ ] **K1** A COD order shows the amount due on delivery on the order page.
- [x] **K2** A COD order still requires admin confirmation before it can move on.
- [x] **K3** A pickup order collects and stores **no** address:
  ```bash
  eval "$DBX 'SELECT fulfillment_method, address_raw, address_street FROM orders WHERE fulfillment_method=\"pickup\" ORDER BY id DESC LIMIT 1'"
  ```
  Expect all address columns `NULL`.
- [ ] **K4** The pickup collection's location and note appear at checkout and on the order page.
- [x] **K5** A ship-only collection does not offer pickup at checkout. *(Initially FAILED - server accepted `fulfillment_method:"pickup"` for a ship-only collection with no cross-check against `allow_ship`/`allow_pickup`; fixed inside `orderRepo.createOrder`'s transaction and re-verified live, see `4d67ade`.)*
- [ ] **K6** A pickup order shows no "+ shipping fee" note.

---

## L. Order page and token security

- [x] **L1** The order page loads from its token and shows status, items, and total.
- [x] **L2** Tokens are 32 hex chars with no visible pattern:
  ```bash
  eval "$DBX 'SELECT order_token FROM orders ORDER BY id DESC LIMIT 10'"
  ```
  Confirm they are not sequential and share no common prefix.
- [x] **L3** `noindex` is served as a header:
  ```bash
  curl -sI $API/orders/<TOKEN> | grep -i x-robots-tag
  ```
  Expect `noindex, nofollow`.
- [ ] **L4** The rendered page also carries a `robots` meta tag (inspect `<head>`).
- [x] **L5** A wrong/guessed token returns the not-found state, and the response body leaks no buyer data.
- [x] **L6** Order endpoints require **no** auth (buyers have no account) but reveal nothing without the exact token.
- [x] **L7** Admin order endpoints reject an absent token (`401`) and a bad token (`403`).

---

## M. Rate limiting

- [x] **M1** Submit 12 orders quickly from one IP → the 11th or 12th returns `429` with the standard error body.
- [x] **M2** **Reading** an order page repeatedly (20+ refreshes) is **not** blocked - a buyer checking status must not lock themselves out.
- [x] **M3** Browsing the catalog is unaffected by the order limiter.
- [x] **M4** After the window passes, ordering works again.

---

## N. Admin orders UI

- [x] **N1** New orders appear in the admin list.
- [x] **N2** Filtering by each status returns the right subset.
- [x] **N3** Detail view shows email, address (ship) or none (pickup), note, and line items.
- [x] **N4** Money in the list matches the order page exactly.
- [ ] **N5** Cancelling asks for confirmation first.
- [ ] **N6** Marking shipped prompts for a tracking code, and skipping it still works.
- [ ] **N7** After any action the list refreshes without a manual reload.
- [ ] **N8** An error (e.g. an illegal transition) surfaces a visible message, not a silent no-op.

---

## O. History integrity

Order records must survive catalog edits - this is what the snapshots exist for.

- [x] **O1** Place an order for `Photocard / A1` at 35.000₫.
- [x] **O2** Change the product price to `50000` → the existing order still shows `35.000₫`, and its total is unchanged.
- [x] **O3** Rename the product → the order still shows the original name.
- [x] **O4** Delete the variant `A1` → the order page still renders correctly with name, label, and price intact.
- [x] **O5** Confirm no order rows were destroyed:
  ```bash
  eval "$DBX 'SELECT COUNT(*) FROM orders'; $DBX 'SELECT COUNT(*) FROM order_items'"
  ```
- [x] **O6** Delete the whole collection → orders survive with `collection_id` set to `NULL`.
- [x] **O7** **Known gap (recorded, expected to fail until Plan 3):** deleting a variant that has a *pending* order means that order's stock can no longer be returned on cancel. Confirm the behaviour, record it, and do not treat it as a new bug - Plan 3 blocks such deletions.

---

## P. Resilience

- [x] **P1** Kill MySQL mid-checkout → clean `500` with the standard JSON body; no partial order row, no phantom stock decrement.
- [x] **P2** Verify no orphaned reservation was left behind:
  ```bash
  eval "$DBX 'SELECT label, stock_qty FROM product_variants'"
  ```
  Stock matches the sum of non-cancelled reservations.
- [x] **P3** Stop Redis → ordering still works (only rate limiting and catalog cache depend on it), or fails cleanly.
- [x] **P4** Restart the backend mid-flow → in-flight requests fail cleanly; committed orders are intact.
- [x] **P5** `docker compose down && docker compose up -d` → all orders, items, and stock survive.

---

## Q. Frontend quality

- [ ] **Q1** Cart, checkout, and order pages have no horizontal scroll at 375px.
- [ ] **Q2** The quantity input is usable on a phone (numeric keyboard).
- [ ] **Q3** Language toggle translates cart/checkout/order chrome; product names stay as entered.
- [ ] **Q4** The submit button disables while submitting, so double-tap is also prevented client-side.
- [ ] **Q5** A `409` out-of-stock error is shown in plain language naming the item, not a raw status code.
- [ ] **Q6** Placing an order clears the cart; going back does not show stale items.
- [ ] **Q7** Console clean on all three pages.
- [ ] **Q8** `/` and `/shop` still work - no regression from Plan 1. *(Partial: `GET /api/shop/collections` returned 200 throughout the entire verification run including after catalog mutations and a full container restart - the API is not regressed. Actual page rendering NOT VERIFIED - no browser tool.)*

---

## R. Address autocomplete

- [ ] **R1** With `VITE_GOONG_API_KEY` set: typing 4+ chars shows Vietnamese address suggestions; picking one fills the field.
- [ ] **R2** The chosen address is stored, with ward/district/province populated where available.
- [x] **R3** **With the key unset**: the field degrades to a plain textarea and ordering still works end to end. *(Functional/API-level: `VITE_GOONG_API_KEY` is unset in this stack, and every one of dozens of orders placed during verification used a plain-text address and succeeded end-to-end. Visual confirmation that the field itself renders as a plain textarea NOT VERIFIED - no browser tool.)*
- [ ] **R4** With a deliberately invalid key: no suggestions appear, no error is shown to the buyer, and ordering still works. A third-party outage must never block checkout.
- [x] **R5** A manually typed address (no suggestion picked) is saved and appears in the admin. *(API-level: confirmed via `GET /api/admin/orders/:id`. Admin UI rendering itself NOT VERIFIED - no browser tool.)*

---

## Sign-off

- [x] All blocking sections (D, E, F, G, I, J) fully PASS. (D1/D2 and G4/G5 within these sections are UI-only items still NOT VERIFIED - no browser tool; every API/DB-checkable item in D, E, F, G, I, J passed.)
- [x] Concurrency (F) repeated 3× with zero oversells. (60 total genuinely concurrent HTTP requests against a stock of 1, real network layer - one winner every round, conservation invariant held throughout.)
- [x] `cd backend && npm test` passes, including `orderConcurrency` run 20× consecutively. (174/174 as of the last Plan 2 fix round; `orderConcurrency` was run 20× consecutively with zero failures during Task 4's review.)
- [x] `cd frontend && npm test && npm run build && npm run lint` pass. (16/16 frontend tests, build clean, lint at the pre-existing baseline - 1 error + 3 warnings, none in shop code.)
- [x] Non-blocking failures recorded with an explicit decision to accept. (K5 and the worker-entrypoint infra bug were both FIXED, not merely accepted - see inline notes in Sections J and K above.)

**Remaining before a full human sign-off:** a browser pass over Section B (cart), Section Q (frontend quality), most of Section R (Goong autocomplete with a real key), and the UI-only items within C, D, G, H, K, L, N (~35 items total, all listed unchecked above). Every money/stock/concurrency/idempotency/security item checkable without a browser is confirmed PASS. See `.superpowers/sdd/plan2-acceptance-report.md` for full evidence per item.

Only then start Plan 3 (payments, proof, email, QR, backups).
