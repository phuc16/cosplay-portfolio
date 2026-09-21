# Product Character/Series Tag + Filter — Design

## Trend angle

**Cosplay-community trend: character/series tagging & filtering.** Cosplay
fans browsing a photocard/poster shop think in terms of "which character or
series is this," not just product name - the same way merch storefronts for
fandoms (K-pop, anime, games) let buyers filter by group/character/series.
This shop sells drop-style photocard/poster collections where a single drop
routinely mixes several different characters or series (confirmed by the
existing photocard/poster patterns already documented in `CLAUDE.md`
/`docs/DECISIONS.md` - batch variant upload, natural-sort by code, etc.) with
no way today to narrow a large drop down to just one.

## Goal

Let the admin tag a product with a free-text character/series name, and let
a buyer filter a collection's product grid by that tag - small, additive,
using the exact same patterns already shipped for other product-level
filters (stock filter, sort) and badges (the digital-product badge).

## Scope decisions

- **One plain free-text field per product**, not a controlled taxonomy/
  multi-select. Mirrors the precedent set by `collections.pickup_note` and
  `gift_settings.name` (see `docs/DECISIONS.md`): admin-authored plain text,
  not a bilingual `{vi, en}` object, since a character/series name is a
  proper noun that isn't translated (same non-translation precedent as
  "Merch"/"Merchandise" before it was localized, and unlike that case, a
  character name has no Vietnamese equivalent to translate to at all).
- **Optional.** A product with no tag behaves exactly as it does today - no
  badge, doesn't participate in the filter's option list.
- **Per-product, not per-variant.** A product's individual variants
  (photocard codes A1, A2, B1...) are different physical pieces of the same
  character/series artwork, not different characters - tagging at the
  variant level would be finer-grained than the actual use case and would
  require re-tagging potentially dozens of rows per product for no benefit.
- **Filter is scoped to one collection's product grid** (`Collection.jsx`),
  not a shop-wide cross-collection filter - matches how the existing stock
  filter/sort are already scoped, and a buyer browsing a specific drop is
  the primary use case (find "which of these photocards in this exact drop
  are the character I want").

## Data model

`products` gets one new nullable column:

| Column | Type | Notes |
|---|---|---|
| `character_tag` | string(191), nullable | Free text, e.g. "Genshin Impact - Raiden Shogun". `NULL`/unset means untagged. |

New migration `040_add_product_character_tag.js` - additive only, no
backfill needed (`NULL` for every existing row is the correct "untagged"
state).

## Backend

`backend/shop/catalogRepo.js`:
- `createProduct(data)`: INSERT gains `character_tag` (from
  `data.character_tag || null`).
- `updateProduct(id, data)`: UPDATE gains `character_tag = ?` (from
  `data.character_tag || null`).

No other backend change needed - `nestCollectionDetail` already spreads
`...p` (every raw product column) into both the admin and public collection
responses, and `getPublicCollectionBySlug`'s existing field-stripping
(`delivery_link` only) doesn't touch this column, so `character_tag`
reaches the buyer's collection API automatically, same as `name`/`price`/
`description` already do.

## Admin UI

`frontend/src/components/AdminProducts.jsx`'s product form gains one text
input ("Nhân vật / Series (tùy chọn)") between the name and price fields -
plain Vietnamese label, no bilingual object, matching every other
admin-only form field in this codebase. Wired through the same
`draft`/`edit`/`save` flow every other field already uses - no special
validation (empty string coerces to `null`, matching the `||null` pattern
`giftSettings.js`'s `updateSettings` already established for optional text
fields).

## Buyer-facing display + filter

**`ProductCard.jsx`**: a small badge next to the existing digital-product
badge, shown only when `product.character_tag` is set - reuses the exact
badge styling already in place for `shopDigitalBadge`
(`bg-[var(--brand-soft)]` pill), just a second conditional span, not a new
component.

**`Collection.jsx`**: the existing product-filter row (search input +
stock-filter `SearchableSelect` + sort `SearchableSelect`) gains a third
`SearchableSelect`, populated from the distinct `character_tag` values
present among the collection's *own* products (`[...new Set(products.map(p
=> p.character_tag).filter(Boolean))].sort()`), with an "All" option. Shown
only when the collection has **2 or more** distinct tags - a collection
with 0 or 1 distinct tags gets no useful narrowing from a filter with at
most one real choice, so (matching the "hide a filter that isn't useful
yet" precedent the existing `products.length > 1` gate on the whole filter
row already sets) it's omitted rather than shown disabled or with a single
option.

## Testing approach

- Backend (`backend/tests/catalogRepo.test.js`): `createProduct` persists
  and returns `character_tag`; defaults to `null` when omitted;
  `updateProduct` can set and clear it (empty string -> `null`).
- Frontend admin (`frontend/src/components/AdminProducts.test.jsx`): the
  form field renders, is included in the `adminCreateProduct`/
  `adminUpdateProduct` payload, and round-trips through `edit()`.
- Frontend buyer (`frontend/src/pages/Collection.test.jsx`): the tag filter
  renders only with 2+ distinct tags among the collection's products;
  narrows `visibleProducts` correctly; does not appear with 0 or 1 distinct
  tags. `ProductCard.test.jsx`: the tag badge renders when set, is absent
  when not.

## Out of scope

- No controlled vocabulary/autocomplete of existing tags across
  collections - free text only, exactly as typed by the admin (a future
  request for "suggest existing tags while typing" is a natural follow-up
  but adds real scope: querying distinct tags shop-wide, deduping near-
  identical spellings, etc. - deferred).
- No shop-wide (`Shop.jsx`) cross-collection tag filter - scoped to one
  collection's own product grid only (see Scope decisions above).
- No bilingual `{vi, en}` tag object - see Scope decisions above.
