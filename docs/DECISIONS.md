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
