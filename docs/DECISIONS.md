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
