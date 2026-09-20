# Shop SEO Metadata — Design

## Goal

The shop (`/merchandise` and `/merchandise/:slug`) has no SEO/social-sharing
metadata at all today: no per-page `<title>`/meta description, no Open
Graph/Twitter Card tags (so a link pasted into Facebook/Zalo/Discord — this
seller's actual discovery channel, per a small Vietnamese cosplay shop's
buyer base — renders as a bare unstyled link), and no JSON-LD structured
data. This adds all three, frontend-only, with zero visible UI change.

## Scope decisions

- **Only `Shop.jsx` (collection list) and `Collection.jsx` (single drop)
  get metadata.** Cart, Checkout, and the buyer's `Order.jsx` page are
  explicitly excluded: they're private/transactional, not something a buyer
  or seller would ever want indexed or unfurled, and `Order.jsx` in
  particular must never leak a title/og:image derived from one buyer's
  private order data to a public crawler/link-unfurler. Admin pages are
  excluded for the obvious reason. This mirrors `ShopHeader`/`ShopFooter`'s
  own page list *minus* the three private ones.
- **Shop.jsx gets only `<title>` + a meta description** — no Open
  Graph/Twitter/JSON-LD. A collection-list page has no single representative
  image (no cover, just N collection thumbnails) and no natural JSON-LD
  entity to describe (an `ItemList` of collections would just restate what
  `Collection.jsx`'s own JSON-LD already tells a crawler, once it follows the
  link) — adding OG here would mean either fabricating an image/description
  or leaving og:image out entirely, and the marginal value is low next to
  Collection.jsx's page (which is what buyers actually share). Kept minimal
  per instructions, not because a richer version would be wrong.
- **Collection.jsx gets the full set**: title, meta description, OG
  (`og:title`, `og:description`, `og:image`, `og:type`, `og:url`,
  `og:site_name`), Twitter Card (mirroring OG), and JSON-LD.
- **Hand-rolled `useSeoMeta` hook, not `react-helmet-async`.** This is a
  pure client-rendered Vite SPA with no SSR/prerendering — helmet-async's
  main value (coordinating head tags across a streaming/hydrating server
  render, and deduping across multiple simultaneously-mounted components
  during that hydration) doesn't apply here; there is exactly one mounted
  page at a time; `document.title`/`document.head.appendChild` is all
  there is to it. `frontend/package.json`'s dependency list is already
  lean (axios, dompurify, jsqr, marked, react-router-dom — nothing head/meta
  related), and a ~50-line hook covers everything this feature needs. Adding
  a dependency for this would be the wrong tradeoff for this codebase.
- **JSON-LD shape: `ItemList` of `Product` items, not `CollectionPage`.**
  Both are valid per the brief; `ItemList` is simpler, is what Google's own
  docs point to for a list-of-products page, and doesn't require inventing
  page-level properties (`CollectionPage.url`/`isPartOf`/etc.) beyond what
  `ItemList.name`/`numberOfItems` already say. Each `Product` gets only
  `name`, `image` (when one exists), and `offers` (`priceCurrency: "VND"`,
  `price`, `availability`) — deliberately not `description` or
  `aggregateRating` (this shop has no review data at all; fabricating either
  would violate structured-data guidelines and this task's own instruction
  not to invent unbacked fields).
- **JSON-LD is built from `collection.products` (the full catalog on this
  URL), not the search/sort/stock-filtered `visibleProducts` the page
  actually renders into the grid.** A crawler never types into the search
  box; structured data should describe the page's real, stable content, not
  one buyer's transient UI state that isn't even reflected in the URL (there
  is no `?q=`/`?sort=` query param — search/sort are local `useState` only).
- **Availability derivation**: `InStock` only when both (a) the collection
  itself is currently orderable (`status !== "closed"` and already started)
  and (b) the specific product isn't sold out (`isProductSoldOut`, the same
  helper `ProductCard.jsx` already uses for its own sold-out overlay).
  Otherwise `OutOfStock` — this covers a closed collection, a not-yet-started
  preview, and a plain sold-out variant/digital item with one rule, matching
  the explicit instruction not to claim `InStock` for any of those. There is
  no `PreOrder` concept in this app (no preorder mechanism exists), so an
  unstarted collection is `OutOfStock`, not `PreOrder` — accurate, not
  aspirational.
- **`og:type: "website"`, not `"product"`.** `"product"` commits to the
  Open Graph product namespace's own properties (`product:price:amount`
  etc.), which this page doesn't populate on the `<meta>` tags themselves
  (that data already lives correctly in the JSON-LD `Offer`s) — `"website"`
  is valid everywhere and doesn't imply an incomplete product-namespace
  declaration for what is, after all, a multi-product listing page.
- **Brand name**: fetched the same way `ShopFooter.jsx` already fetches its
  own copy of `artistName` from `GET /api/settings` (`getLocalized`,
  reactive to the current language) — no shared context exists for this, and
  every shop page already independently fetches what it needs (see
  `ShopFooter.jsx`'s own comment on this). `Shop.jsx`/`Collection.jsx` each
  add their own small fetch, matching that established pattern rather than
  inventing a shared settings context for one field.
- **Collection title/description are plain strings, not `{vi, en}`
  objects** (confirmed against `backend/migrations/008_create_products.js`
  /`collections` migrations and `Collection.jsx`'s existing
  `renderMarkdown(collection.description)` call, which never localizes it) —
  no bilingual infrastructure to reuse for those two fields. The meta
  *description* still respects the current language for its generic
  fallback text (`t("shopDesc")`, used when a collection has no
  description of its own) and for `Shop.jsx`'s description entirely, via
  the existing `useLanguage()`/`t()` mechanism — exactly like every other
  page.
- **Meta description = collection's markdown description, stripped to
  plain text and truncated to ~160 chars on a word boundary**, falling back
  to the generic `t("shopDesc")` copy when the collection has none. Markdown
  → text reuses the existing sanitized `renderMarkdown` (no second parser),
  reading `textContent` off a detached (never-attached) element rather than
  regex-stripping tags.
- **Image URLs need to become absolute.** Every image URL in this app is a
  relative `/api/storage/...` path (`backend/storage.js`'s `proxyUrl`) —
  fine for an in-page `<img>`, meaningless to an external link-unfurler.
  `toAbsoluteUrl()` prefixes with `window.location.origin` when needed.

## Edge cases

- **Collection has no `cover_image`**: falls back to the first product (in
  listing order) that has *any* resolvable image (`productSeoImage`, same
  cover-resolution precedence `ProductCard.jsx` uses: `thumbnail_image` →
  `images[0]` → first variant with an image). If nothing resolves, `og:image`
  /`twitter:image` are omitted entirely (never emit a broken/empty tag), and
  `twitter:card` degrades to `summary` instead of `summary_large_image`.
- **Zero products in the collection**: no JSON-LD is emitted at all (an
  `ItemList` with zero items isn't meaningful structured data); title/meta
  description/OG still render normally.
- **Loading state / not-found slug**: no title/meta/JSON-LD is ever emitted
  — nothing truthful to describe yet, and a not-found page has no reason to
  be indexable or shareable. The hook is simply never given data until
  `collection` is a real object.
- **Sold-out product inside an otherwise-open collection**: that product's
  own JSON-LD `Offer.availability` is `OutOfStock` even though the
  collection itself is fully orderable — per-product, not just
  per-collection.
- **Not-started-yet / closed collection**: every product's availability is
  forced `OutOfStock` in JSON-LD regardless of its own stock count, since
  nothing in the collection can actually be bought right now.
- **Digital products**: use the already-flattened `product.stock_qty`
  (`catalogRepo.getPublicCollectionBySlug` flattens the hidden variant's
  stock onto the product itself for digital items) via the same
  `isProductSoldOut` helper — no special-casing needed in the SEO code.

## Testing approach

- New `frontend/src/hooks/useSeoMeta.test.jsx`: unit tests for the hook
  itself (sets title/meta/JSON-LD, skips empty-content meta entries,
  re-applies on deps change without duplicating tags, restores the previous
  title and removes tags on unmount).
- New `frontend/src/utils/seoContent.test.js`: unit tests for the small pure
  helpers (`stripMarkdownToText`, `truncateText`, `toAbsoluteUrl`,
  `productSeoImage`).
- Extended `Shop.test.jsx`/`Collection.test.jsx` (same `createRoot`/`act`
  pattern already used throughout this codebase — no `@testing-library/react`
  dependency here): assert `document.title`, the description/OG/Twitter meta
  tags, and the parsed JSON-LD `<script>` content for representative
  fixtures — including the not-started/closed/sold-out availability cases
  and the no-description/no-image fallback case. Because these tests mount
  multiple component instances into the same shared `document` without
  unmounting between tests (the file's existing pattern), a `beforeEach` now
  clears any stray SEO `<meta>`/`<script>` tags a previous test's
  still-mounted instance left in `document.head`, so `document.head` queries
  are never contaminated by an earlier test's tags — `document.title` itself
  needed no such guard, since it's a single value always reflecting the most
  recently completed test's own render.

## Out of scope

- No `sitemap.xml`/`robots.txt` changes.
- No server-side rendering or prerendering. This is a known, accepted
  limitation of a client-rendered SPA: a crawler that doesn't execute
  JavaScript (most link-unfurlers for Facebook/Zalo/Discord *do* execute a
  bounded amount of JS or at least parse the initial document, but a purely
  static crawler would not see these tags) still won't see this metadata.
  Fixing that would mean SSR/prerendering/static-generation, a much larger
  architectural change this PR does not attempt.
- No canonical `<link rel="canonical">` tag — not requested, and this app
  has no query-string-driven duplicate-content URLs to disambiguate (search/
  sort filters are local state, never reflected in the URL).
- No SEO metadata for Shop.jsx beyond title + description (see scope
  decisions above).
- No admin UI to customize per-collection SEO copy — everything is derived
  from data that already exists (title, description, cover/product images,
  stock).
