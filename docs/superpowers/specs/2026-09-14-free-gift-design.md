# Free Gift Feature — Design

## Goal

Sellers can configure one shop-wide "free gift" (a name, a picture, an
optional description, and optionally a digital delivery link) with a
minimum order amount. Any order whose paid items add up to at least that
amount automatically gets the gift added as a 0đ line item. The whole
thing can be turned on/off at any time without losing its configuration.

## Scope decisions (from brainstorming)

- **One global gift, not per-collection.** A single `gift_settings` row
  applies shop-wide, regardless of which collection(s) an order's paid
  items came from.
- **Threshold is measured against the items subtotal**, before any
  shipping fee — the same number already shown to the buyer as the cart
  total, not whatever they end up paying including delivery.
- **The gift is not a catalog item.** It does not reference
  `product_variants` and has no relationship to any collection or
  product. It is defined entirely by its own row in `gift_settings`:
  name, picture, optional note, optional delivery link, and the
  threshold. This means no dummy "container" collection/product is
  needed just to hold it.
- **No stock limit.** The gift is available to every qualifying order
  for as long as it's enabled — "forever until closed." There is no
  quantity to track, decrement, or run out of.
- **No buyer opt-out.** If an order qualifies, the gift is added
  automatically; the buyer cannot decline or remove it from their order.
- **Exactly one gift unit per qualifying order**, regardless of how far
  over the threshold the order is.
- **Digital vs. physical is inferred from whether a delivery link is
  set** — not a separate type field. A gift with a `delivery_link` is
  digital (its link only ever reveals once the order reaches
  `confirmed`/`completed`, identical to how digital products already
  behave); a gift with no link is physical (ships/gets picked up with
  the rest of the order).
- **COD eligibility is unaffected by the gift**, in either direction.
  Whether COD is offered/accepted is decided purely from the *paid*
  items, exactly as today. A digital gift does not additionally block
  COD (this was considered and deliberately dropped — it would require
  reordering `createOrder`'s validation sequence for a rule with weak
  payoff).
- **A physical gift can force a digital-only order into needing
  shipping/pickup info it wouldn't otherwise need.** This is
  intentional: if an all-digital cart's subtotal qualifies for a
  physical gift, the buyer must supply shipping details, because a
  physical item now needs to reach them. The frontend must anticipate
  this *before* the order is submitted (see Checkout Flow below), since
  the address form only renders when it thinks it'll be needed.
- **The gift ignores per-collection concerns entirely** — no collection
  status/schedule check, no `allow_ship`/`allow_pickup` check. There is
  no collection to check against, since the gift isn't tied to one.

## Data model

### New table: `gift_settings` (singleton, one row)

| Column | Type | Notes |
|---|---|---|
| `id` | int, PK | |
| `enabled` | boolean, not null, default false | |
| `name` | string(191), not null, default `''` | Buyer-facing name, plain text (same convention as `collections.pickup_note` — admin writes it once, not a bilingual `{vi,en}` object) |
| `image_url` | string(512), nullable | Uploaded via the existing image-upload flow (same MinIO-backed pipeline every other product/variant image already uses) |
| `min_total` | int unsigned, not null, default 0 | VND. The items-subtotal threshold |
| `note` | text, nullable | Optional buyer-facing description, e.g. "Quà tặng từ shop, số lượng có hạn theo đợt" |
| `delivery_link` | string(2048), nullable | Presence of a value marks the gift as digital; absence marks it physical |
| `updated_at` | timestamp | |

This mirrors the existing `payment_settings` singleton pattern exactly
(one row, `getSettings()`/`updateSettings()`, no relationship to any
other table).

### `order_items` gets one new column

| Column | Type | Notes |
|---|---|---|
| `is_gift` | boolean, not null, default false | Marks a row as the automatically-added gift rather than a purchased item |

`product_variant_id` is **already nullable** with `ON DELETE SET NULL` in
the current schema (confirmed via the ERD reviewed during design) — a
gift row simply leaves it `NULL` from the moment it's created, which is
already a normal, handled case for every existing read path (all of them
already prefer the snapshot columns and only fall back to a live join
for legacy pre-snapshot rows).

A gift row's snapshot columns are populated directly from `gift_settings`
at the moment the order is created:
- `product_name_snapshot` ← `gift_settings.name`
- `image_url_snapshot` ← `gift_settings.image_url`
- `delivery_link_snapshot` ← `gift_settings.delivery_link` (or `NULL`)
- `unit_price_snapshot` = `0`
- `qty` = `1`
- `variant_label_snapshot` = `''` (empty string — this column is
  `NOT NULL` and a gift has no variant concept; every display path that
  renders `product_name_snapshot - variant_label_snapshot` or similar
  must be checked to skip the separator when this is blank, so it
  doesn't render as "Gift name - " with a dangling dash. This needs to
  be verified against the actual templates during implementation, not
  assumed.)
- `collection_id_snapshot` = `NULL` (no collection)
- `is_gift` = `true`

Once written, this row is permanent — later changes to `gift_settings`
(disabling it, changing its picture, changing the threshold) never
retroactively affect an already-placed order, because nothing re-reads
`gift_settings` after order creation. This is the same guarantee every
other snapshot column in this schema already provides.

## Order creation flow (`orders/orderRepo.js::createOrder`)

Current flow (relevant steps, from the codebase as of this design):
1. Validate `items`, dedupe, sort ascending by variant id.
2. Idempotency check via `request_key`.
3. Lock + fetch all requested variant rows (`FOR UPDATE`), joined to
   their product/collection.
4. Validate: all ids found, digital+COD conflict
   (`NoCodForDigitalError`), fulfillment method required for any
   physical cart (`FulfillmentRequiredError`), per-row collection
   open/scheduled check, fulfillment-offered check
   (`FulfillmentNotOfferedError`).
5. Build `lines[]` from the locked rows.
6. `total = domain.computeTotal(lines)`.
7. Decrement stock per line.
8. Insert `orders` row, then `order_items` rows.

This changes as follows:

1. Steps 1-3 unchanged — they only ever concern the buyer's real,
   paid items.
2. Step 4's **fulfillment-required check moves to after step 6** (it
   needs to know whether a gift applies, which needs the real total).
   The **COD-vs-digital check stays exactly where it is today**,
   evaluated purely against the paid rows — deliberately not gift-aware,
   per the scope decision above.
3. After step 6 (`total` computed from real paid lines only):
   - If `gift_settings.enabled` and `total >= gift_settings.min_total`:
     append one more entry to `lines[]` with the shape described above
     (`product_variant_id: null`, `unit_price_snapshot: 0`, `qty: 1`,
     `is_gift: true`, snapshot fields copied from `gift_settings`).
     No locking, no stock decrement — there's nothing to reserve.
   - `giftIsPhysical` = gift applied AND `gift_settings.delivery_link`
     is empty.
4. The fulfillment-required check (now running after the gift decision)
   uses: fulfillment method is required whenever the order isn't fully
   digital, where "fully digital" now means *all paid rows are digital
   AND the gift either didn't apply or is itself digital*. Concretely:
   `fulfillmentRequired = !paidAllDigital || giftIsPhysical`.
5. Per-row `allow_ship`/`allow_pickup` offered-check and
   collection-status/scheduling checks continue to run only over the
   real paid rows (unchanged) — the gift row is never subject to them,
   since it has no collection.
6. Stock decrement (step 7) only runs for real paid rows, as today —
   there's no stock concept for the gift.
7. `order_items` insert loop now includes the gift row (if applied)
   alongside the paid rows, each carrying its own `is_gift` value.

`domain.computeTotal` is unaffected — the gift line's price is `0`, so
summing it changes nothing, and `orders.total` continues to mean "what
the buyer pays for their items," same as today.

## Public + Admin API

### Public: `GET /api/shop/gift-settings`

Returns `{ enabled, min_total, name, image_url, note }` — no
`delivery_link` (buyers don't need it pre-order; it's irrelevant until
their own order is confirmed, at which point it's already exposed
through their order's own `order_items`, following the existing digital
delivery-link reveal rule).

Used by the Cart and Checkout pages to:
- Show a "spend Xđ more to get [gift name] free" / "🎁 you'll get [gift
  name] free!" hint near the cart total.
- Decide, before the buyer ever gets to the address section, whether to
  render/require it (see Checkout Flow below).

### Admin: `GET`/`PUT /api/admin/gift-settings`

New thin router (`backend/routes/adminGift.js`, mirroring the shape of
`adminPayments.js`), backed by new business logic in
`backend/shop/giftSettings.js` (mirrors `shop/payments/settingsRepo.js`'s
`getSettings`/`updateSettings` singleton-row pattern exactly). Mounted
under the existing `auth` JWT middleware alongside the other
`/api/admin/*` routers.

Image upload for the gift's picture reuses the existing generic
image-upload endpoint/flow (same one `AdminPaymentSettings.jsx` already
uses for the MoMo QR image), just pointed at a `gifts` folder/prefix.

## Checkout flow (frontend)

`Cart.jsx` and `Checkout.jsx` both fetch `GET /api/shop/gift-settings`
(in parallel with whatever they already fetch on mount — `Checkout.jsx`
already fetches payment methods the same way).

`giftMayApply = giftSettings.enabled && cartTotal(cart) >=
giftSettings.min_total` — a client-side estimate, cosmetic only, exactly
like the existing `cartTotal()` display (the server is still the sole
authority on whether the gift actually gets added).

**Cart.jsx**: shows the progress/eligibility hint next to the existing
cart total, using the same "check availability on open" pattern already
used for sold-out/closed detection.

**Checkout.jsx**: the existing `allDigital` flag (all cart items are
digital) currently gates whether the shipping/fulfillment section
renders at all, and whether `fulfillment_method`/address fields are
included in the submitted payload. This becomes:

```
effectiveAllDigital = allDigital && !(giftMayApply && !giftSettingsHasDeliveryLink)
```

i.e., treat the order as needing the shipping section whenever a
physical gift might apply, even if every actual cart item is digital.
When `effectiveAllDigital` is false, the existing ship/pickup radio,
`AddressFields`, and pickup-location block render exactly as they do
today for any physical cart — no new UI, just an existing code path
triggered by an additional condition. The submitted payload's
`fulfillment_method`/address stripping switches from `allDigital` to
`effectiveAllDigital` the same way.

If the frontend's estimate turns out to be wrong (e.g. the gift setting
changed between page load and submit, or a price changed) the backend
remains authoritative and simply proceeds with whatever it determines
server-side — worst case, the buyer supplied shipping info that goes
unused (harmless), or, in the rarer reverse case, `createOrder` throws
its existing `FulfillmentRequiredError` and the buyer is shown the
existing error/retry path, same as any other stale-cart race today.

## Display

Anywhere `order_items` rows are already rendered — the buyer's order
page, admin order detail, the ViettelPost shipping export, and the
pickup roster — a row with `is_gift: true` gets a small marker (e.g. "🎁
Quà tặng") instead of/alongside its price, so a 0đ line reads as
"you got a free gift," not as a pricing bug. This is a rendering-only
change to existing templates; no new views.

## Out of scope (explicitly deferred)

- Multiple simultaneous gifts / a gift catalog.
- Any stock/quantity limit on the gift.
- Buyer ability to decline or swap the gift.
- Per-collection gift configuration.
- Any interaction between the gift and COD eligibility.
