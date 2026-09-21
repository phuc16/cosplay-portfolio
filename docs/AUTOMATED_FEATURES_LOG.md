# Automated Features Log

Record of features shipped (or abandoned) by the daily autonomous
feature-growth agent. Each entry: date, slug, branch, PR URL, trend angle,
one-line description. Read this before picking new features so a future run
never repeats or over-uses one trend angle.

## 2026-09-21 - searchable-select-a11y - `feature/auto-searchable-select-a11y` - PR: https://github.com/phuc16/cosplay-portfolio/pull/19 - Tech trend (accessibility/ARIA)

Adds keyboard navigation (arrows/Home/End/Enter/Escape) and combobox/
listbox/option ARIA semantics to `SearchableSelect`, closing the gap
explicitly tracked as a follow-up in `docs/DECISIONS.md` (2026-09-11).
