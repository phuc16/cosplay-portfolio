# Artist/Photographer Credit Line — Plan

See `docs/superpowers/specs/2026-09-20-artist-credit-design.md` for full
reasoning.

1. Migration `backend/migrations/040_add_product_credit_text.js` — add
   nullable `products.credit_text varchar(255)`. Run against
   `cosplay_test` and confirm it applies cleanly.
2. `backend/shop/catalogRepo.js`:
   - Add `normalizeCreditText()` helper (trim, empty → null).
   - `createProduct`: insert `credit_text`.
   - `updateProduct`: update `credit_text`.
   - `copyCollection`: add `credit_text: p.credit_text` to the explicit
     product-copy field list.
   - Confirm (read, don't assume) that `nestCollectionDetail`'s `...p`
     spread already carries `credit_text` through both admin and public
     read paths, and that the public path's `delivery_link` strip
     doesn't also strip `credit_text`.
3. `backend/routes/adminCatalog.js`: add a `CREDIT_TEXT_MAX_LEN = 255`
   max-length check to `validateProduct`.
4. Backend tests (`tests/catalogRepo.test.js`,
   `tests/adminCatalogRoutes.test.js`): create/update, trim,
   empty-becomes-null, clear-by-omission, public+admin exposure
   (including a digital product), 255/256-char boundary via the route,
   `copyCollection` preservation (value + null cases).
5. `frontend/src/components/AdminProducts.jsx`: add `credit_text` to
   `blank`, `edit()`, and a new `<input>` in the form below the
   description textarea.
6. `frontend/src/i18n/translations.js`: add `shopCreditPrefix` to both
   `en` and `vi`.
7. `frontend/src/components/shop/ProductCard.jsx`: render the credit
   line (grid card body + detail modal), conditional on
   `product.credit_text`.
8. Frontend tests (`AdminProducts.test.jsx`, `ProductCard.test.jsx`):
   submit-on-create, pre-fill-on-edit, blank-when-absent; renders when
   set, absent when not, in both card and detail modal.
9. Run full backend suite (`--pool=forks`) and full frontend suite;
   confirm no regressions beyond the known pre-existing MinIO-dependent
   failures.
10. `npm run lint` in `frontend/`, fix anything introduced.
11. Leave `cosplay_test` migrated and clean.
