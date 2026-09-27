# Before/After Transformation Gallery — Design

## Trend angle: portfolio/website-decor

Before/after comparison presentation (progress shots, wig styling,
prop-building, makeup transformation) is one of the most common ways
cosplayers actually show their craft online right now - it's the format
that gets shared, because it makes the amount of work visible in a single
glance instead of buried a few photos deep in an album. This portfolio's
existing album/lightbox viewer treats every photo identically (one slide
at a time, in upload order), so a "before" and "after" photo of the same
piece currently show up as two unrelated slides with no visual link
between them at all. This closes that gap using the album/lightbox
machinery that already exists - no new page, no new upload flow.

## Scope decisions

- **Pairing, not a new photo "type".** Any two existing images already
  uploaded to the same album can be linked as a before/after pair after
  the fact - no separate upload step, no new image-role field beyond the
  pairing itself. This matches how the seller actually works today
  (upload photos to an album via the existing dropzone, then curate).
- **Same album only.** A pair only makes sense as a single visual
  comparison inside one project's album - allowing cross-album pairing
  would need to resolve "which album does the combined slide even belong
  to" for no real benefit.
- **Symmetric on both rows, single admin action.** Setting image A's
  partner to image B sets `A.pair_role='before', A.pair_image_id=B` *and*
  `B.pair_role='after', B.pair_image_id=A` in one request - the lightbox
  needs to resolve the pair starting from either row's sort position, and
  a one-sided link would be a data-integrity trap for the very next unpair/
  re-pair operation.
- **Public rendering fold: two photos → one slide.** `buildAlbumSlides`
  (pure, unit-tested) collapses a resolved pair into a single
  `{ src, pairedSrc }` slide and drops the "after" image from its own
  slot in the array - so the dot-navigation count in the lightbox reflects
  "things to look at", not "individual photos", and the pair always
  appears together, never split across two clicks forward/back.
- **No migration risk beyond one nullable pair.** Two new nullable
  columns on `images` (`pair_role`, `pair_image_id`, self-referencing
  FK with `ON DELETE SET NULL`) - every existing row defaults to
  unpaired, identical rendering to today.
- **Admin UX**: a small `<select>` under each thumbnail in
  `AdminAlbumImages.jsx` (already the per-album image manager), listing
  the album's other images as candidate partners - picking one pairs
  immediately (no separate "save" step, matching the existing
  drag-to-reorder/delete actions on the same screen, which are also
  immediate). Only rendered on an image that isn't already someone's
  "after" - pairing is driven from one side only, so the same link can't
  be described two different ways by two different rows.

## Data model

New migration `049_add_image_pair_columns.js`:

```
images.pair_role       VARCHAR(10) NULL   -- 'before' | 'after' | NULL
images.pair_image_id   INT UNSIGNED NULL  -- FK images.id, ON DELETE SET NULL
```

`ON DELETE SET NULL`, not `CASCADE`: deleting one photo of a pair must
degrade its partner back to an ordinary ungrouped photo, not delete the
partner too.

## API

`PUT /api/images/:id/pair` (admin, `auth` middleware - same as every other
album/image route in `server.js`), body `{ pairedImageId: number | null }`:

- `null` - unlinks `:id` and, if it had one, its former partner too (never
  leaves a one-sided link dangling).
- a number - validates the partner exists, belongs to the *same*
  `album_id`, and isn't `:id` itself; clears any *stale* prior pairing on
  either side first (re-pairing an already-paired image must not leave
  its old partner dangling); then writes both rows symmetrically.
- Invalidates the `gallery` Redis cache on every write, same as every
  other album/image mutation in this file.

`GET /api/gallery`'s existing per-item mapping gains `pairRole`/
`pairImageId` (straight passthrough of the new columns) - both the public
gallery and `AdminAlbumImages.jsx` read this same endpoint, so no second
endpoint or shape is needed.

## Frontend

- `frontend/src/utils/albumSlides.js` (new, pure, unit-tested):
  `buildAlbumSlides(items)` does the two-photos-into-one-slide fold
  described above; `slideSrc`/`slidePairedSrc` normalize a slide (plain
  string, for every existing caller/slide, or the new pair shape) so
  `Lightbox` doesn't need two different code paths for "old" vs "new"
  slides.
- `Portfolio.jsx`'s `buildData` calls `buildAlbumSlides` when building each
  album's `items`; `Lightbox` renders a `pairedSrc` slide as two photos
  side by side with small "Before"/"After" (bilingual) badges instead of
  a single full-bleed image, and preloads both halves of neighbouring
  pair slides the same way it already preloads single photos.
- `AdminAlbumImages.jsx` gets the pairing `<select>` plus a small
  "Trước"/"Sau" badge on a paired thumbnail's corner, and surfaces a
  failed pairing request as an inline error (matching the existing
  delete-failure error handling on the same screen).

## Edge cases

- **Partner deleted after pairing**: `ON DELETE SET NULL` clears the
  surviving image's own columns at the DB level - no dangling id for
  `buildAlbumSlides` to fail to resolve. Also covered defensively in
  `buildAlbumSlides` itself (falls back to a plain slide if `pairImageId`
  doesn't resolve in the passed-in item list, for the interim moment
  before that image's own row is next re-read).
- **Re-pairing an already-paired image**: old partner is explicitly
  unlinked in the same request - no stale one-sided pairing left over
  (covered by a dedicated backend test).
- **Cross-album pairing attempt**: rejected 400 before any write happens.
- **Self-pairing**: rejected 400.
- **Sort order changes after pairing**: `buildAlbumSlides` is
  order-independent by construction (it locates a "before"'s partner by
  id, not by array position) - re-sorting images never breaks an existing
  pair or duplicates a slide.
- **A single-image album, or an album with no pairs at all**: identical
  rendering to before this feature - `buildAlbumSlides` returns exactly
  the same array of bare src strings it always would have.

## Testing approach

- `backend/tests/imagePairing.test.js`: symmetric pairing, cross-album
  rejection, self-pairing rejection, 404 on a missing id, unlinking both
  sides, re-pairing clearing the old partner, and `GET /api/gallery`
  exposing the new fields.
- `frontend/src/utils/albumSlides.test.jsx`: unpaired passthrough, pair
  collapsing to one slide, order-independence, a pair alongside plain
  photos, missing-partner fallback, empty input.
- `frontend/src/components/AdminAlbumImages.test.jsx`: picking a partner
  PUTs the expected body and the badges appear after refetch; a failed
  pairing request surfaces its error message instead of failing silently.
- Full existing backend + frontend suites re-run to confirm no regression
  to the existing gallery/album/lightbox behavior.

## Out of scope

- A dedicated slider/drag-to-compare widget (side-by-side is enough for
  v1; a draggable overlay slider is a much bigger client-side component
  for a nice-to-have interaction, not the core "show the comparison"
  goal).
- Cropping/aligning the two photos to match dimensions - shown at their
  own natural aspect ratio, same as every other photo in the lightbox.
- Bulk/automatic pairing (e.g. by filename convention) - YAGNI until a
  seller has enough of these to make one-at-a-time pairing tedious.
