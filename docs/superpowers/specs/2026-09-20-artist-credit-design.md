# Artist/Photographer Credit Line — Design

## Goal

Let an admin attach a single, free-text credit line to a product (e.g.
"Ảnh: @tenphotographer", "Artist: @tenartist (Twitter)") naming who to
credit for the artwork/photo the product is based on — an original
artist, photographer, or the cosplayer photographed — and show that line
to buyers wherever the product itself is shown. Crediting the source is
a near-universal norm in the cosplay/fan-art community and is often a
condition artists attach to letting merch (photocards/posters, this
shop's actual product type) be made from their work at all; this shop
currently has no field for it anywhere.

## Why free-text, not a structured field

A structured credit (separate name/handle/platform/URL fields, or a
role enum like "photographer" vs. "artist" vs. "cosplayer") was
considered and rejected for this first iteration:

- The convention for how to phrase a credit varies by seller, platform,
  and even by drop ("Ảnh:", "Photo by", "Design gốc:", "cosplayer:
  @x, ảnh: @y" naming two different people in one line) — a rigid
  schema would either constrain the seller to a format they don't use,
  or need to grow multiple repeatable sub-fields (name + role, possibly
  several per product) for a use case with no evidence yet that it's
  needed.
- This shop already has exactly this shape of field elsewhere —
  `products.description` is free markdown text, not structured — so a
  single free-text line for credit is consistent with the codebase's
  existing precedent rather than introducing a new pattern.
- Nothing here needs to be queried, filtered, or aggregated (unlike,
  say, `products.character_tag` from the sibling PR #12, which the
  storefront filters by). A credit line is purely something to *read*,
  never something to *search by* — so there's no query-shaped reason to
  break it into columns.
- If a structured/linkable credit (e.g. a clickable handle to an
  external profile) turns out to be wanted later, that's a strict
  superset of this and can be added without a breaking migration - this
  field would simply become the fallback/plain-text case.

## How this differs from PR #12 (`character_tag`)

PR #12 (open, unmerged as of this writing) adds `products.character_tag`
— a free-text field naming **who/what is depicted** in the art (e.g.
"Raiden Shogun - Genshin Impact"), shown as a searchable/filterable
badge so buyers can browse a collection by character.

This feature is conceptually and structurally distinct:

| | `character_tag` (PR #12) | `credit_text` (this feature) |
|---|---|---|
| Answers | "Who/what is this a picture of?" | "Who made/took this, and who should be credited?" |
| Searchable/filterable | Yes (dropdown filter on Collection page) | No — display only |
| UI placement | Badge on the product card/grid | Small italic line near description, own section in the admin form |
| Column name | `products.character_tag` | `products.credit_text` |

Both are per-product nullable `varchar(255)` free-text columns added the
same way (own migration, own admin input, own public render), but they
are independent features that can both land without collision: different
column, different validation call site, different UI section, no shared
component. This document exists specifically to keep that boundary
explicit for anyone reviewing both PRs.

## Data model

New nullable column on `products`:

| Column | Type | Notes |
|---|---|---|
| `credit_text` | `varchar(255)`, nullable | Free-text, admin-entered, not translated. Trimmed on write; an empty/whitespace-only string is stored as `NULL` (same convention as `description`'s `data.description \|\| null`, extended with an explicit trim since this is a single short line rather than a markdown block). |

Migration: `backend/migrations/040_add_product_credit_text.js`
(`alterTable("products")` → `table.string("credit_text", 255).nullable()`,
reversible via `dropColumn`).

## API changes

- `POST /api/admin/collections/:id/products` and
  `PUT /api/admin/products/:id` (`backend/routes/adminCatalog.js`) accept
  `credit_text` in the body, validated for max length (255 chars,
  matching the column) — no other validation (no URL-format check, no
  `@handle` parsing).
- `backend/shop/catalogRepo.js`'s `createProduct`/`updateProduct` persist
  it via a small shared `normalizeCreditText()` helper (trim, empty →
  `null`).
- Read paths: `nestCollectionDetail` (shared by both
  `getCollectionDetailById` — admin — and `getPublicCollectionBySlug` —
  public) builds each product object with a `...p` spread of the raw row,
  so `credit_text` flows through to both the admin and public JSON
  automatically once it's a real column — no separate mapping change
  needed, verified by reading the function before implementing. The
  public path's existing `delivery_link`-stripping step (digital-only,
  security-sensitive) does not touch `credit_text` — a credit is meant to
  be public, unlike a delivery link.
- `copyCollection`: unlike `getCollectionDetailById`, this function
  builds an **explicit** field list per product (not a generic
  spread) when calling `createProduct` for the copy, so `credit_text`
  does **not** ride along "for free" — verified by reading the function
  before implementing. `credit_text: p.credit_text` was added explicitly
  to that list, and a test (`copyCollection preserves a product's
  credit_text`, plus a null-stays-null case) confirms it.

## Admin UI

`frontend/src/components/AdminProducts.jsx`'s product form gets one new
plain `<input>` directly below the existing description `<textarea>`,
labelled via its placeholder `"Credit tác giả / nhiếp ảnh gia (tuỳ
chọn)"` (optional, `maxLength={255}`). `blank` and `edit(p)` both carry
`credit_text` the same way every other optional text field
(`description`, `delivery_link`) already does; `save()`'s
`{ ...draft, price: ... }` spread submits it with no extra plumbing.

## Public UI

`frontend/src/components/shop/ProductCard.jsx` renders a small, italic,
low-opacity line — `"{t("shopCreditPrefix")}: {credit_text}"` — in two
places, matching the visual weight of the existing variant/product
`description` block next to it:

- The grid card body, right after the product-level `description` block.
- The variant detail modal, right after `detail.description`.

Only rendered when `product.credit_text` is truthy — a product with no
credit set shows nothing extra, not an empty label. The `"Credit:"`
prefix is a bilingual i18n key (`shopCreditPrefix`, `en`/`vi` — both
render as "Credit" since that word doubles as an English loanword
commonly used as-is in Vietnamese cosplay-community contexts, e.g.
"credit tác giả"); the credit text itself is admin-entered free text
and is never translated, run through `t()`, or reformatted — same
precedent as `products.description` and the free-gift feature's `name`
field.

## Edge cases

- **Empty input**: an admin who types only whitespace, or clears the
  field, gets `NULL` stored (not an empty string) — `normalizeCreditText`
  trims before the `|| null`-equivalent check. The public UI's `&&`
  guard treats `null`/`undefined`/`""` identically as "don't render."
- **Very long input**: the admin route validator rejects anything over
  255 chars with `400 invalid_input` before it ever reaches the DB
  layer (mirrors the existing `NAME_MAX_LEN` check immediately above it)
  — a 256-char string cannot 500 on a DB truncation error.
- **`copyCollection`**: explicitly carried through (see API changes
  above) — both the "has a value" and "is null" cases are tested so a
  regression that silently drops it on copy is caught either direction.
- **Digital products**: a digital product's single hidden variant has
  its own `stock_qty`/`delivery_link`, but `credit_text` lives on the
  *product* row, not the variant, so it works identically for digital
  and physical products with no special-casing — verified with an
  explicit public-exposure test for a digital product.
- **Omitted vs. explicit-empty on update**: `updateProduct`'s SQL
  `UPDATE` always writes `normalizeCreditText(data.credit_text)`, so
  (unlike the digital-product `stock_qty`/`delivery_link`
  omitted-preserves-existing convention used elsewhere in this file) an
  update call that doesn't include `credit_text` at all clears it to
  `NULL`, exactly matching how `description`/`price`/`images` already
  behave on the same `UPDATE products SET ...` statement — the admin
  form always submits the full draft object on save, so this only
  matters for a hypothetical partial-payload caller, and is called out
  explicitly here (and tested) rather than left implicit.

## Testing approach

- Backend (`backend/tests/catalogRepo.test.js`): create/update, trim,
  empty-string-becomes-null, clear-by-omission, public exposure
  (physical and digital), admin exposure, `copyCollection` preservation
  (value case and null case) — mirrors the structure PR #12's own
  `character_tag` tests use for the same "does copy preserve my new
  field" question.
- Backend (`backend/tests/adminCatalogRoutes.test.js`): create/update via
  the real HTTP route including the 255-char boundary (accept at exactly
  255, reject at 256 with `400 invalid_input`, not a 500), trimming
  through the route.
- Frontend (`AdminProducts.test.jsx`): the new input submits on create,
  pre-fills on edit, is blank when the product has none.
- Frontend (`ProductCard.test.jsx`): renders on the grid card and in the
  detail modal when set, renders nothing when absent.

## Out of scope (explicitly deferred)

- Structured credit fields (name/handle/role/URL) or multiple credits
  per product.
- Linking out to an external profile/social URL — this is plain text,
  never rendered as a link.
- Any search/filter by credit text (unlike PR #12's character tag).
- Any interaction with `copyCollection`'s title/status handling beyond
  the plain field-copy above — a copied product's `credit_text` is
  copied verbatim, same as its `description`.
