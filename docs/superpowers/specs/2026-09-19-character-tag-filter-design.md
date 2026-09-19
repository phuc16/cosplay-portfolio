# Character/Series Tagging + Filter — Design

**Trend angle:** Cosplay-community trend — character/series tagging and
filtering is a current, community-specific expectation, not a generic
e-commerce feature: cosplay photocard/poster sellers on Twitter/X, Shopee,
and dedicated cosplay marketplaces routinely tag merch by the character and
series/game it depicts, because buyers browse by "who" before "what" (a fan
of one specific character wants to find every item for them across a large
drop, not scroll the whole grid). This shop's own drops are exactly this
shape - `docs/DECISIONS.md` describes 40+ code photocard sheets - so a large
collection with no way to narrow by character is a real, not hypothetical,
browsing problem for this seller's actual catalog.

## Scope decisions

- **One free-text tag per product, not a many-to-many tag system.** A
  product in this shop is already a single character/pose/print (the
  *variant* level is the individual photocard code within that, per the
  existing `product_variants.label` model) - a product needing multiple
  independent character tags is not a pattern this catalog has, and a
  full tag table (join table, admin tag management UI, tag merge/rename)
  is disproportionate infrastructure for what "which character is this"
  needs here. If a product legitimately spans multiple characters (a group
  print), the admin can write that directly into the one field (e.g.
  "Raiden Shogun & Yae Miko") - filtering degrades gracefully to an exact
  match on the full field for that item, same tradeoff free-text fields
  make elsewhere in this codebase (`collections.pickup_note`, `gift_settings.name`).
  Revisit if the seller's catalog grows into needing real multi-tag/faceted
  browsing.
- **New column on `products`, not a separate table.** Mirrors the
  free-text-field precedent already used for `collections.pickup_note`/
  `gift_settings.name` - a value the admin types once, not (per CLAUDE.md's
  bilingual-copy convention) buyer-facing UI chrome needing `{vi, en}`
  translation. A character/series name (e.g. "Raiden Shogun (Genshin
  Impact)") is a proper noun - translating it makes no sense the way
  translating "Add to cart" does.
- **Filtering is entirely client-side**, reusing the exact pattern
  `Collection.jsx` already has for its `search`/`stockFilter`/`sortBy`
  controls: the full collection (with every product) is already fetched in
  one request, so a new server round-trip for "narrow to one tag" would be
  pure overhead. No new API endpoint at all - the existing `SELECT *` in
  `nestCollectionDetail` (`catalogRepo.js`) already returns every product
  column, so the new field reaches the frontend automatically once it
  exists in the schema.
- **The filter only renders when there are 2+ distinct tags** among a
  collection's products - mirrors the existing "only show the whole filter
  bar when `collection.products.length > 1`" gate. A collection where every
  product shares one tag (or none has one) has nothing meaningful to filter
  by.
- **Untagged products always remain visible** under every tag filter
  selection except a specific chosen tag - selecting a tag narrows to
  *that* tag only (exact match), "All" (the default) shows everything
  including untagged products. There is no separate "untagged" filter
  option - a small enough set in practice that a dedicated bucket isn't
  worth the extra UI.
- **No admin tag-management screen.** The field is a plain text input in
  the existing product form (`AdminProducts.jsx`), no autocomplete/
  suggestion list from previously-used tags for v1 - the admin types
  whatever they type, same free-text discipline as every other admin text
  field in this app. A follow-up (typeahead of previously-used tags to
  avoid typos causing near-duplicate tags like "Raiden Shogun" vs "Raiden
  shogun") is easy to add later once real usage shows it's needed - not
  built speculatively now.
- **Displayed to buyers, not just used for filtering.** A tag also renders
  as a small badge on `ProductCard`'s grid card and detail modal (mirrors
  the existing digital-product badge pattern) - the community value here is
  partly *seeing* which character something is at a glance (a buyer
  scanning thumbnails wants the label, not just the ability to filter).

## Data model

### `products` gets one new column

| Column | Type | Notes |
|---|---|---|
| `character_tag` | string(191), nullable | Free text - a character and/or series name. `NULL`/omitted means untagged. |

No index needed - filtering happens client-side against an already-fetched
collection, and no query filters by this column server-side in this design.

## API

No new endpoints and no route changes. `character_tag` flows through
existing paths automatically:
- `catalogRepo.createProduct(data)` / `updateProduct(id, data)`: pass
  `data.character_tag || null` through to the `INSERT`/`UPDATE`, same
  pattern as `description`.
- `nestCollectionDetail` (used by both the public
  `getPublicCollectionBySlug` and the admin `getCollectionDetailById`)
  already does `SELECT * FROM products`, so the new column reaches both
  the public storefront and the admin catalog view with no code change
  there.

## Frontend

### Admin (`AdminProducts.jsx`)

- New text input "Nhân vật / Series (tùy chọn)" in the product form,
  alongside the existing name/price/description fields. Included in
  `draft`/`blank`/`edit()`'s field list the same way every other plain
  text field already is.
- The existing free-text `search` filter (already matches `p.name`) is
  extended to also match `p.character_tag`, so an admin managing a large
  drop can find "everything with Raiden Shogun in it" the same way they
  already search by product name - a one-line addition to an existing
  `.filter()` predicate, not new UI.

### Storefront (`Collection.jsx`)

- Compute the distinct, non-empty `character_tag` values present in
  `collection.products` (trimmed, case-sensitive exact grouping - matches
  how the admin actually types them, no fuzzy normalization for v1).
- When there are 2+ distinct tags, render one more `SearchableSelect`
  alongside the existing stock/sort controls: `{ code: "", name:
  "All characters" }` plus one option per distinct tag. Selecting narrows
  `visibleProducts` to `p.character_tag === selectedTag` (in addition to
  the existing search/stock filters, all AND-combined, matching how
  `stockFilter`/`search` already compose).
- `ProductCard.jsx`: renders `product.character_tag` as a small badge
  (reusing the same badge style already used for `shopDigitalBadge`) next
  to the product name on both the grid card and the detail modal, only
  when present.

## Testing approach

Backend (`backend/tests/catalogRepo.test.js`, extended):
- `createProduct` persists `character_tag` when given, `null` when
  omitted.
- `updateProduct` updates `character_tag` when given, and (matching the
  existing `delivery_link`/`stock_qty` omitted-field precedent already
  tested in this file) preserves the existing value when the field is
  omitted from the update payload - never silently clears it.
- `updateProduct` clears `character_tag` back to `null` when explicitly
  sent as an empty string (an admin removing a tag).
- The public path (`getPublicCollectionBySlug`) and the admin path
  (`getCollectionDetailById`) both expose `character_tag` on each nested
  product (no stripping - unlike `delivery_link`, there is no trust
  boundary reason to hide it from buyers, since it's shown to them by
  design).

Frontend:
- `Collection.test.jsx`: the tag filter does not render when 0 or 1
  distinct tags exist among the collection's products; renders with the
  correct option list when 2+ exist; selecting a tag narrows the grid to
  matching products (composes correctly with an already-set stock/search
  filter).
- `ProductCard.test.jsx`: the character-tag badge renders on the grid card
  and detail modal when `product.character_tag` is set; renders nothing
  extra when it's absent.
- `AdminProducts.test.jsx` (if the existing file's structure supports it
  cheaply): the new field round-trips through `edit()`/`save()` the same
  way `description` already does.

## Edge cases

- **A tag containing only whitespace** (`"   "`): treated as absent -
  trimmed to empty and stored as `null`, same discipline as `pickup_note`/
  `payment_note` elsewhere, so it can never render as a visible-but-blank
  filter chip.
- **Every product in a collection shares the same tag**: the filter still
  renders (2+ distinct tags is about the collection's *products*, not a
  single-tag collection - a single shared tag among many products means
  exactly one non-empty distinct value plus untagged, so unless everything
  has that one tag with zero untagged items, this can still be exactly 1
  distinct tag, which correctly hides the filter as "nothing to narrow").
- **Switching collections** (`slug` param changes): the tag filter
  selection resets, same as `search`/`stockFilter`/`sortBy` already do
  today - no explicit new reset code needed since these are plain
  component state, not persisted across navigations.
- **A tag with characters that need HTML-escaping** (e.g. `<3`): rendered
  via React's normal JSX text interpolation, never `dangerouslySetInnerHTML`
  (that's reserved for markdown fields like `description`) - safe by
  default, no explicit escaping needed.
