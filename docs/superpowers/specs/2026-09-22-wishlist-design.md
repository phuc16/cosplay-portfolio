# Wishlist (Save-for-Later) — Design

## Trend angle

**Shopping/e-commerce trend**: a persistent, one-tap "save for later" list
is now a baseline expectation on shopping sites of any size — buyers
routinely browse a drop, aren't ready to commit to every item, and expect
a low-friction way to keep track of what caught their eye without adding
purchase intent (which the cart implies) or waiting for a stock alert
(which is reactive, not something the buyer curates themselves). This
shop already ships frequent, small e-commerce-parity features (coupon
codes, product reviews, one-click reorder, back-in-stock alerts) — a
wishlist is the same category of "expected baseline," and this codebase
already has a proven pattern for exactly this shape of client-side,
localStorage-backed list: the cart (`frontend/src/shop/cart.js`).

## Scoped distinctly from two adjacent features

- **Not the cart.** The cart (`shop/cart.js`) is a checkout-bound,
  price/name snapshot with a `qty` per line, because it has to survive
  into `createOrder` with numbers a buyer can rely on. The wishlist has no
  checkout relationship and no `qty` — an item either is or isn't saved.
  Its stored fields are pointers for re-fetch, deliberately **not** a
  price/availability snapshot (see "Data model" below) — the two modules
  share a persistence *shape* (localStorage, subscribe/notify, array of
  plain objects), not a semantic.
- **Not back-in-stock alerts** (the separately-shipped PR #11). Back-in-stock
  is a one-shot **server-side email trigger** tied to a single sold-out
  variant: the backend remembers an email address and fires once when
  that variant's stock moves off zero, then forgets it. It requires no
  browsing UI of its own — it's a "notify me" button on a sold-out item.
  The wishlist is the opposite shape: a **client-only, browsable list**
  the buyer curates and revisits, with no backend involvement, no email,
  and no relationship to stock transitions — saving a wishlist item never
  sends anything to the server, and a sold-out item can be wishlisted
  (unlike some stock-alert UIs, which trigger only when it's sold out).
  Both features can coexist on the same sold-out variant with zero shared
  code or data.

## Scope decisions

- **100% client-side.** No backend changes, no migration, no new API
  route — this mirrors the instruction and the fact that the cart itself
  is 100% client-side until checkout. `localStorage`, same as the cart.
- **No qty, no merge-on-duplicate.** A variant is either saved or not;
  adding an already-saved variant is a no-op (unlike the cart's
  qty-merge behavior on a duplicate `addToCart`).
- **Not a snapshot.** Unlike every snapshot column this codebase already
  uses for orders (`product_name_snapshot`, `unit_price_snapshot`, etc.)
  and unlike the cart's own display fields, a wishlist entry's stored
  `product_name`/`price`/`image_url` are **cosmetic only** — good enough
  for the header badge count and an instant first paint of the wishlist
  page, never trusted for anything a buyer could act on. The Wishlist
  page always re-fetches the owning collection by slug
  (`fetchCollection`, the same public endpoint `Cart.jsx`'s
  `checkCartAvailability` already re-fetches from) and reads live
  price/stock/status from that response before rendering anything
  actionable (the "Add to cart" button, the price shown, the sold-out
  badge). This directly follows the instruction's explicit requirement
  and deliberately diverges from the order-snapshot convention described
  in CLAUDE.md, because a wishlist has no purchase-commitment moment to
  snapshot *at* — nothing is ever charged against it.
- **Independent of stock/orderable state.** The heart toggle is never
  disabled for a sold-out variant or a closed/not-started collection —
  those are exactly the situations a buyer is most likely to want to
  bookmark something for later. This is the opposite of "Add to cart",
  which is already disabled in both cases.
- **Reuses the cart's own add-to-cart function** from the Wishlist page's
  quick-add action — no reimplementation of cart-line construction.

## Data model (client-side only, no backend)

### `localStorage["shop_wishlist"]`: a JSON array of entries

| Field | Type | Notes |
|---|---|---|
| `variant_id` | int | The variant being tracked — the de-dup key |
| `product_id` | int | Needed to re-locate the product within a re-fetched collection (a collection's product list is keyed by product, not variant) |
| `collection_slug` | string | Needed to re-fetch via `fetchCollection(slug)` — same "link back to product" precedent as the cart's own `collection_slug` field (`docs/DECISIONS.md`, 2026-08-11, "Cart items link back to their product") |
| `product_name`, `variant_label`, `price`, `image_url` | optional, cosmetic | Last-known display fields only — shown before the live fetch resolves and used for nothing that gates a purchase or a stock claim |
| `is_digital` | optional, cosmetic | Mirrors the cart's own field of the same name; informational only |

`isValid()` (mirroring `cart.js`'s own untrusted-localStorage-input
stance) only requires `variant_id`/`product_id` to be integers and
`collection_slug` to be a non-empty string — the fields actually needed
to re-fetch. Every other field is optional and never gates validity,
since they're allowed to be stale or absent.

### API (`frontend/src/shop/wishlist.js`), mirroring `cart.js`'s shape

- `readWishlist()` / `subscribeWishlist(listener)` — same untrusted-read
  and pub/sub pattern as `cart.js`.
- `addToWishlist(item)` — no-op if the variant is already saved (no
  qty-merge concept).
- `removeFromWishlist(variantId)`.
- `toggleWishlist(item)` — what the heart-icon button drives.
- `isWishlisted(variantId, wishlist?)` — convenience read, accepts a
  pre-read wishlist to avoid a redundant `readWishlist()` call from a
  component that's already subscribed.
- `wishlistCount(wishlist)` — count of **distinct items**, not units
  (there's no `qty` to sum, unlike `cartCount`).

## UI

### `ProductCard.jsx` — heart toggle

Placed in the two places this component already surfaces a specific
variant (this file's own terminology, from its inline comment: `null` =
closed, `"grid"` = full variant gallery, an object = single-variant
detail):

- **Each thumbnail in the variant gallery** (`view === "grid"`): a small
  circular heart overlay in the thumbnail's top-right corner, alongside
  the existing bottom-label pill and sold-out overlay. Since the
  thumbnail itself is a `<button>` (opens the detail modal), the heart is
  a sibling button in a wrapping `<div>`, not nested inside it (invalid
  HTML) — its click handler calls `e.stopPropagation()` so tapping the
  heart never also opens the detail modal.
- **The detail modal** (single-variant view, reached directly for a
  single-variant/digital product or via a gallery thumbnail for a
  multi-variant one): a heart button next to the "View all" link in the
  header row.

No heart on the bare outer product-grid card (the one Collection.jsx
renders per product) — that card has no "Add to cart" either today; every
variant-specific action already lives inside one of the two modals above,
so the heart follows the same existing convention rather than introducing
a new one for an ambiguous case (which variant would a heart on a
multi-variant product's outer card even refer to?).

Both placements read `isWishlisted(variantId, wishlist)` from a
component-local `wishlist` state kept live via `subscribeWishlist` (the
exact same "read on mount + subscribe" pattern `ShopHeader.jsx` already
uses for its cart-count badge), so a toggle made elsewhere (e.g. the
Wishlist page's own remove button) is reflected without a remount.

### `ShopHeader.jsx` — nav badge

A new heart-icon link to `/merchandise/wishlist`, placed beside the
existing cart icon link, showing `wishlistCount(readWishlist())` as a
badge exactly like the cart's own count badge — same
read-on-mount-then-subscribe reactivity, same badge markup/positioning,
just wired to `subscribeWishlist` instead of `subscribeCart`. The two
badges are independent counters (a heavy cart and an empty wishlist, or
vice versa, render correctly at the same time).

### `Wishlist.jsx` page (`/merchandise/wishlist`)

Route added alongside the shop's existing flat `/merchandise/*` routes in
`App.jsx` (same list `/merchandise/faq` and `/merchandise/:slug` already
sit in) — placed before the dynamic `/merchandise/:slug` route, matching
this file's existing convention of listing the static `/merchandise/faq`
route before it too (React Router's own route ranking would in fact pick
the static path over the dynamic one either way, but the explicit
ordering keeps the file self-consistent and readable).

On mount, and after the wishlist array changes: collects the distinct
`collection_slug`s across saved entries, fetches each once via
`fetchCollection` (`Promise.all` with a per-slug `.catch(() => null)`, the
exact resilience pattern `cartAvailability.js`'s `checkCartAvailability`
already uses for the cart's own early-validation fetch), then resolves
each entry against its collection's live product/variant data — handling
a digital product's flattened `variant_id`/`stock_qty` the same way
`cartAvailability.js`'s own `findProduct` already does.

A resolution failure at any level — the collection fetch itself rejects,
the product is no longer in the collection's product list, or the
variant is no longer in the product's variant list — renders that one row
as "No longer available" with only a Remove button, and never throws or
blocks the rest of the list from rendering (verified by a test that mixes
one failing and one succeeding collection fetch in the same wishlist).

For a resolvable row: shows the live product name/variant label/price,
a sold-out/ended/not-started badge when applicable (reusing
`isSoldOut`/`isProductSoldOut` already exported from `ProductCard.jsx`,
and `collection.status`/`collection.not_started_yet`, the same fields
`Cart.jsx`'s own availability check already reads), a link back to the
product's collection page, a "Remove" button, and an "Add to cart" button
that's disabled when sold out or not orderable and otherwise calls the
existing `addToCart` from `shop/cart.js` directly with the row's live
price — never the wishlist entry's own (possibly stale) cached price.

## Bilingual copy

All new buyer-facing strings (`wishlistNavLabel`, `wishlistTitle`,
`wishlistDesc`, `wishlistEmpty`, `wishlistAdd`, `wishlistRemove`,
`wishlistRemoveItem`, `wishlistUnavailable`, `wishlistAddedToCart`) are
added to both the `en` and `vi` blocks of
`frontend/src/i18n/translations.js`, read via `useLanguage()`'s `t()` —
no hardcoded copy in JSX, following the same pattern every other shop
string in this file already uses.

## Testing approach

- `frontend/src/shop/wishlist.test.js` — mirrors `cart.test.js`'s
  structure: add/remove/toggle/list/count, no duplicate on a repeated
  add, malformed-entry filtering, corrupt-storage recovery, a
  `setItem`-throws case, and a persistence-across-a-simulated-reload
  case (a fresh `readWishlist()` reflects prior writes, since nothing but
  `localStorage` survives a real reload).
- `ProductCard.test.jsx` — a new `describe` block covering: default
  unsaved state, toggling on/off, that toggling never adds to cart, that
  the heart stays enabled/clickable for a sold-out variant and for a
  closed collection (the behavior that's the entire point of this
  feature, unlike "Add to cart"), that clicking a gallery thumbnail's
  heart doesn't also open the detail modal, and that an external wishlist
  change is reflected live without a remount.
- `ShopHeader.test.jsx` — a new `describe` block mirroring the existing
  cart-badge tests: link exists, no badge when empty, correct count at
  mount, live update without a remount, and that the cart/wishlist
  badges count independently of each other.
- `Wishlist.test.jsx` — empty state; rendering a resolvable saved item
  with live price/label; a sold-out variant disabling Add to cart; a
  digital product's flattened variant; a 404'd collection and a
  deleted-product case both rendering "No longer available" without
  crashing; that one failing collection fetch doesn't break another
  succeeding one in the same list; Remove actually clearing storage; and
  quick-add-to-cart landing an item in the real cart via the existing
  `addToCart`.

## Out of scope (explicitly deferred)

- Any backend persistence, cross-device sync, or account/email tie-in for
  the wishlist (fully client-side, matches the instruction).
- Any interaction with back-in-stock alerts (PR #11) — no shared code,
  no shared data, no cross-linking UI between the two features.
- Wishlist sharing/export, sorting/filtering, or a "move all to cart"
  bulk action — YAGNI for a first version; the cart itself didn't ship
  with bulk actions either.
- Any price/stock snapshotting on save — explicitly rejected per the
  "Data model" section above.
