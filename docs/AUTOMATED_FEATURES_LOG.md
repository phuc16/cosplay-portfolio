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
- PR: TBD - see repo open PRs
- Trend angle: `cosplay-community`
- Description: Adds a "Share" button to the product/variant detail modal
  (native share sheet on mobile, copy-to-clipboard + inline confirmation on
  desktop) that deep-links back to that exact product+variant via a
  `?product=&variant=` query param on the existing collection page, which
  `Collection.jsx` auto-opens on mount - no per-product route, no backend
  changes.

## 2026-09-26 - Back-in-stock email alerts (`back-in-stock-alerts`)

- Branch: `feature/auto-back-in-stock-alerts`
- PR: https://github.com/phuc16/cosplay-portfolio/pull/29
- Trend angle: `Shopping/e-commerce`
- Description: Buyers can leave an email on a sold-out product variant
  and get notified once an admin's stock edit brings it back from 0 to
  a positive number - queued and sent by the background worker,
  structurally independent of the order-email pipeline (new
  `stock_alerts`/`stock_alert_queue` tables, no FK to `orders`/
  `email_queue`).
