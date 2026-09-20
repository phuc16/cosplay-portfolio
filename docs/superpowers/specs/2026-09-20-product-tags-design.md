# Product Tags (Character/Series Filter) — Design

## Goal

Cosplay buyers browsing a drop (a `collection`) usually want to jump
straight to one character/series ("only Genshin Impact", "only Bocchi the
Rock") rather than scroll a mixed grid of 20+ products. Sellers can now
tag each `product` with free-text character/series names; buyers see those
tags as badges on the product card and can filter a collection's grid down
to one tag at a time via a chip bar.

## Scope decisions

- **Tags live on `products`, not `collections`.** In this schema, one
  `products` row is typically one character/design within a drop, so the
  tag belongs at that granularity.
- **Free-text, admin-entered, no taxonomy.** A single JSON array of
  strings, exactly mirroring the existing `products.images` column
  pattern - no separate `tags` table, no shop-wide canonical tag list, no
  autocomplete.
- **Comma-separated single text input in the admin UI.** No tag-picker
  widget. The seller types `Genshin Impact, Raiden Shogun` and it's split
  on save.
- **Trimmed, deduped (case-insensitive, first-seen casing wins), non-empty
  strings only**, scoped per-product. Two different products in the same
  collection typed as "genshin" and "Genshin" are *not* reconciled to one
  canonical value - that cross-product inconsistency is accepted (YAGNI;
  matches how a seller would expect their own per-row typing to behave,
  without this feature policing spelling shop-wide).
- **Single-select client-side filter, toggle-off.** Clicking a tag chip
  narrows the grid to products containing that tag; clicking the same
  chip again (or an "All" chip) clears the filter. No multi-select
  AND/OR combination logic.
- **No new fetch, no new endpoint.** Tags ride along on the existing
  product create/update endpoints and the existing collection-detail
  response that already powers `Collection.jsx` - the same pattern the
  prior Digital/Physical collection-list filter used (fetch once, derive
  filter groups client-side).
- **Chip bar only renders when at least one product in the collection has
  at least one tag.** A collection with no tagged products shows no chip
  bar at all - same "don't show controls for zero data" instinct already
  used for search/sort controls (`collection.products.length > 1`) and
  the Digital/Physical collection-list grouping.
- **Tag text itself is not translated.** It's admin-entered free text
  (a character/series name), exactly like the free gift's `name` field
  per that spec's own note - only new *UI chrome* labels (e.g. an "All"
  reset chip) go through the `{vi, en}` i18n mechanism.

## Data model

### `products` gets one new column

| Column | Type | Notes |
|---|---|---|
| `tags` | JSON, nullable | Array of strings, e.g. `["Genshin Impact", "Raiden Shogun"]`. Same column shape/nullability as the existing `products.images` JSON column. |

Migration: `040_add_product_tags.js`.

`mysql2` can hand a JSON column back as either a string or an already-
parsed array depending on driver/column state (the same quirk
`catalogRepo.js`'s `parseImages` helper works around for `images`) - a
new `parseTags(value)` helper replicates that same string-or-array
handling. It is *not* a reuse of `parseImages` as-is: `parseImages` only
parses/normalizes shape, while `parseTags` also owns the
trim/dedupe/case-fold normalization rule above, which `images` has no
equivalent of. Both helpers stay separate, small functions.

## Backend

`backend/shop/catalogRepo.js`:

- `normalizeTags(rawTags)` — pure function: takes whatever array-ish
  value the caller passed (frontend already sends an array, split from
  the comma-separated input), trims each entry, drops empty strings,
  dedupes case-insensitively keeping the first-seen original casing.
  Used by both `createProduct` and `updateProduct` before the `INSERT`/
  `UPDATE`, and reused as `parseTags`'s fallback shape-normalizer for
  values already read back from MySQL (a value already in the DB was
  already normalized at write time, so re-running the same rule on read
  is a no-op in practice, but keeps read/write on one code path instead
  of two slightly different ones).
- `createProduct`/`updateProduct` persist `tags` (defaulting to `[]`,
  same convention as `images`).
- `nestCollectionDetail`'s per-product mapping (both the physical branch
  and the digital-product flattened branch) attaches `tags:
  parseTags(p.tags)` — this is the one function every product read path
  (`getPublicCollectionBySlug`, `getCollectionDetailById`) already funnels
  through, so both the admin and public paths get `tags` for free without
  duplicating the mapping.
- `copyCollection` carries `tags` through when duplicating a product,
  same as every other product field it already copies.
- Tags are **not** stripped from the public path — unlike `delivery_link`,
  a tag has no trust/business reason to be hidden pre-order; it's exactly
  the kind of buyer-facing catalog metadata `images`/`name`/`price`
  already are.

No new endpoints. Tags ride along on:
- `POST /api/admin/collections/:id/products` (create)
- `PUT /api/admin/products/:id` (update)
- `GET /api/shop/collections/:slug` (public detail, powers `Collection.jsx`)
- `GET /api/admin/collections/:id` (admin detail, powers `AdminProducts.jsx`)

## Admin UI (`frontend/src/components/AdminProducts.jsx`)

One new field in the existing product add/edit form: a plain text input,
Vietnamese-labeled ("Tags (cách nhau bởi dấu phẩy)" placeholder-style,
matching the form's existing plain-Vietnamese-label convention - no
bilingual treatment, since this is an admin-only control, same as every
other field already in this form).

- On edit, pre-filled with `product.tags.join(", ")`.
- On save, split on `,`, trim each piece, drop empties, dedupe
  case-insensitively (first-seen casing wins) — the exact same
  `normalizeTags` rule the backend applies, mirrored client-side so what
  the admin sees pre-filled after a save round-trip already matches what
  got stored (the backend remains authoritative; this is a UX nicety, not
  a trust boundary, same relationship every other client-side validation
  in this codebase has to its server-side counterpart).
- A tag containing a comma typed by mistake is impossible to represent in
  this simple format - splitting on `,` is exactly what turns "Genshin,
  Impact" into two tags `["Genshin", "Impact"]` rather than one. This is
  an accepted limitation of the comma-separated-input format (same
  tradeoff any comma-separated tag input makes), not a bug: a seller who
  wants a comma inside one tag has no such value in this data model.

## Public UI

### `frontend/src/pages/Collection.jsx`

- `collectionTags(products)` — pure helper, derives the distinct set of
  tags across a collection's products (`Array.from(new Set(products.flatMap(p
  => p.tags || [])))`), preserving first-seen order across the product
  list (same "no canonical sort imposed" approach the rest of this
  feature already takes towards tag casing/ordering).
- Rendered as a chip row above the product grid, directly below the
  existing search/stock-filter/sort control row, only when
  `collectionTags(...).length > 0`.
- An "All" chip (`t("shopFilterAllTags")`) always sits first when the bar
  renders, active whenever no tag is selected.
- Clicking a tag chip sets `tagFilter` to that tag; clicking the already-
  active chip (or the "All" chip) clears it back to `""`. Selected chip
  gets the same active-brand-fill treatment already used for primary
  actions (`bg-[var(--brand)] text-white`); other chips use the existing
  outlined-pill convention (`border border-[var(--border-brand)]`) also
  seen on the collection's ship/pickup badges.
- `tagFilter` folds into the existing `visibleProducts` filter chain
  alongside `search`/`stockFilter`: `if (tagFilter &&
  !(p.tags || []).includes(tagFilter)) return false`.
- Switching collections (slug change) resets `tagFilter` back to `""` via
  the same effect that already resets fetch state on `slug` change - a
  filter selected on one collection must not silently carry into another.

### `frontend/src/components/shop/ProductCard.jsx`

Each product's own tags render as small badges next to its name, using
the same badge convention the existing Digital badge on this same card
already established (`px-1.5 py-0.5 rounded text-[10px] font-semibold`),
distinguished from the Digital badge only by using the outlined-pill
style (`border border-[var(--border-brand)]`) instead of the filled
`bg-[var(--brand-soft)]` treatment, so a tag badge doesn't visually read
as "this is a digital item." Renders nothing when `product.tags` is empty
or absent.

## Edge cases

- **A product with no tags.** `tags` defaults to `[]` at every read path
  (never `null`/`undefined`) so every consumer can safely `.map`/`.includes`
  without a null check. No badges render on its card; it's simply excluded
  from any active tag filter (never shown when a tag chip is selected,
  same as any other non-matching product).
- **A collection where zero products have any tag.** `collectionTags()`
  returns `[]`; the chip bar does not render at all — no "All" chip
  either, since there is nothing to filter.
- **A tag containing a comma, typed by mistake in the admin form.** Splits
  into two separate tags on save (see Admin UI above) — accepted
  limitation of the comma-separated format, not a bug to guard against.
- **Casing collisions within one product's own tag list** (`"Genshin
  Impact, genshin impact"`) — deduped to one entry, first-seen casing
  kept (`"Genshin Impact"`).
- **Casing/spelling collisions across different products** (`"Genshin"`
  on product A, `"genshin impact"` on product B) — *not* reconciled;
  both survive as distinct chips in the collection's tag bar. Explicitly
  accepted per the scope decisions above.
- **A very long tag list on one product** — badges wrap (`flex-wrap`),
  same as the existing Digital badge/name row already does.
- **Switching the selected tag filter to one that yields zero matching
  products** — falls through to the collection's existing
  `shopNoProductsMatch` empty state, the same one search/stock filtering
  already produces; no new empty-state copy needed.
- **`copyCollection`** carries a product's `tags` into the duplicate,
  same as `images`/`description`/every other product field it copies.
- **Legacy rows created before this migration** — `tags` is `NULL` in the
  DB; `parseTags(null)` returns `[]`, identical in shape to a product that
  was tagged with an empty list on purpose. No backfill needed.

## Testing approach

Backend (`backend/tests/catalogRepo.test.js`):
- `createProduct`/`updateProduct` persist `tags`, read back correctly via
  `getCollectionDetailById`.
- Trim/dedupe/case-fold rules verified directly (mixed-case duplicates
  collapse to the first-seen casing; blank/whitespace-only entries
  dropped).
- Defaults to `[]` when omitted at creation, preserved (not clobbered)
  when omitted on `updateProduct` — matching the existing
  omitted-field-preserves-current-value convention `stock_qty`/
  `delivery_link` already follow... **except** `tags`, like `images`,
  follows the *replace-on-any-update* convention instead (both are plain
  arrays the frontend always resends in full, unlike the digital hidden-
  variant fields that get patched piecemeal) - verified explicitly so the
  two different conventions in the same file aren't conflated.
- `tags` is present (not stripped) on `getPublicCollectionBySlug`, unlike
  `delivery_link`.
- `copyCollection` carries `tags` through.

Frontend:
- `AdminProducts.jsx`: tag input renders, splits/trims/dedupes on save,
  pre-fills as `tags.join(", ")` when editing an existing product.
- `Collection.jsx`: chip bar renders only when at least one product has a
  tag; clicking a chip filters the grid; clicking again toggles back to
  showing everything; an "All" chip resets the filter.
- `ProductCard.jsx`: tag badges render for a tagged product, render
  nothing for an untagged one.

## Out of scope (explicitly deferred)

- Cross-collection / shop-wide tag browsing or search.
- A shop-wide tag taxonomy or autocomplete against existing tags.
- Multi-tag AND/OR filter combinations (multi-select).
- Tag-based SEO/URL routing (e.g. `/tag/genshin`).
- Tag management as a separate admin screen/CRUD API.
- Reconciling casing/spelling differences for "the same" tag across
  different products.
