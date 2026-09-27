# Recent Sales Badge (Social Proof) — Design

## Trend angle: shopping/e-commerce

Urgency and social-proof signals ("12 people bought this today", "selling
fast") are one of the most common conversion levers on modern storefronts
(Shopee/TikTok Shop badges, Shopify "sold X in the last Y hours" apps) -
buyers use them as a cheap trust signal for an unfamiliar small seller,
which is exactly this shop's situation (a small Vietnamese cosplay seller,
not a known brand). This shop already shows remaining stock
(`shopInStock`/`shopSoldOut`), but nothing about *momentum* - a buyer can't
tell a drop that's quietly moving from one that isn't. This closes that gap
with a read-only badge computed from data that already exists (paid order
history), no new schema and no admin configuration surface.

## Scope decisions

- **No new table/column.** "Recently sold" is derived entirely from
  `order_items` joined through `orders`/`product_variants` - there is
  nothing to snapshot here (unlike order-item fields, this number is a
  live, ephemeral aggregate, not something a specific order needs to stay
  historically accurate against catalog edits).
- **Only counts committed sales.** `orders.status IN ('confirmed',
  'shipped', 'completed')` - a `pending` order can still expire
  (`releaseExpiredOrders`) or get cancelled, so counting it would let a
  pile of unpaid/abandoned orders inflate the badge. `cancelled` is
  obviously excluded too.
- **24-hour rolling window**, keyed off `orders.created_at` (order
  placement time, not `confirmed_at`) - simpler, and "placed in the last
  24h and since confirmed" is the natural reading of "sold today" for a
  buyer, without needing to reason about a COD order that may never set
  `confirmed_at` before going straight to `completed`.
- **Threshold, computed server-side, not client-side.** Below
  `RECENT_SALES_BADGE_THRESHOLD` (3 units), the backend reports `0`
  rather than the true (low) count - a single sale reads as noise, not a
  trend, and a lone sale of someone's own test order would otherwise show
  up as "1 sold!" on a brand-new drop. Keeping the threshold in one place
  (`catalogRepo.js`) means the frontend never needs its own copy of the
  magic number to stay in sync with.
- **Product-level, not variant-level.** A photocard drop can have 40+
  variants; a per-variant count would be noisy and would rarely clear the
  threshold on its own. Summing across all of a product's variants (via
  `product_variants.product_id`) gives a meaningful, stable signal.
- **No caching concerns.** Unlike the portfolio's `gallery`/`settings`
  keys, the shop catalog reads (`listPublicCollections`,
  `getPublicCollectionBySlug`) are not Redis-cached at all today (verified
  by grep - CLAUDE.md's caching note applies to portfolio only) - so
  there's no invalidation to wire up and no risk of the rolling window
  going stale behind a cache TTL.
- **Public collection-detail path only.** `listPublicCollections` (the
  `/merchandise` grid of collections) never nests products, so there is
  nowhere to attach a per-product count there - only
  `getPublicCollectionBySlug` (the `/merchandise/:slug` page, which
  `ProductCard` renders from) needs it.

## Data model / query

No migration. New helper in `backend/shop/catalogRepo.js`:

```
attachRecentSalesCounts(products) ->
  SELECT pv.product_id, SUM(oi.qty) AS units
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN product_variants pv ON pv.id = oi.product_variant_id
   WHERE o.status IN ('confirmed','shipped','completed')
     AND o.created_at >= (UTC_TIMESTAMP() - INTERVAL 24 HOUR)
     AND pv.product_id IN (...)
   GROUP BY pv.product_id
```

`UTC_TIMESTAMP()` per this repo's date-math convention (never `NOW()`),
matching `closeExpiredCollections`/order-scheduling code elsewhere in the
same file. Each product gets `recent_sales_count: units >= 3 ? units : 0`
merged in; called from `getPublicCollectionBySlug` after the existing
gacha-booth filter/`delivery_link` strip, so the shape of every other field
is unchanged.

## Edge cases

- **Variant deleted within the window**: `order_items.product_variant_id`
  goes `SET NULL` on variant delete (existing FK behavior) - that order's
  past sale silently drops out of the count. Accepted: this is a
  display-only, non-order-critical number, and the scenario (a variant
  sold and deleted again within 24h) is rare. Not worth a
  `product_id_snapshot` migration for.
- **New product, zero sales**: `byProduct.get(p.id)` misses ->
  `recent_sales_count: 0` -> no badge. No divide-by-zero/undefined path.
- **Gacha/digital products**: their one hidden variant still has a real
  `product_variants.id` and `product_id`, so the same join works
  unmodified - a popular gacha or digital download can also earn the
  badge.
- **A booth-only gacha product**: already filtered out of
  `getPublicCollectionBySlug`'s `products` array before
  `attachRecentSalesCounts` runs, so no wasted query rows for it.
- **Sold-out product with real recent sales**: the frontend still hides
  the badge (see below) - "act fast, only a few left" and "sold out" are
  contradictory signals to show together.

## Frontend

`ProductCard.jsx`: a small badge next to the existing digital-product
badge, shown when `!isProductSoldOut(product) && product.recent_sales_count
> 0`:

```jsx
{!isProductSoldOut(product) && product.recent_sales_count > 0 && (
  <span className="... bg-orange-500/15 text-orange-500">
    {t("shopRecentSales", { n: product.recent_sales_count })}
  </span>
)}
```

New i18n keys (`translations.js`, both `en`/`vi`): `shopRecentSales` -
"🔥 {n} sold in the last 24h" / "🔥 Đã bán {n} trong 24h qua" - same `{n}`
interpolation pattern `shopInStock` already uses.

## Testing approach

- `backend/tests/catalogRepo.test.js`: new `describe("recent sales count
  (social proof badge)")` - counts confirmed+shipped units within the
  window; reports `0` below the threshold; excludes `pending`/`cancelled`
  orders; excludes sales older than 24h. Uses a new
  `insertOrderWithQtyAt(variantId, { qty, status, hoursAgo, token })` test
  helper (existing `insertOrderForVariant` has no qty/time knobs).
- `frontend/src/components/shop/ProductCard.test.jsx`: badge renders above
  threshold, not at `0`, not when the field is absent (older/other read
  paths), and not on a sold-out product even with a high count.
- Full existing backend + frontend suites re-run to confirm no regression.

## Out of scope

- Any admin configuration of the threshold/window (YAGNI - revisit if a
  seller ever asks to tune it).
- Variant-level badges.
- "X people are viewing this" (would need real-time infra - session
  tracking - this shop has none today; a materially bigger feature).
