# Decisions Log

Running record of product/business decisions made for the merch shop feature,
outside of the formal specs in `docs/superpowers/specs/`. Each entry is a
decision the user made during live testing or discussion — not a
implementation detail (those live in code comments/commit messages).

## 2026-08-10 — Pickup code only revealed once paid

`pickup_code` (Event Pickup Verification) must only be shown to the buyer
(order page + email) once the order is `confirmed` or `completed`, not while
still `pending`. Showing it earlier let a buyer treat "I placed an order" as
"I can collect it" before the seller verified payment.

## 2026-08-10 — Add-to-cart toast links to /cart

The add-to-cart confirmation toast is now a clickable link to `/cart`,
because clicking through the header cart icon was "too far" during live
testing on mobile.

## 2026-08-11 — Cart items link back to their product

Cart line items link to `/shop/:collection_slug` (no per-product page exists,
so the collection page is the closest available destination).

## 2026-08-11 — Every phân loại (variant) can have its own photo, and admin needs to set it

Photocard-style products (A1, A2, B1...) are different pieces of art per
code, not the same photo at different sizes — `product_variants.image_url`
already existed in the schema/spec for this, but the admin product-add UI
had no control to actually upload it. Added a per-row file picker in
AdminVariants.jsx.

## 2026-08-11 — Clicking a variant chip opens a detail modal instead of adding directly

Because each variant can now have a distinct photo, buyers need to see it
before adding to cart. Chip click opens a modal (photo, label, price,
stock) with an explicit "Add to cart" action inside, rather than adding
immediately on click. Sold-out variants can still be opened to view
details — only the modal's add button is disabled for those.

## 2026-08-11 — Admin login session persists across refresh

The JWT is saved to localStorage and restored on mount (still bounded by the
server's 8h token expiry) — previously a page refresh always dropped the
seller back to the login screen even mid-session.

## 2026-08-11 — Variant detail modal lists all variants for easy switching

The modal opened by a single chip only showed that one variant, making it
tedious to compare photocard codes (close, reopen a different chip, repeat).
The full variant list now also appears inside the modal, so switching
between them doesn't require closing it.
(Superseded same day — see the full photo-grid gallery entry below.)

## 2026-08-11 — Full photo-grid gallery to browse all variants at once

The text-chip switcher inside the detail modal wasn't what the user meant
by "see the full list" — for photocard-style products (A1, A2, B1...),
buyers are used to a page of thumbnails with codes overlaid (like the old
Google Form order image), not a one-photo-at-a-time view. Clicking anywhere
on the product card now opens that full grid; picking a thumbnail opens the
single-variant detail (photo, price, stock, Add to cart) with a "View all"
link back to the grid. Individual chips below the card still jump straight
to a variant's detail. A single-variant product skips the gallery.

## 2026-08-11 — Quantity picker added to the variant detail modal

Adding more than one of a variant required adding once then editing qty in
the cart afterward. Added a +/- stepper in the detail modal, clamped to
remaining stock (no ceiling for unlimited variants), resetting to 1 every
time a variant's detail is (re)opened so a stale quantity never carries
over into a different pick.

## 2026-08-11 — Default email templates redesigned, brand-matched

Cancelled-order emails were showing the pickup QR block ("Đưa mã này khi
nhận hàng tại sự kiện") even though a cancelled order has nothing left to
pick up — fixed by also gating isPickup on the order not being cancelled.
Separately, the four default templates (order_placed, payment_confirmed,
shipped, cancelled) were redesigned to be more compact and match the site's
brand green (#6BBF59, same as frontend/src/index.css's --brand): a header
bar, tighter spacing, a highlighted total row, and a badge-style tracking
code for the shipped email. Only the code-level fallback defaults changed —
templates a seller already edited in the DB are untouched; the admin UI's
"reset to default" reads the new ones live.

## 2026-08-11 — Variant/product photos no longer forced into a square crop

Photos are shot in whatever aspect ratio the seller took them (portrait
photocards, landscape posters), but the gallery grid and detail modal
cropped every one into a square via aspect-square + object-cover. Gallery
thumbnails now use a CSS-columns masonry layout so each keeps its natural
ratio uncropped; the detail modal shows the photo at natural size, with the
modal itself made scrollable for unusually tall shots.

## 2026-08-11 — Admin can copy a collection (with products/variants)

Setting up a similar drop meant re-entering every product and re-uploading
every photocard code from scratch. `POST /collections/:id/copy` duplicates
the collection plus every product/variant underneath it (title suffixed
"(Copy)", always starts as `draft` regardless of the source's status).
Images are referenced, not re-uploaded. Slug is derived from the title the
normal way, so a second copy naturally lands on "-copy-2".

Also (explicitly requested alongside this): `updateCollection` now
re-derives the slug from the title on every edit, not just at creation —
otherwise a copy renamed away from "X (Copy)" would keep the stale "-copy"
URL forever. Caveat worth remembering: this means renaming an already-live,
already-shared collection also changes its public `/shop/:slug` URL — any
link shared before the rename breaks. Acceptable per explicit request, but
worth knowing before renaming an active collection with an existing
audience.

## 2026-08-11 — Gallery grid widened, columns scale with variant count, chips restyled

The variant gallery modal was capped at max-w-lg / 3-4 columns — cramped
for a 40+ code photocard sheet. Widened to max-w-4xl with columns now
picked from the variant count (2 columns for <=2 variants, up through
3/6/8 for 17+) instead of a fixed responsive breakpoint, so a 2-variant
product doesn't get stretched into a handful of oversized thumbnails.
Label chips changed from a plain dark box to a brand-green pill on a
gradient scrim, with a hover highlight on each thumbnail.

## 2026-08-11 — Shop moved from /shop to /merchandise, discoverable from the main site

The shop lived at /shop with no link to it from the main portfolio page —
only reachable if a visitor already knew the URL. Route renamed to
/merchandise (and /merchandise/:slug), added as a nav tab on the main site
(next to Thông tin/Dự án/Liên hệ) and as a button in the Hỗ trợ section
alongside Gumroad/PayPal. The shop's own display name (shopTitle) changed
from "Merch" to "Merchandise" to match, kept identical in both languages
(same precedent as "Merch" itself never being translated).

## 2026-08-11 — Placeholder-label bug fixed, then recovery made actually actionable

Found via live testing: a stale cart line (variant deleted after being
added) reused OutOfStockError with the literal placeholder "không tồn tại"
standing in as a fake product label — buyer saw `Rất tiếc, "không tồn
tại" vừa hết hàng`. Split into a distinct VariantNotFoundError first.

Then realized the fixed message's own advice — "refresh the page and try
again" — didn't actually work: a stale cart line lives in localStorage,
Checkout never lists individual items, and the buyer has no way to find
or remove the bad one themselves. Refreshing does nothing; retrying
Place order just repeats the same 409 forever. Backend now reports which
variant_ids were missing; Checkout.jsx removes exactly those from the
cart on that specific error and re-renders with what's left, so a retry
actually succeeds.

## 2026-08-11 — Admin order "Chi tiết" now collapses again

Chi tiết only ever opened an order's detail panel — there was no way to
close it back up once expanded, so a seller who'd looked at one order was
stuck with its full timeline/address/payment-proof/items staying visible.
Button now toggles (relabels to "Ẩn" while open), matching the
expand/collapse pattern already used for AdminCollections' product list.

## 2026-08-11 — Order/proof rate-limit messages made actionable

"Quá nhiều đơn. Thử lại sau." gave no count and no wait time. Now states
the cap (10 đơn/giờ, 20 lần/giờ for proof uploads) and a concrete minutes-
remaining figure computed from express-rate-limit's resetTime, same
pattern as the existing login-lockout message.

## 2026-08-11 — Payment method picker uses logos, like every other checkout

The `<select>` showing raw uppercase text (BANK/MOMO/PAYPAL/COD) didn't
match how buyers actually recognize payment methods elsewhere. Replaced
with a card grid (role="radiogroup"), each showing an icon: bank reuses the
existing VietQR mark, PayPal reuses the same logo path used in the
portfolio's own support-links section, Momo gets a brand-pink monogram (no
bundled asset), COD gets a plain cash icon (no brand to show).

## 2026-08-11 — Pickup instruction line also gated by payment confirmation

"Đưa mã này khi nhận hàng tại sự kiện" was shown on every pickup order's
email regardless of payment status, including the very first (pending,
unpaid) order_placed email — same premature-instruction problem the
pickup_code gating already solved, just left ungated on this line. Now
requires isPaid, same as the confirmation-code block. The QR image itself
stays ungated — still shown on any non-cancelled pickup order regardless
of payment method/status, since it's just a scannable order lookup link.

## 2026-08-11 — Momo QR stays manual-upload (not auto-generated)

Considered auto-generating a Momo QR from the public nhantien.momo.vn/<phone>
link (no amount/note pre-fill, unlike VietQR which is an open documented
standard). User chose to keep the existing manual-upload flow instead —
Momo's real QR format is proprietary/undocumented, so auto-generating one
risked producing a subtly wrong code for a real-money flow.

## 2026-08-11 — Order QR extended to ship orders too

The QR (a link to the order's own status page) was pickup-only. Since it's
just a convenient order-lookup link, not something pickup-specific, any
non-cancelled order (ship or pickup) now gets it attached. Ship orders get
a plain "Mã QR đơn hàng" caption, no pickup instructions or payment gating.

## 2026-08-11 — Restock stats gets a collection filter, both stats views get CSV export

Restock stats always showed every collection mixed together, with no way to
narrow to one drop. Added the same collection-select filter StatsDrop
already had. Separately, both StatsDrop and StatsRestock now have a "Xuất
CSV" button (matching the existing bookkeeping CSV export), server-rendered
so it's guaranteed identical to the on-screen table, respecting whatever
collection filter is active.

## 2026-08-11 — Per-collection payment (transfer) deadline override

The 48-hour reservation window before an unpaid order auto-cancels was a
single global constant (`RESERVATION_HOURS`/`.env`), no way to give one
drop a shorter or longer window than another. Added
`collections.payment_deadline_hours` (nullable int, positive-integer
validated); when set it overrides the system default for every order
placed against that collection, COD orders unaffected (COD never expires).
Left blank on a collection, behavior is unchanged. Carried over on collection
copy, like every other collection setting.

## 2026-08-11 — Buyer sees their uploaded payment-proof photo on every visit

Previously the order page only showed a "✓ Đã tải lên" text confirmation on
a return visit — the actual photo only rendered in the same session it was
uploaded, because the public order API deliberately withheld
`payment_proof_url` (only exposing the boolean `has_payment_proof`). Buyer
asked to see the photo itself every time, so the field is now included in
the public order response — no new exposure of trust boundary, since
reaching this response at all already requires the order's own token, same
gate that already protects buyer_name/phone/address on the same response.

## 2026-08-11 — Auto-cancelled (expired) orders explain why in their email

The admin's manual-cancel reason (see below) only covered admin-initiated
cancellations. An order auto-cancelled by the payment-deadline sweep
(`releaseExpiredOrders`) went out with no reason at all. Now sets the same
`cancel_reason` column to a fixed message ("Đơn hàng tự động hủy do quá hạn
chuyển khoản.") on the sweep's cancel transition — reuses the exact same
storage column and email-rendering path the admin-reason feature built, no
new code path.

## 2026-08-13 — Admin can batch-add phân loại by uploading multiple images, and reorder them

Entering a 40-code photocard sheet one row at a time (label, then pick its
photo) was tedious. AdminVariants.jsx now has a "Tải ảnh hàng loạt" picker
accepting multiple files at once — each file's name minus extension (e.g.
`A1.png` → `A1`) becomes that row's label, and the file itself is uploaded
as its photo. Uploaded rows land in the existing editable list alongside
any already-typed rows; nothing is saved until the seller presses the
existing "Lưu phân loại" button, so review/edit/remove before confirming
works exactly as it already did for manually-added rows. A failed upload
in the batch reports its own error but doesn't drop the others that
succeeded.

Separately, rows can now be reordered with per-row ▲/▼ buttons. No backend
change was needed: `catalogRepo.replaceVariants` already derives each
variant's `sort_order` from its position in the array the frontend sends,
so reordering `rows` client-side before save is the entire feature.

## 2026-08-13 — Shop image upload cap raised from 15MB to 50MB

Live testing hit this directly: an admin's ~31MB product photo was
rejected outright. Every uploaded image (product/variant photos, payment
proof) is re-encoded to WebP immediately (`processShopImage`), so a large
*input* was never a disk-usage problem — only a per-request decode-time
memory/CPU cost, which is an acceptable tradeoff per explicit direction.
Raised `MAX_UPLOAD_BYTES` (`backend/shop/images.js`) from 15MB to 50MB,
and the request body ceiling (`UPLOAD_LIMIT`, `backend/server.js`) from
50mb to 70mb so a 50MB image's base64 encoding (~1.33x inflation) still
fits in the body the size check needs to see, rather than getting rejected
earlier by the body-parser with a less specific 413.

Also fixed a real bug surfaced by the same failed upload: both upload
routes (`adminCatalog.js`, `orders.js`) always returned the generic "Ảnh
không hợp lệ" ("invalid image") regardless of *why* validation failed,
discarding `InvalidImageError`'s specific, user-safe message (e.g. "too
large, max 50MB" vs. "unsupported format"). The admin saw "invalid image"
for what was actually an oversized-but-otherwise-fine JPEG, with no way to
tell what to actually fix. Now surfaces the specific message for
`InvalidImageError`, still falling back to the generic message for any
other (unexpected) sharp failure so internals never leak.

## 2026-08-13 — X-Forwarded-For spoofing bypassed every rate limiter and the login lockout

A follow-up security review (requested after the previous hardening pass)
found a HIGH-severity gap the first audit missed: `keyGen`/`getClientIp`
in `backend/server.js` trusted the *leftmost* entry of `X-Forwarded-For`
for rate-limit keys and the admin login lockout. In production the real
chain is client → host Nginx → frontend container's Nginx → this server
(`deploy/DEPLOY.md` §9.2, `frontend/nginx.conf`'s `/api` block) — each hop
*appends* via `$proxy_add_x_forwarded_for`, so the leftmost entry is
whatever the original client sent, fully attacker-controlled. Combined
with the already-known default-admin-credentials fallback (deferred, prod
sets real ones), this meant the 5-attempt login lockout, the 10/hour order
limiter, and every other rate limiter could be defeated by sending a new
fake IP on every request — no actual rate limiting at all.

Fixed with `app.set("trust proxy", 2)` (exactly the two Nginx hops in the
real chain) plus switching both key functions to Express's own `req.ip`
(which becomes trustworthy once `trust proxy` is set correctly), further
wrapped in `express-rate-limit`'s `ipKeyGenerator` helper so an attacker
can't rotate through addresses in the same IPv6 /64 to get a fresh bucket
either. Also bumped `sharp` (0.34.5 → 0.35.3) for a libvips CVE fix, since
it decodes attacker-supplied bytes on the unauthenticated payment-proof
upload route, and ran `npm audit fix` for two other non-breaking
transitive fixes (`ip-address`, `body-parser`). Left `nodemailer` and
`uuid`/`exceljs` on their current majors — both need a breaking upgrade,
and neither's vulnerable code path (SMTP `envelope.size`/`List-*`
headers/`jsonTransport`/raw-message options for nodemailer; buffer-provided
UUID generation for uuid) is actually used anywhere in this codebase, so
deferred to a dedicated upgrade rather than risking the email-sending path
under this review's time budget.

## 2026-08-13 — Static FAQ page added at /merchandise/faq, no admin panel (yet)

Buyer confusion during live testing had already driven several UX fixes
this session (add-to-cart toast, pickup-code gating, stale-cart recovery,
etc.) — a FAQ was the cheaper fix for the remaining "buyer doesn't know
X" gap than a guided tour would have been (considered and rejected: a
tour needs a new dependency and step-target coupling to UI that breaks on
redesign, with no evidence yet that guessing, not reading, is the actual
problem).

Content (payment methods incl. the COD/pickup restriction, payment
deadline, proof upload, order-link recovery, pickup code timing, shipping
being receiver-pays, cancellation, sold-out variants) lives in a static
bilingual file (`frontend/src/shop/faq.js`), not a `site_settings`-backed
admin panel — this content changes rarely enough that editing the file
directly is simpler than building CRUD for it. Revisit if it turns out to
need frequent editing.

## 2026-08-13 — Security hardening: CORS allowlist, helmet headers, unguessable payment-proof storage keys

A security audit of the payment/order flow flagged the admin-credentials
default-fallback as the one blocker to fix before launch (deferred — prod
already sets `ADMIN_USERNAME`/`ADMIN_PASSWORD`), plus several Medium items
fixed now: CORS was wide open (`cors()`, no allowlist) on every route
including admin; no security response headers (`helmet`) were set anywhere,
notable because the admin JWT lives in `localStorage` with no containment
if any future XSS landed; JWT verification didn't pin `algorithms:
["HS256"]` (a latent alg-confusion landmine); and payment-proof photo
object-storage keys were generated from `Date.now()+Math.random()` —
combined with sequential order IDs and the public, unauthenticated
`/api/storage/:path` proxy, a buyer's bank-transfer screenshot was
guessable/brute-forceable rather than truly access-controlled.

Fixes: CORS now allowlists `SITE_URL` (reused, not a new env var) with a
warn-and-allow-all fallback only when unset (dev/test convenience, since
prod always sets it); `helmet()` added with CSP disabled (this API only
returns JSON/images, never HTML) and `crossOriginResourcePolicy` disabled
too (its same-origin default would otherwise block cross-origin `<img>`
loads in local dev, where frontend :5173 and backend :5000 are different
origins — the storage proxy already sets its own permissive
`Access-Control-Allow-Origin` for exactly that case); JWT verify now pins
HS256; payment-proof storage keys switched to `crypto.randomBytes(16)`,
matching the pattern already used for `order_token`. Also swept every
random/ID generator in the backend for the same class of issue — confirmed
every other one is either already a CSPRNG guarding real access (order
token, worker-lease holder ID) or a sequential/weak ID that's fine because
it's never used alone as a credential (order rows are always gated by
`order_token` or the admin JWT; public portfolio image keys have no
confidentiality requirement to begin with).

## 2026-08-11 — Admin cancel reason, included in the buyer's cancellation email

Cancelling gave the buyer no explanation. Admin's "Hủy" action now prompts
for an optional reason (dismissing the prompt only skips the reason, not
the cancellation — the existing confirm() guard still gates that). Stored
in a new orders.cancel_reason column, appended to the cancelled email as
"Lý do hủy: ..." only when present (omitted entirely otherwise, not an
empty label), escaped like every other buyer-facing string in email HTML.
