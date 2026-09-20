# One-Click Reorder ("Order again") — Plan

See `docs/superpowers/specs/2026-09-20-order-again-design.md` for full
rationale. Small, ordered tasks:

1. **Export `findProduct` from `frontend/src/shop/cartAvailability.js`**
   (rename nothing, just add `export`) so `reorder.js` can share the exact
   same "locate this variant within a fetched collection" rule instead of
   re-deriving it. No behavior change to `cartAvailability.js` itself.

2. **New `frontend/src/shop/reorder.js`**:
   - `hasReorderableItems(items)` - pure, no network, gates the button.
   - `reorderOrderItems(order)` - async, does the fetch/classify/addToCart
     work described in the design doc's data-flow section, returns
     `{ addedCount, skipped: [{ name, reason }] }` where `reason` is one
     of `"unavailable" | "ended" | "not_started" | "sold_out"` (the same
     vocabulary `cartAvailability.js`/`Cart.jsx` already use, so the UI
     layer can reuse `Cart.jsx`'s existing `cartItemSoldOut`/`cartItemEnded`/
     `cartItemUnavailable`/`cartItemNotStarted` translation keys verbatim
     instead of adding a second set of near-duplicate strings).

3. **New translation keys** (`frontend/src/i18n/translations.js`, both
   `en`/`vi`): `orderReorderButton`, `orderReorderInProgress`,
   `orderReorderSummaryAdded` (`{n}`), `orderReorderSummaryNone`,
   `orderReorderSummarySkipped` (`{list}`). Reuse the existing
   `cartItemSoldOut`/`cartItemEnded`/`cartItemUnavailable`/
   `cartItemNotStarted` keys for the per-reason text - no new reason
   strings.

4. **Wire into `frontend/src/pages/Order.jsx`**:
   - `useNavigate()` (already used elsewhere in this codebase, e.g.
     `Checkout.jsx`/`Cart.jsx`).
   - Render the "Đặt lại" / "Order again" button near the items list,
     only when `hasReorderableItems(order.items)`.
   - On click: busy state, call `reorderOrderItems(order)`, then render
     the summary as a fixed-bottom `Link to="/cart"` toast (same visual
     pattern as `Collection.jsx`'s `addedMsg`), built from the
     added-count + skipped list.

5. **Tests**:
   - `frontend/src/shop/reorder.test.js` (new) - see design doc's testing
     section for the full case list.
   - Extend `frontend/src/pages/Order.test.jsx` - button visibility, the
     click → summary → `/cart` link flow, mocking `../shop/reorder` as a
     module.

6. Run `cd frontend && npm test` (full suite) and `npm run lint`, fix
   anything introduced. No backend changes, so the backend suite is not
   expected to need a run, but do one pass anyway per the task
   instructions to confirm nothing backend-side was accidentally touched.
