# Merch Shop — Plan 3 Verification (post-implementation QA)

Run after every task in `2026-08-07-merch-shop-3-payments.md` is implemented and committed, against a running stack. This is the final gate before the feature goes live.

**Blocking sections: D, E, H, L.** A wrong account number or an unscannable QR sends a buyer's money somewhere it cannot be recovered from; an email failure that rolls back an order loses a paid sale; an unrestorable backup means an outage becomes permanent data loss. Nothing ships with an open failure in those.

## Setup

```bash
docker compose up -d --build
docker run -d --name maildev -p 1080:1080 -p 1025:1025 maildev/maildev
cd frontend && npm run dev
```

Point the backend at the capture server so **nothing reaches a real inbox** during testing:
```
SMTP_HOST=localhost  SMTP_PORT=1025  SMTP_USER=x  SMTP_PASS=x
SMTP_FROM=shop@example.com  ADMIN_EMAIL=seller@example.com
SITE_URL=http://localhost:5173  SHOP_NAME=Kami Shop
```

Inbox: `http://localhost:1080`. Helpers:
```bash
API=http://localhost:5000/api
DBX="docker compose exec -T mysql mysql -uroot -p$DB_PASS cosplay -N -B -e"
```

---

## A. Payment settings admin

- [ ] **A1** Admin → Thanh toán tab loads with all methods off by default.
- [ ] **A2** Enable **bank** with only a name → rejected, message names the missing field.
- [ ] **A3** Enable bank with BIN `abc` → rejected (must be numeric).
- [ ] **A4** Enable bank fully (ACB, BIN `970416`, account, holder) → saves.
- [ ] **A5** Enable **Momo** with neither phone nor QR image → rejected.
- [ ] **A6** Enable Momo with a phone only → saves.
- [ ] **A7** Enable Momo with a QR image upload only → saves; the image renders in admin.
- [ ] **A8** Enable **PayPal** with no link → rejected.
- [ ] **A9** Enable **COD** → saves (needs no configuration).
- [ ] **A10** Reload the page → every setting persisted.
- [ ] **A11** Only one settings row exists, no matter how many saves:
  ```bash
  eval "$DBX 'SELECT COUNT(*) FROM payment_settings'"
  ```
  Expect `1`.
- [ ] **A12** Reserved SePay fields are **not** rendered anywhere in the admin UI (they are unwired).

---

## B. Checkout method filtering

- [ ] **B1** With only bank + COD enabled, checkout offers exactly those two.
- [ ] **B2** Disable COD → checkout offers only bank; reload confirms.
- [ ] **B3** Disable **all** methods → checkout refuses to submit and shows a message to contact the seller. No order is created.
- [ ] **B4** API-level: with only bank enabled, ordering with `paypal` is rejected:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/orders -H 'Content-Type: application/json' \
    -d '{"items":[{"variant_id":<ID>,"qty":1}],"buyer":{"buyer_name":"A","phone":"09","email":"a@b.co","address_raw":"x"},"fulfillment_method":"ship","payment_method":"paypal"}'
  ```
  Expect `400`, and `SELECT COUNT(*) FROM orders` unchanged.
- [ ] **B5** The public endpoint leaks nothing sensitive:
  ```bash
  curl -s $API/shop/payment-methods | jq .
  ```
  Expect only `methods` and `payment_note` — **no** account number, no SePay key.

---

## C. Payment instructions (blocking)

A wrong account number here sends real money to the wrong place.

- [ ] **C1** Place a bank order. The order page shows bank name, account number, holder, and amount.
- [ ] **C2** **Character-by-character, confirm the displayed account number matches what was entered in admin.** Compare against:
  ```bash
  eval "$DBX 'SELECT bank_account_number, bank_account_holder, bank_bin FROM payment_settings'"
  ```
- [ ] **C3** The amount shown equals the order total exactly, formatted as VND.
- [ ] **C4** A transfer note (`DH…`) is displayed prominently and is stable across reloads.
- [ ] **C5** Two different orders produce **different** transfer notes.
- [ ] **C6** Copy-to-clipboard for the account number and note yields exactly the displayed value (no whitespace, no truncation).
- [ ] **C7** A **Momo** order shows Momo details and **no** bank account number anywhere:
  ```bash
  curl -s $API/orders/<MOMO_TOKEN>/payment | jq .
  ```
  Confirm the bank account number string does not appear.
- [ ] **C8** A **PayPal** order shows the link and no other account details.
- [ ] **C9** A **COD** order shows the amount due on delivery and **no** account details or QR.
- [ ] **C10** Break the bank config (blank the BIN) → the order page still shows the printed account details with an explanation, **not** a blank box or an error page.
- [ ] **C11** `payment_note` from settings appears on the order page when set.

---

## D. VietQR against a real bank (blocking)

Unit tests prove the encoding is self-consistent. Only a banking app proves it is correct.

- [ ] **D1** Configure the seller's **real** ACB account in admin.
- [ ] **D2** Place a test order with a small total (e.g. 2.000₫).
- [ ] **D3** Open the order page and scan the VietQR with a Vietnamese banking app (ACB ONE, MoMo, Vietcombank, or any VietQR-capable app).
- [ ] **D4** The app pre-fills the **correct account number**.
- [ ] **D5** The app shows the **correct account holder name**.
- [ ] **D6** The app pre-fills the **exact amount** (2.000₫, not 2₫, not 200.000₫).
- [ ] **D7** The app pre-fills the **transfer note** matching the one displayed on the page.
- [ ] **D8** Scan a second order's QR → different amount and different note.
- [ ] **D9** Scan the QR rendered in the **email** (MailDev) → same result.
- [ ] **D10** *(Optional but recommended)* actually complete the 2.000₫ transfer and confirm the note arrives intact in the bank statement, since that is what the seller will match against.

**If any of D4–D7 is wrong, stop.** A QR that encodes the wrong account or amount is the single most damaging defect in this feature.

---

## E. Payment proof

- [ ] **E1** On a pending order, upload a screenshot → success, thumbnail appears.
- [ ] **E2** The image is stored and viewable via the storage proxy; `Content-Type` is `image/webp`.
- [ ] **E3** DB reflects it:
  ```bash
  eval "$DBX 'SELECT id, payment_proof_url, payment_proof_uploaded_at FROM orders ORDER BY id DESC LIMIT 1'"
  ```
- [ ] **E4** Upload a second image → replaces the first; the order still has exactly one proof URL.
- [ ] **E5** Admin order detail shows the proof inline.
- [ ] **E6** Confirm the order → the upload control disappears from the buyer's page.
- [ ] **E7** Force an upload on a confirmed order via API → `409`:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/orders/<TOKEN>/proof \
    -H 'Content-Type: application/json' -d '{"base64":"'"$(base64 -i some.png | tr -d '\n')"'"}'
  ```
- [ ] **E8** Upload a non-image (text file base64) → `400`, no DB change.
- [ ] **E9** Upload a ~8MB photo → succeeds (large-body path configured), stored compressed and much smaller.
- [ ] **E10** Unknown token → `404`.
- [ ] **E11** A COD order shows no proof-upload control (nothing to prove).

---

## F. Email content

- [ ] **F1** Place an order → `order_placed` arrives in MailDev within ~10s.
- [ ] **F2** A copy also arrives at `ADMIN_EMAIL`.
- [ ] **F3** Subject contains the order id.
- [ ] **F4** Vietnamese diacritics render correctly in subject and body — no mojibake (`Ä‘`, `?`).
- [ ] **F5** The item table lists every line with name, variant label, quantity, and line total.
- [ ] **F6** The total matches the order exactly, formatted `105.000₫`.
- [ ] **F7** The order link works and opens the right order.
- [ ] **F8** The shipping note ("phí ship trả cho shipper") appears for ship orders.
- [ ] **F9** The QR renders in the email body (it is a `cid:` attachment, not a blocked remote image).
- [ ] **F10** Confirm payment → `payment_confirmed` email arrives.
- [ ] **F11** Mark shipped with tracking `VTP123` → `shipped` email arrives **containing that code**.
- [ ] **F12** Cancel an order → `cancelled` email arrives.
- [ ] **F13** Mark completed → **no** email (deliberate).
- [ ] **F14** Let a prepaid order expire → exactly **one** cancellation email, even after several sweep cycles.
- [ ] **F15** No email contains a raw `{{placeholder}}`.

---

## G. Email template editing

- [ ] **G1** Admin → Email tab lists all four templates pre-filled with the defaults.
- [ ] **G2** Edit the `order_placed` subject → the next order's email uses the new wording.
- [ ] **G3** Save a template containing `{{oder_id}}` (typo) → rejected with a message naming the bad placeholder.
- [ ] **G4** Save with a valid placeholder set → accepted.
- [ ] **G5** "Restore default" repopulates the shipped default text.
- [ ] **G6** Restarting the stack does **not** overwrite an edited template (the seed only inserts what is missing):
  ```bash
  docker compose restart backend
  eval "$DBX 'SELECT type, subject FROM email_templates'"
  ```

---

## H. Email must never break orders (blocking)

- [ ] **H1** Stop the SMTP capture server (`docker stop maildev`), then place an order.
  Expect: the order is **created normally**, the buyer sees the order page, and the browser shows no error. Only delivery fails.
  ```bash
  eval "$DBX 'SELECT COUNT(*) FROM orders'"
  ```
- [ ] **H2** The queued email is retried and its attempt count climbs:
  ```bash
  eval "$DBX 'SELECT id, type, status, attempts, LEFT(last_error,40) FROM email_queue ORDER BY id DESC LIMIT 5'"
  ```
- [ ] **H3** After 5 attempts the row becomes `failed` and stops being retried — attempts stay at 5, not 50.
- [ ] **H4** Restart MailDev, place a new order → new mail sends normally; the previously failed row is **not** resurrected.
- [ ] **H5** With SMTP unconfigured entirely (unset `SMTP_HOST`), ordering still works and the worker does not error-loop.
- [ ] **H6** Confirming and shipping still work while SMTP is down — a mail failure must not block a status change.
- [ ] **H7** Deleting an order removes its queued mail:
  ```bash
  eval "$DBX 'SELECT COUNT(*) FROM email_queue WHERE order_id NOT IN (SELECT id FROM orders)'"
  ```
  Expect `0`.
- [ ] **H8** The worker keeps generating thumbnails and sweeping expiries while email is failing.

---

## I. Email escaping (security)

- [ ] **I1** Place an order with buyer name `<script>alert(1)</script>`. Open the email in MailDev → the name shows as literal text, and **no** `<script>` tag exists in the message source.
- [ ] **I2** Buyer name `<b>bold</b>` → renders as literal text, not bold.
- [ ] **I3** Note field `<img src=x onerror=alert(1)>` → inert in the email.
- [ ] **I4** A product name containing `&` renders as `&` in the email, not `&amp;amp;`.
- [ ] **I5** The subject line contains no HTML tags even when the buyer name has them.

---

## J. Order QR and admin scanner

- [ ] **J1** `/api/orders/<token>/qr.svg` returns an SVG.
- [ ] **J2** The order page renders the QR.
- [ ] **J3** Scan it with a plain phone camera → opens that exact order page.
- [ ] **J4** Two orders produce visibly different QRs.
- [ ] **J5** Unknown token → `404`, not a QR of an error page.
- [ ] **J6** Admin → Đơn hàng → "Quét QR" prompts for camera permission.
- [ ] **J7** Denying permission shows a readable message, not a blank overlay.
- [ ] **J8** Scanning a buyer's QR opens the **admin** order view with Confirm/Complete actions — **not** the read-only buyer page.
- [ ] **J9** Scanning an unrelated QR (e.g. a wifi QR) does nothing harmful and keeps scanning.
- [ ] **J10** Closing the scanner releases the camera (the indicator light goes out).
- [ ] **J11** Test on a real phone over HTTPS or `localhost` — camera APIs require a secure context.
- [ ] **J12** Test on **iOS Safari** specifically, which lacks `BarcodeDetector` and must use the `jsQR` fallback.
- [ ] **J13** The scanner bundle is not loaded on buyer pages — check the network tab on `/shop`; `jsqr` must not appear.

---

## K. Variant deletion guard (Plan 2 gap)

This is the fix for the gap Plan 2 recorded as an expected failure.

- [ ] **K1** Place an order for variant `A1`. In admin, try to remove `A1` from the product → rejected with `409`, message naming `A1`.
- [ ] **K2** `A1` still exists:
  ```bash
  eval "$DBX 'SELECT label FROM product_variants ORDER BY label'"
  ```
- [ ] **K3** Editing `A1`'s stock or label **is** still allowed.
- [ ] **K4** Cancel the order → `A1` can now be deleted.
- [ ] **K5** Place another order, complete it fully → the variant can be deleted.
- [ ] **K6** A confirmed (not yet shipped) order also blocks deletion — its stock is still committed.
- [ ] **K7** Re-run Plan 2 verification item **O7** — it should now **pass** rather than being an accepted failure.

---

## L. Backups (blocking)

- [ ] **L1** Run `./deploy/backup.sh` → reports OK with a file size.
- [ ] **L2** The dump exists and is non-trivial:
  ```bash
  ls -lh /var/backups/cosplay/
  ```
- [ ] **L3** Gzip integrity passes: `gzip -t <dump>`.
- [ ] **L4** The dump actually contains order data:
  ```bash
  gunzip -c <dump> | grep -c "INSERT INTO \`orders\`"
  ```
  Expect ≥ 1 (with orders present).
- [ ] **L5** **Restore drill.** Run `./deploy/restore.sh <dump>` and compare its printed counts and total sum against production:
  ```bash
  eval "$DBX 'SELECT COUNT(*), COALESCE(SUM(total),0) FROM orders'"
  ```
  Counts and the money total must match exactly.
- [ ] **L6** Record the restore wall-clock time here: ________
- [ ] **L7** Simulate a truncated dump (`head -c 100 <dump> > bad.sql.gz`) and confirm `backup.sh`-style validation rejects it — a corrupt file must not be mistaken for a backup.
- [ ] **L8** Retention prunes correctly: create a file older than the window and confirm a run deletes it.
  ```bash
  touch -d '20 days ago' /var/backups/cosplay/cosplay-old.sql.gz
  ./deploy/backup.sh && ls /var/backups/cosplay/
  ```
- [ ] **L9** The cron entry is installed and runs — check `/var/log/cosplay-backup.log` after the scheduled time.
- [ ] **L10** Drop the scratch restore database afterwards.

---

## M. Security and privacy

- [ ] **M1** `curl $API/shop/payment-methods` exposes no account number and no SePay key.
- [ ] **M2** `curl $API/admin/payment-settings` without a token → `401`; with a bad token → `403`.
- [ ] **M3** `/api/orders/<token>/payment` and `/qr.svg` both send `X-Robots-Tag: noindex`.
- [ ] **M4** A wrong order token returns `404` and leaks no buyer data.
- [ ] **M5** Payment proof images are served through `/api/storage/`, never a direct MinIO URL.
- [ ] **M6** A proof image URL is not guessable from the order id alone (it carries a timestamp and random component).
- [ ] **M7** SMTP credentials appear **only** in env, never in the DB or any API response:
  ```bash
  eval "$DBX 'SELECT * FROM payment_settings'" | grep -i smtp   # expect no match
  ```
- [ ] **M8** Backend logs contain no full account numbers, no SMTP password, and no complete buyer address:
  ```bash
  docker compose logs backend | grep -iE "smtp_pass|$(eval "$DBX 'SELECT bank_account_number FROM payment_settings'")"
  ```
  Expect no match.

---

## N. Resilience

- [ ] **N1** Stop MySQL → payment instructions endpoint returns a clean `500` JSON, backend stays alive.
- [ ] **N2** Stop MinIO → proof upload fails with a clean error; ordering still works.
- [ ] **N3** Stop the SMTP server → covered in H, orders unaffected.
- [ ] **N4** Restart the worker → queued mail resumes sending, nothing sent twice:
  ```bash
  eval "$DBX 'SELECT status, COUNT(*) FROM email_queue GROUP BY status'"
  ```
- [ ] **N5** `docker compose down && up -d` → payment settings, templates, orders, and proofs all survive.
- [ ] **N6** Check for duplicate sends after a restart mid-dispatch: no order has two `sent` rows of the same type.

---

## O. End-to-end journeys

Run each completely, as a buyer would.

- [ ] **O1 — Prepaid ship.** Browse → add to cart → checkout (bank) → order page → scan VietQR → upload proof → admin confirms → buyer gets confirmation email → admin ships with tracking → buyer gets shipped email with the code → admin completes.
- [ ] **O2 — COD ship.** Checkout (COD) → order page shows amount due, no QR, no proof upload → admin approves → shipped → completed. Confirm the order never expired at any point.
- [ ] **O3 — Pickup at event.** Order from a pickup-enabled collection → no address collected → order page shows pickup location/note and the QR → admin scans the QR at "the booth" → admin order opens → mark completed. Confirm `shipped` was never offered.
- [ ] **O4 — Expiry.** Place a prepaid order, force it overdue, wait for the sweep → cancelled, stock returned, one cancellation email.
- [ ] **O5 — Sold out mid-checkout.** Two browsers, last unit: first completes, second gets a clear out-of-stock message naming the item and no order.

---

## P. Frontend quality

- [ ] **P1** Order page, payment instructions, and proof upload are usable at 375px with no horizontal scroll.
- [ ] **P2** The VietQR is large enough to scan from a phone screen at default zoom.
- [ ] **P3** Language toggle translates all new chrome; seller content unchanged.
- [ ] **P4** Admin payment settings and email editor are usable on a phone (the seller may work from one at an event).
- [ ] **P5** Console clean on every page.
- [ ] **P6** `/`, `/shop`, `/cart`, `/checkout` all still work — no regression from Plans 1–2.

---

## Sign-off

- [ ] Blocking sections **C, D, H, L** fully PASS.
- [ ] The VietQR was scanned with a **real** banking app and pre-filled the correct account, holder, amount, and note (D4–D7).
- [ ] A backup was **actually restored** and its counts and money total matched production (L5).
- [ ] `cd backend && npm test` passes, with `orderConcurrency` run 20× consecutively.
- [ ] `cd frontend && npm test && npm run build && npm run lint` pass.
- [ ] Plan 1 and Plan 2 verification checklists re-run and still PASS (no regressions).
- [ ] Non-blocking failures recorded with an explicit decision to accept.

## Production readiness

Beyond the checklists, before real buyers use this:

- [ ] `JWT_SECRET`, `ADMIN_PASSWORD`, and `SMTP_PASS` are strong and not defaults.
- [ ] `SITE_URL` points at the real domain, so emailed order links and QRs resolve publicly.
- [ ] SPF and DKIM are configured for the sending domain — send a test to Gmail and confirm it lands in the inbox, not spam.
- [ ] The seller's **shop-only** bank account is configured (not their main personal account), per the design's blast-radius reasoning.
- [ ] Backup cron is installed on the server and has produced at least one dump.
- [ ] Container memory under load is within the 2GB budget:
  ```bash
  docker stats --no-stream
  ```
- [ ] A dry-run drop was rehearsed: create a collection, place a real order end to end, then reset order data before going live.
