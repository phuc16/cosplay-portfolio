# Automated Features Log

Record of features shipped (or abandoned) by the daily autonomous
feature-growth agent. Each entry: date, slug, branch, PR URL, trend angle,
one-line description. Read this before picking new features so a future run
never repeats or over-uses one trend angle.

## 2026-09-21 - searchable-select-a11y - `feature/auto-searchable-select-a11y` - PR: https://github.com/phuc16/cosplay-portfolio/pull/19 - Tech trend (accessibility/ARIA)

Adds keyboard navigation (arrows/Home/End/Enter/Escape) and combobox/
listbox/option ARIA semantics to `SearchableSelect`, closing the gap
explicitly tracked as a follow-up in `docs/DECISIONS.md` (2026-09-11).

## 2026-09-21 - order-reorder - `feature/auto-order-reorder` - PR: https://github.com/phuc16/cosplay-portfolio/pull/20 - Shopping/e-commerce trend (one-click reorder)

Adds a "Dat lai" (Reorder) button to the buyer's order page that re-adds
the order's real items to the cart via the existing cart.js/addToCart,
relying on /cart's existing live-availability revalidation instead of a
new check.

## 2026-09-21 - product-character-tag - `feature/auto-product-character-tag` - PR: https://github.com/phuc16/cosplay-portfolio/pull/21 - Cosplay-community trend (character/series tagging & filtering)

Adds an optional `products.character_tag` free-text field, an admin form
field to set it, a buyer-facing badge, and a collection-page filter
(shown once a drop has 2+ distinct tags) - lets buyers narrow a mixed
photocard/poster drop down to one character/series.

<!--
Note: this branch, feature/auto-searchable-select-a11y, and
feature/auto-order-reorder were all cut from main before any of them
merged, so each PR independently creates this file with only its own
entries - merging the second and third PRs will show a trivial conflict on
this file. Keep every entry (don't drop any) when resolving it.
-->
