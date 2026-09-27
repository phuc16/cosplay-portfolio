# Automated Features Log

Record of features produced by the autonomous daily feature-growth routine - one entry per pick, including abandoned ones, so future runs can check what's already been tried without re-discovering it the hard way.

## 2026-09-22 - Abandoned: scroll-reveal (`scroll-reveal`)

Originally the 3rd pick for today's run ("scroll-reveal animations for the
portfolio page"). Abandoned before any code was written: it turned out to
already be live on `main` at commit `12c54a7` ("feat(portfolio): add hero
cutout slide-in + section scroll-reveal"), predating this routine entirely.
Discovered only by direct file inspection of `origin/main`, not by any
doc/PR check - a process gap worth noting for future runs: always check
`origin/main`'s actual file content (`git grep` for the concrete
symbols/APIs a feature would introduce), not just docs/PR titles, before
starting design/implementation work.

## 2026-09-22 - Shareable product cards (`shareable-product-cards`)

- Branch: `feature/auto-shareable-product-cards`
- PR: #24 (merged)
- Trend angle: `cosplay-community`
- Description: Adds a "Share" button to the product/variant detail modal
  (native share sheet on mobile, copy-to-clipboard + inline confirmation on
  desktop) that deep-links back to that exact product+variant via a
  `?product=&variant=` query param on the existing collection page, which
  `Collection.jsx` auto-opens on mount - no per-product route, no backend
  changes.

## 2026-09-27 - Housekeeping: catalog of pre-existing open PRs from earlier runs

Before picking today's features, found 18 open PRs already sitting unmerged
on GitHub from prior daily runs (dated 2026-09-18 through 2026-09-26),
several literal duplicates of each other created on different days. This
log never covered them: each PR's own log-append commit lives on its own
unmerged branch and never reached `main`, so every subsequent day's run
re-read an under-populated `main` copy of this file and picked
already-attempted ideas again without knowing it. Cataloging all of them
here now (regardless of merge order) so future runs stop rediscovering/
duplicating this work - check this list, not just the entries above it,
before picking:

- #7 `feature/auto-payment-reminder-email` - payment reminder email for pending orders (e-commerce)
- #8 `feature/auto-coupon-codes` - coupon/discount codes at checkout (e-commerce)
- #9 `feature/auto-product-reviews` - product reviews/ratings after order completion (e-commerce)
- #10 `feature/auto-accessible-select` - keyboard nav/ARIA for SearchableSelect (tech/a11y)
- #11 `feature/auto-back-in-stock` - back-in-stock email notifications (e-commerce)
- #12 `feature/auto-character-tags` - character/series tagging + filtering for products (cosplay-community)
- #15 `feature/auto-shop-seo-metadata` - SEO meta tags + JSON-LD for Shop/Collection pages (tech)
- #16 `feature/auto-order-again` - one-click "order again" from a completed order (e-commerce)
- #17 `feature/auto-artist-credit` - artist/photographer credit line on products (cosplay-community)
- #19 `feature/auto-searchable-select-a11y` - duplicate of #10
- #20 `feature/auto-order-reorder` - duplicate of #16
- #21 `feature/auto-product-character-tag` - duplicate of #12
- #22 `feature/auto-pwa-installable` - web app manifest + installable service worker (tech)
- #23 `feature/auto-wishlist` - wishlist/save-for-later list (e-commerce)
- #27 `feature/auto-select-a11y` - duplicate of #10/#19
- #28 `feature/auto-character-tag-filter` - duplicate of #12/#21
- #29 `feature/auto-back-in-stock-alerts` - duplicate of #11

Closed-without-merge (rejected - don't retry): #13 (SearchableSelect a11y,
duplicate of the above), #14 (coupon/discount codes, duplicate of #8).

Today's 3 picks below were chosen specifically to avoid every topic above.

## 2026-09-27 - Recent sales badge / social proof (`recent-sales-badge`)

- Branch: `feature/auto-recent-sales-badge`
- PR: TBD - see repo open PRs
- Trend angle: `e-commerce`
- Description: A "🔥 N sold in the last 24h" badge on a product card once a
  product clears a threshold of committed (confirmed/shipped/completed)
  sales in the last 24 hours - derived entirely from existing order data
  (no migration), hidden below the threshold and on sold-out products. See
  `docs/superpowers/specs/2026-09-27-recent-sales-badge-design.md`.
