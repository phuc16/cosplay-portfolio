# Shareable Product Cards — Design

## Trend angle: cosplay-community

Cosplay drops are discovered and resold through reshares, not search -
sellers post a story on Instagram/TikTok, and fans reshare the specific
photocard or variant they want (not the whole shop). That's how buyers
in this community actually find a drop today. This shop currently has no
way to hand a fan a link to *one specific item* - the only URL that
exists is the whole collection page, so "check out this exact photocard"
degrades into "go dig through this whole drop for the one I mean." A
native/one-tap share button on the exact item a buyer is already looking
at (the variant detail view) closes that gap with no new UI surface
beyond a button and a query param.

## Scope decisions

- **No per-product page.** Per `docs/DECISIONS.md`'s 2026-08-11 "Cart
  items link back to their product" entry, no per-product route exists
  and this feature does not add one - that would be a much bigger
  change (new route, new data-fetch shape, SEO/meta implications) for a
  problem the existing collection page + a query param already solves.
  The shared link is the collection URL with a `?product=`
  (`&variant=` when needed) query param that `Collection.jsx` reads on
  mount to auto-open the same detail view a click would have opened.
- **Share button lives in the variant detail modal only**, not the bare
  grid card. Sharing "a product" is ambiguous when it has several
  variants (which photocard code?) - the detail view is the first place
  a single, unambiguous item (product + the specific variant being
  looked at) is actually pinned down. A digital product's single hidden
  variant reaches this same modal through its existing one-variant code
  path, so it gets a Share button too with no special-casing.
- **No new npm dependency.** `navigator.share` (Web Share API, mobile
  Safari/Chrome) and `navigator.clipboard.writeText` (desktop fallback)
  are both already-standard browser APIs. No share-library/polyfill.
- **No backend changes.** The deep-link param is resolved entirely
  client-side against data the collection fetch already returns
  (`GET /api/shop/collections/:slug` already includes every product's
  variants) - nothing new to expose, cache-invalidate, or authorize.
- **URL shape**: `/merchandise/:slug?product=<id>` or
  `/merchandise/:slug?product=<id>&variant=<id>`. `variant` is included
  only when the product has more than one variant - a single-variant
  product's detail view is already fully determined by `product` alone,
  so appending a redundant `variant` would just be noise. This mirrors
  the existing collection-slug-in-path convention (`/merchandise/:slug`)
  and keeps the query side to exactly the two ids needed to reconstruct
  a click.
- **Absolute URL, built from `window.location.origin`.** The frontend
  has no `SITE_URL`-equivalent env var exposed to it (only the backend
  reads `SITE_URL`, for CORS) - the running page's own origin is already
  the correct value in every deployment (local dev, production) with no
  new env plumbing.

## Component/state model (read before implementing - see `ProductCard.jsx`)

`ProductCard.jsx` already drives its whole picker/detail UI from one
piece of local state: `view` (`null` = closed, `"grid"` = the full
variant gallery, an object = a single variant's detail, via
`openDetail(v)`/`setView("grid")`). The Share button is added inside the
existing `detail &&` block (the single-variant detail modal), next to
the existing "View all" link.

**Deep-link-in prop**: `Collection.jsx` reads `?product=`/`?variant=`
once via `useSearchParams()` and, for the one matching product only,
passes a `deepLinkVariantId` prop:
- `undefined` (the default, for every non-matching product) - no
  behavior change, `view` starts at `null` exactly as today.
- `null` - this product matched `?product=` but there was no usable
  `variant` id (param absent, non-numeric, or matches no variant of
  this product) - falls back to whatever a plain card click would do:
  the single variant's detail if there's exactly one, the full grid if
  there's more than one.
- a number - matched a real variant id on this product - opens that
  variant's detail directly, same as clicking its gallery thumbnail.

`ProductCard`'s `view` state's initial value becomes a lazy
`useState(() => ...)` that resolves `deepLinkVariantId` against its own
`variants` array once, at mount. This only runs for the one card the
link targets; every other card's initializer sees `deepLinkVariantId ===
undefined` and returns `null`, identical to today.

A deleted/no-longer-listed product simply never appears in
`collection.products`, so no `ProductCard` gets the matching id and
nothing opens - the page renders as an ordinary collection, no crash, no
special-case code required. A collection that has since closed still
renders its products (existing behavior - closed collections stay
browsable), so a shared link into a closed collection still opens the
right detail view, just not orderable - identical to a live click on
that card today.

## Share action

Triggered from a "Share" button in the detail modal:

1. Build the deep-link URL via `buildShareUrl(collectionSlug, product.id,
   variants.length > 1 ? detail.id : null)`.
2. Build `{ title, text }` via `buildShareText(t, product.name,
   detail.label, product.price)` - `title` is the product name (+
   ` · ` + variant label, same separator convention the modal's own
   `<h3>` already uses), `text` is a full sentence built from the
   `shopShareText` translation key (bilingual, via `t()`) interpolating
   the product/variant string and `formatVnd(product.price)`.
3. If `navigator.share` exists: call
   `navigator.share({ title, text, url })`. A user-cancelled share
   rejects the returned promise - caught and ignored (not an error
   state, nothing to show).
4. Else, if `navigator.clipboard?.writeText` exists: write the URL to
   the clipboard and show a brief inline "Link copied!" confirmation
   inside the modal (`useState` + `setTimeout`, the same
   no-toast-library pattern `Collection.jsx`'s `addedMsg` already uses
   for the add-to-cart confirmation - see its own comment: "Brief inline
   confirmation, matching this codebase's no-toast-library style").
   Kept local to `ProductCard` (not bubbled up to `Collection.jsx`
   like the cart toast) since the click that triggers it already
   happens inside the modal - the confirmation reads better right next
   to the button than as a page-level toast, and it avoids adding a new
   prop just to relay a message string one level up for no other reason.
5. Neither API present (very old browser): the button silently does
   nothing beyond attempting `writeText`, which itself will reject -
   acceptable given both `navigator.share` and `navigator.clipboard`
   have near-universal support in browsers this shop otherwise targets.

## Pure helpers (`frontend/src/shop/share.js`)

Extracted so the URL/text logic is unit-testable without mounting a
component:

- `buildShareUrl(collectionSlug, productId, variantId)` - `variantId`
  `null`/`undefined` omits the `variant` query param entirely.
- `buildShareText(t, productName, variantLabel, price)` - returns
  `{ title, text }`. `variantLabel` falsy (empty string for a digital
  product's hidden variant, or simply absent) omits the ` · variant`
  suffix from `title`/from the product string interpolated into `text`.

## i18n

New keys in both `en`/`vi` blocks of `translations.js`, alongside the
existing `shopShare*`-adjacent `shopViewAll`/`shopVariantClose` keys:

- `shopShareButton` - the button label ("Share" / "Chia sẻ").
- `shopShareLinkCopied` - the copy-fallback confirmation ("Link
  copied!" / "Đã sao chép liên kết!").
- `shopShareText` - the template interpolated into `navigator.share`'s
  `text` and copied alongside the URL, e.g. "Check out {product} -
  {price} on {shop}" / "Xem {product} - {price} tại {shop}" (`{shop}`
  resolves to the existing `shopTitle` key, so the shop's own bilingual
  display name is reused rather than duplicated).

## Edge cases

- **Product deleted after the link was shared**: not present in
  `collection.products` - no card matches, page renders normally (see
  above).
- **Variant deleted, product still exists**: `deepLinkVariantId` doesn't
  match any of the product's current `variants` - falls back to the
  product's own default open behavior (single detail or full grid),
  never a broken/blank state.
- **Collection closed/ended since the link was shared**: products stay
  browsable per existing behavior; the deep-linked detail still opens,
  just not orderable (identical to clicking the same card manually).
- **Malformed `variant` query param** (non-numeric, or numeric but
  belongs to a different product): treated the same as "no match" -
  falls back per the rule above, never throws.
- **`navigator.share` rejects because the user dismissed the native
  sheet**: caught, no error UI - this is normal, expected user behavior,
  not a failure.
- **Neither Web Share nor Clipboard API available**: button is a no-op
  beyond the (silently failing) `writeText` call - not worth a third UI
  state for a combination that essentially doesn't occur among this
  shop's actual buyers.

## Testing approach

- Unit tests for `buildShareUrl`/`buildShareText` (`frontend/src/shop/share.test.js`):
  with/without variant id, price formatting, variant-label-present vs
  absent in the built title/text.
- Component tests (`ProductCard.test.jsx`, extended): Share button calls
  `navigator.share` with the expected `{ title, text, url }` when
  present (mocked); falls back to `navigator.clipboard.writeText` +
  shows "Link copied!" when `navigator.share` is `undefined` (both
  mocked).
- Component tests (`Collection.test.jsx`, extended): mounting with
  `?product=<id>` (and `&variant=<id>`) in the URL auto-opens the right
  detail view; mounting with a `?product=` that matches no product in
  the fetched collection falls back to the plain grid, no crash.
- Full existing `ProductCard.test.jsx`/`Collection.test.jsx` suites
  re-run to confirm no regression to the sold-out sorting, masonry
  gallery, closed-collection browsing, etc. these files already cover.

## Out of scope

- A dedicated per-product route/page.
- Server-rendered Open Graph/meta tags for the shared link (the shared
  URL still resolves to the SPA's client-rendered collection page - link
  unfurling on Messenger/Zalo/etc. would need SSR or a meta-tag proxy,
  a materially bigger change explicitly not pursued here).
- Sharing from the bare grid card (pre-variant-selection) or from the
  full gallery view.
- Analytics/tracking on share events.
