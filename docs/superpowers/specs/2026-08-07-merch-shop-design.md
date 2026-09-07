# Merch Shop (E-commerce Phase 1–3) - Design

## Context

The cosplayer currently sells merch collections (t-shirts, photocards, etc.) via Google Form: buyers fill a form to pick items/codes, calculate their own total, and pay by bank transfer/COD. The seller manually reads form responses, cross-checks payment, prepares orders, and books ViettelPost shipments by hand. This is slow and error-prone for both sides.

This spec covers the **core transaction flow**: catalog, cart, checkout, order lifecycle, payment (manual by default, pluggable auto-confirm later), and notifications. It intentionally excludes:
- **Admin statistics dashboard** (Phase 4)
- **ViettelPost booking automation/export** (Phase 5)
- **Buyer onboarding guide** (Phase 6)

These are separate follow-up specs, built once this core flow ships and is proven.

## Constraints

- Production runs on a **2GB RAM / 50GB disk** droplet, already hosting MySQL, Redis, MinIO, backend, worker, and Nginx-fronted frontend for the existing portfolio.
- **No new containers, no new processes, no local ML/compute-heavy dependencies.** Every addition in this design reuses existing infrastructure (see Resource Fit below).
- No buyer accounts - all buyer flows are anonymous, tracked via unique order tokens.

## Data Model

New Knex migrations, same MySQL instance:

```
collections
  id, title, slug, description (markdown), cover_image, thumbnail_image (nullable - falls back
  to cover_image), status (draft|active|closed|archived), fulfillment_methods (ship and/or pickup),
  pickup_location, pickup_note, sort_order, created_at

products
  id, collection_id, name, description (markdown), price,
  images (MinIO refs, same pattern as albums/images)

product_variants
  id, product_id, label (e.g. "S", "A1"), image_url (nullable - falls back to product image),
  stock_qty (nullable - NULL means unlimited/made-to-order)

orders
  id, order_token (unguessable, public lookup), buyer_name, phone, email,
  fulfillment_method (ship|pickup), address (structured: street/ward/district/province
  + raw text fallback - required for ship, omitted for pickup), note, status
  (pending|confirmed|shipped|completed|cancelled), payment_method (bank|momo|paypal|cod),
  payment_proof_url, total (sum of order items; shipping is not part of it),
  shipping_fee (nullable - recorded by admin after the fact, for bookkeeping only),
  cod_amount (nullable), tracking_code, created_at, confirmed_at,
  expires_at (nullable - never set for COD)

order_items
  id, order_id, product_variant_id, product_name_snapshot, variant_label_snapshot,
  unit_price_snapshot, qty

payment_settings   (own table, not site_settings)
  bank_name, bank_account_number, bank_account_holder, momo_phone, momo_qr_image, paypal_link,
  method_enabled flags per method (incl. cod),
  auto_confirm credential fields (nullable/disabled - reserved for a later phase)

email_templates
  type (order_placed|payment_confirmed|shipped|cancelled), subject, body_html  - Vietnamese only
  - seeded with polished defaults, editable by admin, placeholders like {{order_id}}, {{buyer_name}}
```

`collections` are kept separate from the existing `albums` table - albums are portfolio photo galleries with a different lifecycle; collections are merch drops with pricing/stock.

`collections.status` replaces a simple visible/hidden boolean, because a drop has more than two meaningful states:
- **draft** - seller is still adding products/images; invisible to buyers
- **active** - visible and accepting orders
- **closed** - the drop ended, still browsable as an archive of past merch, but Add-to-Cart is disabled with a "this drop has ended" notice
- **archived** - gone from the storefront entirely; the row is retained so historical orders still resolve their collection

`collections.thumbnail_image` is optional and falls back to `cover_image` - same fallback pattern as `product_variants.image_url`. It exists because a collection's cover is typically a wide, detail-dense promotional banner that becomes illegible when shrunk into a list card; the thumbnail gives the seller a clean square/portrait image for list views without forcing a second upload when they don't care.

Collection and product descriptions are **markdown**, rendered to sanitized HTML on the storefront. The current Google Form descriptions rely on bold/emphasis for important rules, and markdown covers that without allowing arbitrary HTML. Note that much of today's description boilerplate disappears under this system - the app generates the order code, displays the correct account details, and tracks payment itself - so what remains is genuinely collection-specific content like handover dates and event details.

`product_variants.image_url` exists because a variant isn't always "same photo, different size" (t-shirt sizes) - it can be "different photo, same everything else" (photocard codes A1, A2, B1... each a distinct piece of art). One field covers both cases without a separate product-type concept.

`product_variants.stock_qty` is nullable, where **NULL means unlimited**. Some merch is genuinely limited (a fixed print run of photocards), while other items are made-to-order or reprintable on demand (posters, note paper) and have no meaningful stock number. Unlimited variants never reserve, never sell out, and are skipped entirely by the expiry sweep.

`order_items` snapshots product/variant name and price at order time so later catalog edits don't rewrite order history.

`orders.total` is the single money field: the sum of `unit_price_snapshot × qty` across the order's items. There is deliberately no separate subtotal, because shipping is excluded (see Shipping Fee) and there is no discount or promo mechanism - even a bundle like "Combo 2A5+1ptc" is modelled as its own product with its own price, not a checkout-time discount. A second column that can never differ from the first is duplication that eventually drifts. If discounts are ever added, reintroducing `subtotal` alongside a `discount` column is a trivial migration at that point.

## Order, Payment & Stock Flow

1. **Browse**: buyer visits `/shop` → collections → products → variants, with live stock (sold-out variants disabled/greyed; unlimited variants show no stock indicator at all).
2. **Cart**: client-side only (localStorage), no server round-trip until checkout.
3. **Checkout**: buyer provides name, phone, email (mandatory - sole notification/tracking channel), optional note, picks a **fulfillment method** from those the collection offers, and picks one enabled payment method.
   - **Ship**: address required (Goong.io-assisted autocomplete, VN-specific). The order total covers the merch only, displayed with a clear "+ shipping fee" note - see Shipping Fee below.
   - **Pickup at event**: no address collected, no shipping involved at all, and the collection's `pickup_location` / `pickup_note` are shown so the buyer knows where and when to collect.
4. **Order created**: status `pending`. Stock is **decremented immediately** per item at this point (reservation, not just at confirm) to prevent overselling on limited drops. Unique `order_token` generated.
   - **Prepaid methods** (bank/Momo/PayPal): `expires_at` set from an admin-configurable reservation window (e.g. 48h). Buyer is shown/emailed a link to `/order/{token}` with the order summary, the chosen method's payment details (bank info + generated VietQR / Momo / PayPal), and an optional "upload payment proof" action.
   - **COD**: no payment step, no proof upload, and **`expires_at` is never set** - there is no payment to wait for, so COD orders must be exempt from the expiry sweep. The order page just shows the summary and the amount due on delivery.
   - Emails fire: buyer - "order placed" (prepaid: "please pay"; COD: "awaiting seller approval"); admin - "new order pending."
5. **Payment proof** (prepaid only, optional, buyer-driven, any time before confirmation): image uploaded to MinIO (same resize/compress pipeline as product images - capped ~1280px, JPEG ~85%), linked to the order, shown inline in the admin order view. Exists because the seller cannot manually scan their entire bank statement for every order.
6. **Confirmation** - same single step for every method, only its meaning differs:
   - **Prepaid, manual (default, always available)**: admin reviews proof/bank app, clicks Confirm or Deny. Confirm means *payment verified*.
   - **Prepaid, auto (opt-in, later phase)**: if seller has configured SePay/Momo API/etc. in `payment_settings`, a webhook matching order_token + amount can auto-confirm. The order model doesn't care which path fired - same status transition either way.
   - **COD**: admin explicitly approves the order before it can ship, letting the seller vet unfamiliar buyers or large orders against refused-delivery losses. Confirm means *order approved*; money is collected on handover - by the shipper at delivery (ship) or by the seller at the event (pickup) - and `cod_amount` (= the order total, merch only) is recorded for the Phase 5 ViettelPost handoff.
   - Confirm → status `confirmed`, `confirmed_at` set, buyer+admin notified (prepaid: "payment confirmed"; COD: "order confirmed, prepare for delivery").
   - Deny/Cancel → status `cancelled`, reserved stock released back to variants.
7. **Expiry sweep**: background loop extending the existing `worker.js` polling pattern (no new process) finds `pending` orders past `expires_at`, auto-cancels them, releases stock, emails the buyer that their order expired. COD orders have a null `expires_at` and are never swept - they wait indefinitely for admin approval.
8. **Shipping** (ship orders only): admin marks `shipped`, optional tracking code → buyer gets "shipped" email with tracking code. Actually booking the ViettelPost shipment is still a manual step outside the app in this phase (Phase 5 automates it). **Pickup orders skip this status entirely** - there is nothing to ship or track; they go straight from `confirmed` to `completed` at handover.
9. **Completed**: admin marks `completed` once delivered (ship) or handed over at the event (pickup). Manual/informational status only.

## Payment Methods

Configured by admin in `payment_settings` (own table, kept separate from the general-purpose `site_settings` blob since this has enough fields to warrant its own namespace):
- **Bank transfer**: bank name + account number + holder name → VietQR generated dynamically (embeds order_token + amount in the QR, no manual typing needed by buyer).
- **Momo**: phone number or uploaded static QR image.
- **PayPal**: PayPal.me link or email, for overseas buyers.
- **COD**: no configuration beyond the enable toggle. COD orders require explicit admin approval at the confirm step (see flow above) and never expire.
- Each method has an independent enable/disable toggle; only enabled methods are offered at checkout.
- Real payment-gateway auto-confirm (SePay + ACB, Momo Business API, PayPal Checkout API) is **out of scope for this phase** - fields are reserved in the schema but the UI to configure/enable them ships in a later phase, once the manual flow is proven.

## Order QR

Every order carries a QR encoding its buyer-facing URL (`/order/{token}`). It is derived from `order_token` and generated on demand - never stored, so it costs no disk and needs no table.

- **Order page**: rendered as inline SVG via the `qrcode` package - crisp at any size, no extra request.
- **Emails**: attached inline and referenced by `cid:`, rather than a `data:` URI (Gmail strips those) or a remote URL (which email image proxies would fetch). The `cid:` attachment renders even when a client blocks remote images.

**Admin scanner.** The admin orders screen has a scan action that opens the device camera via `getUserMedia` (requires HTTPS, already in place). Decoding uses the native `BarcodeDetector` API where available, falling back to `jsQR` (~45KB) since iOS Safari lacks it - chosen over `html5-qrcode` (~300KB) for size. It is **lazy-loaded on the admin scan route only**, so it never lands in the buyer-facing bundle.

The QR contains the *public* buyer URL, but the scanner extracts the token and opens the **admin** order view with full controls, not the read-only buyer page.

This exists primarily for **pickup at events**: instead of searching by name through a queue at the booth, the seller scans the buyer's phone and the order opens immediately with items, payment status, and the Completed action.

Known limitations, accepted deliberately:
- **The scanner needs connectivity.** Festival wifi and mobile data are frequently unusable, and the scanner cannot load an order offline. An offline booth mode is out of scope here; the Phase 5 export is the intended fallback (a printable order list taken to the venue).
- **A QR is a bearer token.** Anyone holding the image can open that order page and see its PII, exactly like holding the link. This is acceptable for the use case but reinforces why order pages are `noindex` and why buyers should not post theirs publicly.

## Fulfillment

Each collection declares which fulfillment methods it offers via `fulfillment_methods` (ship, pickup, or both), because this genuinely varies per drop: a festival pre-order collection offers both ("Bao gồm nhận hàng tại fes và vận chuyển toàn quốc"), while a regular online drop is ship-only.

- **Ship** - address required, shipping settled outside the order total, moves through `shipped` with a tracking code, feeds the Phase 5 ViettelPost automation.
- **Pickup at event** - no address collected, no shipping at all, skips the `shipped` status, never touches ViettelPost. The collection's `pickup_location` and `pickup_note` (event name, dates, booth/table info) are shown at checkout and on the order page.

If a collection offers only one method, checkout selects it implicitly rather than asking.

## Shipping Fee

Shipping is deliberately **not** priced by the system and **not** included in the order total, because ViettelPost shipments are booked as **receiver-pays** (người nhận trả phí): the shipper collects the shipping fee directly from the buyer on delivery. The seller never fronts it, so there is nothing for the system to charge.

This also avoids the accuracy problem entirely - real ViettelPost rates vary by weight and destination, so any flat number would overcharge nearby light orders and undercharge distant heavy ones, while a live rate lookup would add an external call that can fail mid-checkout for marginal benefit at this scale.

Ship orders therefore show the merch total plus a clear "+ shipping fee (paid to the shipper on delivery)" note. `orders.shipping_fee` is nullable and exists only so the seller can record the actual cost afterwards for bookkeeping (useful for the Phase 4 stats dashboard); it never affects what the buyer is charged at checkout.

Consequences:
- Prepaid orders are paid for the merch total only; shipping is settled with the shipper.
- COD orders collect `cod_amount` = the order total; the shipper collects the shipping fee on top under the receiver-pays arrangement.
- Pickup orders never involve shipping at all.
- There is no free-shipping threshold and no shipping configuration to maintain.

## Address Autocomplete

Goong.io (Vietnam-focused, Mapbox-based) is used for address autocomplete at checkout - chosen over Google Places API because it's purpose-built for Vietnamese ward/district/province address structure and doesn't require the seller to attach a Google Cloud billing card. Plain free-text address remains the fallback if autocomplete is unavailable/skipped.

## Notifications

SMTP credentials via backend env vars (`SMTP_HOST/PORT/USER/PASS/FROM`), same pattern as `JWT_SECRET`/`ADMIN_PASSWORD` - no SMTP secrets in the database.

Templates: shipped with well-designed default HTML (order_placed, payment_confirmed, shipped, cancelled), stored in the new `email_templates` table so the seller can edit wording/placeholders from admin without a code change, with placeholder validation on save to prevent broken output. Reverting to the seeded defaults is always possible.

Recipients: `order_placed` and `payment_confirmed` go to both buyer and admin; `shipped` and `cancelled`/`expired` go to buyer only.

## Admin Capabilities

- **Collections**: create/edit, markdown description, cover image + optional thumbnail, status (draft/active/closed/archived), fulfillment methods offered, pickup location/note, sort order - same UX pattern as existing album management.
- **Products & variants**: create/edit product (name, description, price, images); add/edit/remove variants (label, optional per-variant image, stock_qty). Needs a fast bulk-add UI for variant-heavy products (photocard sheets can have 40+ codes).
- **Orders dashboard**: filterable list (status/collection/date), detail view with buyer info, items, payment method, inline proof image, status timeline. Actions: Confirm / Deny / mark Shipped (+ tracking code) / mark Completed / Cancel. Includes the QR scan action for event pickup (see Order QR).
- **Payment settings**: as described above.
- **Email templates**: edit subject/body per type (Vietnamese only), with placeholder validation.

## Non-Functional Requirements

These matter more here than in the portfolio, because orders are money and personal data rather than public photos.

### Correctness under concurrency

- **Stock reservation must be transactional.** Decrementing a limited variant happens inside a DB transaction with row-level locking (`SELECT ... FOR UPDATE`), so two buyers racing for the last unit cannot both succeed. Without this, the system oversells at exactly the moment a hyped drop is busiest. Unlimited variants (`stock_qty IS NULL`) skip locking entirely.
- **Checkout must be idempotent.** A double-tap on a flaky mobile connection must not create two orders holding two reservations. The client sends a generated request key with the submission, and a repeat of the same key returns the original order instead of creating another.

### Abuse resistance

The reservation model has an inherent weakness: an attacker can place many orders, reserve every unit of a limited drop, and never pay. The stock frees up when the orders expire, but the launch window is already lost. Defenses:

- **Order-creation rate limiting per IP**, reusing the existing `express-rate-limit` + Redis setup already in `server.js`.
- **No per-order quantity cap** - deliberately rejected, since buyers legitimately order multiple photocards at once and the friction would hit honest customers hardest.
- The admin order list makes a griefed drop visible and cancellable in bulk if it ever happens.

This is proportionate, not airtight: a determined attacker with many IPs could still get through. Given the audience and stakes, that trade is acceptable; a captcha can be added later if griefing ever becomes real.

### Data safety

- **Nightly `mysqldump` on the host via cron**, compressed, with N-day retention (default 14) and automatic pruning of older dumps. A dump is a few MB, negligible against 50GB.
- This protects against corruption, bad migrations, and accidental deletion - the realistic failure modes. It does **not** protect against losing the droplet entirely; off-site copies are a deliberate later decision.
- Order records are financial and dispute-resolution history: orders and order_items are never hard-deleted, only cancelled.

### Notifications

- **Email sending is asynchronous and retried.** A failed SMTP call must never roll back a committed order. Emails are queued and dispatched by the existing worker loop, with failures logged and visible to admin rather than silently swallowed.
- **Deliverability**: SPF and DKIM must be configured for the sending domain. The current Google Form flow already tells buyers to check spam - the goal is to not need that warning.

### Security & privacy

- **`order_token` is cryptographically random** (not sequential, not guessable), since it is the only thing protecting an order page.
- Order pages are served `noindex` so a link shared in a group chat never ends up in search results.
- Buyer name, phone, address, and email are personal data: exposed only via the order token or authenticated admin, never listed publicly, and never logged in full.
- Markdown descriptions are **sanitized on render**. Authors are trusted (admin only), but sanitizing costs nothing and closes the hole if admin credentials are ever compromised.
- Uploaded images (product photos, payment proofs) are validated by type and size, re-encoded through `sharp`, and served via the existing storage proxy rather than direct MinIO exposure.

### Frontend

- **Mobile-first.** Buyers arrive from Facebook/Instagram links, overwhelmingly on phones; the checkout and cart are designed for that first and scale up.
- **Bilingual UI, single-language content.** Interface chrome - buttons, labels, checkout, order status - is translated Vietnamese/English via the existing `frontend/src/i18n/translations.js` pattern. Seller-authored content (collection and product names, descriptions) is entered once in whichever language the seller chooses and is not translated, so overseas buyers can navigate the flow even when merch descriptions stay Vietnamese. **Emails are Vietnamese only** - a single set of templates to write and maintain, and the overseas minority can translate a receipt.
- The storefront reuses the existing Redis caching pattern, so catalog browsing stays fast without extra infrastructure.
- **The shop is a separate area from the portfolio, reachable only by its own
  URL** (decided 2026-08-09, after the buyer flow was walked end to end). The
  portfolio header carries no shop or cart link; buyers arrive at `/shop` from
  a link the seller shares. The shop therefore carries **its own header** on
  every buyer page (`/shop`, `/shop/:slug`, `/cart`, `/checkout`,
  `/order/:token`): the shop name linking back to the collection list, and a
  cart icon with a live item count.

  This replaced an arrangement in which the cart was linked from exactly one
  place in the entire application - the portfolio header - leaving it
  unreachable from inside the shop, so a buyer could add items and never reach
  checkout. Two smaller defects were fixed with it: the portfolio's shop and
  cart links rendered the same glyph, and the count was read once at mount
  with no setter, so it never changed when the cart did.

  **The count must stay live without a remount.** Items are added on the
  collection page without navigating, so a mount-only read goes stale
  immediately. `writeCart` - the single path every cart mutation already flows
  through - notifies subscribers, and the header subscribes. Do not reintroduce
  a mount-only read or a polling timer.

## Resource Fit (2GB RAM / 50GB disk)

| Addition | Impact | Notes |
|---|---|---|
| New MySQL tables | Negligible | Same MySQL container, just more rows |
| Cart | Zero | Client-side localStorage only |
| Product/variant images + payment proofs | ~GB/year at realistic volume | Same sharp resize/compress pipeline as existing image uploads; a proof screenshot compresses to ~150–400KB |
| Shop catalog caching | Negligible | Reuses existing Redis instance/pattern |
| Stock-reservation expiry sweep | No new process | Extends existing `worker.js` polling loop |
| SePay / Goong.io / Momo / PayPal / SMTP | Zero local cost | All external HTTPS APIs, no local compute or storage |
| Nightly mysqldump + 14-day retention | A few MB per dump | Host cron, pruned automatically |
| Order QR generation | Zero storage | Derived from the token on demand, never persisted |

No new containers, no new processes, no local ML. This is the same order of resource load as the existing albums/images/gallery system already running comfortably on this box.

## Out of Scope (future phases)

- Phase 4: Admin statistics dashboard
- Phase 5: ViettelPost booking automation, CSV/API export
- Phase 6: Buyer onboarding guide (first-visit walkthrough)
- Real payment gateway auto-confirm (SePay+ACB, Momo Business API, PayPal Checkout webhook) - schema reserves space, implementation deferred
