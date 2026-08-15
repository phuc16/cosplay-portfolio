# Decisions Log

Running record of product/business decisions made for the merch shop feature,
outside of the formal specs in `docs/superpowers/specs/`. Each entry is a
decision the user made during live testing or discussion — not a
implementation detail (those live in code comments/commit messages).

## 2026-08-15 — Order page requires a PIN or admin session, not just the link

A security audit (prompted by "hard check secure") flagged that
`order_token` in the order-page URL alone was sufficient to view the
pickup code and upload payment proof — anyone the buyer casually shared
the link with (a screenshot, a forwarded message) could act on the order,
including overwriting a real buyer's payment proof with a fake one and
getting admin to wrongly decline the order.

Decided: every buyer-order route now requires either an admin session
(the same JWT from admin login — an admin following a buyer's link for
support never sees a PIN) or a 6-digit PIN emailed to the buyer at order
creation, verified via a new `/verify-pin` endpoint with a 5-attempt/
15-minute lockout per order (mirroring the existing admin-login lockout).
The PIN's plaintext exists only transiently (order creation response +
the email-queue payload until sent) — only its hash is ever stored.

Follow-up decisions made live during rollout:
- The admin bypass must work even when the admin opens a buyer's link
  directly (not via `/admin` first in that tab) — reads `admin_token`
  from localStorage directly, not just the in-memory axios header.
- Admin access token extended 8h → 1 day (paired with a new 30-day
  refresh token) since the bypass raised the cost of an admin session
  expiring mid-support-conversation.
- The PIN shown in the confirmation email was moved into the same card
  as the "Xem đơn hàng" link (was a visually separate block below it) —
  it's only relevant in the context of that link.
- The buyer's own browser skips entering the PIN once, immediately after
  checkout (the browser that just placed the order already proved it's
  the buyer) — seeded via a session-scoped token, not a persistent
  bypass; a different device or a fresh session still needs the emailed
  PIN.
- FAQ updated: "how do I find my order again" now says the PIN is
  required too, plus a new entry explaining what the PIN is for.

## 2026-08-14 — Admin order search: no scope on "statistic" pages, id search doesn't match the display code

Asked for search across order/ship/statistic admin pages, by id, name,
phone, or email. The statistic pages (`StatsDrop`, `StatsRestock`,
`StatsBookkeeping`) only render aggregates — no per-order listing exists
there to search, so that part of the request has no surface to attach to
in the current app.

Delivered: server-side search on `GET /api/admin/orders` (id/name/phone/
email, `AND`-combined with the existing status/collection/date filters);
client-side search on `ShippingExport` and `ShippingRoster` (both already
fetch their full, non-paginated order lists in one shot, so a backend
param would be pure overhead). A numeric search term only matches an
order's raw `id`, never the Shopee-style `order_code` shown to buyers —
`order_code` is a computed display value, not a stored column, so matching
it would need decoding first, same rule as everywhere else `order_code`
isn't the DB key.

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

## 2026-08-14 — Email footer: sign-off, social links, "automated email" notice

Requested with a Shopee email screenshot as reference (social icon row +
"this is an automated email, don't reply, add us to your contacts"
notice). Added to the shared `wrap()` footer so it appears on every order
email (order_placed, payment_confirmed, shipped, cancelled), not just
one template:
- A plain "Trân trọng,\n{{shop_name}}" sign-off after each template's own
  content (an initial "Đội ngũ {{shop_name}}" version was tried first,
  then simplified to just the name per explicit follow-up feedback).
- A row of circular color-badge social links ({{social_links}}), built
  from the same `contact.social` list the main portfolio page's social
  icons already read from `site_settings` — reused, not duplicated. Badges
  are plain background-color + text (e.g. "f", "IG"), not inline SVG or
  hosted images: Outlook's Word-based rendering engine handles that
  reliably where SVG often silently fails, and it needs no image hosting.
  Renders nothing if no social links are configured.
- "Đây là email tự động, vui lòng không trả lời email này. Thêm
  {{shop_email}} vào danh bạ..." — `shop_email` is `SMTP_FROM` (falling
  back to `SMTP_USER`), i.e. the literal envelope sender, since the whole
  point of "add to contacts" is keeping *that exact address* out of spam.

`{{shop_email}}` and `{{social_links}}` are two new placeholders,
substituted in `buildVars` like every other field; both added to
`PLACEHOLDERS` (backend) and its frontend mirror in
`AdminEmailTemplates.jsx` so the admin's "valid placeholders" hint stays
accurate. Social links are fetched once per `sendQueued` batch (not once
per message) since they change rarely and every email in a batch shares
the same footer.

## 2026-08-14 — Opaque order code shown instead of the raw sequential id

Prompted by a Shopee order-confirmation screenshot ("Đơn hàng
#2608137A69U181"). A plain "#12" leaks order volume to anyone comparing
two order numbers and reads as less polished than most storefronts'
opaque codes. Chose a derived, not stored, value over changing the actual
primary key (which would touch every FK/join in the schema for a purely
cosmetic reason) or adding a new column (extra migration + write path for
something computable from data that already exists): `formatOrderCode(id,
created_at)` in `backend/shop/orders/domain.js` returns a YYMMDD date
prefix plus an 8-character suffix hashed from the id (SHA-256, truncated,
base-36, uppercase) — deterministic so it can never drift from the real
id and needs no uniqueness bookkeeping, but doesn't read as an
obviously-zero-padded small number the way a raw base-36 encode of a
low id would. Matches Shopee's example length (14 chars) per explicit
follow-up request — an earlier 10-char version (date + 4-char base-36 id)
was replaced for looking too much like a padded sequential number.

Applied to the email subject placeholder (`{{order_id}}` now resolves to
the formatted code, not the raw id) and the admin order list/detail
(`backend/routes/adminOrders.js` attaches `order_code` to every order
response; `AdminOrders.jsx` displays it in place of the raw id — API
calls, selection state, and `data-order-id` still use the real numeric
`id`, since backend routes are keyed by that, not the display code). Not
applied to the admin's failed-email-queue listing (`AdminEmailTemplates.jsx`),
which is an internal debug view where the raw id is more useful, not less.

## 2026-08-14 — Order status timestamp added to the buyer's order page

The buyer's order page showed only a bare status badge ("Trạng thái: Đã
xác nhận") with no indication of when that status was reached — the admin
side already had this via `OrderTimeline`, which reads
`confirmed_at`/`shipped_at`/`completed_at`/`cancelled_at`, but those
columns were never included in the public order response
(`toPublicOrder` in `backend/routes/orders.js`). Added all four (no new
migration — the columns already existed for the admin timeline). Frontend
picks whichever one matches the order's *current* status (not a full
history, just the buyer's simpler single-badge view) via a small pure
`statusTimestamp(order)` helper in `Order.jsx`, same
separate-pure-logic-for-testability pattern `OrderTimeline`'s
`buildTimelineSteps` already uses.

## 2026-08-14 — Province/ward pickers replaced with a custom searchable dropdown

The native `<select>` used for province/ward rendered its option list with
OS-level UI (a plain white list, browser-default blue highlight) that
ignores nearly all app CSS — clashing hard with the dark theme, and with
no way to filter a 100+-item ward list by typing. Replaced both with a new
`SearchableSelect` component (`frontend/src/components/shop/SearchableSelect.jsx`):
a styled trigger button + dropdown (matching the existing
`bg-[var(--surface-card)]`/`border-[var(--border-brand)]` card style used
elsewhere) with a type-to-filter text input at the top, fully
CSS-controllable since none of it is native browser chrome. Also added
Enter-to-search on the street field (previously click-only), with
`preventDefault` so Enter doesn't submit the whole checkout form instead.

Caught a real regression from this while re-running the full suite (not
just the touched files): several pre-existing `Checkout.test.jsx` tests
located the submit button via the fragile `button.w-full` selector, which
now also matched `SearchableSelect`'s trigger buttons (same utility
class) — `container.querySelector` silently grabbed the wrong button,
one row of "the button's `disabled` is false" assertions failed loudly,
but two others (clicking what they *thought* was submit) failed
confusingly since nothing looked wrong until stale-cart-removal text
never appeared. Fixed by narrowing the test selector to
`button.w-full.rounded-xl` — the submit button's own `rounded-xl` isn't
shared with the new dropdown's `rounded-lg`, no app markup needed to
change. Worth remembering: a fragile DOM selector shared between an old
test and new markup can silently drift instead of failing outright.

Also added a short FAQ entry ("Cách nhập địa chỉ giao hàng thế nào?")
covering the province/ward/street flow and mentioning the search button
by name for apartment/complex addresses, using this exact Vinhomes
example as the illustration.

## 2026-08-14 — Street-search suggestion picker lost building/complex names

Live testing surfaced the bug immediately: picking "Sảnh chính S3.01, CC
Vinhomes Grand Park, Nguyễn Xiển, Long Bình, Hồ Chí Minh" only filled
"Sảnh chính S3.01" — `structured_formatting.main_text` is Goong's *short*
label for a named place (a building/complex), not the full detail; "CC
Vinhomes Grand Park" and the street name were silently dropped. Fixed by
using `description` (the full string) instead, with the already-known
ward+province suffix stripped off the end (we already have those from our
own pickers — no need to duplicate them into `address_street`, and Goong's
own guess for them can differ slightly from what the buyer actually
selected).

## 2026-08-14 — Goong brought back, but only for an on-demand street search

Follow-up: is there still a place for Goong now that province/ward are a
static picker? Yes, for the free-text street/house-number field, but
scoped very differently from the original design. Explicitly gated
behind a search-button click in `AddressFields.jsx` — never wired to
`onChange` or an effect — so it can never fire per keystroke the way the
original design (and its 6-calls-per-address problem) did. The click
handler sends the already-picked ward + province name alongside the
typed text (`GET /api/shop/address-search`, `backend/routes/shop.js`),
which measurably improves relevance: searching "66B Nguyễn Sĩ Sách" alone
matched a same-named street in Bắc Ninh; adding ", Long Bình, Hồ Chí
Minh" correctly resolved it to the intended Hồ Chí Minh address (verified
directly against Goong's API before wiring this up).

Brought back `GOONG_API_KEY` (backend-only, still never sent to the
browser) and a dedicated `addressLimiter` (20/min per IP) as defense in
depth in case a script bypasses the button and hits the route directly —
though the button-gated design already keeps real usage far under that.
Picking a suggestion only fills the street field; the buyer's own
province/ward picks are never overwritten by whatever Goong's `compound`
data says, since those are already the source of truth.

Live testing showed the real cost of the per-keystroke Goong design: typing
one address fired 6+ requests (network tab: `input=512,` → `input=512,+`
→ `input=512,+Nguy...` → ...), even after server-side proxying and rate-
limiting. Replaced the whole live-autocomplete approach with: a Province
dropdown, a Ward dropdown (populated once a province is picked), and a
plain-text "house number, street" field — zero live address-lookup API
calls for the structured part, since province+ward are chosen from a
fixed list rather than searched for. Vietnam abolished the district level
in a 2025 administrative merger (63→34 provinces), so there's no district
picker — confirmed against the actual current dataset (verified via
direct fetch + `node` parsing, not a summarized fetch, after an initial
AI-summarized page read undercounted the dataset by 6x).

First cut hardcoded this data into the repo (`frontend/public/data/`,
sourced from github.com/zuydd/vn-geo, split into one file per province so
a ward lookup only ever downloads ~100 wards, not all 3,320). Immediately
revised per feedback: fetch province/ward data from a live API instead of
maintaining a local copy that would silently go stale if boundaries
change again. Switched to `provinces.open-api.vn`'s v2 API — free, no key,
confirmed to already reflect the post-2025 structure — proxied through
`backend/shop/vnAddress.js` with a 30-day Redis cache (`vn_provinces`,
`vn_wards:<code>`) per the user's explicit request, rather than fetched
directly from the browser. This keeps the shop off a third party's free
service almost entirely (one real request per province per 30 days,
shared across every visitor) while never needing to hand-update the
dataset if it changes.

This obsoletes the two immediately preceding entries' Goong-specific
work: `GOONG_API_KEY` (env var, all docker-compose/DEPLOY.md references),
`GET /api/shop/address-autocomplete`, and its dedicated rate limiter are
all removed as dead code — nothing calls Goong from this codebase anymore.

Two follow-up asks on the just-shipped Goong integration: (1) had all of
Goong's documented v2 performance parameters been applied, and (2) how to
stop a spammer from running up the shop owner's Goong bill, since the key
lived in the public JS bundle. Fetched Goong's v2 Autocomplete docs
directly: the endpoint is `v2/place/autocomplete` (our code was calling
the older `Place/AutoComplete`), and supports `limit`, `location`+
`radius` (geographic bias), and `more_compound=true` (structured
district/commune/province on each result) — none of which were in use.
Also, `AddressFields.jsx` was parsing ward/district/province by
comma-splitting `secondary_text`, when Goong's own response already
carries this as a structured `compound` object once `more_compound=true`
is requested — fragile guessing replaced with the field made for this.

On spam protection: domain/referrer restriction on Goong's side (their
own suggested mitigation) only stops casual reuse by real browsers — a
script extracting the key from the bundle can set any `Referer` header it
wants, since that header is entirely client-controlled. The actual fix is
architectural: moved the call server-side entirely
(`GET /api/shop/address-autocomplete`, `backend/routes/shop.js`), so the
key never reaches the browser at all, plus a dedicated `addressLimiter`
(20/min per IP, same Redis-backed pattern as every other limiter in
`server.js`) caps worst-case spend independent of whatever limit Goong
itself allows. This reverses the previous two entries' Vite build-time
wiring: `GOONG_API_KEY` is now a plain backend runtime env var (a
container restart picks up a changed value — no rebuild needed, an
improvement over the old build-arg approach), and the CSP's `connect-src`
addition for `rsapi.goong.io` was removed since the browser no longer
talks to Goong directly.

## 2026-08-14 — CSP was silently blocking the Goong address-autocomplete fetch

After wiring up the Goong API key (entry below), the checkout's address
field still showed no suggestions — a working key, correct Goong CORS
headers, and a rebuilt frontend image all confirmed via direct `curl`,
yet nothing appeared in the actual browser. Root cause:
`frontend/nginx.conf`'s Content-Security-Policy had `connect-src 'self'`,
which blocks the browser from making *any* `fetch()` to a cross-origin
URL — `AddressFields.jsx` calls `rsapi.goong.io` directly from client-side
JS, so the request never left the browser at all, and the component's
`fetch().catch()` silently swallowed the resulting CSP violation with no
visible error. `curl` has no CSP to enforce, which is why every
server-side check looked fine.

Fixed by adding `https://rsapi.goong.io` to `connect-src`. Since
`frontend/nginx.conf` is baked into the single Docker image
(`phuc16/cosplay-frontend`) shared by both `docker-compose.yml` (local)
and `docker-compose.pull.yml` (prod), and the host-level nginx config in
`deploy/DEPLOY.md` doesn't duplicate any CSP header, this fix covers
production automatically once the image is rebuilt/pushed
(`./scripts/build-push.sh`) and pulled on the server — no separate
prod-specific config needed changing.

## 2026-08-14 — Wired up the Goong Maps API key for checkout address autocomplete

`frontend/src/components/shop/AddressFields.jsx` already implemented
Goong-based address autocomplete (Vietnam-specific, splits into
street/ward/district/province) — it just had no `VITE_GOONG_API_KEY`
configured anywhere, so it silently degraded to a plain textarea in
every environment. Confirmed this design is already compatible with the
ViettelPost export: `vtpMapping.js`'s `assembleAddress()` joins exactly
these same four fields with `", "`, falling back to `address_raw` — no
VTP-specific admin-division codes needed, just the free-text fields this
component already produces.

Since `VITE_*` vars are inlined into the frontend bundle at Vite *build*
time, not read at container runtime, wiring the key up required more than
an env var: added it to `frontend/Dockerfile` (`ARG`/`ENV`),
`docker-compose.yml`'s frontend `build.args`, and `scripts/build-push.sh`
(the production image build/push script) — a container restart alone
would never pick up a changed value, only a rebuild. Documented in both
`.env.example` and `deploy/DEPLOY.md`.

The key the user first provided (`gmGSsj...`) was rejected by both
Goong's Place/AutoComplete and Geocode endpoints with
`API_KEY_UNAUTHORIZED` — Goong issues separate "Maps Key" (tiles/embeds)
and "API Key" (REST services) credentials, and this was very likely the
former. User is getting the correct API Key; all the wiring above is
already in place and just needs the working key dropped into `.env`
(gitignored, not committed) followed by `docker compose build frontend`.

## 2026-08-14 — Social-link badges removed from the email footer entirely

The letter-badge fallback (facebook "f", messenger "M", instagram "IG")
from the previous entry rendered correctly, but per explicit feedback a
fake-looking letter badge was judged worse than no badge at all — cut
outright rather than tried a third icon approach. The footer now keeps
only the sign-off and "automated email, add to contacts" notice.
`sender.js`'s `getSocialLinks` (the `contact.social`/`contact.contactLinks`
lookup) was removed as dead code along with it — no separate migration or
data cleanup needed, since badges were only ever appended at send time by
`footerHtml()`, never baked into a stored `email_templates` row.

## 2026-08-14 — Order deadline off-by-one: "48 giờ" showed "còn 49 giờ"

Reported live: setting a 48-hour payment deadline showed "còn 49 giờ" on
the order page immediately after placing the order. Root cause: DB
inspection confirmed `orders.expires_at` (a `DATETIME` column, no
fractional-second precision) is stored ~1 second later than the exact
"created_at + N hours" mark — e.g. `created_at` 07:22:32 → `expires_at`
07:22:33 for a 48h deadline, not 07:22:32. Since `formatDeadline`'s
remaining-time calculation always rounds up (`Math.ceil`, by design — see
the SWEEP WINDOW tests — so a deadline minutes away never misreads as "0
hours left"), that stray extra second was enough to round 48.0003 hours
up to 49 for the brief window right after an order is placed (before
naturally correcting to 48 a moment later, which is exactly why it read
as a bug rather than a display quirk — the *first* thing a buyer sees is
the wrong one).

Fixed by subtracting a 5-second buffer before rounding
(`frontend/src/utils/orderDeadline.js`) — enough to absorb the storage
rounding noise without weakening the existing "never shows 0 minutes
early" guarantee at the low end (subtracting 5 seconds from an
already-short remaining window doesn't change the rounded-up hour count
there, since `Math.max(1, ...)` already floors the display at 1
regardless).

## 2026-08-14 — Email footer regressions from the last two entries: duplicate notice, broken icons

Real-send screenshot surfaced two bugs from the footer work above:

1. **The "automated email" notice appeared twice** — once above the QR
   (with an empty "Thêm  vào danh bạ" — the email address missing) and
   once below it (correct). Root cause: the local dev DB's
   `email_templates` table had stale rows saved via the admin UI from
   *before* this session's footer refactor, still containing the old
   `{{shop_email}}`/`{{social_links}}` placeholders baked directly into
   `body_html`. Those two placeholders were removed from `buildVars` in
   the refactor, so `substitute()` correctly rendered them as empty
   (its documented behavior for an unknown placeholder) — the stale
   *content*, not the substitution logic, was the bug. Fixed by deleting
   the 4 stale rows from the local dev DB so they fall back to the
   current (correct) `DEFAULT_TEMPLATES`; this only affected already-saved
   custom templates, not a code path.
2. **Social badges rendered as a broken-image icon with overlapping alt
   text** — the data-URI `<img>` approach from the entry below didn't
   render in real-world testing, contradicting the assumption that an
   `<img>` degrades more gracefully than inline SVG. Reverted to plain
   colored-circle + letter badges (facebook "f", messenger "M", instagram
   "IG") — no image loading involved at all, so it can't fail this way
   regardless of client.

Also extracted the order-page's date formatting into a shared
`formatVnDateTime` (`frontend/src/utils/orderDeadline.js`, used by both
`formatDeadline` and `Order.jsx`'s new status timestamp) after the raw
`toLocaleString("vi-VN")` version produced a format
("14:22:32 14/8/2026") inconsistent with the existing deadline line's
"HH:mm dd/MM" convention.

## 2026-08-14 — Email footer refined: fewer platforms, real logos, moved below the QR

Follow-up feedback on the entry above, from a screenshot of the actual
rendered footer: only Facebook, Messenger, and Instagram should show (not
every configured social platform), using real logo glyphs instead of
plain letter badges, and the whole footer needed to be the very last
section — below the order QR, which it wasn't (QR is appended by
sender.js after the template renders, so content baked into `wrap()`'s
footer always landed above it).

Messenger isn't in `contact.social` at all — it lives in
`contact.contactLinks` (the portfolio page's quick-contact list), so
`sender.js`'s social-link lookup now reads both: Facebook/Instagram URLs
from `contact.social`, Messenger from `contact.contactLinks` (transformed
to `https://m.me/<username>`, same as `Portfolio.jsx`'s `contactHref`).
Display order is fixed at Facebook → Messenger → Instagram per explicit
request, regardless of the order platforms happen to appear in config.

Badges now embed each platform's real SVG logo (same path data as
`Portfolio.jsx`'s icons) as a `data:image/svg+xml;base64` `<img>` rather
than an inline `<svg>` element or a plain letter — an `<img>` degrades
more predictably across mail clients (Outlook's renderer in particular
often drops inline SVG) and needs no image hosting.

Structurally, the whole footer (badges + "automated email" notice) moved
out of `wrap()` — which finishes rendering before the QR block even
exists — into a new `templates.footerHtml(social)`, called by `sender.js`
and string-appended *after* the QR/cancel-reason blocks, the same way
those are appended today. `{{shop_email}}`/`{{social_links}}` are no
longer template placeholders (removed from `PLACEHOLDERS` and its
frontend mirror) since the footer isn't part of the substitutable
template body anymore.

## 2026-08-14 — Tablet-specific grid/thumbnail breakpoints added across shop + portfolio

A responsive audit found every grid layout in the shop and portfolio
jumped straight from a mobile (Tailwind `sm:`, ≤640px) breakpoint to a
desktop one (`lg:`, ≥1024px) with no `md:` (768px) rung — so a tablet in
portrait or landscape (768-1023px, e.g. any iPad) got the exact same
layout as a phone in landscape, wasting the extra width. Confirmed against
`AdminAlbumImages.jsx`, which already used the full `sm:`/`md:`/`lg:`
ladder — proving the gap elsewhere was an inconsistency, not a framework
limit.

Fixed: the collection grid (Shop.jsx) and product grid (Collection.jsx)
now step 1→2→3 columns at `sm:`/`md:` instead of 1→2→3 at `sm:`/`lg:`. The
variant-photo gallery masonry (`ProductCard.jsx`'s `galleryColumnClasses`)
gained a `md:` rung at every tier. On the portfolio page, the 3-card info
grid (photos/info/achievements) now gets a dedicated 2-column tablet
layout (761-980px) instead of collapsing straight to mobile's 1 column —
matching `useBreakpoint()`'s existing mobile/tablet/desktop buckets, which
some CSS already tracked but didn't fully use. The hero ("wallpaper")
card's height, previously a flat 300px at both ≤760px and ≤460px, now
scales down further to 240px at ≤460px, since a 375px-wide phone and a
750px-wide one were getting an identical banner height/aspect. The
per-slide hero-cover crop positioning is percentage-based, so it adapts to
the new height automatically — no separate fix needed there.

No list/grid view-mode toggle exists anywhere in the app, confirmed by
grep — "list type of an item" in the request most likely referred to the
existing single-column mobile collapse, not a feature to add.

## 2026-08-14 — "Merchandise" now translated to Vietnamese ("Cửa hàng")

Reverses part of the 2026-08-11 decision to keep "Merchandise" identical
in both languages (same precedent as "Merch"). Updated `shopTitle`
(`frontend/src/i18n/translations.js`) and the two places Portfolio.jsx
hardcoded the English word regardless of `lang` — the main-site nav tab
and the Hỗ trợ section's shop button.

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
