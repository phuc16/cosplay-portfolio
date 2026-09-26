# Character/Series Tag + Collection Filter - Design Spec

**Trend angle: Cosplay-community.** Cosplay merch (photocards, posters, acrylic
stands) sold by small sellers is near-universally organized by character/
series/fandom - every cosplay-seller storefront on Twitter/Carrd/Shopee
already lets buyers filter informally via hashtags or manual sorting. A
drop in this shop can run to dozens of products across several characters
or series in one collection, and buyers currently have zero way to narrow
that down to "just the Raiden Shogun cards" - they scroll and squint at
thumbnails. This is the smallest change that gives buyers that filter.

## Problem

`products` has no notion of which character/series it depicts. On a large
drop, a buyer who only cares about one character has to visually scan
every product card in the collection. Sellers already informally group
products this way in their own heads (and often in the product name
itself, e.g. "Raiden Shogun - A1") - there's no structured field to hang a
filter control off of.

## Data model

One new nullable column: `products.character_tag`, `VARCHAR(255)`,
matching `NAME_MAX_LEN` (the existing limit for `products.name` in
`backend/routes/adminCatalog.js`) rather than inventing a new number.
`NULL`/empty means untagged - today's behavior, unaffected.

**Why not a many-to-many tags table (considered and rejected):** a tags
table (`product_tags` + join table) would support multiple tags per
product and reusable/normalized tag values across collections - useful at
marketplace scale. This shop's actual catalog is a small Vietnamese
seller's drops: tens to low hundreds of products per drop, one character/
series per product in the overwhelming common case. A single plain-text
column needs no new CRUD surface, no new admin management screen, and no
migration path for merging/renaming tags - it is simply another field on
the existing product form, the same shape as `collections.pickup_note` or
`gift_settings.name`, both of which `docs/DECISIONS.md` already documents
as deliberately staying plain free-text instead of growing their own
structured/relational model. If a seller runs a drop with two characters
sharing one product, they can only tag it as one string - accepted as an
edge case a real photocard drop essentially never hits (each product/SKU
is already one specific character's art), and cheap to revisit later by
introducing a tags table then, if it's ever actually needed - YAGNI.

## Backend

### `catalogRepo.js`

- `createProduct(data)` / `updateProduct(id, data)`: accept and persist
  `character_tag` (trimmed, or `null` if empty/omitted). Existing callers
  that never pass it are unaffected (stored as `NULL`, same as today).
- `nestCollectionDetail` already does `SELECT * FROM products ...` and
  spreads `...p` onto every returned product - `character_tag` flows
  through the admin (`getCollectionDetailById`) and public
  (`getPublicCollectionBySlug`, via `listPublicCollections` → detail)
  paths with no new SELECT column list to edit. Verified by reading the
  function: no explicit column list exists there to fall out of sync.
- `copyCollection`: its per-product `createProduct({...})` call currently
  lists fields explicitly (not a `SELECT *`/spread) - `character_tag` is
  added to that explicit list so a copied drop keeps its products' tags,
  same as every other product field.
- `character_tag` is not a secret like `delivery_link` - no path strips it
  from the public response. It has nothing to do with orders/snapshots,
  so `order_items`/`attachItems` are untouched.

### `routes/adminCatalog.js`

- `validateProduct(body)`: if `character_tag` is present and non-empty,
  reject when `String(body.character_tag).length > NAME_MAX_LEN` (same
  limit/message shape as the existing product-name check, mirrored not
  reinvented). Empty string/omitted/`null` is valid (untagged).

No new route, no new query param - the public collection-detail payload
(already fetched once per collection page load) simply carries one more
field per product.

## Frontend

### Admin (`frontend/src/components/AdminProducts.jsx`)

- New optional text input "Nhân vật / Series" in the product create/edit
  form, alongside `name`/`price`/`description`. Saved through the existing
  `adminCreateProduct`/`adminUpdateProduct` calls, which already forward
  the whole draft object - no new API function needed.
- Small, optional addition to the compact per-product list row: the tag
  (if set) renders as a small pill next to the price, so an admin managing
  a 40-product drop can see it without opening each product. Cut if it
  clutters the row; kept here since it's a one-line addition.

### Public (`frontend/src/pages/Collection.jsx`)

- Compute the distinct non-empty `character_tag` values across
  `collection.products` on every render (cheap - at most a few hundred
  products, once per collection page load, no new fetch).
- If there are 2+ distinct values, render a `SearchableSelect` (reusing
  the existing component - it already renders exactly this shape of
  control for the stock filter/sort dropdowns on this same page) with
  options `["Tất cả" / All, <tag A>, <tag B>, ...]`. If there are 0 or 1
  distinct values, render nothing - there is nothing to filter (a single
  shared tag or no tags at all).
- Selecting a tag filters the already-fetched `collection.products` array
  client-side, the same pattern the existing search/stock-filter/sort
  controls on this page already use - no new backend query param.
- **Untagged-product handling (decision):** untagged products
  (`character_tag: null`) are included only in the implicit "All" bucket,
  not offered as a separate "Other/Untagged" filter option. Rationale: if
  a collection has 2+ distinct real tags, it's a multi-character drop
  where the admin has already tagged the products that matter to split
  out; an extra "Untagged" bucket for the (usually few, often zero)
  leftover items adds a filter option that's rarely useful and easy to
  confuse with "All". A seller who wants every product filterable just
  tags all of them - cheap to do since it's one text field per product.
- Filtering is applied as an additional predicate alongside the existing
  `search`/`stockFilter` predicates in `Collection.jsx`'s existing
  `.filter()` chain, before the existing `sortProducts()` call - so the
  established sold-out-sinks-to-the-end stable sort behavior is applied
  to the filtered subset unchanged, not bypassed or reordered specially
  for tags.

### i18n

The tag *value* itself (e.g. "Genshin Impact - Raiden Shogun") is
admin-authored free text and is not translated - same precedent as
`collections.pickup_note`/`gift_settings.name` in `docs/DECISIONS.md`.
Only the UI chrome around it (field label, "All" option, filter
placeholder) goes through the existing `{ vi, en }` /
`LanguageContext.t()` pattern in `frontend/src/i18n/translations.js`.

## Edge cases / testing

- Create/update with `character_tag` omitted or `""` → stored `NULL`, no
  error; existing tests/products unaffected.
- `character_tag` over `NAME_MAX_LEN` (255) chars → `400 invalid_input`,
  same shape as the existing oversized-name rejection (not a raw 500).
- A collection whose products all share one tag → 0 or 1 distinct real
  values → no filter control.
- Products tagged `["A", "A", null, "B"]` → filter offers exactly `["All",
  "A", "B"]`; the null-tagged product is visible only under "All".
- Filtering by a tag hides non-matching products; the sold-out-last stable
  sort still applies within the visible subset (verified by reading
  `Collection.jsx`'s existing `sortProducts` + filter chain and inserting
  the tag predicate into the same `.filter()`, not a separate pass after
  sorting).
- `copyCollection` carries `character_tag` onto every copied product -
  covered by a `catalogRepo.test.js` assertion, since the field list there
  is explicit (not a spread) and could otherwise silently be missed.
- Public API: `character_tag` appears in `getPublicCollectionBySlug`'s
  response; nothing else about the payload shape changes (no
  snapshot/order code touched).

## Out of scope

- A many-to-many tags table / multi-tag-per-product (see rejection above).
- A dedicated admin "manage tags" screen (there's nothing to manage - it's
  a free-text field on the product form, same workflow as any other
  product field).
- A backend query param / server-side filtering (this shop's per-drop
  catalog size doesn't need it - same "fetch once, filter client-side"
  precedent as the existing sold-out/search/sort controls on this page).
- Translating the tag value itself.
- Surfacing tag filtering anywhere other than the collection page (no
  cross-collection "browse by character" page - out of scope for this
  pick).
