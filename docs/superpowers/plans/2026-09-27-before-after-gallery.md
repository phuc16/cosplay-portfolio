# Before/After Transformation Gallery Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Small, single-PR feature - one branch, a handful of ordered commits.

**Goal:** Let the admin link two existing photos in the same album as a before/after pair; the public lightbox then renders that pair as one side-by-side comparison slide instead of two separate photos.

**Architecture:** Two new nullable, symmetric columns on `images` (`pair_role`, `pair_image_id`) written by a new `PUT /api/images/:id/pair` route. `GET /api/gallery` passes both through. A new pure helper `frontend/src/utils/albumSlides.js` folds a resolved pair into one slide; `Portfolio.jsx`'s `Lightbox` renders that shape as two photos with Before/After badges; `AdminAlbumImages.jsx` gets the pairing control.

**Tech Stack:** Express/mysql2 + Knex migration (backend), React/Vite (frontend), Vitest + Supertest for both.

## Global Constraints

- Migration only adds nullable columns - no backfill, no behavior change for any existing row.
- Pairing is symmetric - every write updates both rows or neither.
- Same-album validation happens before any write.
- `UTC_TIMESTAMP()`/no date math involved here at all - not applicable to this feature.
- New buyer/visitor-facing copy ("Before"/"After") goes through the existing bilingual pattern already used elsewhere in `Portfolio.jsx` (`lang === "vi" ? ... : ...`), not `translations.js` (that file backs `useLanguage()`'s `t()`, which `Portfolio.jsx` doesn't use - it already inlines `lang === "vi"` checks throughout).
- `redis.del("gallery")` on every pairing write, matching every other album/image mutation.

---

### Task 1: Migration

**Files:**
- Create: `backend/migrations/049_add_image_pair_columns.js`

- [x] Add `pair_role` (string, nullable) and `pair_image_id` (unsigned int, nullable, FK `images.id`, `ON DELETE SET NULL`) to `images`.
- [x] Verify: `npm run migrate` against a fresh `cosplay_test` DB applies cleanly.

### Task 2: Backend - pairing endpoint

**Files:**
- Modify: `backend/server.js`

- [x] Add `PUT /api/images/:id/pair` (auth-gated): validates the target image exists, then either unlinks (both sides) when `pairedImageId` is `null`, or validates the partner (exists, same album, not self), clears stale prior pairing on either side, and writes both rows symmetrically.
- [x] Add `pairRole`/`pairImageId` to `GET /api/gallery`'s per-item mapping.
- [x] `invalidateGallery()` on every successful pairing write.

### Task 3: Backend tests

**Files:**
- Create: `backend/tests/imagePairing.test.js`

- [x] Symmetric pairing sets both rows correctly.
- [x] Rejects cross-album pairing (400).
- [x] Rejects self-pairing (400).
- [x] 404s on a missing image id.
- [x] Unlinks both sides when `pairedImageId` is `null`.
- [x] Re-pairing clears the old partner's pairing.
- [x] `GET /api/gallery` exposes `pairRole`/`pairImageId`.

### Task 4: Frontend - pure slide-building helper

**Files:**
- Create: `frontend/src/utils/albumSlides.js`
- Create: `frontend/src/utils/albumSlides.test.jsx`

- [x] `buildAlbumSlides(items)`: collapses a resolved before/after pair into `{ src, pairedSrc }`, order-independent, falls back to a plain slide when the partner doesn't resolve.
- [x] `slideSrc`/`slidePairedSrc` normalizers for a mixed string/object slide array.
- [x] Tests: unpaired passthrough, pair collapsing, order-independence, mixed with plain photos, missing-partner fallback, empty input.

### Task 5: Frontend - Lightbox + admin UI

**Files:**
- Modify: `frontend/src/pages/Portfolio.jsx`
- Modify: `frontend/src/components/AdminAlbumImages.jsx`
- Modify: `frontend/src/components/AdminAlbumImages.test.jsx`

- [x] `buildData` builds each album's `items` via `buildAlbumSlides`.
- [x] `Lightbox` accepts a `vi` prop and renders a `pairedSrc` slide as two photos with "Trước"/"Before" and "Sau"/"After" badges; preloads both halves of neighbouring pair slides.
- [x] `AdminAlbumImages.jsx`: a "Trước"/"Sau" badge on a paired thumbnail; a `<select>` (hidden on an "after" image) to pick/clear a partner, wired to the new endpoint; inline error on a failed pairing request.
- [x] Tests: picking a partner PUTs the expected body and badges appear after refetch; a failed request surfaces its error.

### Task 6: Verify

- [x] `backend`: `npx vitest run tests/imagePairing.test.js` - 7 passed.
- [x] `backend`: full suite - no new failures vs. baseline (same 6 pre-existing MinIO-dependent failures + 1 pre-existing flaky `worker.test.js` case, both unrelated).
- [x] `frontend`: `npx vitest run src/utils/albumSlides.test.jsx src/components/AdminAlbumImages.test.jsx` - all passed.
- [x] `frontend`: full suite - 788/788 passed.
- [x] `frontend`: `npm run lint` - no new errors (confirmed the extraction into `albumSlides.js` avoids a `react-refresh/only-export-components` error that an inline export from `Portfolio.jsx` would have introduced).
