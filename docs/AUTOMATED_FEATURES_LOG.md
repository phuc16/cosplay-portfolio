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

## 2026-09-26 - SearchableSelect keyboard nav + ARIA combobox semantics (`select-a11y`)

- Branch: `feature/auto-select-a11y`
- PR: https://github.com/phuc16/cosplay-portfolio/pull/27
- Trend angle: `Tech trend (accessibility)`
- Description: Closes the keyboard-nav/ARIA gap in `SearchableSelect`
  explicitly flagged and deferred in `docs/DECISIONS.md`'s 2026-09-11 entry -
  adds arrow-key/Home/End option navigation (no wraparound), Enter-to-select,
  Escape-to-close (returns focus to the trigger), and
  `role="combobox"`/`"listbox"`/`"option"` +
  `aria-expanded`/`aria-controls`/`aria-activedescendant`/`aria-selected`
  semantics, with no change to the component's prop contract. Frontend-only.
