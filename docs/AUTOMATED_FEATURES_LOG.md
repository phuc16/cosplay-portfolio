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

<!--
Note: this branch and feature/auto-searchable-select-a11y were both cut
from main before either merged, so both PRs independently create this file
with only their own entry - the merge of the second PR will show a trivial
conflict on this file. Keep both entries (don't drop either) when resolving it.
-->
