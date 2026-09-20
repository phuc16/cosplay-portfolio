# Product Tags — Plan

Small, ordered tasks. See `docs/superpowers/specs/2026-09-20-product-tags-design.md`
for the full design.

1. **Migration** — `backend/migrations/040_add_product_tags.js`: add
   nullable `tags` JSON column to `products` (mirrors the existing
   `images` column).
2. **`backend/shop/catalogRepo.js`** — add `normalizeTags`/`parseTags`
   helpers; persist `tags` in `createProduct`/`updateProduct`; attach
   `tags: parseTags(...)` in `nestCollectionDetail`'s product mapping
   (both physical and digital branches); carry `tags` through
   `copyCollection`. Do **not** strip `tags` on the public path.
3. **Backend tests** — extend `backend/tests/catalogRepo.test.js`:
   create/update/read round-trip, trim/dedupe/case-fold rules, default-
   to-`[]`, public-path exposure, `copyCollection` carries tags through.
   Run with `npx vitest run --pool=forks tests/catalogRepo.test.js`.
4. **Admin UI** — `frontend/src/components/AdminProducts.jsx`: add a
   comma-separated tags text input to the product form; split/trim/dedupe
   on save; pre-fill as `tags.join(", ")` on edit.
5. **Admin UI tests** — extend `frontend/src/components/AdminProducts.test.jsx`.
6. **Public filter UI** — `frontend/src/pages/Collection.jsx`: derive
   distinct tags from the fetched collection's products; render a chip
   bar (only when non-empty) above the grid; single-select toggle
   filtering; reset on slug change; add `shopFilterAllTags` i18n key.
7. **Product-card badges** — `frontend/src/components/shop/ProductCard.jsx`:
   render each product's own tags as small badges.
8. **Frontend tests** — extend `Collection.test.jsx` (chip render/filter/
   toggle) and `ProductCard.test.jsx` (badge render / no-tags no-render)
   if those test files exist; otherwise add to whichever file already
   covers this component.
9. **Full suite run** — backend (`npx vitest run --pool=forks`) and
   frontend (`npm test`), confirm no regressions beyond the documented
   pre-existing failures.
10. **Lint** — `cd frontend && npm run lint`.
11. **Commit, push, open PR, update `docs/AUTOMATED_FEATURES_LOG.md`.**
