# Size Chart / Fit Notes — Design

## Trend angle: cosplay-community

Cosplay wearables (costumes, wigs, prop harnesses) fit very differently
from mainstream apparel sizing - a "M" from one seller's pattern can run
small or large depending on the character design, and cosplay buyers
specifically ask about this before ordering (it's a recurring FAQ in
group-buy/preorder posts across the community right now, distinct from
generic e-commerce size charts because the garments themselves are
often handmade or small-batch, not standard retail sizing). This shop
sells wearable costumes today with no way for a seller to say anything
about fit beyond the free-text product description, which buyers have to
dig through rather than a clearly-labeled section. This adds one optional
field a seller can fill in once per product.

## Scope decisions

- **Product-level, not per-variant.** A costume's fit doesn't change
  per photocard code or color - one note per product, shown regardless
  of which variant's detail is currently open. This also means it's
  simpler than `product_variants.description` (already per-variant,
  used for per-code notes today) - no risk of confusing the two.
- **Plain TEXT column, same convention as `description`.** Not a
  bilingual `{ vi, en }` object - per `CLAUDE.md`'s i18n note, that
  pattern is for *site-authored UI copy* (`translations.js`,
  `frontend/src/shop/faq.js`), not seller-entered catalog content;
  `products.description` is already a single free-text column with no
  bilingual infra, and this field follows the same precedent. Rendered
  through the same markdown pipeline as `description` (`renderMarkdown`)
  so a seller can format an actual measurements table if they want one.
- **Optional, no validation beyond the existing TEXT-column precedent.**
  `description` has no length check in `validateProduct` (it's a TEXT
  column, not a fixed-length varchar prone to `ER_DATA_TOO_LONG`) - this
  field follows the same precedent, no new validation code.
- **Admin form shows the field only for a physical product.** Digital
  downloads and gacha turns have nothing to "fit" - hidden the same way
  the existing `delivery_link`/`stock_qty` inputs are shown only for
  `type === "digital"`. The backend itself stores/returns the field for
  any product type regardless (no type gate at the repo layer) - the
  type restriction is purely a UI convenience, matching how
  `gacha_booth_only` is stored unconditionally but only meaningful (and
  only shown in the form) for a gacha product.
- **No order-item snapshot.** This is pre-purchase informational content
  a buyer reads before deciding to buy, not something a placed order
  needs to stay historically accurate against later catalog edits (unlike
  `product_name_snapshot` etc.) - if a seller edits the note after an
  order ships, that's fine, nothing downstream reads it post-purchase.
- **Shown in the variant detail modal**, not the bare grid card - that's
  the screen a buyer is actually on when deciding to add to cart (same
  reasoning `docs/superpowers/specs/2026-09-22-shareable-product-cards-design.md`
  used for putting the Share button there instead of the bare card).

## Data model

New migration `050_add_product_size_chart_note.js`: `products.size_chart_note
TEXT NULL`. `nestCollectionDetail`'s existing `SELECT * FROM products`
picks it up automatically - no change needed there. `createProduct`/
`updateProduct`/`copyCollection` updated to read/write/carry it, same as
every other product field.

## API

No new endpoint - carried on the existing product create/update/read
paths (`POST /collections/:id/products`, `PUT /products/:id`, and every
existing product-read response, admin and public alike - it needs no
gating the way `delivery_link` does, since a size chart isn't sensitive
pre-purchase content).

## Frontend

- `AdminProducts.jsx`: a textarea next to the existing description
  textarea, rendered only when `draft.type === "physical"`; wired into
  the same `draft`/`payload` object every other field already uses (no
  special-case save logic needed).
- `ProductCard.jsx`: in the single-variant detail modal, a small labeled
  block ("Bảng size / Ghi chú độ vừa" / "Size chart / fit notes") right
  after the variant's own `description` block, rendered via
  `renderMarkdown(product.size_chart_note)` - same markdown pipeline,
  distinct visual label so it doesn't read as more variant-specific
  description text.
- New i18n key `shopSizeChartLabel` in `translations.js`.

## Edge cases

- **Digital/gacha product with a stray `size_chart_note` from a past
  type change**: still stored (no backend gate), simply never rendered
  anywhere (public path only reads it for products where the admin form
  would show the field; nothing crashes if a caller sets it on any
  type - it's just inert data, same class as any other field a seller
  set before switching a product's type).
- **Product copy (`copyCollection`)**: carried through like every other
  field - a copied costume keeps its seller-authored fit note.
- **Empty string vs. `null`**: `updateProduct` treats an explicitly
  empty string the same as `description` already does (`data.size_chart_note
  || null` - clears the column), so "delete the note" works by clearing
  the textarea and saving, no separate "remove" control needed.
- **Markdown injection**: goes through the exact same `renderMarkdown`
  call already used for `description`/variant `description`, which
  already forces `rel=noopener` on links per the existing
  `docs/EDGE_CASE_CHECKLIST.md` entry - no new sanitization surface.

## Testing approach

- `backend/tests/catalogRepo.test.js`: defaults to `null`; stored at
  creation and visible on both admin and public read paths; `updateProduct`
  overwrites and clears it; carried through `copyCollection`.
- `frontend/src/components/AdminProducts.test.jsx`: textarea shown (and
  saved) for a physical product (the default type), hidden for
  digital/gacha, pre-filled when editing an existing product.
- `frontend/src/components/shop/ProductCard.test.jsx`: renders in the
  detail modal when set, absent when not, and identical regardless of
  which variant of a multi-variant product is open (proving it's
  product-level, not variant-level).
- Full existing backend + frontend suites re-run to confirm no
  regression.

## Out of scope

- A structured measurements table (rows/columns, unit conversion) -
  plain markdown text covers this for v1; revisit only if a seller
  outgrows free text.
- Per-variant size charts (e.g. a costume sold in S/M/L variants with
  different measurements per size) - this shop's wearables today are
  sold as single-variant or code-based (photocard-style) products, not
  size-variant products; revisit if that catalog shape changes.
- Surfacing the note on the bare grid card (pre-variant-selection) or in
  order emails/snapshots.
