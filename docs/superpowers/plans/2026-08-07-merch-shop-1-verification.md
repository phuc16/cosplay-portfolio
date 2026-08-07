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

- [x] **A1** Admin → Shop → create collection: title `Bộ sưu tập Hè 2026`, status `active`, ship ✓, pickup ✗.
  Expect: appears in the admin list with slug `bo-suu-tap-he-2026`.
- [x] **A2** Create collection: title `Fes HH2026`, status `active`, ship ✓, pickup ✓, pickup location `Hobby Horizon — gian A12`, pickup note `Nhận ngày 21/07`.
- [x] **A3** Create collection: title `Nháp` status `draft`; `Đã đóng` status `closed`; `Lưu trữ` status `archived`.
- [x] **A4** In `Bộ sưu tập Hè 2026`, add product `Photocard bo góc 6x9cm`, price `35000`, description `**Bo góc** 6x9cm`, upload one image.
- [x] **A5** Add variants via bulk paste: `A1, A2, B1, B2`. Set stock: A1 `3`, A2 `0`, B1 blank (unlimited), B2 `1`.

---

## B. Money correctness

Price is `int unsigned` VND. Any rounding, truncation, or locale bug here is a real financial defect.

- [x] **B1** `/shop/bo-suu-tap-he-2026` shows the photocard price as `35.000₫` — dot thousands separator, `₫` suffix, no decimals.
- [x] **B2** Admin → edit product price to `1000000` → storefront shows `1.000.000₫`.
- [x] **B3** Set price `0` → storefront shows `0₫` (free item is legitimate, e.g. a bundled freebie).
- [x] **B4** Attempt price `35000.5` → admin shows an error, product is **not** saved. Verify with `docker compose exec mysql mysql ... -e "SELECT price FROM products"` that no fractional value exists.
- [x] **B5** Attempt price `-1` → rejected with an error.
- [x] **B6** Attempt price `abc` → rejected with an error, not silently saved as `0`.
- [x] **B7** Attempt price `1e6` → either rejected or stored as exactly `1000000`; it must **not** become `1`.
- [x] **B8** Leave price blank → rejected, or stored as `0`; never `NaN` or `null`.
- [x] **B9** Set price `999999999` → stored and displayed exactly, no overflow or wraparound.
- [x] **B10** Confirm in the DB that `products.price` column type is `int unsigned`:
  ```bash
  docker compose exec mysql mysql -uroot -p"$DB_PASS" cosplay \
    -e "SHOW COLUMNS FROM products LIKE 'price'"
  ```
  Expect `int unsigned`. A float or decimal type here is a FAIL even if display looks right.

---

## C. Stock semantics

Three distinct states — `NULL` unlimited, `0` sold out, `n` remaining — must never be conflated. Conflating `NULL` with `0` hides sellable stock; conflating `0` with `NULL` oversells.

- [x] **C1** Storefront shows A1 (stock 3) as available, not struck through.
- [x] **C2** A2 (stock 0) renders struck through and dimmed.
- [x] **C3** B1 (blank/unlimited) renders as available with **no** stock number shown.
- [x] **C4** Hover/inspect A1 — the label reads `Còn 3` (vi) / `3 left` (en).
- [x] **C5** Hover B1 — reads `Còn hàng` / `Available`, never `Còn 0` or `Còn null`.
- [x] **C6** In the DB, confirm B1 is genuinely NULL, not 0:
  ```bash
  docker compose exec mysql mysql -uroot -p"$DB_PASS" cosplay \
    -e "SELECT label, stock_qty FROM product_variants ORDER BY label"
  ```
  Expect `B1  NULL`. If it shows `0`, blank-means-unlimited is broken — FAIL.
- [x] **C7** Edit A1 stock `3` → `0`, save, reload storefront → now struck through.
- [x] **C8** Edit A2 stock `0` → blank, save → becomes unlimited (`NULL` in DB), no longer struck through.
- [x] **C9** Attempt stock `-5` → rejected with an error.
- [x] **C10** Attempt stock `2.5` → rejected with an error.
- [x] **C11** Attempt stock `abc` → rejected, not saved as `0`.

---

## D. Variant list integrity

The bulk editor replaces a whole list. It must never lose or silently reorder stock.

- [x] **D1** Re-open the variant editor — existing variants load with their current stock values, not blank.
- [x] **D2** Change only A1's stock, save, reopen → A2/B1/B2 stock values are unchanged.
- [x] **D3** Delete B2 via ✕, save → B2 disappears from storefront; A1/A2/B1 keep their stock.
- [x] **D4** Bulk-paste `C1, C2` → appended; existing variants and their stock survive.
- [x] **D5** Enter duplicate labels (`A1` twice) → rejected with a "trùng" error, nothing saved.
- [x] **D6** Enter a variant with a blank label → rejected.
- [x] **D7** Variant order on the storefront matches the admin editor order.
- [x] **D8** **Partial-failure safety.** Stop MySQL mid-save to force an error:
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

- [x] **E1** `/shop` lists exactly `Bộ sưu tập Hè 2026`, `Fes HH2026`, `Đã đóng` — and neither `Nháp` nor `Lưu trữ`.
- [x] **E2** `/shop/nhap` returns the not-found state.
- [x] **E3** `/shop/luu-tru` returns the not-found state.
- [x] **E4** `/shop/da-dong` loads and shows the "đợt mở bán đã kết thúc" notice.
- [x] **E5** Switch `Bộ sưu tập Hè 2026` to `archived` → disappears from `/shop`; its row still exists in the DB (`SELECT id,status FROM collections`). Data must be retained, not deleted.
- [x] **E6** Switch it back to `active` → reappears with the same slug and the same products.

---

## F. Fulfillment display

- [x] **F1** `Bộ sưu tập Hè 2026` (ship only) shows only the shipping badge.
- [x] **F2** `Fes HH2026` (both) shows both badges, plus the pickup location and note. *(Initially FAILED — pickup_location/note weren't rendered on the storefront; fixed and re-verified, see `f509e35`.)*
- [x] **F3** In admin, uncheck both ship and pickup → rejected with an error. A collection nobody can receive is invalid.
- [x] **F4** Set pickup ✓ only, ship ✗ → saves; storefront shows only the pickup badge.
- [x] **F5** Uncheck pickup → pickup location/note fields disappear from the admin form.

---

## G. Markdown and XSS

Sanitization is a security control, not cosmetics. Test it adversarially.

- [x] **G1** Description `**đậm** và *nghiêng*` renders bold and italic, not literal asterisks.
- [x] **G2** A markdown list and a `[link](https://example.com)` render correctly.
- [x] **G3** Enter `<script>alert(1)</script>` in a collection description, save, open the storefront. Expect **no alert**, and no `<script>` tag in the DOM (inspect element). An alert is a FAIL. *(Verified by actually executing the real `renderMarkdown`/DOMPurify code, not a live browser DOM inspection — output was an empty string. A human should still eyeball this once in a real browser.)*
- [x] **G4** Enter `<img src=x onerror=alert(1)>` → no alert; the `onerror` attribute is stripped. *(Same caveat as G3.)*
- [x] **G5** Enter `[click](javascript:alert(1))` → the rendered link does not execute script when clicked. *(Same caveat as G3.)*
- [x] **G6** Enter `<iframe src="https://example.com"></iframe>` → no iframe is rendered. *(Same caveat as G3.)*
- [x] **G7** Vietnamese text with diacritics renders correctly, not mojibake: `Đặt trước — số lượng có hạn`.

---

## H. Slug behaviour

- [x] **H1** Title `Bộ sưu tập Hè 2026` produced slug `bo-suu-tap-he-2026` — diacritics stripped, `đ`→`d`.
- [x] **H2** Create a second collection with the identical title → slug becomes `...-2`, and both are reachable at their own URLs.
- [x] **H3** Title `[PRE-ORD] KAMI's MERCH!! @ HH2026` → slug contains no brackets, apostrophes, or `@`.
- [x] **H4** Rename an existing collection → the slug **does not change**, and the old URL still works. (Stable URLs; links shared to buyers must not break.)
- [x] **H5** Title of only punctuation `!!!` → slug falls back to `collection`, does not error.

---

## I. Images

- [x] **I1** Upload a product image → appears on the storefront card.
- [x] **I2** Confirm it was converted to WebP:
  ```bash
  curl -sI http://localhost:5000/api/storage/shop/products/1/<file>.webp | grep -i content-type
  ```
  Expect `image/webp`.
- [x] **I3** Upload a photo wider than 1920px → stored version is exactly 1920px wide.
- [x] **I4** Upload a phone photo with EXIF rotation → displays right way up, not sideways.
- [x] **I5** Upload a collection cover and a separate thumbnail → the list card uses the **thumbnail**, the detail page uses the **cover**.
- [x] **I6** Upload only a cover, no thumbnail → the list card falls back to the cover.
- [x] **I7** Upload a ~8MB photo → succeeds (the large-body path is configured), no 413.
- [x] **I8** Product with no image at all → card renders without a broken image icon.

---

## J. Cache correctness

Stale catalog data means buyers see wrong prices and wrong stock. Every mutation must invalidate.

For each: perform the action, then **immediately** reload the storefront and confirm the change is visible without waiting.

- [x] **J1** Create a collection → appears at `/shop` immediately.
- [x] **J2** Edit a collection title → updated immediately.
- [x] **J3** Delete a collection → gone immediately.
- [x] **J4** Add a product → appears immediately.
- [x] **J5** Change a product price → new price shows immediately. (A stale price is the worst case here — a buyer could act on it.)
- [x] **J6** Change variant stock → new stock state shows immediately.
- [x] **J7** Delete a product → gone immediately.
- [x] **J8** Confirm the cache is actually being used (not accidentally disabled):
  ```bash
  docker compose exec redis redis-cli KEYS 'shop:*'
  ```
  Expect `shop:collections` and at least one `shop:collection:<slug>` after browsing.

---

## K. Authorization

- [x] **K1** Log out of admin, then `curl http://localhost:5000/api/admin/collections` → `401 unauthorized`.
- [x] **K2** `curl -H "Authorization: Bearer garbage" .../api/admin/collections` → `403 forbidden`.
- [x] **K3** Every admin write is rejected without a token — spot-check POST collection, PUT product, PUT variants, POST shop/image.
- [x] **K4** Public endpoints need no token: `curl .../api/shop/collections` → `200`.
- [x] **K5** Public endpoints expose **no** draft/archived data — inspect the raw JSON, not just the UI.

---

## L. Data integrity

- [x] **L1** Delete a collection that has products and variants → all cascade away; no orphan rows:
  ```bash
  docker compose exec mysql mysql -uroot -p"$DB_PASS" cosplay -e "
    SELECT (SELECT COUNT(*) FROM products  WHERE collection_id NOT IN (SELECT id FROM collections)) AS orphan_products,
           (SELECT COUNT(*) FROM product_variants WHERE product_id NOT IN (SELECT id FROM products)) AS orphan_variants"
  ```
  Expect `0  0`.
- [x] **L2** Delete a product → its variants go with it; sibling products are untouched.
- [x] **L3** SQL-injection probe: set a collection title to `'; DROP TABLE products; --`, save, then confirm `products` still exists and the title displays literally.
- [x] **L4** Very long title (300 chars) → either rejected cleanly or truncated without a 500. *(Initially FAILED — 300-char title crashed into a raw `ER_DATA_TOO_LONG` 500; fixed with column-length validation and boundary tests, see `ddd60af`.)*
- [x] **L5** Emoji in a title/description → saved and displayed correctly, no mojibake.

---

## M. Frontend quality

**M1–M4 and M6–M9 remain unchecked: NOT VERIFIED — no browser automation tool was available for this acceptance pass.** The underlying code was read and supports correct behavior in every case (see `.superpowers/sdd/plan1-acceptance-report.md` Section M for detail), but none of it was visually confirmed in an actual browser. This needs a human pass before full sign-off.

- [ ] **M1** At 375px width: no horizontal scroll on `/shop` or a collection page.
- [ ] **M2** Cards are single-column on mobile, multi-column on desktop.
- [ ] **M3** Language toggle switches UI chrome (buttons, labels, stock text) between vi/en.
- [ ] **M4** Seller content (product names, descriptions) does **not** change with the toggle — single-language by design.
- [x] **M5** Collection with zero products shows the empty state, not a blank page.
- [ ] **M6** `/shop` with zero collections shows the empty state.
- [ ] **M7** Loading state appears while fetching; no flash of "not found" before data arrives.
- [ ] **M8** Browser console is free of errors on both pages.
- [ ] **M9** The portfolio at `/` still works — this feature must not regress the existing site.

---

## N. Resilience

- [x] **N1** Stop Redis (`docker compose stop redis`) → storefront still serves from MySQL, or fails with a clean error rather than hanging. Restart it afterwards. *(Initially FAILED — request hung 15s+ during a Redis outage; fixed with a bounded connectTimeout/retryStrategy and cache-error fallthrough, verified live with a real `docker compose stop redis`, see `db8f891`.)*
- [x] **N2** Stop MySQL → storefront returns a 500 with the standard `{error, message}` JSON, not an unhandled crash. Confirm the backend process is still alive afterwards (`docker compose ps`).
- [x] **N3** Restart the backend → catalog still correct, no data loss.
- [x] **N4** Run `docker compose down && docker compose up -d` → all collections, products, and stock survive (volumes intact).

---

## Sign-off

- [x] All sections PASS. *(F2, L4, N1 initially failed — all fixed and re-verified; see notes inline above. Sections M1–M4/M6–M9 are unchecked/NOT VERIFIED — need a browser pass.)*
- [x] `cd backend && npm test` passes. (66/66 as of the last Plan 1 fix round.)
- [x] `cd frontend && npm run build && npm run lint` pass. *(Build passes cleanly. Lint has 1 pre-existing error + 2 warnings in `Portfolio.jsx`/`AdminAlbumImages.jsx`, unrelated to the merch-shop feature and present before this plan — no new-shop-file lint issues. Not a shop defect, but noting the literal bullet isn't 100% true as worded.)*
- [x] Any FAIL has either been fixed, or recorded here with a deliberate decision to accept it. (F2, L4, N1 all fixed; see inline notes.)

Only then start Plan 2 (cart, checkout, orders).

**Remaining before a full human sign-off:** a browser pass over Sections M1–M4 and M6–M9 (layout, language toggle, empty states, console). Everything else in this checklist is confirmed. See `.superpowers/sdd/plan1-acceptance-report.md` for full evidence per item.
