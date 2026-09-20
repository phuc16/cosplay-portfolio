# Shop SEO Metadata — Implementation Plan

**Goal:** Per-page `<title>`/meta description/Open Graph/Twitter Card/
JSON-LD structured data for `Shop.jsx` and `Collection.jsx`, frontend-only,
zero visible UI change. See
`docs/superpowers/specs/2026-09-20-shop-seo-metadata-design.md` for the
full design/scope reasoning.

## Task 1: `useSeoMeta` hook

**Files:** `frontend/src/hooks/useSeoMeta.js`,
`frontend/src/hooks/useSeoMeta.test.jsx`

- [x] Write a hand-rolled hook that sets `document.title`, upserts `<meta>`
      tags (skipping empty-content entries), and an optional
      `<script type="application/ld+json">`, cleaning all of it up on
      unmount/deps-change (restores the previous title, removes created
      tags) — explicit `deps` array param, same convention as
      `frontend/src/hooks/useBlobUrl.js`.
- [x] Unit tests: sets title+description, skips a null-content entry,
      emits/parses JSON-LD, re-applies without duplicating on a deps change,
      restores title and removes tags on unmount, leaves title alone when
      none given.
- [x] `cd frontend && npx vitest run src/hooks/useSeoMeta.test.jsx` — green.

## Task 2: `seoContent` helpers

**Files:** `frontend/src/utils/seoContent.js`,
`frontend/src/utils/seoContent.test.js`

- [x] `stripMarkdownToText(markdown)` — markdown → plain text via the
      existing `renderMarkdown` + a detached element's `textContent`.
- [x] `truncateText(text, maxLen = 160)` — word-boundary truncation with an
      ellipsis, only when actually cut.
- [x] `toAbsoluteUrl(path)` — prefixes a relative `/api/storage/...` path
      with `window.location.origin`; passes through an already-absolute URL.
- [x] `productSeoImage(product)` — same cover-image precedence
      `ProductCard.jsx` uses (`thumbnail_image` → `images[0]` → first
      variant with an image), duplicated narrowly since `ProductCard`'s own
      version is entangled with its local view-state.
- [x] Unit tests for all four.
- [x] `cd frontend && npx vitest run src/utils/seoContent.test.js` — green.

## Task 3: Wire into `Shop.jsx`

**Files:** `frontend/src/pages/Shop.jsx`, `frontend/src/pages/Shop.test.jsx`

- [x] Fetch `artistName` from `GET /api/settings` (same pattern as
      `ShopFooter.jsx`), localized via `getLocalized`.
- [x] `useSeoMeta({ title: "<shopTitle> - <brand>" (or just <shopTitle> if
      brand hasn't loaded yet), meta: [{ name: "description", content:
      t("shopDesc") }] })`.
- [x] Tests: title includes the fetched brand name and description content;
      falls back to the section title alone while the brand name hasn't
      resolved.
- [x] `cd frontend && npx vitest run src/pages/Shop.test.jsx` — green, no
      regressions in the existing suite.

## Task 4: Wire into `Collection.jsx`

**Files:** `frontend/src/pages/Collection.jsx`,
`frontend/src/pages/Collection.test.jsx`

- [x] Fetch `artistName` the same way.
- [x] Compute `seoOrderable` (collection open + already started),
      `seoDescription` (stripped/truncated collection description, or the
      generic fallback), `seoTitle`, `seoImage` (absolute cover or first
      product image), `seoUrl` (`window.location.href`), and build the
      `ItemList`/`Product` JSON-LD from `collection.products` — all gated on
      `collection` being a loaded object (never during loading/not-found).
- [x] `useSeoMeta` call with title, description, full OG/Twitter meta set,
      and the JSON-LD.
- [x] Tests: full happy path (title/description/OG/Twitter/JSON-LD content
      and per-product availability), generic-description + no-image
      fallback (og:image omitted, twitter:card degrades to `summary`),
      not-started and closed collections force every product `OutOfStock`
      in JSON-LD even when individually in stock, zero products emits no
      JSON-LD, loading/not-found emits nothing.
- [x] Added a `beforeEach` `document.head` sweep (this test file never
      unmounts prior component instances between tests) so head-tag
      assertions aren't contaminated by an earlier test's leftover tags.
- [x] `cd frontend && npx vitest run src/pages/Collection.test.jsx` — green,
      no regressions.

## Task 5: Full verification

- [x] `cd frontend && npm test` — full suite green, no regressions.
- [x] `cd frontend && npm run lint` — no new warnings/errors introduced by
      this change (pre-existing unrelated warnings in other files left
      untouched).
- [x] Commit, push, open PR.
