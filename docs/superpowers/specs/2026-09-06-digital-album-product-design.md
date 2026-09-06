# Digital Album Product — Design Spec

## Goal

Sell digital albums as a distinct product type alongside physical merch (cards, posters, etc.), sold through the same cart/checkout as everything else. After the seller accepts (confirms) an order containing a digital product, the buyer receives the digital delivery link (e.g. a Drive link) in the same "accepted" email, and can also see it on their order-status page. Physical items in the same order are unaffected — they keep going through the existing ship/pickup fulfillment flow.

## Background

Today, `products` have no `type`/category distinction — every product implicitly means "physical, sold via one or more `product_variants` rows" (size/edition options, each with its own `stock_qty`, images, thumbnail, and markdown description). Orders carry a single order-level `fulfillment_method` (`ship` or `pickup`), and `order_items` snapshot the variant/product name and price at order-creation time. The "seller accepts an order" action is the existing `pending -> confirmed` status transition, which already triggers a `payment_confirmed` email built from a template with `{{items}}`/`{{prep_note}}` placeholders.

## Decisions (from brainstorming)

- Digital is a **product-level type** (`products.type`), not a variant-level option and not a collection-level flag.
- Digital products still support **limited stock** (not unconditionally unlimited).
- Digital products have **no variant list in the admin UI at all** — no size/edition options. They use the product's own `images` (already exists), plus a `stock_qty` and a `delivery_link` entered directly on the product form.
- Internally, each digital product gets exactly **one auto-created, hidden `product_variants` row** (no label, never surfaced in any variant UI) so that cart, `order_items`, and stock-decrement code — all built around `variant_id` — need zero structural changes. `stock_qty` and `delivery_link` live on this hidden row; product-fetch endpoints flatten them onto the product object for anything digital, so no frontend code needs variant-awareness for digital items.
- The delivery link is **fixed on the product** (not entered manually per order at accept time) — the same link is sent to every buyer of that product.
- **No COD** for any order containing at least one digital item (mixed or digital-only) — cash-on-delivery collects payment at physical delivery time, which doesn't make sense once a digital good has already been emailed out.
- If a cart has **any physical item**, checkout still requires the existing ship/pickup choice (scoped to the physical items) exactly as today.
- If a cart is **all-digital**, checkout skips address/ship/pickup entirely; the backend auto-sets `fulfillment_method = 'digital'` (buyer never picks this value).
- The delivery link is shown both in the "accepted" email **and** on the buyer's order-status page (`/order/:token`), once the order has reached `confirmed` or later (never for `pending`/`cancelled`).

## Data Model Changes

All changes are additive Knex migrations, numbered after the current highest (`028`), never editing past migrations.

1. **`products.type`** — `ENUM('physical', 'digital')`, `NOT NULL DEFAULT 'physical'`. Every existing row backfills to `'physical'` for free via the default.
2. **`product_variants.delivery_link`** — `VARCHAR(2048) NULL`. Only ever set on the one hidden variant belonging to a digital product; always `NULL` for physical variants.
3. **`order_items.delivery_link_snapshot`** — `VARCHAR(2048) NULL`. Captured at order-creation time from the variant's `delivery_link`, so a later edit to the product's link never changes what a past order's buyer was already sent/shown. `NULL` for physical line items.
4. **`orders.fulfillment_method`** — extend the existing enum to add `'digital'` as a third value (alongside `ship`/`pickup`).

## Backend Logic

### Catalog (`backend/shop/catalogRepo.js`)

- `createProduct(data)`: unchanged for `type: 'physical'`. For `type: 'digital'`, after inserting the product row, also insert exactly one `product_variants` row with `label: ''`, `stock_qty: data.stock_qty ?? null`, `delivery_link: data.delivery_link ?? null`. The product's own `images` column is used as-is (no variant-level images for digital).
- `updateProduct(id, data)`: for digital products, additionally updates the hidden variant's `stock_qty`/`delivery_link` in place (fetch the product's single variant row, `UPDATE` it) whenever those fields are present in the payload. Changing a product's `type` after creation is **out of scope** — the admin UI will not offer a way to flip `type` on an existing product (avoids the ambiguity of migrating variants <-> hidden-variant on type change).
- Any function that returns a product for the buyer-facing API (gallery/collection fetch, single-product fetch) flattens the hidden variant's `stock_qty`/`delivery_link` onto the returned product object when `type === 'digital'` (as `product.stock_qty`, `product.delivery_link`), so `ProductCard.jsx` and cart logic don't need to special-case variant lookups for digital items.
- `copyCollection`'s per-variant mapping carries `delivery_link` through like the other variant columns it already copies (`thumbnail_image`, `description`).

### Orders (`backend/shop/orders/orderRepo.js`)

- `createOrder(input)`:
  - For each cart line, resolve whether its product is `digital` (join through `product_variants -> products`).
  - If `payment_method === 'cod'` and any line is digital: reject with a validation error (same error-shape convention as existing `createOrder` validation failures).
  - If every line is digital: force `fulfillment_method = 'digital'` regardless of what the client sent, skip address validation/assignment (address fields stay `NULL`, mirroring the existing pickup no-address pattern), and skip shipping-fee computation.
  - If at least one line is physical: `fulfillment_method` must be `ship`/`pickup` and is validated exactly as today, scoped to the physical lines only (a digital line is never checked against a collection's `allow_ship`/`allow_pickup` flags).
  - When inserting each `order_items` row, set `delivery_link_snapshot` from the variant's `delivery_link` for digital lines, `NULL` for physical lines.
  - Stock decrement logic is untouched — it already operates on `variant.stock_qty` regardless of physical/digital, and the hidden variant participates the same way a normal variant would.
- `attachItems` (used by order-status fetch and admin views): include `delivery_link_snapshot` in the item projection. The route/serializer that returns order data to the buyer only surfaces `delivery_link_snapshot` when `order.status` is `confirmed`, `shipped`, or `completed` — never for `pending`/`cancelled`.

### Email (`backend/shop/email/templates.js`, `orderRepo.js` buildVars)

- `buildVars`'s `prep_note` branch gains a digital case: when the order is all-digital, note that the download link is included below; when mixed, keep the existing ship/pickup wording (physical items still need shipping/pickup handling) — the digital item's link still appears in the item list regardless.
- The `{{items}}` block renders, under each digital line, its `delivery_link_snapshot` as a clickable line (e.g. "Download: <a href="...">...</a>"). Physical lines are rendered exactly as today.
- No other transition emails change — `shipped`/`cancelled` emails don't mention digital items at all (a cancelled order's digital line never had a link sent in the first place, since links only render for `confirmed`+ in both email and the order page).

## Admin UI

### `AdminProducts.jsx`

- Add a Physical/Digital type toggle to the product-create form. `type` is set at creation and is **not editable afterward** (per Data Model Changes above).
- When `type === 'digital'`: hide the "Add Variant" / variant-list flow entirely for that product. Instead, the product form itself gains two fields: `Stock quantity` (same semantics as a variant's `stock_qty` — blank/null means unlimited, `0` means sold out) and `Delivery link` (URL input). The existing `images` multi-upload for products is reused as-is.
- When `type === 'physical'`: no change to any existing behavior.

### `AdminOrders.jsx`

- In the order-detail item list, digital line items get a small "Digital" badge next to the product/variant name, and display their `delivery_link_snapshot` (read-only text, since the link is fixed on the product and not editable per-order) so the admin can sanity-check what will be emailed before confirming the order.

## Buyer UI

### `ProductCard.jsx`

- A digital product renders like a product with exactly one variant: no variant picker is shown. Sold-out state (`isProductSoldOut`) reads the flattened `product.stock_qty` the same way it already reads a variant's `stock_qty`.

### `Cart.jsx` / `Checkout.jsx`

- Cart composition is computed from the cart's resolved product types (already available via the same gallery/product data the cart already reads for images/names).
- All-digital cart: hides address fields and the ship/pickup selector entirely; no shipping fee line.
- Any digital item present (mixed or not): the COD payment-method option is hidden/disabled, with a short inline note explaining why (COD isn't available for orders containing a digital item).

### `Order.jsx` (buyer order-status page)

- Once `order.status` is `confirmed`, `shipped`, or `completed`, each digital line item renders its `delivery_link_snapshot` as a "Download" button/link, using the same data the page already fetches per item.

## Out of Scope

- Changing a product's `type` after it's created.
- Per-order-custom delivery links (link is always fixed on the product).
- Any change to `shipped`/`cancelled` email content beyond what's described above.
- Digital-product variants of any kind (size/edition options) — explicitly not supported; if ever needed, it's a separate future spec.

## Testing Outline

Mirrors this codebase's existing per-layer test conventions (no new tooling):

- **`backend/tests/schema.test.js`**: new columns exist with correct nullability/defaults.
- **`backend/tests/catalogRepo.test.js`**: creating a digital product auto-creates its hidden variant with the submitted `stock_qty`/`delivery_link`; updating a digital product updates that hidden variant; a physical product's behavior is unchanged; `copyCollection` carries `delivery_link` through.
- **`backend/tests/orderRepo.test.js`** (or equivalent): COD rejected when any line is digital; all-digital cart forces `fulfillment_method = 'digital'` and skips address/shipping; mixed cart still requires ship/pickup for its physical lines; `delivery_link_snapshot` captured correctly per line; `attachItems`/order fetch only exposes the link for `confirmed`+ statuses.
- **Email template tests**: digital branch of `prep_note` wording; `{{items}}` renders the download link for digital lines.
- **`frontend/src/components/AdminProducts.test.jsx`**: type toggle; digital form fields (`stock_qty`, `delivery_link`) replace the variant-list flow; physical flow unchanged.
- **`frontend/src/components/shop/ProductCard.test.jsx`**: digital product shows no variant picker; sold-out driven by flattened `stock_qty`.
- **`frontend/src/pages/Cart.test.jsx` / `Checkout.test.jsx`**: address/ship-pickup fields hidden for all-digital cart; COD option hidden when any digital item present.
- **`frontend/src/pages/Order.test.jsx`**: download link shown only for `confirmed`/`shipped`/`completed`, never for `pending`/`cancelled`.
