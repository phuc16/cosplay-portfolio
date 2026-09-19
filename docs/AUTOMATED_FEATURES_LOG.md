# Automated Features Log

Record of features shipped (or abandoned) by the daily autonomous feature-growth
run. Each entry: date, slug, branch, PR URL, trend angle, one-line description.
Read this before picking new features so a future run doesn't duplicate or
over-use one trend angle - see `docs/DECISIONS.md`/`docs/EDGE_CASE_CHECKLIST.md`
for everything already decided/covered outside this log.

## 2026-09-19

- **searchableselect-a11y** - `feature/auto-accessible-select` - https://github.com/phuc16/cosplay-portfolio/pull/10 - Tech trend (accessibility/ARIA) - Keyboard nav (arrows/Home/End/Enter/Escape) + ARIA combobox/listbox semantics for the custom `SearchableSelect` dropdown, closing the follow-up tracked in `docs/DECISIONS.md`'s 2026-09-11 entry.
- **back-in-stock-notify** - `feature/auto-back-in-stock` - https://github.com/phuc16/cosplay-portfolio/pull/11 - Shopping/e-commerce trend (back-in-stock alerts) - Buyers can request an email for a sold-out variant; a new `stock_notify_requests` table + a polling step added to the existing worker tick (reusing the SMTP transport) sends it once the variant restocks. Deliberately does not reuse the order-coupled `email_queue` table (see design doc).
- **character-tag-filter** - `feature/auto-character-tags` - https://github.com/phuc16/cosplay-portfolio/pull/12 - Cosplay-community trend (character/series tagging) - A free-text `products.character_tag` column, an admin form field, a client-side filter dropdown on the Collection page (2+ distinct tags required to show), and a small badge on ProductCard. No new API endpoint - the field rides the existing nested-product read path.

Note: this run's three PRs each independently branched off `main` and each
added their own next-numbered migration file locally (040/041 depending on
branch) - since none has merged yet, a future run (or the repo owner merging
these) should double check migration numbers don't collide once more than
one lands; renumber the later one(s) at merge time if needed.
