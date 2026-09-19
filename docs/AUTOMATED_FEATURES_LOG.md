# Automated Features Log

Record of features shipped (or abandoned) by the daily autonomous feature-growth
run. Each entry: date, slug, branch, PR URL, trend angle, one-line description.
Read this before picking new features so a future run doesn't duplicate or
over-use one trend angle - see `docs/DECISIONS.md`/`docs/EDGE_CASE_CHECKLIST.md`
for everything already decided/covered outside this log.

## 2026-09-19

- **searchableselect-a11y** - `feature/auto-accessible-select` - https://github.com/phuc16/cosplay-portfolio/pull/10 - Tech trend (accessibility/ARIA) - Keyboard nav (arrows/Home/End/Enter/Escape) + ARIA combobox/listbox semantics for the custom `SearchableSelect` dropdown, closing the follow-up tracked in `docs/DECISIONS.md`'s 2026-09-11 entry.
