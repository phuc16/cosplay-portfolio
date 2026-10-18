# Sub-albums and album-image watermark - Design

Date: 2026-10-18

## Goals

1. Each portfolio album can contain sub-albums, shown to visitors as a card grid in the style of the shop's product cards (cover, name, photo count).
2. Every image uploaded into an album or sub-album is watermarked using the shop's existing watermark format.

## Decisions

- **Click behavior:** an album with sub-albums drills into a sub-album card grid; clicking a sub-album opens its photos in the lightbox. An album without sub-albums opens the lightbox directly, as today.
- **Watermark scope:** new uploads only. Existing images are not re-stamped (originals are not kept; re-stamping would double-mark).
- **Sub-album cover:** always the sub-album's first photo (follows reorder). No override, no separate upload.
- **Depth:** exactly one level. A sub-album cannot have children.
- **Mixed content:** an album may hold direct photos and sub-albums at the same time.
- **Approach:** self-referencing `albums.parent_id` (rejected: separate `sub_albums` table, image tags).
- This reverses the earlier "watermark declined for now" decision; log it in `docs/DECISIONS.md`.

## Data model

Migration `backend/migrations/050_add_album_parent.js`:

- `albums.parent_id` INT UNSIGNED NULL, FK to `albums.id`, `ON DELETE CASCADE`, indexed.
- `down` drops the FK, index, and column.
- Existing rows keep `parent_id = NULL`; no data migration.

Invariants (enforced server-side, 400 `invalid_input` on violation):

- `parent_id`, when set, references an existing album whose own `parent_id IS NULL`.
- An album that has sub-albums cannot be given a `parent_id`.
- An album cannot be its own parent.
- `sort_order` is per sibling set. A new album/sub-album gets `MAX(sort_order)+1` among its siblings (same `parent_id`, with NULL treated as the top-level set).

## Backend

`backend/server.js` (albums routes), `backend/shop/images.js`, new shared watermark module.

- `POST /albums` accepts optional `parent_id`; validates per invariants; computes sibling-scoped `sort_order`.
- `PUT /albums/:id` updates `title`/`description`; `parent_id` is not editable (no re-parenting in v1).
- `GET /albums` (admin) returns all rows including `parent_id`.
- `PUT /albums/reorder` only accepts ids that share one `parent_id`; mixed sets are rejected with 400.
- `DELETE /albums/:id` cascades to sub-albums and their images (DB FKs). MinIO objects are handled as they are today for album delete.
- `PUT /image/:id` may move a photo to any album or sub-album id that exists.
- `GET /gallery` returns top-level albums only:
  `{ id, group, description, items: [...direct photos], subAlbums: [{ id, title, description, cover, count, items }] }`.
  `cover` is the first photo's `src` (or `null` if the sub-album is empty; empty sub-albums are still returned). Redis key `gallery`, 1h TTL, and `invalidateGallery()` on every album/image write are unchanged. Deploy flushes the `gallery` key so no stale-shape payload is served; the frontend also treats a missing `subAlbums` as `[]`.

### Watermark

- Move `escapeXml`, `watermarkSvg`, and a new `applyWatermark(webpBuffer, { text })` out of `shop/images.js` into `backend/watermark.js`. `shop/images.js` imports it; shop behavior and output stay byte-for-byte equivalent (existing `shopImages.test.js` must keep passing unchanged).
- Format is the shop's: `SHOP_NAME` (fallback `"Shop"`) tiled diagonally, rotated -30°, `fill-opacity 0.18` white, WebP quality 82 re-encode.
- In `server.js`, `processImage(buffer, { watermark = false })`. Only `POST /image` passes `watermark: true`. `/upload/hero`, `/upload/thumbnail`, `/upload/event-image` are not watermarked.
- Alpha channel is preserved (WebP). The tiled text is composited over the whole frame like the shop's, so fully transparent areas receive faint text too; this is intended (it cannot be cropped or erased out of cutouts).
- The worker's 400px thumbnail generation derives from the stored (already watermarked) image, so thumbnails carry the mark; no worker change required (verify in plan).

## Public UI

`frontend/src/pages/Portfolio.jsx` (`buildData`, `ProjectSection`).

- `buildData` maps `subAlbums` (default `[]`); album card count = direct photos + all sub-album photos.
- Album with `subAlbums.length > 0`: clicking opens a drill-in view inside the Projects section with a back control, the album title, a sub-album card grid (cover, title, "N ảnh"/"N photos"), and any direct photos below (opening the lightbox on click).
- Sub-album card click opens the lightbox on that sub-album's `items`. Empty sub-albums render a placeholder cover and are not clickable.
- Reuses the existing `.album-grid` breakpoints and card styling tokens; no new design tokens. Bilingual copy via existing `lang` handling.
- Album without sub-albums: unchanged behavior.

## Admin UI

`AdminAlbums.jsx`, `AdminAlbumForm.jsx`, `AdminAlbumImages.jsx`.

- Album list shows sub-albums nested/indented under their parent.
- "Add sub-album" action on top-level albums reuses `AdminAlbumForm` with `parent_id`.
- Sub-albums support edit, delete (confirm text warns that photos are deleted), photo upload, photo reorder, and sibling reorder.
- No "Add sub-album" on sub-albums.
- Delete-album confirm mentions the number of sub-albums that will also be removed.

## Error handling

- Invalid `parent_id` / depth violations / mixed-parent reorder: 400 `invalid_input` with a Vietnamese message, consistent with existing handlers.
- Watermark or image-decode failures keep the existing mapping: `InvalidImageError` to 400, anything else to 500.
- Redis outage: gallery read degrades to DB as today.

## Testing

Backend (vitest, real MySQL/Redis, per CLAUDE.md; do not run concurrent suites):

- Migration up/down; cascade delete of sub-albums and images.
- Create with valid/invalid `parent_id` (missing, nested, self, parent with children becoming child).
- Sibling-scoped `sort_order` and reorder rejection for mixed parents.
- `/gallery` nesting shape, cover = first photo, count, empty sub-album, cache invalidation on sub-album/image writes, absence of sub-albums on legacy albums.
- Watermark: `/image` output differs from the same input processed without watermark; hero/thumbnail/event outputs do not; shop `processShopImage` output unchanged after the extraction; alpha preserved.

Frontend (vitest):

- `Portfolio`: album without subs opens lightbox; with subs shows drill-in, counts, back, sub-album click, empty-sub state, missing `subAlbums` tolerance.
- Admin: nested list, add sub-album, no add on sub-albums, delete confirm text, reorder within siblings.

Plus lint and production build clean.

## Out of scope

Nesting deeper than one level, re-parenting an existing album, separate cover upload or cover override, retro-stamping existing images, per-album watermark toggle.

## Docs

Add a `docs/DECISIONS.md` entry (watermark reversal, one-level depth, first-photo cover, new-uploads-only) and update `CLAUDE.md` architecture notes (gallery shape, `backend/watermark.js`).
