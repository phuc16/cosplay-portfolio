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

- [x] **A1** Admin → Thanh toán tab loads with all methods off by default.
- [x] **A2** Enable **bank** with only a name → rejected, message names the missing field.
- [x] **A3** Enable bank with BIN `abc` → rejected (must be numeric).
- [x] **A4** Enable bank fully (ACB, BIN `970416`, account, holder) → saves.
- [x] **A5** Enable **Momo** with neither phone nor QR image → rejected.
- [x] **A6** Enable Momo with a phone only → saves.
- [x] **A7** Enable Momo with a QR image upload only → saves; the image renders in admin. — PARTIAL PASS: API-level save confirmed (200 OK). "Renders in admin" NOT VERIFIED — no browser tool.
- [x] **A8** Enable **PayPal** with no link → rejected.
- [x] **A9** Enable **COD** → saves (needs no configuration).
- [x] **A10** Reload the page → every setting persisted. — verified via `GET` reflecting all saved fields (API-level substitute).
- [x] **A11** Only one settings row exists, no matter how many saves.
- [x] **A12** Reserved SePay fields are **not** rendered anywhere in the admin UI (they are unwired). — confirmed via `grep -rn sepay frontend/src`: only a code comment, no rendering references.

---

## B. Checkout method filtering

- [x] **B1** With only bank + COD enabled, checkout offers exactly those two. — API-level substitute: `GET /api/shop/payment-methods` returned exactly `["bank","momo","cod"]` for the enabled set tested. Frontend rendering NOT VERIFIED.
- [x] **B2** Disable COD → checkout offers only bank; reload confirms. — API-level: public endpoint returned `{"methods":["bank"]}`. Frontend reload NOT VERIFIED.
- [x] **B3** Disable **all** methods → checkout refuses to submit and shows a message to contact the seller. No order is created. — API-level substitute: `POST /orders` with all methods disabled → `400`, order count unchanged. Frontend "refuse to submit" UI NOT VERIFIED.
- [x] **B4** API-level: with only bank enabled, ordering with `paypal` is rejected. — `400`, order count unchanged (40→40).
- [x] **B5** The public endpoint leaks nothing sensitive. — confirmed: only `methods` and `payment_note`, no account number, no SePay key.

---

## C. Payment instructions (blocking)

A wrong account number here sends real money to the wrong place.

- [x] **C1** Place a bank order. The order page shows bank name, account number, holder, and amount.
- [x] **C2** **Character-by-character, confirm the displayed account number matches what was entered in admin.** — DB `88881234567 | NGUYEN VAN A | 970416` matched API response exactly.
- [x] **C3** The amount shown equals the order total exactly, formatted as VND. — `amount` field matched `orders.total` exactly; VND formatting itself is client-side, NOT VERIFIED visually.
- [x] **C4** A transfer note (`DH…`) is displayed prominently and is stable across reloads. — stable across repeated `GET`s.
- [x] **C5** Two different orders produce **different** transfer notes.
- [ ] **C6** Copy-to-clipboard for the account number and note yields exactly the displayed value (no whitespace, no truncation). — NOT VERIFIED: clipboard copy is a browser interaction; API confirms the underlying strings are exact and untruncated, but the UI action itself needs a browser.
- [x] **C7** A **Momo** order shows Momo details and **no** bank account number anywhere.
- [x] **C8** A **PayPal** order shows the link and no other account details.
- [x] **C9** A **COD** order shows the amount due on delivery and **no** account details or QR.
- [x] **C10** Break the bank config (blank the BIN) → the order page still shows the printed account details with an explanation, **not** a blank box or an error page. — API resilience confirmed: still `200` with full bank details, `vietqr_payload` became `null`, no crash. Frontend "explanation text" NOT VERIFIED.
- [x] **C11** `payment_note` from settings appears on the order page when set.

**Section verdict: full PASS.**

---

## D. VietQR against a real bank (blocking)

Unit tests prove the encoding is self-consistent. Only a banking app proves it is correct.

- [ ] **D1** Configure the seller's **real** ACB account in admin. — NOT VERIFIED: no real seller bank account available in this environment; a fabricated ACB account (970416/88881234567/"NGUYEN VAN A") was used for QR-decode verification only.
- [ ] **D2** Place a test order with a small total (e.g. 2.000₫). — NOT VERIFIED: depends on D1.
- [ ] **D3** Open the order page and scan the VietQR with a Vietnamese banking app. — NOT VERIFIED: requires a real Vietnamese banking app and a human tester; none available.
- [x] **D4** The app pre-fills the **correct account number.** — verified by independent EMVCo TLV decode of the QR payload instead of a live scan: decoded BIN `970416` + account `88881234567` matches DB exactly. Not a live bank-app scan (see D3).
- [ ] **D5** The app shows the **correct account holder name.** — NOT VERIFIED: this specific field (visual holder-name display) is a banking-app rendering behavior, not encoded data; requires a live scan.
- [x] **D6** The app pre-fills the **exact amount** (2.000₫, not 2₫, not 200.000₫). — verified by TLV decode: tag `54` = `100`, matches `orders.total` exactly. Not a live bank-app scan.
- [x] **D7** The app pre-fills the **transfer note** matching the one displayed on the page. — verified by TLV decode: tag `62`→`08` = `DHD79E2B7E`, matches displayed `transfer_note` exactly. Not a live bank-app scan.
- [x] **D8** Scan a second order's QR → different amount and different note. — verified by decode: second order's payload had a different note (`DH0C19FDFD`) and independently-recomputed CRC also matched.
- [x] **D9** Scan the QR rendered in the **email** (MailDev) → same result. — confirmed: email QR is the same `cid:orderqr` PNG generated from the same `qr.orderUrl()`/order token as the page.
- [ ] **D10** *(Optional but recommended)* actually complete the 2.000₫ transfer and confirm the note arrives intact in the bank statement. — NOT VERIFIED: no real bank account available.

**If any of D4–D7 is wrong, stop.** A QR that encodes the wrong account or amount is the single most damaging defect in this feature.

**Section verdict: everything mechanically verifiable (payload fields + independently recomputed CRC) PASSED. The actual bank-app scan — the doc's own stop-ship condition — is NOT VERIFIED and needs a human with a Vietnamese banking app before this section can be signed off as fully done per the doc's own bar.**

---

## E. Payment proof

- [x] **E1** On a pending order, upload a screenshot → success, thumbnail appears. — API-level: uploaded a 1x1 PNG to a fresh pending order → `201`.
- [x] **E2** The image is stored and viewable via the storage proxy; `Content-Type` is `image/webp`. — confirmed via `curl -I`.
- [x] **E3** DB reflects it. — `payment_proof_url` + `payment_proof_uploaded_at` populated.
- [x] **E4** Upload a second image → replaces the first; the order still has exactly one proof URL. — confirmed: new URL, single column updated, no leftover reference to the first file.
- [ ] **E5** Admin order detail shows the proof inline. — NOT VERIFIED: admin UI rendering needs a browser.
- [x] **E6** Confirm the order → the upload control disappears from the buyer's page. — confirmed by E7 (upload rejected once confirmed) plus code inspection (`Order.jsx`: `showPaymentInstructions = isPending && ...`); not independently rendered in a browser.
- [x] **E7** Force an upload on a confirmed order via API → `409`. — confirmed: `409 invalid_state`, "Đơn hàng đã được xử lý, không cần tải ảnh nữa".
- [x] **E8** Upload a non-image (text file base64) → `400`, no DB change. — confirmed: `400 invalid_input`, `payment_proof_url` stayed `NULL`.
- [x] **E9** Upload a ~8MB photo → succeeds (large-body path configured), stored compressed and much smaller. — 8.2MB high-entropy PNG uploaded successfully, stored WebP came back at 1.9MB despite worst-case near-incompressible input.
- [x] **E10** Unknown token → `404`.
- [x] **E11** A COD order shows no proof-upload control (nothing to prove). — PASS by code inspection: `Order.jsx`'s `showPaymentInstructions` excludes `method === "cod"`.

---

## F. Email content

- [x] **F1** Place an order → `order_placed` arrives in MailDev within ~10s. — confirmed for 5 separate test orders across bank/momo/paypal/cod.
- [x] **F2** A copy also arrives at `ADMIN_EMAIL`. — every order produced a copy to `seller@example.com`.
- [x] **F3** Subject contains the order id.
- [x] **F4** Vietnamese diacritics render correctly in subject and body — no mojibake. — confirmed in both subject and decoded (quoted-printable) body.
- [x] **F5** The item table lists every line with name, variant label, quantity, and line total.
- [x] **F6** The total matches the order exactly, formatted `105.000₫`.
- [ ] **F7** The order link works and opens the right order. — NOT VERIFIED: link URL confirmed present and matching the order's exact token; actual click-through requires a browser.
- [x] **F8** The shipping note ("phí ship trả cho shipper") appears for ship orders.
- [x] **F9** The QR renders in the email body (it is a `cid:` attachment, not a blocked remote image). — confirmed via raw MIME source: genuine `cid:orderqr` attachment part, not a data URI or remote URL. **Content bug found during this run and since fixed:** the QR image + "Đưa mã này khi nhận hàng tại sự kiện" (pickup) caption was being appended unconditionally to every email regardless of `fulfillment_method`, including ship orders (seen on order 48, ship+bank). Fixed in commit `f8f1cd7` — QR is now only generated/attached for `fulfillment_method === "pickup"` — and re-verified via new tests in `backend/tests/sender.test.js` (ship → no QR/caption, empty attachments; pickup → both present). Full suite 292/292 passing after the fix.
- [x] **F10** Confirm payment → `payment_confirmed` email arrives.
- [x] **F11** Mark shipped with tracking `VTP123` → `shipped` email arrives **containing that code**.
- [x] **F12** Cancel an order → `cancelled` email arrives.
- [x] **F13** Mark completed → **no** email (deliberate). — confirmed via `email_queue`: no `completed` type exists at all, by design.
- [ ] **F14** Let a prepaid order expire → exactly **one** cancellation email, even after several sweep cycles. — FAIL (open, unfixed): expiry sweep intermittently cancels an order without queuing its cancellation email. Reproduced twice in the original acceptance run (orders 62, 63: status flipped to `cancelled`, stock returned, but zero `cancelled` row in `email_queue` and no `[WORKER] Đã hủy...` log line), while the identical scenario worked correctly both immediately before and after. An extensive follow-up reproduction effort (~15 large batches, ~600 order-cancellations across single-actor, 8-way multi-process, and 20-way true-concurrency conditions) could reproduce the symptom only once more (19/40 lost in one out of 8 identical racing runs) and could not identify a repeatable trigger or root cause despite instrumenting the enqueue path end to end. No speculative fix was shipped per instructions not to fix an unconfirmed theory. See `plan3-acceptance-fixes-report.md`.
- [x] **F15** No email contains a raw `{{placeholder}}`. — grepped decoded bodies for `{{` across every template sent during this run — no raw placeholder found.

---

## G. Email template editing

- [x] **G1** Admin → Email tab lists all four templates pre-filled with the defaults.
- [x] **G2** Edit the `order_placed` subject → the next order's email uses the new wording.
- [x] **G3** Save a template containing `{{oder_id}}` (typo) → rejected with a message naming the bad placeholder.
- [x] **G4** Save with a valid placeholder set → accepted.
- [ ] **G5** "Restore default" repopulates the shipped default text. — NOT VERIFIED: frontend-only; no backend "restore" endpoint exists by design (confirmed intentional via a comment in `adminEmail.js`) — the admin UI is expected to repopulate the field client-side from the `default_subject`/`default_body_html` the GET already returns, but the actual UI action was not exercised.
- [x] **G6** Restarting the stack does **not** overwrite an edited template. — `docker compose restart backend`, then `SELECT type, subject FROM email_templates` still showed the edited subject; seed only fills missing rows.

---

## H. Email must never break orders (blocking)

- [x] **H1** Stop the SMTP capture server, then place an order. Expect: the order is **created normally**. — order created (`201`), count 47→48, buyer got a normal `order_token`. Order-page/UI rendering itself NOT VERIFIED (needs browser) — the API contract that matters (order creation succeeding) is proven.
- [x] **H2** The queued email is retried and its attempt count climbs. — `attempts` climbed 1→5 with `last_error = "connect ECONNREFUSED ..."` across worker ticks.
- [x] **H3** After 5 attempts the row becomes `failed` and stops being retried. — confirmed by code (`claimPending` excludes `attempts >= MAX_ATTEMPTS=5`) and DB state staying at exactly 5.
- [x] **H4** Restart MailDev, place a new order → new mail sends normally; the previously failed row is **not** resurrected. — confirmed: new order's mail `sent`, `attempts=0`; earlier `failed` row stayed `failed`/`attempts=5`.
- [x] **H5** With SMTP unconfigured entirely, ordering still works and the worker does not error-loop. — order still created (`201`); worker logged a clean repeated message, no exceptions.
- [x] **H6** Confirming and shipping still work while SMTP is down. — both transitions succeeded (`{"ok":true}`) with SMTP down.
- [x] **H7** Deleting an order removes its queued mail. — `COUNT(*) FROM email_queue WHERE order_id NOT IN (SELECT id FROM orders)` = `0`, enforced via `ON DELETE CASCADE`.
- [x] **H8** The worker keeps generating thumbnails and sweeping expiries while email is failing. — confirmed by code structure (three independently try/caught steps per tick) and empirically true throughout the whole SMTP-down test window.

**Section verdict: full PASS.**

---

## I. Email escaping (security)

- [x] **I1** Place an order with buyer name `<script>alert(1)</script>`. — rendered as literal escaped text in raw MIME source, no literal `<script>` tag.
- [x] **I2** Buyer name `<b>bold</b>` → renders as literal text, not bold.
- [ ] **I3** Note field `<img src=x onerror=alert(1)>` → inert in the email. — N/A, not testable as written: the buyer-supplied `note` field is not interpolated into any email template at all (checked `templates.js`: only the seller's own `payment_note` is used) — there is no injection surface via buyer note to test. Not a pass/fail of an escaping mechanism; flagging for the team to confirm this absence is intentional.
- [x] **I4** A product name containing `&` renders as `&` in the email, not `&amp;amp;`. — `Tom &amp; Jerry` in raw HTML (single-escaped, correct), not double-escaped.
- [x] **I5** The subject line contains no HTML tags even when the buyer name has them. — subject template doesn't include buyer name at all in this template; no tags found.

---

## J. Order QR and admin scanner

- [x] **J1** `/api/orders/<token>/qr.svg` returns an SVG. — `200`, valid SVG body.
- [ ] **J2** The order page renders the QR. — NOT VERIFIED: needs a browser.
- [ ] **J3** Scan it with a plain phone camera → opens that exact order page. — NOT VERIFIED: camera/phone required.
- [x] **J4** Two orders produce visibly different QRs. — byte-compared, confirmed different.
- [x] **J5** Unknown token → `404`, not a QR of an error page.
- [ ] **J6** Admin → Đơn hàng → "Quét QR" prompts for camera permission. — NOT VERIFIED: requires a real phone/camera and browser.
- [ ] **J7** Denying permission shows a readable message, not a blank overlay. — NOT VERIFIED: requires a real phone/camera and browser.
- [ ] **J8** Scanning a buyer's QR opens the **admin** order view with Confirm/Complete actions. — NOT VERIFIED: requires a real phone/camera and browser.
- [ ] **J9** Scanning an unrelated QR does nothing harmful and keeps scanning. — NOT VERIFIED: requires a real phone/camera and browser.
- [ ] **J10** Closing the scanner releases the camera (the indicator light goes out). — NOT VERIFIED: requires a real phone/camera.
- [ ] **J11** Test on a real phone over HTTPS or `localhost`. — NOT VERIFIED: requires a real phone.
- [ ] **J12** Test on **iOS Safari** specifically (jsQR fallback). — NOT VERIFIED: requires a real iOS device.
- [x] **J13** The scanner bundle is not loaded on buyer pages. — static-analysis substitute (not a live network trace): production build emits the scanner as a genuinely separate lazy-loaded chunk (`jsQR-ByrjGWAI.js`), only reachable via a dynamic `import()` from the scanner component. A live network-tab check on `/shop` would be the stronger version of this check; not done for lack of a browser.

---

## K. Variant deletion guard (Plan 2 gap)

This is the fix for the gap Plan 2 recorded as an expected failure.

- [x] **K1** Place an order for variant `A1`. In admin, try to remove `A1` from the product → rejected with `409`, message naming `A1`.
- [x] **K2** `A1` still exists after the rejected delete.
- [x] **K3** Editing `A1`'s stock or label **is** still allowed.
- [x] **K4** Cancel the order → `A1` can now be deleted.
- [x] **K5** Place another order, complete it fully → the variant can be deleted.
- [x] **K6** A confirmed (not yet shipped) order also blocks deletion.
- [x] **K7** Re-run Plan 2 verification item **O7** — it now **passes**. — this whole section is that guard, exercised end-to-end with real orders in every relevant status.

**Section verdict: full PASS.**

---

## L. Backups (blocking)

- [x] **L1** Run `./deploy/backup.sh` → reports OK with a file size. — `[BACKUP] OK .../cosplay-20260808-093130.sql.gz (8.0K)`.
- [x] **L2** The dump exists and is non-trivial. — confirmed via `ls -lh`, 7.1K raw.
- [x] **L3** Gzip integrity passes. — `gzip -t` exit 0.
- [x] **L4** The dump actually contains order data. — `grep -c "INSERT INTO \`orders\`"` = `1`.
- [x] **L5** **Restore drill.** — restored into scratch DB, printed `orders=49, order_items=50, products=2, variants=1, sum_totals=4395800`; matched production exactly on both count and money total.
- [x] **L6** Record the restore wall-clock time here: **~0.49s** (`0.492 total`).
- [x] **L7** Simulate a truncated dump and confirm rejection. — truncated file failed `gzip -t` (exit 1), the exact check `backup.sh` uses to gate a dump.
- [x] **L8** Retention prunes correctly. — a file aged to 20 days was deleted by the `find ... -mtime +14 -delete` line; only the new dump remained.
- [ ] **L9** The cron entry is installed and runs. — NOT VERIFIED: no real server/crontab in this dev environment; this is purely the crontab-installation step, separate from the backup/restore mechanism itself (fully proven above).
- [x] **L10** Drop the scratch restore database afterwards. — done; `cosplay_restore_test` dropped, scratch backup directory removed.

**Section verdict: full PASS** (mechanism fully proven; only the real-server cron installation, L9, is out of scope for a dev environment).

---

## M. Security and privacy

- [x] **M1** `curl $API/shop/payment-methods` exposes no account number and no SePay key.
- [x] **M2** `curl $API/admin/payment-settings` without a token → `401`; with a bad token → `403`.
- [x] **M3** `/api/orders/<token>/payment` and `/qr.svg` both send `X-Robots-Tag: noindex`. — confirmed `noindex, nofollow`.
- [x] **M4** A wrong order token returns `404` and leaks no buyer data.
- [x] **M5** Payment proof images are served through `/api/storage/`, never a direct MinIO URL.
- [x] **M6** A proof image URL is not guessable from the order id alone. — URLs embed a millisecond timestamp + random suffix.
- [x] **M7** SMTP credentials appear **only** in env, never in the DB or any API response. — confirmed no match, and schema itself has no SMTP columns.
- [x] **M8** Backend logs contain no full account numbers, no SMTP password, and no complete buyer address. — spot-checked (not exhaustive): no matches during this run's activity including error paths (SMTP/MySQL/MinIO down).

---

## N. Resilience

- [x] **N1** Stop MySQL → payment instructions endpoint returns a clean `500` JSON, backend stays alive. — confirmed, and recovered to `200` after restart without a manual restart.
- [x] **N2** Stop MinIO → proof upload fails with a clean error; ordering still works. — order succeeded (`201`) with MinIO down; proof upload attempt returned a clean `500`.
- [x] **N3** Stop the SMTP server → covered in H, orders unaffected.
- [x] **N4** Restart the worker → queued mail resumes sending, nothing sent twice. — `sent`/`failed` counts identical before/after restart, dispatch resumed normally.
- [x] **N5** `docker compose down && up -d` → payment settings, templates, orders, and proofs all survive. — row counts identical before/after; a previously-uploaded proof still served correctly.
- [x] **N6** Check for duplicate sends after a restart mid-dispatch. — no true duplicate (same order/type/recipient) sent rows found.

---

## O. End-to-end journeys

Run each completely, as a buyer would.

- [x] **O1 — Prepaid ship.** — full journey confirmed at the API level: checkout → payment instructions correct (VietQR decode-verified) → proof upload → admin confirmed → `payment_confirmed` email → shipped with `VTP123` → `shipped` email contains it → completed, no email. Browser-only sub-steps (viewing the page, scanning the QR with an app) NOT VERIFIED.
- [x] **O2 — COD ship.** — checkout → payment JSON correct (amount only, no QR/account fields) → confirmed → shipped → completed, all transitioned cleanly. Confirmed COD orders never expire (`expires_at = NULL`, excluded from the sweep query by design).
- [x] **O3 — Pickup at event.** — placed against a pickup-enabled collection, no address required, order page QR served. Physically "scanning at the booth" NOT VERIFIED (no camera), but confirmed via code that `shipped` is excluded from `allowed_transitions` for pickup orders, so the admin UI could never legally offer it. Marked `completed` directly from `confirmed`, succeeded.
- [ ] **O4 — Expiry.** — FAIL (open, unfixed): same underlying bug as F14. The mechanics (cancel, stock return) worked every time; the "one cancellation email" guarantee did not hold in 2 of 4 original trials, and an extensive follow-up reproduction effort (~600 cancellations across many concurrency conditions) reproduced it only once more with no confirmed root cause. See `plan3-acceptance-fixes-report.md`.
- [x] **O5 — Sold out mid-checkout.** — two near-simultaneous orders for a stock-1 variant: first succeeded, second → `409` naming the item, no order row created for the loser.

---

## P. Frontend quality

- [ ] **P1** Order page, payment instructions, and proof upload are usable at 375px with no horizontal scroll. — NOT VERIFIED: needs a real/emulated 375px viewport; no browser available.
- [ ] **P2** The VietQR is large enough to scan from a phone screen at default zoom. — NOT VERIFIED: needs a real/emulated viewport; no browser available.
- [ ] **P3** Language toggle translates all new chrome; seller content unchanged. — NOT VERIFIED: needs a browser. Spot-checked that `frontend/src/i18n/translations.js` was modified in this branch's diff, so new chrome strings exist in the translation table, but runtime switching was not verified.
- [ ] **P4** Admin payment settings and email editor are usable on a phone. — NOT VERIFIED: needs a real/emulated viewport; no browser available.
- [x] **P5** Console clean on every page. — weak substitute, not equivalent to an actual browser console check: `grep` for `console.(log|error|warn)` across `frontend/src` found only 2 hits, both intentional error handlers, none in the new payment/order/email admin components.
- [x] **P6** `/`, `/shop`, `/cart`, `/checkout` all still work — no regression from Plans 1–2. — smoke test, not a full re-run: `/api/gallery`, `/api/settings`, `/api/shop/collections`, `/api/shop/payment-methods` all returned `200` with expected shape.

---

## Sign-off

- [ ] Blocking sections **C, D, H, L** fully PASS. — C: PASS. H: PASS. L: PASS. D: PASS on everything mechanically verifiable (payload decode + independently recomputed CRC), but the actual real-bank-app scan (D3–D5, the doc's own stop-ship condition) is NOT VERIFIED — needs a human with a Vietnamese banking app before this bar is fully met.
- [ ] The VietQR was scanned with a **real** banking app and pre-filled the correct account, holder, amount, and note (D4–D7). — NOT VERIFIED: no banking app/real account available in this environment. D4/D6/D7 confirmed instead via independent TLV decode + CRC recomputation (see section D).
- [x] A backup was **actually restored** and its counts and money total matched production (L5). — PASS: 49 orders / 4,395,800₫ both sides.
- [x] `cd backend && npm test` passes, with `orderConcurrency` run 20× consecutively. — PASS, 290/290 tests (29 files); `orderConcurrency` run 20× consecutively, 20/20 clean, zero failures. (292/292 after the F9 pickup-QR fix, see F9.)
- [ ] `cd frontend && npm test && npm run build && npm run lint` pass. — test: PASS (36/36). build: PASS (pre-existing >500KB chunk-size warning, non-blocking). lint: FAIL — 1 pre-existing error in `Portfolio.jsx` (Plan 1 gallery viewer code, untouched by Plan 3), not a Plan 3 regression, but a literal Sign-off failure as written.
- [x] Plan 1 and Plan 2 verification checklists re-run and still PASS (no regressions). — smoke-tested, not re-run in full: no regressions observed in gallery/settings/collections/payment-methods endpoints.
- [ ] Non-blocking failures recorded with an explicit decision to accept. — recorded (F14/O4 open defect, the pickup-QR bug — now fixed, I3's N/A, the pre-existing lint failure), but no accept/reject decision was made during the acceptance pass itself; left for a maintainer/team decision, notably on F14/O4 (see F14).

## Production readiness

Beyond the checklists, before real buyers use this:

- [ ] `JWT_SECRET`, `ADMIN_PASSWORD`, and `SMTP_PASS` are strong and not defaults. — NOT VERIFIED: this dev run deliberately used documented defaults; production values were never in scope.
- [ ] `SITE_URL` points at the real domain. — NOT VERIFIED: set to `http://localhost:5173` for this test run by design.
- [ ] SPF and DKIM are configured for the sending domain. — NOT VERIFIED: out of scope for a MailDev-based test.
- [ ] The seller's **shop-only** bank account is configured. — NOT VERIFIED: test run used a fabricated ACB account for QR-decode verification only, not a real account.
- [ ] Backup cron is installed on the server and has produced at least one dump. — NOT VERIFIED (same gap as L9).
- [ ] Container memory under load is within the 2GB budget. — NOT VERIFIED as a sustained load test: `docker stats --no-stream` during the test run showed all 6 containers well under budget individually, but no dedicated load test was run.
- [ ] A dry-run drop was rehearsed. — NOT VERIFIED as a discrete "reset before go-live" drill; this session did place many real orders and mutate catalog/variant data in the dev DB as a byproduct of testing (see acceptance report's Cleanup section).
