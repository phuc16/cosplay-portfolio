# Merch Shop — Plan 1 Verification (post-implementation QA)

Run this **after** every task in `2026-08-07-merch-shop-1-catalog.md` is implemented and committed, against a running stack. This is acceptance testing of the built feature, separate from the unit tests written during implementation.

Money and stock are the commerce-critical surfaces here. A wrong price or a variant that appears in stock when it is not causes real disputes with real buyers, so those sections are exhaustive rather than representative.

## How to run

```bash
docker compose up -d --build
cd frontend && npm run dev      # http://localhost:5173
```

Log into `/admin` with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

Record each check as PASS / FAIL. **Any FAIL blocks moving to Plan 2** — do not build checkout on a catalog that misreports stock or price.

Reset between full runs:
```bash
docker compose exec mysql mysql -uroot -p"$DB_PASS" cosplay \
  -e "SET FOREIGN_KEY_CHECKS=0; TRUNCATE product_variants; TRUNCATE products; TRUNCATE collections; SET FOREIGN_KEY_CHECKS=1;"
docker compose exec redis redis-cli DEL shop:collections
docker compose exec redis redis-cli --scan --pattern 'shop:collection:*' | xargs -r docker compose exec -T redis redis-cli DEL
```

---

## A. Seed data

Create this once; later sections depend on it.

- [ ] **A1** Admin → Shop → create collection: title `Bộ sưu tập Hè 2026`, status `active`, ship ✓, pickup ✗.
  Expect: appears in the admin list with slug `bo-suu-tap-he-2026`.
- [ ] **A2** Create collection: title `Fes HH2026`, status `active`, ship ✓, pickup ✓, pickup location `Hobby Horizon — gian A12`, pickup note `Nhận ngày 21/07`.
- [ ] **A3** Create collection: title `Nháp` status `draft`; `Đã đóng` status `closed`; `Lưu trữ` status `archived`.
- [ ] **A4** In `Bộ sưu tập Hè 2026`, add product `Photocard bo góc 6x9cm`, price `35000`, description `**Bo góc** 6x9cm`, upload one image.
- [ ] **A5** Add variants via bulk paste: `A1, A2, B1, B2`. Set stock: A1 `3`, A2 `0`, B1 blank (unlimited), B2 `1`.

---

## B. Money correctness

Price is `int unsigned` VND. Any rounding, truncation, or locale bug here is a real financial defect.

- [ ] **B1** `/shop/bo-suu-tap-he-2026` shows the photocard price as `35.000₫` — dot thousands separator, `₫` suffix, no decimals.
- [ ] **B2** Admin → edit product price to `1000000` → storefront shows `1.000.000₫`.
- [ ] **B3** Set price `0` → storefront shows `0₫` (free item is legitimate, e.g. a bundled freebie).
- [ ] **B4** Attempt price `35000.5` → admin shows an error, product is **not** saved. Verify with `docker compose exec mysql mysql ... -e "SELECT price FROM products"` that no fractional value exists.
- [ ] **B5** Attempt price `-1` → rejected with an error.
- [ ] **B6** Attempt price `abc` → rejected with an error, not silently saved as `0`.
- [ ] **B7** Attempt price `1e6` → either rejected or stored as exactly `1000000`; it must **not** become `1`.
- [ ] **B8** Leave price blank → rejected, or stored as `0`; never `NaN` or `null`.
- [ ] **B9** Set price `999999999` → stored and displayed exactly, no overflow or wraparound.
- [ ] **B10** Confirm in the DB that `products.price` column type is `int unsigned`:
  ```bash
  docker compose exec mysql mysql -uroot -p"$DB_PASS" cosplay \
    -e "SHOW COLUMNS FROM products LIKE 'price'"
  ```
  Expect `int unsigned`. A float or decimal type here is a FAIL even if display looks right.

---

## C. Stock semantics

Three distinct states — `NULL` unlimited, `0` sold out, `n` remaining — must never be conflated. Conflating `NULL` with `0` hides sellable stock; conflating `0` with `NULL` oversells.

- [ ] **C1** Storefront shows A1 (stock 3) as available, not struck through.
- [ ] **C2** A2 (stock 0) renders struck through and dimmed.
- [ ] **C3** B1 (blank/unlimited) renders as available with **no** stock number shown.
- [ ] **C4** Hover/inspect A1 — the label reads `Còn 3` (vi) / `3 left` (en).
- [ ] **C5** Hover B1 — reads `Còn hàng` / `Available`, never `Còn 0` or `Còn null`.
- [ ] **C6** In the DB, confirm B1 is genuinely NULL, not 0:
  ```bash
  docker compose exec mysql mysql -uroot -p"$DB_PASS" cosplay \
    -e "SELECT label, stock_qty FROM product_variants ORDER BY label"
  ```
  Expect `B1  NULL`. If it shows `0`, blank-means-unlimited is broken — FAIL.
- [ ] **C7** Edit A1 stock `3` → `0`, save, reload storefront → now struck through.
- [ ] **C8** Edit A2 stock `0` → blank, save → becomes unlimited (`NULL` in DB), no longer struck through.
- [ ] **C9** Attempt stock `-5` → rejected with an error.
- [ ] **C10** Attempt stock `2.5` → rejected with an error.
- [ ] **C11** Attempt stock `abc` → rejected, not saved as `0`.

---

## D. Variant list integrity

The bulk editor replaces a whole list. It must never lose or silently reorder stock.

- [ ] **D1** Re-open the variant editor — existing variants load with their current stock values, not blank.
- [ ] **D2** Change only A1's stock, save, reopen → A2/B1/B2 stock values are unchanged.
- [ ] **D3** Delete B2 via ✕, save → B2 disappears from storefront; A1/A2/B1 keep their stock.
- [ ] **D4** Bulk-paste `C1, C2` → appended; existing variants and their stock survive.
- [ ] **D5** Enter duplicate labels (`A1` twice) → rejected with a "trùng" error, nothing saved.
- [ ] **D6** Enter a variant with a blank label → rejected.
- [ ] **D7** Variant order on the storefront matches the admin editor order.
- [ ] **D8** **Partial-failure safety.** Stop MySQL mid-save to force an error:
  ```bash
  docker compose stop mysql   # then click Save in the variant editor
  docker compose start mysql
  ```
  Reload the product. Expect the variant list to be **exactly as it was before** the failed save — not empty, not partially written. A wiped list here means the transaction is not working — FAIL.

---

## E. Collection visibility matrix

Verify all four statuses against both the storefront list and the direct URL.

| Status | Appears in `/shop` list | Direct `/shop/<slug>` |
|---|---|---|
| `draft` | no | 404 |
| `active` | yes | 200, orderable-looking |
| `closed` | yes | 200 + "drop has ended" notice |
| `archived` | no | 404 |

- [ ] **E1** `/shop` lists exactly `Bộ sưu tập Hè 2026`, `Fes HH2026`, `Đã đóng` — and neither `Nháp` nor `Lưu trữ`.
- [ ] **E2** `/shop/nhap` returns the not-found state.
- [ ] **E3** `/shop/luu-tru` returns the not-found state.
- [ ] **E4** `/shop/da-dong` loads and shows the "đợt mở bán đã kết thúc" notice.
- [ ] **E5** Switch `Bộ sưu tập Hè 2026` to `archived` → disappears from `/shop`; its row still exists in the DB (`SELECT id,status FROM collections`). Data must be retained, not deleted.
- [ ] **E6** Switch it back to `active` → reappears with the same slug and the same products.

---

## F. Fulfillment display

- [ ] **F1** `Bộ sưu tập Hè 2026` (ship only) shows only the shipping badge.
- [ ] **F2** `Fes HH2026` (both) shows both badges, plus the pickup location and note.
- [ ] **F3** In admin, uncheck both ship and pickup → rejected with an error. A collection nobody can receive is invalid.
- [ ] **F4** Set pickup ✓ only, ship ✗ → saves; storefront shows only the pickup badge.
- [ ] **F5** Uncheck pickup → pickup location/note fields disappear from the admin form.

---

## G. Markdown and XSS

Sanitization is a security control, not cosmetics. Test it adversarially.

- [ ] **G1** Description `**đậm** và *nghiêng*` renders bold and italic, not literal asterisks.
- [ ] **G2** A markdown list and a `[link](https://example.com)` render correctly.
- [ ] **G3** Enter `<script>alert(1)</script>` in a collection description, save, open the storefront. Expect **no alert**, and no `<script>` tag in the DOM (inspect element). An alert is a FAIL.
- [ ] **G4** Enter `<img src=x onerror=alert(1)>` → no alert; the `onerror` attribute is stripped.
- [ ] **G5** Enter `[click](javascript:alert(1))` → the rendered link does not execute script when clicked.
- [ ] **G6** Enter `<iframe src="https://example.com"></iframe>` → no iframe is rendered.
- [ ] **G7** Vietnamese text with diacritics renders correctly, not mojibake: `Đặt trước — số lượng có hạn`.

---

## H. Slug behaviour

- [ ] **H1** Title `Bộ sưu tập Hè 2026` produced slug `bo-suu-tap-he-2026` — diacritics stripped, `đ`→`d`.
- [ ] **H2** Create a second collection with the identical title → slug becomes `...-2`, and both are reachable at their own URLs.
- [ ] **H3** Title `[PRE-ORD] KAMI's MERCH!! @ HH2026` → slug contains no brackets, apostrophes, or `@`.
- [ ] **H4** Rename an existing collection → the slug **does not change**, and the old URL still works. (Stable URLs; links shared to buyers must not break.)
- [ ] **H5** Title of only punctuation `!!!` → slug falls back to `collection`, does not error.

---

## I. Images

- [ ] **I1** Upload a product image → appears on the storefront card.
- [ ] **I2** Confirm it was converted to WebP:
  ```bash
  curl -sI http://localhost:5000/api/storage/shop/products/1/<file>.webp | grep -i content-type
  ```
  Expect `image/webp`.
- [ ] **I3** Upload a photo wider than 1920px → stored version is exactly 1920px wide.
- [ ] **I4** Upload a phone photo with EXIF rotation → displays right way up, not sideways.
- [ ] **I5** Upload a collection cover and a separate thumbnail → the list card uses the **thumbnail**, the detail page uses the **cover**.
- [ ] **I6** Upload only a cover, no thumbnail → the list card falls back to the cover.
- [ ] **I7** Upload a ~8MB photo → succeeds (the large-body path is configured), no 413.
- [ ] **I8** Product with no image at all → card renders without a broken image icon.

---

## J. Cache correctness

Stale catalog data means buyers see wrong prices and wrong stock. Every mutation must invalidate.

For each: perform the action, then **immediately** reload the storefront and confirm the change is visible without waiting.

- [ ] **J1** Create a collection → appears at `/shop` immediately.
- [ ] **J2** Edit a collection title → updated immediately.
- [ ] **J3** Delete a collection → gone immediately.
- [ ] **J4** Add a product → appears immediately.
- [ ] **J5** Change a product price → new price shows immediately. (A stale price is the worst case here — a buyer could act on it.)
- [ ] **J6** Change variant stock → new stock state shows immediately.
- [ ] **J7** Delete a product → gone immediately.
- [ ] **J8** Confirm the cache is actually being used (not accidentally disabled):
  ```bash
  docker compose exec redis redis-cli KEYS 'shop:*'
  ```
  Expect `shop:collections` and at least one `shop:collection:<slug>` after browsing.

---

## K. Authorization

- [ ] **K1** Log out of admin, then `curl http://localhost:5000/api/admin/collections` → `401 unauthorized`.
- [ ] **K2** `curl -H "Authorization: Bearer garbage" .../api/admin/collections` → `403 forbidden`.
- [ ] **K3** Every admin write is rejected without a token — spot-check POST collection, PUT product, PUT variants, POST shop/image.
- [ ] **K4** Public endpoints need no token: `curl .../api/shop/collections` → `200`.
- [ ] **K5** Public endpoints expose **no** draft/archived data — inspect the raw JSON, not just the UI.

---

## L. Data integrity

- [ ] **L1** Delete a collection that has products and variants → all cascade away; no orphan rows:
  ```bash
  docker compose exec mysql mysql -uroot -p"$DB_PASS" cosplay -e "
    SELECT (SELECT COUNT(*) FROM products  WHERE collection_id NOT IN (SELECT id FROM collections)) AS orphan_products,
           (SELECT COUNT(*) FROM product_variants WHERE product_id NOT IN (SELECT id FROM products)) AS orphan_variants"
  ```
  Expect `0  0`.
- [ ] **L2** Delete a product → its variants go with it; sibling products are untouched.
- [ ] **L3** SQL-injection probe: set a collection title to `'; DROP TABLE products; --`, save, then confirm `products` still exists and the title displays literally.
- [ ] **L4** Very long title (300 chars) → either rejected cleanly or truncated without a 500.
- [ ] **L5** Emoji in a title/description → saved and displayed correctly, no mojibake.

---

## M. Frontend quality

- [ ] **M1** At 375px width: no horizontal scroll on `/shop` or a collection page.
- [ ] **M2** Cards are single-column on mobile, multi-column on desktop.
- [ ] **M3** Language toggle switches UI chrome (buttons, labels, stock text) between vi/en.
- [ ] **M4** Seller content (product names, descriptions) does **not** change with the toggle — single-language by design.
- [ ] **M5** Collection with zero products shows the empty state, not a blank page.
- [ ] **M6** `/shop` with zero collections shows the empty state.
- [ ] **M7** Loading state appears while fetching; no flash of "not found" before data arrives.
- [ ] **M8** Browser console is free of errors on both pages.
- [ ] **M9** The portfolio at `/` still works — this feature must not regress the existing site.

---

## N. Resilience

- [ ] **N1** Stop Redis (`docker compose stop redis`) → storefront still serves from MySQL, or fails with a clean error rather than hanging. Restart it afterwards.
- [ ] **N2** Stop MySQL → storefront returns a 500 with the standard `{error, message}` JSON, not an unhandled crash. Confirm the backend process is still alive afterwards (`docker compose ps`).
- [ ] **N3** Restart the backend → catalog still correct, no data loss.
- [ ] **N4** Run `docker compose down && docker compose up -d` → all collections, products, and stock survive (volumes intact).

---

## Sign-off

- [ ] All sections PASS.
- [ ] `cd backend && npm test` passes.
- [ ] `cd frontend && npm run build && npm run lint` pass.
- [ ] Any FAIL has either been fixed, or recorded here with a deliberate decision to accept it.

Only then start Plan 2 (cart, checkout, orders).
