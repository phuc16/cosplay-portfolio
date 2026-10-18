# Sub-albums and Album-Image Watermark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portfolio albums can contain one level of sub-albums (shop-card-style drill-in grid on the public page, nested list in admin), and every image uploaded to an album/sub-album is stamped with the shop's tiled `SHOP_NAME` watermark.

**Architecture:** A nullable self-referencing `albums.parent_id` (depth capped at 1 in server code). `GET /api/gallery` returns top-level albums each carrying `subAlbums`. The shop's watermark SVG/composite code moves into a shared `backend/watermark.js` used by both `shop/images.js` and the portfolio `POST /api/image` route. Frontend gains a `ProjectAlbums`/`SubAlbumGrid` component pair (public) and a nested admin list.

**Tech Stack:** Node/Express, MySQL + Knex migrations (no ORM), Redis, sharp, vitest + supertest (real MySQL/Redis), React 19 + Vite, vitest (jsdom), Tailwind classes in admin, inline CSS-var styles in `Portfolio.jsx`.

Spec: `docs/superpowers/specs/2026-10-18-sub-albums-watermark-design.md`

## Global Constraints

- Depth is exactly one level; a sub-album cannot have children. No re-parenting: `PUT /api/albums/:id` never changes `parent_id`.
- Watermark = shop format: `SHOP_NAME` (fallback `"Shop"`), tiled diagonally, rotate -30deg, white `fill-opacity 0.18`, WebP `quality 82, effort 4`. Applied ONLY on `POST /api/image`. `/api/upload/hero`, `/api/upload/thumbnail`, `/api/upload/event-image` stay unwatermarked. Existing images are not re-stamped.
- Sub-album cover is always the first photo's `src` (thumb or full); no override or separate upload.
- `GET /api/gallery` contract (both frontend owners code against this exactly):

```
[{ id, group, description,
   items: [Item],                      // direct photos only
   subAlbums: [{ id, title, description, cover: string|null, count: number, items: [Item] }] }]
Item = { id, src, fullSrc, width, height }
```

  Frontend treats a missing `subAlbums` as `[]`.
- `GET /api/albums` (admin, flat) returns every row including `parent_id` (null for top-level), ordered `sort_order ASC, id ASC`.
- Invalid input: HTTP 400, body `{ error: "invalid_input", message: <Vietnamese> }`.
- Redis key `gallery` (1h TTL); every album/image write calls `invalidateGallery()`.
- Code style (user CLAUDE.md): no inline comments on self-documenting code, no zero-arg factory functions, match surrounding comment density. Date math n/a here.
- Migrations are sequential and never edited after landing: new file `050_add_album_parent.js`.
- Commit messages: detailed body, **no `Co-Authored-By` trailer** (user preference overrides the default attribution). Never `git push`.
- Backend tests use the real `cosplay_test` MySQL + Redis DB 15 and **must never run concurrently**: always run them through the lock script (see Team Execution).
- Definition of done per task: its tests pass, `npm run lint` clean for frontend tasks (backend has no linter), no failing build.

## File Structure

| File | Owner | Responsibility |
|---|---|---|
| `backend/migrations/050_add_album_parent.js` | api | add `albums.parent_id` + FK + index |
| `backend/albums.js` (new) | api | `AlbumInputError`, `resolveParentId`, `nextSortOrder`, `assertSameParent`, `buildGallery` |
| `backend/server.js` | api | thin routes using `albums.js`; wire watermark into `POST /image`; startup gallery flush |
| `backend/tests/albumParentSchema.test.js`, `albumsRoutes.test.js`, `galleryNesting.test.js`, `albumImageWatermark.test.js` (new) | api | DB/route tests |
| `backend/watermark.js` (new) | wm | `escapeXml`, `watermarkSvg`, `applyWatermark` |
| `backend/shop/images.js` | wm | import shared watermark; behavior unchanged |
| `backend/worker.js` | wm | add `processImage` to exports only |
| `backend/tests/watermark.test.js`, `workerThumbnailWatermark.test.js` (new), `shopImages.test.js` (extend) | wm | |
| `docs/DECISIONS.md`, `CLAUDE.md` | wm | decision entry + architecture notes (last task) |
| `frontend/src/pages/portfolioAlbums.js` (new) + `.test.js` | pub | `buildAlbums(gallery)` adapter |
| `frontend/src/components/portfolio/SubAlbumGrid.jsx`, `ProjectAlbums.jsx` (new) + tests | pub | drill-in view / album grid |
| `frontend/src/pages/Portfolio.jsx` | pub | use `buildAlbums` + `ProjectAlbums` |
| `frontend/src/components/albumTree.js` (new) + test | adm | `buildAlbumTree`, `findGalleryAlbum` |
| `frontend/src/components/AdminAlbums.jsx`, `AdminAlbumForm.jsx`, `AdminAlbumImages.jsx` + tests | adm | nested admin UI |

## Team Execution (lead only; see end of document for spawn details)

Roster: `api`, `wm`, `pub`, `adm`. Dependencies: api-5 needs wm-1. wm-5 (docs) needs api-6, pub-6, adm-6. Everything else is independent (frontend codes against the contract above with mocked HTTP).

---

# Teammate `wm` - watermark module (5 tasks)

### Task wm-1: Shared `watermark.js`

**Files:**
- Create: `backend/watermark.js`
- Create: `backend/tests/watermark.test.js`

**Interfaces:**
- Produces: `applyWatermark(webpBuffer: Buffer, opts?: { text?: string }): Promise<Buffer>` (WebP in, WebP out, same dimensions, default text `process.env.SHOP_NAME || "Shop"`); `watermarkSvg(text, width, height): Buffer`; `escapeXml(s): string`.

- [ ] **Step 1: Write the failing test** - `backend/tests/watermark.test.js`

```js
import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { applyWatermark, watermarkSvg, escapeXml } from "../watermark.js"

async function solidWebp(width, height, { alpha = false } = {}) {
  return sharp({
    create: {
      width, height, channels: alpha ? 4 : 3,
      background: alpha ? { r: 200, g: 40, b: 120, alpha: 0 } : { r: 200, g: 40, b: 120 },
    },
  }).webp({ quality: 82 }).toBuffer()
}

async function maxGreenDeviation(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let max = 0
  for (let i = 1; i < data.length; i += info.channels) max = Math.max(max, Math.abs(data[i] - 40))
  return max
}

describe("applyWatermark", () => {
  it("returns webp with the same dimensions", async () => {
    const out = await applyWatermark(await solidWebp(400, 300), { text: "Kami" })
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe("webp")
    expect([meta.width, meta.height]).toEqual([400, 300])
  })

  it("visibly changes the pixels", async () => {
    const src = await solidWebp(400, 400)
    expect(await maxGreenDeviation(src)).toBeLessThan(8)
    const out = await applyWatermark(src, { text: "Kami" })
    expect(await maxGreenDeviation(out)).toBeGreaterThan(20)
  })

  it("uses SHOP_NAME when no text is given and falls back to Shop", async () => {
    const prev = process.env.SHOP_NAME
    try {
      process.env.SHOP_NAME = "Alpha"
      const a = await applyWatermark(await solidWebp(400, 400))
      process.env.SHOP_NAME = "Omega Omega"
      const b = await applyWatermark(await solidWebp(400, 400))
      expect(a.equals(b)).toBe(false)
      delete process.env.SHOP_NAME
      const c = await applyWatermark(await solidWebp(400, 400))
      const d = await applyWatermark(await solidWebp(400, 400), { text: "Shop" })
      expect(c.equals(d)).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.SHOP_NAME
      else process.env.SHOP_NAME = prev
    }
  })

  it("keeps the alpha channel", async () => {
    const out = await applyWatermark(await solidWebp(300, 300, { alpha: true }), { text: "Kami" })
    expect((await sharp(out).metadata()).hasAlpha).toBe(true)
  })

  it("does not throw on tiny images", async () => {
    const out = await applyWatermark(await solidWebp(8, 8), { text: "Kami" })
    expect((await sharp(out).metadata()).width).toBe(8)
  })
})

describe("escapeXml / watermarkSvg", () => {
  it("escapes markup characters", () => {
    expect(escapeXml(`<a&"b'>`)).toBe("&lt;a&amp;&quot;b&apos;&gt;")
  })

  it("never lets shop-name markup into the svg", () => {
    expect(watermarkSvg("<script>", 400, 400).toString()).not.toContain("<script>")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run (through the lock script): `$LOCK vitest run tests/watermark.test.js`
Expected: FAIL, cannot resolve `../watermark.js`.

- [ ] **Step 3: Implement** - `backend/watermark.js` (the SVG code is moved verbatim from `backend/shop/images.js`)

```js
const sharp = require("sharp")

const WEBP_QUALITY = 82

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]))
}

/**
 * The shop name tiled diagonally across the whole photo, low-opacity. Harder
 * to crop out than a single corner tag since removing it means cloning out
 * text from the middle of the subject, not just cropping an edge. Tiles are
 * generated in an unrotated grid sized to the image's diagonal, then the
 * whole grid is rotated around the image center -- that way corners still
 * get full coverage after rotation instead of being clipped.
 */
function watermarkSvg(text, width, height) {
  const label = escapeXml(text)
  const fontSize = Math.max(14, Math.round(width * 0.035))
  const diag = Math.ceil(Math.sqrt(width * width + height * height))
  const spacingX = Math.round(fontSize * (label.length * 0.62 + 5))
  const spacingY = Math.round(fontSize * 3.5)
  const cols = Math.ceil(diag / spacingX) + 2
  const rows = Math.ceil(diag / spacingY) + 2

  let tiles = ""
  for (let r = 0; r < rows; r++) {
    const y = r * spacingY - diag / 2
    const rowOffset = (r % 2) * (spacingX / 2)
    for (let c = 0; c < cols; c++) {
      const x = c * spacingX - diag / 2 + rowOffset
      tiles += `<text x="${x}" y="${y}" font-family="sans-serif" font-size="${fontSize}" ` +
        `fill="white" fill-opacity="0.18" text-anchor="middle">${label}</text>`
    }
  }

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(${width / 2},${height / 2}) rotate(-30)">${tiles}</g>
    </svg>
  `)
}

/** Stamp the tiled name over an already-encoded WebP and re-encode it. */
async function applyWatermark(webpBuffer, { text = process.env.SHOP_NAME || "Shop" } = {}) {
  const { width, height } = await sharp(webpBuffer).metadata()
  return sharp(webpBuffer)
    .composite([{ input: watermarkSvg(text, width, height), top: 0, left: 0 }])
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer()
}

module.exports = { applyWatermark, watermarkSvg, escapeXml }
```

- [ ] **Step 4: Run to verify it passes**

Run: `$LOCK vitest run tests/watermark.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/watermark.js backend/tests/watermark.test.js
git commit -m "feat(watermark): extract shared tiled-name watermark module" -m "applyWatermark/watermarkSvg/escapeXml live in backend/watermark.js so portfolio uploads can reuse the shop's exact watermark format. Tests cover dimensions, visible pixel change, SHOP_NAME fallback, alpha, tiny images and markup escaping." -- backend/watermark.js backend/tests/watermark.test.js
```

### Task wm-2: `shop/images.js` uses the shared module

**Files:**
- Modify: `backend/shop/images.js` (remove local `escapeXml`/`watermarkSvg`, import `applyWatermark`)
- Modify: `backend/tests/shopImages.test.js`

**Interfaces:**
- Consumes: `applyWatermark` from wm-1.
- Produces: `processShopImage(buffer, { watermark })` unchanged signature and behavior.

- [ ] **Step 1: Write the failing test** - append to `backend/tests/shopImages.test.js` (add `import { applyWatermark } from "../watermark.js"` at the top)

```js
describe("processShopImage watermark delegates to the shared module", () => {
  it("equals applyWatermark(plain output) byte-for-byte", async () => {
    const input = await pngFixture(500, 400)
    const plain = await processShopImage(input)
    const marked = await processShopImage(input, { watermark: true })
    const expected = await applyWatermark(plain, { text: process.env.SHOP_NAME || "Shop" })
    expect(marked.equals(expected)).toBe(true)
  })
})
```

- [ ] **Step 2: Run** `$LOCK vitest run tests/shopImages.test.js` - Expected: this new test PASSES or FAILS depending on encode determinism of the old inline code; record the result. Existing tests must be green before the refactor.

- [ ] **Step 3: Refactor** - in `backend/shop/images.js`: delete the local `escapeXml` and `watermarkSvg` functions, add `const { applyWatermark } = require("../watermark")` next to the other requires, and replace the tail of `processShopImage`:

```js
  const data = await pipeline.webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer()
  if (!watermark) return data

  return applyWatermark(data, { text: process.env.SHOP_NAME || "Shop" })
}
```

(`sharp` stays imported; it is still used above. Update the JSDoc above `processShopImage` only if it mentions the removed helpers.)

- [ ] **Step 4: Run** `$LOCK vitest run tests/shopImages.test.js tests/imageValidation.test.js tests/adminCatalogRoutes.test.js` - Expected: all PASS, including the original corner-mark tests.

- [ ] **Step 5: Commit**

```bash
git add backend/shop/images.js backend/tests/shopImages.test.js
git commit -m "refactor(shop): reuse shared watermark module in processShopImage" -m "Removes the duplicated SVG tiling code; shop output is unchanged (asserted byte-equal against applyWatermark of the plain encode)." -- backend/shop/images.js backend/tests/shopImages.test.js
```

### Task wm-3: Watermark edge cases

**Files:** Modify `backend/tests/watermark.test.js`

- [ ] **Step 1: Write tests** - append:

```js
describe("applyWatermark edge cases", () => {
  it("handles very wide and very tall images", async () => {
    for (const [w, h] of [[1920, 200], [200, 1920]]) {
      const out = await applyWatermark(await solidWebp(w, h), { text: "Kami" })
      const meta = await sharp(out).metadata()
      expect([meta.width, meta.height]).toEqual([w, h])
    }
  })

  it("handles long and non-ASCII names", async () => {
    const out = await applyWatermark(await solidWebp(600, 600), { text: "Kamidayhehe Ảnh Cosplay <3 & co" })
    expect((await sharp(out).metadata()).format).toBe("webp")
  })

  it("is not idempotent-safe by design: stamping twice changes pixels again", async () => {
    const once = await applyWatermark(await solidWebp(400, 400), { text: "Kami" })
    const twice = await applyWatermark(once, { text: "Kami" })
    expect(twice.equals(once)).toBe(false)
  })
})
```

- [ ] **Step 2-4:** Run `$LOCK vitest run tests/watermark.test.js` - Expected: PASS. If a case fails, fix `backend/watermark.js` (owned by you) and re-run.
- [ ] **Step 5: Commit** `git commit -m "test(watermark): cover extreme aspect ratios, long/unicode names, double stamping" -- backend/tests/watermark.test.js`

### Task wm-4: Worker thumbnails inherit the mark

**Files:**
- Modify: `backend/worker.js:198` (export `processImage`)
- Create: `backend/tests/workerThumbnailWatermark.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, afterEach, vi } from "vitest"
import sharp from "sharp"
import storage from "../storage.js"
import { applyWatermark } from "../watermark.js"
import { processImage } from "../worker.js"
import { closeDb } from "./helpers/db.js"
import redis from "../redis.js"

afterEach(() => vi.restoreAllMocks())

async function greenDeviation(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let max = 0
  for (let i = 1; i < data.length; i += info.channels) max = Math.max(max, Math.abs(data[i] - 40))
  return max
}

describe("worker thumbnail of a watermarked album image", () => {
  it("still carries the watermark", async () => {
    const plain = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: { r: 200, g: 40, b: 120 } } }).webp().toBuffer()
    const stamped = await applyWatermark(plain, { text: "Kamidayhehe" })
    let uploaded
    vi.spyOn(storage, "getBuffer").mockResolvedValue(stamped)
    vi.spyOn(storage, "upload").mockImplementation(async (_key, buf) => { uploaded = buf })

    await processImage({ id: 999999, album_id: 1, url: "/api/storage/images/1/x.webp" })

    expect(await greenDeviation(uploaded)).toBeGreaterThan(10)
  })
})

import { afterAll } from "vitest"
afterAll(async () => { await redis.quit(); await closeDb() })
```

(Move the `afterAll` import to the top import line when you write the file; shown separately here only for clarity.)

- [ ] **Step 2: Run** `$LOCK vitest run tests/workerThumbnailWatermark.test.js` - Expected: FAIL, `processImage is not a function`.
- [ ] **Step 3: Implement** - change the last line of `backend/worker.js` to `module.exports = { run, sweepExpiredOrders, dispatchEmails, warnIfMailStuckUnconfigured, tick, lease, processImage }`.
- [ ] **Step 4: Run** the same command - Expected: PASS. If the thumbnail deviation is below 10 because 1200px to 400px shrinks the tiles too much, lower the threshold to the smallest value that still fails on an unmarked input (prove it by also asserting the unmarked thumbnail stays `< 5`).
- [ ] **Step 5: Commit** `git commit -m "test(worker): prove thumbnails derive from the watermarked original" -m "Exports processImage from worker.js (test seam only, no behavior change)." -- backend/worker.js backend/tests/workerThumbnailWatermark.test.js`

### Task wm-5: Docs (BLOCKED until api-6, pub-6, adm-6 are done)

**Files:** Modify `docs/DECISIONS.md`, `CLAUDE.md`

- [ ] **Step 1:** Read the top of `docs/DECISIONS.md` and follow its exact entry format and ordering. Add an entry dated `2026-10-18` titled "Portfolio sub-albums (one level) and watermark on new album uploads" recording: (a) watermark reverses the earlier "watermark declined for now" decision; applies to `POST /api/image` only, new uploads only, hero/thumbnail/event unwatermarked, existing images not re-stamped (originals not kept); (b) `albums.parent_id`, depth capped at 1, no re-parenting; (c) cover = first photo only; an album with only sub-albums uses its first sub-album's cover and its card count includes sub-album photos; (d) rejected alternatives: separate `sub_albums` table, image tags, serve-time stamping.
- [ ] **Step 2:** In `CLAUDE.md`: update the Caching paragraph to say `GET /api/gallery` returns top-level albums with nested `subAlbums` (cache flushed on server start); the Image upload flow paragraph to add "portfolio album photos are additionally watermarked via `backend/watermark.js` (shared with the shop)"; add `backend/watermark.js` and `backend/albums.js` rows to the Key Files table.
- [ ] **Step 3:** Run `git diff docs/DECISIONS.md CLAUDE.md` and check accuracy against the merged code.
- [ ] **Step 4: Commit** `git commit -m "docs: log sub-albums + watermark decision, update architecture notes" -- docs/DECISIONS.md CLAUDE.md`

---

# Teammate `api` - schema, routes, gallery (6 tasks)

### Task api-1: Migration `050_add_album_parent.js`

**Files:**
- Create: `backend/migrations/050_add_album_parent.js`
- Create: `backend/tests/albumParentSchema.test.js`

**Interfaces:** Produces column `albums.parent_id INT UNSIGNED NULL`, FK `fk_albums_parent` to `albums.id` `ON DELETE CASCADE`, index `idx_albums_parent_sort(parent_id, sort_order)`.

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect, afterAll } from "vitest"
import db from "../db.js"
import redis from "../redis.js"
import { closeDb } from "./helpers/db.js"

afterAll(async () => { await redis.quit(); await closeDb() })

describe("albums.parent_id", () => {
  it("is a nullable column", async () => {
    const [[col]] = await db.query(
      "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'albums' AND COLUMN_NAME = 'parent_id'"
    )
    expect(col.IS_NULLABLE).toBe("YES")
  })

  it("has a cascading self-referencing foreign key", async () => {
    const [[fk]] = await db.query(
      "SELECT DELETE_RULE, REFERENCED_TABLE_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'albums' AND CONSTRAINT_NAME = 'fk_albums_parent'"
    )
    expect(fk.DELETE_RULE).toBe("CASCADE")
    expect(fk.REFERENCED_TABLE_NAME).toBe("albums")
  })

  it("has the sibling-order index", async () => {
    const [rows] = await db.query("SHOW INDEX FROM albums WHERE Key_name = 'idx_albums_parent_sort'")
    expect(rows.map((r) => r.Column_name)).toEqual(["parent_id", "sort_order"])
  })
})
```

- [ ] **Step 2:** `$LOCK vitest run tests/albumParentSchema.test.js` - Expected: FAIL (globalSetup only migrates files that exist, so the column is missing).
- [ ] **Step 3: Migration**

```js
/**
 * Sub-albums: a nullable self-reference, capped at one level by the route
 * layer (albums.js resolveParentId), not by the schema. The column and its
 * index land first and the FK second so MySQL reuses idx_albums_parent_sort
 * as the FK's backing index instead of auto-creating a duplicate.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable("albums", (table) => {
    table.integer("parent_id").unsigned().nullable()
    table.index(["parent_id", "sort_order"], "idx_albums_parent_sort")
  })
  await knex.schema.alterTable("albums", (table) => {
    table.foreign("parent_id", "fk_albums_parent").references("id").inTable("albums").onDelete("CASCADE")
  })
}

exports.down = async function (knex) {
  await knex.schema.alterTable("albums", (table) => {
    table.dropForeign("parent_id", "fk_albums_parent")
  })
  await knex.schema.alterTable("albums", (table) => {
    table.dropIndex(["parent_id", "sort_order"], "idx_albums_parent_sort")
    table.dropColumn("parent_id")
  })
}
```

- [ ] **Step 4:** `$LOCK vitest run tests/albumParentSchema.test.js` - Expected: PASS. Then verify `down`: under the lock run `cd backend && DB_NAME=cosplay_test npx knex migrate:down` (expect it to report 050 reverted), then `DB_NAME=cosplay_test npx knex migrate:latest` (expect 050 re-applied). Add the DB host/port/user/pass env from CLAUDE.md if `.env` does not supply them.
- [ ] **Step 5: Commit** `git commit -m "feat(albums): add parent_id for one-level sub-albums" -m "Self-referencing FK with ON DELETE CASCADE plus a (parent_id, sort_order) index. Down migration verified by migrate:down then migrate:latest on cosplay_test." -- backend/migrations/050_add_album_parent.js backend/tests/albumParentSchema.test.js`

### Task api-2: `albums.js` helpers and create/update routes

**Files:**
- Create: `backend/albums.js`
- Modify: `backend/server.js` (the `POST /albums` and `PUT /albums/:id` handlers, lines ~726-782)
- Create: `backend/tests/albumsRoutes.test.js`

**Interfaces:**
- Produces from `albums.js`: `class AlbumInputError extends Error`; `resolveParentId(raw): Promise<number|null>` (null for undefined/null/""; throws `AlbumInputError` for non-positive-integer, missing parent, or parent that is itself a sub-album); `nextSortOrder(parentId: number|null): Promise<number>`; `assertSameParent(ids: Array<number|string>): Promise<void>`; `buildGallery(albums, images)` (api-4).

- [ ] **Step 1: Failing tests** - `backend/tests/albumsRoutes.test.js`

```js
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import redis from "../redis.js"
import { resetTables, closeDb } from "./helpers/db.js"

const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)
const createAlbum = (body) => authed(request(app).post("/api/albums")).send(body)
const row = async (id) => (await db.query("SELECT * FROM albums WHERE id=?", [id]))[0][0]

beforeEach(async () => { await resetTables("images", "albums") })
afterAll(async () => { await redis.quit(); await closeDb() })

describe("POST /api/albums with parent_id", () => {
  it("creates top-level albums with NULL parent and increasing sort_order", async () => {
    const a = (await createAlbum({ title: "A" })).body.id
    const b = (await createAlbum({ title: "B" })).body.id
    expect((await row(a)).parent_id).toBeNull()
    expect([(await row(a)).sort_order, (await row(b)).sort_order]).toEqual([1, 2])
  })

  it("creates a sub-album with sibling-scoped sort_order", async () => {
    const parent = (await createAlbum({ title: "P" })).body.id
    await createAlbum({ title: "Other top" })
    const s1 = (await createAlbum({ title: "S1", parent_id: parent })).body.id
    const s2 = (await createAlbum({ title: "S2", parent_id: parent })).body.id
    expect((await row(s1)).parent_id).toBe(parent)
    expect([(await row(s1)).sort_order, (await row(s2)).sort_order]).toEqual([1, 2])
  })

  it("rejects a parent that does not exist", async () => {
    const res = await createAlbum({ title: "X", parent_id: 99999 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("rejects nesting a sub-album under a sub-album", async () => {
    const parent = (await createAlbum({ title: "P" })).body.id
    const sub = (await createAlbum({ title: "S", parent_id: parent })).body.id
    const res = await createAlbum({ title: "SS", parent_id: sub })
    expect(res.status).toBe(400)
  })

  it.each(["abc", -1, 0, 1.5, "1; DROP TABLE albums"])("rejects malformed parent_id %j", async (bad) => {
    const res = await createAlbum({ title: "X", parent_id: bad })
    expect(res.status).toBe(400)
  })

  it("treats null and empty-string parent_id as top-level", async () => {
    for (const p of [null, ""]) {
      const id = (await createAlbum({ title: "T", parent_id: p })).body.id
      expect((await row(id)).parent_id).toBeNull()
    }
  })
})

describe("PUT /api/albums/:id", () => {
  it("never changes parent_id", async () => {
    const p1 = (await createAlbum({ title: "P1" })).body.id
    const p2 = (await createAlbum({ title: "P2" })).body.id
    const sub = (await createAlbum({ title: "S", parent_id: p1 })).body.id
    const res = await authed(request(app).put(`/api/albums/${sub}`)).send({ title: "S2", description: "d", parent_id: p2 })
    expect(res.status).toBe(200)
    const r = await row(sub)
    expect([r.title, r.parent_id]).toEqual(["S2", p1])
  })
})
```

- [ ] **Step 2:** `$LOCK vitest run tests/albumsRoutes.test.js` - Expected: FAIL (parent_id ignored, no validation).
- [ ] **Step 3: Implement** - `backend/albums.js`:

```js
const db = require("./db")

class AlbumInputError extends Error {
  constructor(message) {
    super(message)
    this.name = "AlbumInputError"
  }
}

function parsePositiveInt(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 && String(value).trim() === String(n) ? n : null
}

async function resolveParentId(raw) {
  if (raw === undefined || raw === null || raw === "") return null
  const id = parsePositiveInt(raw)
  if (id === null) throw new AlbumInputError("parent_id không hợp lệ.")
  const [[parent]] = await db.query("SELECT id, parent_id FROM albums WHERE id=?", [id])
  if (!parent) throw new AlbumInputError("Album cha không tồn tại.")
  if (parent.parent_id !== null) throw new AlbumInputError("Album con không thể chứa album con.")
  return id
}

async function nextSortOrder(parentId) {
  const [[{ nextOrder }]] = await db.query(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM albums WHERE parent_id <=> ?",
    [parentId]
  )
  return nextOrder
}

module.exports = { AlbumInputError, resolveParentId, nextSortOrder }
```

In `backend/server.js`: add `const { AlbumInputError, resolveParentId, nextSortOrder, assertSameParent, buildGallery } = require("./albums")` near the other requires at the top (the last two are added by api-3/api-4; add them to the import in those tasks). Replace the `POST /albums` body:

```js
app.post(`${API_PREFIX}/albums`, auth, async (req, res) => {
  try {
    const { title, description } = req.body
    const parentId = await resolveParentId(req.body.parent_id)
    const nextOrder = await nextSortOrder(parentId)
    const [r] = await db.query(
      "INSERT INTO albums(title, description, sort_order, parent_id) VALUES(?,?,?,?)",
      [title || "Untitled", description || null, nextOrder, parentId]
    )
    invalidateGallery()
    console.log(`[ALBUMS] Created: ${title || "Untitled"} (id=${r.insertId}${parentId ? `, parent=${parentId}` : ""})`)
    res.json({ ok: true, id: r.insertId })
  } catch (err) {
    if (err instanceof AlbumInputError) {
      return res.status(400).json({ error: "invalid_input", message: err.message })
    }
    console.error("[ALBUMS] Lỗi create:", err)
    res.status(500).json({ error: "server_error", message: "Không tạo được album." })
  }
})
```

`PUT /albums/:id` needs no code change (it only sets title/description); the test pins that behavior.

- [ ] **Step 4:** `$LOCK vitest run tests/albumsRoutes.test.js` - Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(albums): create sub-albums with validated parent_id" -m "albums.js holds parent resolution (existence, depth cap, integer parsing) and sibling-scoped sort_order. PUT stays title/description only so parent_id is immutable." -- backend/albums.js backend/server.js backend/tests/albumsRoutes.test.js`

### Task api-3: Reorder scope, delete cascade, image move validation

**Files:** Modify `backend/albums.js`, `backend/server.js` (`PUT /albums/reorder`, `DELETE /albums/:id`, `PUT /image/:id`), `backend/tests/albumsRoutes.test.js`.

**Interfaces:** Produces `assertSameParent(ids)` (throws `AlbumInputError` when the existing rows among `ids` have more than one distinct `parent_id`).

- [ ] **Step 1: Failing tests** - append to `albumsRoutes.test.js`:

```js
const insertImage = (albumId, n = 1) =>
  db.query("INSERT INTO images(album_id, url, sort_order) VALUES(?,?,?)", [albumId, `/api/storage/images/${albumId}/${n}.webp`, n])

describe("PUT /api/albums/reorder", () => {
  it("reorders siblings", async () => {
    const p = (await createAlbum({ title: "P" })).body.id
    const s1 = (await createAlbum({ title: "S1", parent_id: p })).body.id
    const s2 = (await createAlbum({ title: "S2", parent_id: p })).body.id
    const res = await authed(request(app).put("/api/albums/reorder")).send({ albumIds: [s2, s1] })
    expect(res.status).toBe(200)
    expect([(await row(s2)).sort_order, (await row(s1)).sort_order]).toEqual([0, 1])
  })

  it("rejects ids from different parents", async () => {
    const a = (await createAlbum({ title: "A" })).body.id
    const sub = (await createAlbum({ title: "S", parent_id: a })).body.id
    const res = await authed(request(app).put("/api/albums/reorder")).send({ albumIds: [a, sub] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })
})

describe("DELETE /api/albums/:id", () => {
  it("cascades to sub-albums and every image under them", async () => {
    const p = (await createAlbum({ title: "P" })).body.id
    const s = (await createAlbum({ title: "S", parent_id: p })).body.id
    await insertImage(p)
    await insertImage(s)
    const keep = (await createAlbum({ title: "Keep" })).body.id
    await insertImage(keep)
    expect((await authed(request(app).delete(`/api/albums/${p}`))).status).toBe(200)
    expect(await row(s)).toBeUndefined()
    const [imgs] = await db.query("SELECT album_id FROM images")
    expect(imgs.map((i) => i.album_id)).toEqual([keep])
  })

  it("deleting only a sub-album leaves the parent and its photos", async () => {
    const p = (await createAlbum({ title: "P" })).body.id
    const s = (await createAlbum({ title: "S", parent_id: p })).body.id
    await insertImage(p)
    await insertImage(s)
    await authed(request(app).delete(`/api/albums/${s}`))
    expect(await row(p)).toBeDefined()
    expect((await db.query("SELECT id FROM images"))[0]).toHaveLength(1)
  })
})

describe("PUT /api/image/:id (move)", () => {
  it("moves a photo into a sub-album", async () => {
    const p = (await createAlbum({ title: "P" })).body.id
    const s = (await createAlbum({ title: "S", parent_id: p })).body.id
    await insertImage(p)
    const [[img]] = await db.query("SELECT id FROM images")
    expect((await authed(request(app).put(`/api/image/${img.id}`)).send({ album_id: s })).status).toBe(200)
    expect((await db.query("SELECT album_id FROM images WHERE id=?", [img.id]))[0][0].album_id).toBe(s)
  })

  it("400s when the target album does not exist", async () => {
    const p = (await createAlbum({ title: "P" })).body.id
    await insertImage(p)
    const [[img]] = await db.query("SELECT id FROM images")
    const res = await authed(request(app).put(`/api/image/${img.id}`)).send({ album_id: 99999 })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2:** run the file - Expected: reorder-mixed, move-nonexistent FAIL; cascade tests may already pass thanks to the FK (that is fine; they pin behavior).
- [ ] **Step 3: Implement**
  - `albums.js`:

```js
async function assertSameParent(ids) {
  const [rows] = await db.query(
    `SELECT parent_id FROM albums WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  )
  if (new Set(rows.map((r) => r.parent_id)).size > 1) {
    throw new AlbumInputError("Chỉ đổi thứ tự album cùng cấp.")
  }
}
```
  export it. In `server.js`'s reorder handler call `await assertSameParent(albumIds)` after the positive-integer check; in its `catch` add the same `AlbumInputError` to-400 branch as in api-2. In `PUT /image/:id`, before the UPDATE:

```js
    if (album_id !== undefined) {
      const [[target]] = await db.query("SELECT id FROM albums WHERE id=?", [album_id])
      if (!target) {
        return res.status(400).json({ error: "invalid_input", message: "Album không tồn tại." })
      }
      await db.query("UPDATE images SET album_id=? WHERE id=?", [album_id, req.params.id])
      console.log(`[IMAGE] Moved id=${req.params.id} → album ${album_id}`)
    }
```
  - `DELETE /albums/:id`: keep the explicit `DELETE FROM images WHERE album_id=?` and `DELETE FROM albums`; the FK now cascades sub-albums and their images. Add one clarifying line to the log message only if useful; no logic change.
- [ ] **Step 4:** run - Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(albums): scope reorder to siblings, validate image moves, pin cascade delete" -- backend/albums.js backend/server.js backend/tests/albumsRoutes.test.js`

### Task api-4: Nested `GET /api/gallery`

**Files:** Modify `backend/albums.js` (add `buildGallery`), `backend/server.js` (`GET /gallery`), Create `backend/tests/galleryNesting.test.js`.

**Interfaces:** Produces `buildGallery(albums: Row[], images: Row[]) => GalleryAlbum[]` exactly per the contract in Global Constraints. Inputs are already ordered `sort_order ASC, id ASC`.

- [ ] **Step 1: Failing tests** - `backend/tests/galleryNesting.test.js`

```js
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import redis from "../redis.js"
import { buildGallery } from "../albums.js"
import { resetTables, closeDb } from "./helpers/db.js"

const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)

async function album(title, parentId = null, order = 1) {
  const [r] = await db.query("INSERT INTO albums(title, sort_order, parent_id) VALUES(?,?,?)", [title, order, parentId])
  return r.insertId
}
async function image(albumId, url, order = 1, thumb = null) {
  await db.query("INSERT INTO images(album_id, url, thumb_url, width, height, sort_order) VALUES(?,?,?,?,?,?)", [albumId, url, thumb, 100, 200, order])
}

beforeEach(async () => {
  await resetTables("images", "albums")
  await redis.del("gallery")
})
afterAll(async () => { await redis.quit(); await closeDb() })

describe("GET /api/gallery nesting", () => {
  it("returns only top-level albums, each with subAlbums", async () => {
    const p = await album("Cosplay")
    const s = await album("Nino", p)
    await image(p, "/api/storage/p.webp")
    await image(s, "/api/storage/s1.webp", 1, "/api/storage/s1-t.webp")
    await image(s, "/api/storage/s2.webp", 2)
    const body = (await request(app).get("/api/gallery")).body
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ id: p, group: "Cosplay" })
    expect(body[0].items.map((i) => i.fullSrc)).toEqual(["/api/storage/p.webp"])
    expect(body[0].subAlbums).toHaveLength(1)
    const sub = body[0].subAlbums[0]
    expect(sub).toMatchObject({ id: s, title: "Nino", count: 2, cover: "/api/storage/s1-t.webp" })
    expect(sub.items.map((i) => i.id)).toHaveLength(2)
    expect(sub.items[0]).toEqual({ id: expect.any(Number), src: "/api/storage/s1-t.webp", fullSrc: "/api/storage/s1.webp", width: 100, height: 200 })
  })

  it("legacy albums have an empty subAlbums array", async () => {
    const a = await album("Old")
    await image(a, "/api/storage/o.webp")
    const body = (await request(app).get("/api/gallery")).body
    expect(body[0].subAlbums).toEqual([])
    expect(body[0].items).toHaveLength(1)
  })

  it("keeps empty sub-albums with cover null", async () => {
    const p = await album("P")
    await album("Empty", p)
    const sub = (await request(app).get("/api/gallery")).body[0].subAlbums[0]
    expect(sub).toMatchObject({ title: "Empty", count: 0, cover: null, items: [] })
  })

  it("orders sub-albums by sort_order and skips images without a url", async () => {
    const p = await album("P")
    await album("Second", p, 2)
    const first = await album("First", p, 1)
    await db.query("INSERT INTO images(album_id, url, sort_order) VALUES(?, '', 1)", [first])
    const subs = (await request(app).get("/api/gallery")).body[0].subAlbums
    expect(subs.map((s) => s.title)).toEqual(["First", "Second"])
    expect(subs[0].count).toBe(0)
  })

  it("is invalidated when a sub-album is created", async () => {
    const p = await album("P")
    await request(app).get("/api/gallery")
    await request(app).post("/api/albums").set("Authorization", `Bearer ${token}`).send({ title: "New sub", parent_id: p })
    const body = (await request(app).get("/api/gallery")).body
    expect(body[0].subAlbums.map((s) => s.title)).toEqual(["New sub"])
  })
})

describe("buildGallery", () => {
  it("ignores orphaned sub-album rows whose parent is missing", () => {
    expect(buildGallery([{ id: 5, title: "x", description: null, parent_id: 99 }], [])).toEqual([])
  })
})
```

- [ ] **Step 2:** run - Expected: FAIL (`buildGallery` missing; gallery still flat).
- [ ] **Step 3: Implement** - `albums.js`:

```js
function toItem(img) {
  return { id: img.id, src: img.thumb_url || img.url, fullSrc: img.url, width: img.width, height: img.height }
}

function buildGallery(albums, images) {
  const itemsByAlbum = new Map()
  for (const img of images) {
    if (!img.url) continue
    if (!itemsByAlbum.has(img.album_id)) itemsByAlbum.set(img.album_id, [])
    itemsByAlbum.get(img.album_id).push(toItem(img))
  }
  const itemsOf = (id) => itemsByAlbum.get(id) || []

  return albums
    .filter((a) => a.parent_id == null)
    .map((a) => ({
      id: a.id,
      group: a.title,
      description: a.description,
      items: itemsOf(a.id),
      subAlbums: albums
        .filter((s) => s.parent_id === a.id)
        .map((s) => {
          const items = itemsOf(s.id)
          return { id: s.id, title: s.title, description: s.description, cover: items[0]?.src ?? null, count: items.length, items }
        }),
    }))
}
```

export it; add it to the `server.js` require. In `GET /gallery` replace the `grouped = albums.map(...)` block with `const grouped = buildGallery(albums, images)` (keep the cache set/get and the `[GALLERY] DB:` log).
- [ ] **Step 4:** run `$LOCK vitest run tests/galleryNesting.test.js tests/albumsRoutes.test.js` - Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(gallery): nest sub-albums in GET /api/gallery" -m "buildGallery is a pure function over ordered album/image rows; cover is the first photo's src, empty sub-albums are kept with cover null." -- backend/albums.js backend/server.js backend/tests/galleryNesting.test.js`

### Task api-5: Watermark album uploads (BLOCKED until wm-1 is done)

**Files:** Modify `backend/server.js` (`processImage`, `POST /image`), Create `backend/tests/albumImageWatermark.test.js`.

**Interfaces:** Consumes `applyWatermark(webpBuffer, opts?)` from `backend/watermark.js`.

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import sharp from "sharp"
import app from "../server.js"
import storage from "../storage.js"
import db from "../db.js"
import redis from "../redis.js"
import { resetTables, closeDb } from "./helpers/db.js"

const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)
let uploads

async function fixture() {
  return sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 40, b: 120 } } }).png().toBuffer()
}

async function greenDeviation(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let max = 0
  for (let i = 1; i < data.length; i += info.channels) max = Math.max(max, Math.abs(data[i] - 40))
  return max
}

beforeEach(async () => {
  await resetTables("images", "albums")
  uploads = []
  vi.spyOn(storage, "upload").mockImplementation(async (key, buf) => { uploads.push({ key, buf }) })
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => { await redis.quit(); await closeDb() })

describe("album photo upload watermark", () => {
  it("stamps POST /api/image output in an album and a sub-album", async () => {
    const [p] = await db.query("INSERT INTO albums(title, sort_order) VALUES('P',1)")
    const [s] = await db.query("INSERT INTO albums(title, sort_order, parent_id) VALUES('S',1,?)", [p.insertId])
    for (const albumId of [p.insertId, s.insertId]) {
      uploads.length = 0
      const res = await authed(request(app).post("/api/image")).field("album_id", String(albumId)).attach("file", await fixture(), "a.png")
      expect(res.status).toBe(200)
      expect(uploads).toHaveLength(1)
      expect(await greenDeviation(uploads[0].buf)).toBeGreaterThan(20)
    }
  })

  it.each(["/api/upload/hero", "/api/upload/thumbnail", "/api/upload/event-image"])("does not stamp %s", async (path) => {
    const res = await authed(request(app).post(path)).attach("file", await fixture(), "a.png")
    expect(res.status).toBe(200)
    expect(await greenDeviation(uploads[0].buf)).toBeLessThan(8)
  })
})
```

- [ ] **Step 2:** `$LOCK vitest run tests/albumImageWatermark.test.js` - Expected: FAIL on the album case (deviation < 8).
- [ ] **Step 3: Implement** in `server.js`: `const { applyWatermark } = require("./watermark")` beside the other requires, then

```js
async function processImage(buffer, { watermark = false } = {}) {
  validateImageBuffer(buffer)
  const meta = await sharp(buffer).metadata()
  let pipeline = sharp(buffer).rotate()
  if (meta.width > MAX_FULL_WIDTH) {
    pipeline = pipeline.resize(MAX_FULL_WIDTH, null, { withoutEnlargement: true })
  }
  const webp = await pipeline.webp({ quality: 82, effort: 4 }).toBuffer()
  return { buffer: watermark ? await applyWatermark(webp) : webp, ext: "webp" }
}
```

keep the existing explanatory comments above the function; and in `POST /image` change the call to `await processImage(buffer, { watermark: true })`. The width/height read afterwards (`sharp(finalBuffer).metadata()`) stays and now reads the stamped buffer.
- [ ] **Step 4:** run it plus `tests/portfolioImageUpload.test.js` - Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(albums): watermark every album/sub-album photo at upload" -m "Only POST /api/image stamps (shop format via watermark.js). hero/thumbnail/event uploads stay clean. Existing images are untouched." -- backend/server.js backend/tests/albumImageWatermark.test.js`

### Task api-6: Startup cache flush and whole-backend verification

**Files:** Modify `backend/server.js` (`app.listen` callback).

- [ ] **Step 1:** In the `require.main === module` block, inside the `app.listen(5000, () => {` callback add as the first statement:

```js
    redis.del("gallery").catch(() => {})
```

so a payload cached in the old flat shape is dropped on deploy.
- [ ] **Step 2:** Run the whole backend suite once, alone, through the lock: `$LOCK vitest run` (full). Expected: all PASS, 0 failures. If any non-album test fails, do not edit it: determine whether the cause is your change; fix your code or report to the lead.
- [ ] **Step 3: Commit** `git commit -m "chore(gallery): flush cached gallery on server start" -m "Guards against a stale flat-shaped payload surviving a deploy; frontend also tolerates a missing subAlbums." -- backend/server.js`

---

# Teammate `pub` - public portfolio UI (6 tasks)

All tests: `cd frontend && npx vitest run <file>`; lint: `cd frontend && npm run lint`. Render pattern (same as `AdminAlbums.test.jsx`): `createRoot` + `act`, `globalThis.IS_REACT_ACT_ENVIRONMENT = true`.

### Task pub-1: `buildAlbums` adapter

**Files:** Create `frontend/src/pages/portfolioAlbums.js`, `frontend/src/pages/portfolioAlbums.test.js`.

**Interfaces:** Produces `buildAlbums(gallery): Album[]` with
`Album = { id, title, count, cover: string, items: string[], thumbs: string[], subAlbums: Sub[] }`,
`Sub = { id, title, count, cover: string, items: string[], thumbs: string[] }`.
`items` are full-size URLs (`fullSrc || src`), `thumbs` are `src`. `count` of an album = direct photos + all sub-album photos. `cover` of an album = first direct photo's `src`, else the first sub-album's non-empty cover, else `""`. Also produces `allPhotoThumbs(gallery): string[]` (every direct and sub-album `src`, used for "latest photos").

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect } from "vitest"
import { buildAlbums, allPhotoThumbs } from "./portfolioAlbums"

const item = (id, src, fullSrc) => ({ id, src, fullSrc: fullSrc || src, width: 1, height: 1 })

describe("buildAlbums", () => {
  it("handles a legacy album without subAlbums", () => {
    const [a] = buildAlbums([{ id: 1, group: "Event", items: [item(1, "/t1", "/f1"), item(2, "/t2", "/f2")] }])
    expect(a).toMatchObject({ id: 1, title: "Event", count: 2, cover: "/t1", items: ["/f1", "/f2"], thumbs: ["/t1", "/t2"], subAlbums: [] })
  })

  it("counts sub-album photos in the album total and maps sub-albums", () => {
    const [a] = buildAlbums([{
      id: 2, group: "Cosplay", items: [item(1, "/d")],
      subAlbums: [
        { id: 21, title: "Nino", cover: "/n1", count: 2, items: [item(2, "/n1", "/n1f"), item(3, "/n2", "/n2f")] },
        { id: 22, title: "Empty", cover: null, count: 0, items: [] },
      ],
    }])
    expect(a.count).toBe(3)
    expect(a.subAlbums[0]).toMatchObject({ id: 21, title: "Nino", count: 2, cover: "/n1", items: ["/n1f", "/n2f"], thumbs: ["/n1", "/n2"] })
    expect(a.subAlbums[1]).toMatchObject({ count: 0, cover: "", items: [], thumbs: [] })
  })

  it("falls back to the first sub-album cover when the album has no direct photos", () => {
    const [a] = buildAlbums([{ id: 3, group: "Only subs", items: [], subAlbums: [{ id: 31, title: "S", cover: "/s", items: [item(1, "/s")] }] }])
    expect(a.cover).toBe("/s")
  })

  it("tolerates null/undefined gallery", () => {
    expect(buildAlbums(undefined)).toEqual([])
    expect(buildAlbums(null)).toEqual([])
  })
})

describe("allPhotoThumbs", () => {
  it("includes direct and sub-album photos", () => {
    expect(allPhotoThumbs([{ id: 1, group: "A", items: [item(1, "/a")], subAlbums: [{ id: 2, title: "S", items: [item(2, "/s")] }] }])).toEqual(["/a", "/s"])
  })
})
```

- [ ] **Step 2:** `npx vitest run src/pages/portfolioAlbums.test.js` - Expected: FAIL (module missing).
- [ ] **Step 3: Implement**

```js
const full = (it) => it.fullSrc || it.src

function buildSub(s) {
  const items = s.items || []
  return {
    id: s.id,
    title: s.title,
    count: items.length,
    cover: s.cover || items[0]?.src || "",
    items: items.map(full),
    thumbs: items.map((it) => it.src),
  }
}

export function buildAlbums(gallery) {
  return (gallery || []).map((g) => {
    const items = g.items || []
    const subAlbums = (g.subAlbums || []).map(buildSub)
    const subCount = subAlbums.reduce((n, s) => n + s.count, 0)
    return {
      id: g.id,
      title: g.group,
      count: items.length + subCount,
      cover: items[0]?.src || subAlbums.find((s) => s.cover)?.cover || "",
      items: items.map(full),
      thumbs: items.map((it) => it.src),
      subAlbums,
    }
  })
}

export function allPhotoThumbs(gallery) {
  return (gallery || []).flatMap((g) => [
    ...(g.items || []),
    ...(g.subAlbums || []).flatMap((s) => s.items || []),
  ]).map((it) => it.src)
}
```

- [ ] **Step 4:** run - Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(portfolio): adapter for nested gallery albums" -- frontend/src/pages/portfolioAlbums.js frontend/src/pages/portfolioAlbums.test.js`

### Task pub-2: `SubAlbumGrid` sub-album cards

**Files:** Create `frontend/src/components/portfolio/SubAlbumGrid.jsx`, `frontend/src/components/portfolio/SubAlbumGrid.test.jsx`.

**Interfaces:** Consumes `Album` from pub-1. Produces default export `SubAlbumGrid({ album, lang, onBack, onOpenPhotos })` where `onOpenPhotos(photos: string[], index: number)`.

Behavior: back button text `← Quay lại` / `← Back` (`data-testid="sub-back"`); album title heading; one card per sub-album (`data-testid="sub-album-card"`) with cover image (4/5), name, `N ảnh`/`N photos`; clicking a non-empty card calls `onOpenPhotos(sub.items, 0)`; an empty sub-album shows a placeholder block (no `<img>`), `aria-disabled="true"`, and is not clickable. Cards are keyboard-activatable (`role="button"`, `tabIndex={0}`, Enter/Space).

- [ ] **Step 1: Failing test**

```jsx
import { describe, it, expect, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: SubAlbumGrid } = await import("./SubAlbumGrid")

const album = {
  id: 2, title: "Cosplay", count: 3, cover: "/c", items: [], thumbs: [],
  subAlbums: [
    { id: 21, title: "Nino", count: 2, cover: "/n1", items: ["/n1f", "/n2f"], thumbs: ["/n1", "/n2"] },
    { id: 22, title: "Empty", count: 0, cover: "", items: [], thumbs: [] },
  ],
}

async function render(props) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<SubAlbumGrid album={album} lang="vi" onBack={() => {}} onOpenPhotos={() => {}} {...props} />) })
  return container
}

describe("SubAlbumGrid cards", () => {
  it("renders name, count and cover per sub-album", async () => {
    const c = await render()
    const cards = c.querySelectorAll('[data-testid="sub-album-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain("Nino")
    expect(cards[0].textContent).toContain("2 ảnh")
    expect(cards[0].querySelector("img").getAttribute("src")).toBe("/n1")
  })

  it("opens the lightbox for a sub-album", async () => {
    const onOpenPhotos = vi.fn()
    const c = await render({ onOpenPhotos })
    await act(async () => { c.querySelectorAll('[data-testid="sub-album-card"]')[0].click() })
    expect(onOpenPhotos).toHaveBeenCalledWith(["/n1f", "/n2f"], 0)
  })

  it("empty sub-album has no image and does nothing on click", async () => {
    const onOpenPhotos = vi.fn()
    const c = await render({ onOpenPhotos })
    const empty = c.querySelectorAll('[data-testid="sub-album-card"]')[1]
    expect(empty.querySelector("img")).toBeNull()
    expect(empty.getAttribute("aria-disabled")).toBe("true")
    await act(async () => { empty.click() })
    expect(onOpenPhotos).not.toHaveBeenCalled()
  })

  it("Enter opens a card and the back button calls onBack", async () => {
    const onOpenPhotos = vi.fn()
    const onBack = vi.fn()
    const c = await render({ onOpenPhotos, onBack })
    await act(async () => {
      c.querySelectorAll('[data-testid="sub-album-card"]')[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })
    expect(onOpenPhotos).toHaveBeenCalledTimes(1)
    await act(async () => { c.querySelector('[data-testid="sub-back"]').click() })
    expect(onBack).toHaveBeenCalled()
  })

  it("renders English copy", async () => {
    const c = await render({ lang: "en" })
    expect(c.textContent).toContain("Back")
    expect(c.textContent).toContain("2 photos")
  })
})
```

- [ ] **Step 2:** run - Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `SubAlbumGrid.jsx` (direct-photos section is added in pub-3):

```jsx
import { useState } from "react"

const s = {
  back: { background: "none", border: "none", color: "var(--text-link)", cursor: "pointer", fontSize: "var(--text-sm)", padding: 0, marginBottom: 12 },
  title: { margin: "0 0 16px", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-link)" },
  grid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 },
  card: { borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border-default)", background: "var(--bg-sunken)", position: "relative", transition: "transform .25s,box-shadow .25s" },
  img: { width: "100%", aspectRatio: "4/5", objectFit: "cover", display: "block" },
  placeholder: { width: "100%", aspectRatio: "4/5", background: "var(--bg-sunken)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "var(--text-sm)" },
  foot: { padding: "10px 14px", borderTop: "1px solid var(--border-default)" },
  name: { fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)" },
  count: { fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 },
}

export default function SubAlbumGrid({ album, lang, onBack, onOpenPhotos }) {
  const vi = lang === "vi"
  const unit = vi ? "ảnh" : "photos"
  const [hov, setHov] = useState(null)

  return (
    <div>
      <button type="button" data-testid="sub-back" onClick={onBack} style={s.back}>← {vi ? "Quay lại" : "Back"}</button>
      <h3 style={s.title}>{album.title}</h3>
      <div className="album-grid" style={s.grid}>
        {album.subAlbums.map((sub, i) => {
          const empty = sub.items.length === 0
          const open = () => { if (!empty) onOpenPhotos(sub.items, 0) }
          return (
            <div
              key={sub.id}
              data-testid="sub-album-card"
              role="button"
              tabIndex={empty ? -1 : 0}
              aria-disabled={empty ? "true" : undefined}
              onClick={open}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open() } }}
              onMouseEnter={() => setHov(i)}
              onMouseLeave={() => setHov(null)}
              style={{ ...s.card, cursor: empty ? "default" : "pointer", transform: !empty && hov === i ? "scale(1.02)" : "none", boxShadow: !empty && hov === i ? "var(--shadow-pink-hover)" : "none" }}
            >
              {empty
                ? <div style={s.placeholder}>{vi ? "Chưa có ảnh" : "No photos yet"}</div>
                : <img src={sub.cover} alt={sub.title} loading="lazy" decoding="async" style={s.img} />}
              <div style={s.foot}>
                <div style={s.name}>{sub.title}</div>
                <div style={s.count}>{sub.count} {unit}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4:** run - Expected: PASS. Then `npm run lint` - clean.
- [ ] **Step 5: Commit** `git commit -m "feat(portfolio): sub-album card grid with empty/keyboard states" -- frontend/src/components/portfolio/SubAlbumGrid.jsx frontend/src/components/portfolio/SubAlbumGrid.test.jsx`

### Task pub-3: Direct photos below the sub-album grid

**Files:** Modify `SubAlbumGrid.jsx`, `SubAlbumGrid.test.jsx` (your files).

Behavior: when `album.items.length > 0`, after the card grid render a heading (`Ảnh khác` / `More photos`, `data-testid="direct-photos-title"`) and a grid of `<img>` thumbnails from `album.thumbs` (`data-testid="direct-photo"`, `className="album-grid"` on the grid for the shared breakpoints); clicking photo `i` calls `onOpenPhotos(album.items, i)`. No heading when there are no direct photos.

- [ ] **Step 1: Failing tests** - append:

```jsx
describe("direct photos", () => {
  const withDirect = { ...album, items: ["/d0f", "/d1f"], thumbs: ["/d0", "/d1"] }

  it("shows them below the cards and opens the lightbox at the clicked index", async () => {
    const onOpenPhotos = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<SubAlbumGrid album={withDirect} lang="vi" onBack={() => {}} onOpenPhotos={onOpenPhotos} />) })
    expect(container.querySelector('[data-testid="direct-photos-title"]').textContent).toBe("Ảnh khác")
    const photos = container.querySelectorAll('[data-testid="direct-photo"]')
    expect(photos).toHaveLength(2)
    expect(photos[1].getAttribute("src")).toBe("/d1")
    await act(async () => { photos[1].click() })
    expect(onOpenPhotos).toHaveBeenCalledWith(["/d0f", "/d1f"], 1)
  })

  it("renders nothing extra when there are no direct photos", async () => {
    const c = await render()
    expect(c.querySelector('[data-testid="direct-photos-title"]')).toBeNull()
  })
})
```

- [ ] **Step 2:** run - Expected: FAIL on the first test.
- [ ] **Step 3: Implement** - add to `s`: `photoGrid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 8 }`, `photo: { width: "100%", aspectRatio: "4/5", objectFit: "cover", display: "block", borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", cursor: "pointer" }`, `sub: { margin: "24px 0 12px", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-muted)" }`; and after the cards grid, before the closing wrapper `</div>`:

```jsx
      {album.items.length > 0 && (
        <>
          <h4 data-testid="direct-photos-title" style={s.sub}>{vi ? "Ảnh khác" : "More photos"}</h4>
          <div className="album-grid" style={s.photoGrid}>
            {album.thumbs.map((src, i) => (
              <img key={`${src}-${i}`} data-testid="direct-photo" src={src} alt={`${album.title} ${i + 1}`} loading="lazy" decoding="async" style={s.photo} onClick={() => onOpenPhotos(album.items, i)} />
            ))}
          </div>
        </>
      )}
```

- [ ] **Step 4:** run - Expected: PASS; `npm run lint` clean.
- [ ] **Step 5: Commit** `git commit -m "feat(portfolio): show an album's direct photos under its sub-albums" -- frontend/src/components/portfolio/SubAlbumGrid.jsx frontend/src/components/portfolio/SubAlbumGrid.test.jsx`

### Task pub-4: `ProjectAlbums` with drill-in state

**Files:** Create `frontend/src/components/portfolio/ProjectAlbums.jsx`, `ProjectAlbums.test.jsx`.

**Interfaces:** Produces default export `ProjectAlbums({ albums, lang, onOpenAlbum, onOpenPhotos })`. `onOpenAlbum(album)` fires for albums with no sub-albums (existing lightbox behavior, receives the full `Album`). Albums with `subAlbums.length > 0` switch the component into `SubAlbumGrid` for that album; Back returns to the list. Album cards: `data-testid="album-card"`, show `count` with `ảnh`/`photos`, the existing `+` badge, and an empty-state `Chưa có album.` / `No albums yet.`. If the open album disappears from `albums` (data reload) the list view renders again.

- [ ] **Step 1: Failing test**

```jsx
import { describe, it, expect, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: ProjectAlbums } = await import("./ProjectAlbums")

const plain = { id: 1, title: "Event", count: 2, cover: "/e", items: ["/e1f", "/e2f"], thumbs: ["/e1", "/e2"], subAlbums: [] }
const withSubs = {
  id: 2, title: "Cosplay", count: 3, cover: "/d", items: ["/df"], thumbs: ["/d"],
  subAlbums: [
    { id: 21, title: "Nino", count: 2, cover: "/n1", items: ["/n1f", "/n2f"], thumbs: ["/n1", "/n2"] },
    { id: 22, title: "Empty", count: 0, cover: "", items: [], thumbs: [] },
  ],
}

async function render(props) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  const all = { albums: [plain, withSubs], lang: "vi", onOpenAlbum: () => {}, onOpenPhotos: () => {}, ...props }
  await act(async () => { root.render(<ProjectAlbums {...all} />) })
  return { container, root, all }
}
const cards = (c) => c.querySelectorAll('[data-testid="album-card"]')

describe("ProjectAlbums", () => {
  it("shows total counts including sub-album photos", async () => {
    const { container } = await render()
    expect(cards(container)[1].textContent).toContain("3 ảnh")
  })

  it("an album without sub-albums opens the lightbox directly", async () => {
    const onOpenAlbum = vi.fn()
    const { container } = await render({ onOpenAlbum })
    await act(async () => { cards(container)[0].click() })
    expect(onOpenAlbum).toHaveBeenCalledWith(plain)
  })

  it("an album with sub-albums drills in instead of opening the lightbox", async () => {
    const onOpenAlbum = vi.fn()
    const { container } = await render({ onOpenAlbum })
    await act(async () => { cards(container)[1].click() })
    expect(onOpenAlbum).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Nino")
    expect(container.querySelector('[data-testid="sub-back"]')).not.toBeNull()
    expect(cards(container)).toHaveLength(0)
  })

  it("sub-album click opens its photos; back returns to the album list", async () => {
    const onOpenPhotos = vi.fn()
    const { container } = await render({ onOpenPhotos })
    await act(async () => { cards(container)[1].click() })
    await act(async () => { container.querySelectorAll('[data-testid="sub-album-card"]')[0].click() })
    expect(onOpenPhotos).toHaveBeenCalledWith(["/n1f", "/n2f"], 0)
    await act(async () => { container.querySelector('[data-testid="sub-back"]').click() })
    expect(cards(container)).toHaveLength(2)
  })

  it("falls back to the list when the open album disappears", async () => {
    const { container, root, all } = await render()
    await act(async () => { cards(container)[1].click() })
    await act(async () => { root.render(<ProjectAlbums {...all} albums={[plain]} />) })
    expect(cards(container)).toHaveLength(1)
  })

  it("shows the empty state", async () => {
    const { container } = await render({ albums: [] })
    expect(container.textContent).toContain("Chưa có album.")
  })
})
```

- [ ] **Step 2:** run - Expected: FAIL.
- [ ] **Step 3: Implement** (styles copied from the current `ProjectSection` so the look is unchanged)

```jsx
import { useState } from "react"
import SubAlbumGrid from "./SubAlbumGrid"

const s = {
  grid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 },
  card: { borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border-default)", cursor: "pointer", background: "var(--bg-sunken)", position: "relative", transition: "transform .25s,box-shadow .25s" },
  img: { width: "100%", aspectRatio: "4/5", objectFit: "cover", display: "block" },
  foot: { padding: "10px 14px", borderTop: "1px solid var(--border-default)" },
  title: { fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)" },
  count: { fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 },
  plus: { position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: "var(--radius-full)", background: "rgba(236,72,153,.25)", border: "1px solid rgba(236,72,153,.5)", color: "var(--pink-400)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, lineHeight: 1 },
}

export default function ProjectAlbums({ albums, lang, onOpenAlbum, onOpenPhotos }) {
  const vi = lang === "vi"
  const [hov, setHov] = useState(null)
  const [openId, setOpenId] = useState(null)
  const open = albums.find((a) => a.id === openId)

  if (open) {
    return <SubAlbumGrid album={open} lang={lang} onBack={() => setOpenId(null)} onOpenPhotos={onOpenPhotos} />
  }

  const activate = (alb) => (alb.subAlbums.length > 0 ? setOpenId(alb.id) : onOpenAlbum(alb))

  return (
    <div className="album-grid" style={s.grid}>
      {albums.map((alb, i) => (
        <div
          key={alb.id}
          data-testid="album-card"
          role="button"
          tabIndex={0}
          style={{ ...s.card, transform: hov === i ? "scale(1.02)" : "none", boxShadow: hov === i ? "var(--shadow-pink-hover)" : "none" }}
          onMouseEnter={() => setHov(i)}
          onMouseLeave={() => setHov(null)}
          onClick={() => activate(alb)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(alb) } }}
        >
          <img src={alb.cover} alt={alb.title} loading="lazy" decoding="async" style={s.img} />
          <div style={s.plus}>+</div>
          <div style={s.foot}>
            <div style={s.title}>{alb.title}</div>
            <div style={s.count}>{alb.count} {vi ? "ảnh" : "photos"}</div>
          </div>
        </div>
      ))}
      {albums.length === 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: 0 }}>{vi ? "Chưa có album." : "No albums yet."}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4:** run - Expected: PASS; lint clean.
- [ ] **Step 5: Commit** `git commit -m "feat(portfolio): ProjectAlbums grid with sub-album drill-in" -- frontend/src/components/portfolio/ProjectAlbums.jsx frontend/src/components/portfolio/ProjectAlbums.test.jsx`

### Task pub-5: Wire into `Portfolio.jsx`

**Files:** Modify `frontend/src/pages/Portfolio.jsx` (imports; `ProjectSection` ~L378-422; `buildData` ~L608-620, L639; `ProjectSection` call ~L728).

- [ ] **Step 1:** Add imports:

```js
import ProjectAlbums from "../components/portfolio/ProjectAlbums"
import { buildAlbums, allPhotoThumbs } from "./portfolioAlbums"
```

- [ ] **Step 2:** In `buildData` replace the `albums` mapping with `const albums = buildAlbums(gallery)` and `galleryPhotos` with `const galleryPhotos = allPhotoThumbs(gallery)`.
- [ ] **Step 3:** In `ProjectSection`: add a prop `onOpenPhotos`; delete the now-unused `hov` state and the `albumGrid`, `albumCard`, `albumImg`, `albumFoot`, `albumTitle`, `albumCount`, `plusBtn` style entries; replace the whole `<div className="album-grid" ...>...</div>` block (the one rendering `data.albums.map`) with:

```jsx
          <ProjectAlbums albums={data.albums} lang={lang} onOpenAlbum={onOpenAlbum} onOpenPhotos={onOpenPhotos} />
```

  If `useState` becomes unused in the file's other components it is still used elsewhere (`Portfolio` uses it); remove nothing else.
- [ ] **Step 4:** Update the call site:

```jsx
<ProjectSection data={data} lang={lang} onOpenAlbum={(alb) => openPhoto(alb.items?.length ? alb.items : [alb.cover], 0)} onOpenPhotos={openPhoto} />
```

- [ ] **Step 5:** Run `npm run lint` (must be clean, including no unused vars) and `npx vitest run src/pages src/components/portfolio`. Expected: PASS. Run `npm run build` - Expected: success.
- [ ] **Step 6: Commit** `git commit -m "feat(portfolio): render albums through ProjectAlbums with sub-album support" -m "buildData now uses buildAlbums/allPhotoThumbs so latest-photos also include sub-album photos. Existing albums without sub-albums behave exactly as before." -- frontend/src/pages/Portfolio.jsx`

### Task pub-6: Frontend verification

- [ ] **Step 1:** `cd frontend && npx vitest run` - Expected: whole frontend suite PASS (note any pre-existing failures by checking them against `git stash`-free means: run the failing file on `main` via `git worktree` only if needed; report rather than fix files you do not own).
- [ ] **Step 2:** `npm run lint` and `npm run build` - Expected: clean / success.
- [ ] **Step 3:** Read `git diff main -- frontend/src/pages/Portfolio.jsx` and confirm only the intended hunks changed. Report completion to the lead; do not screenshot or deploy (user verifies visually).

---

# Teammate `adm` - admin UI (6 tasks)

Same test/lint commands as `pub`. HTTP in tests is mocked by setting `api.defaults.adapter` (see `AdminAlbums.test.jsx`).

### Task adm-1: `albumTree.js` helpers

**Files:** Create `frontend/src/components/albumTree.js`, `albumTree.test.js`.

**Interfaces:** Produces `buildAlbumTree(rows): Array<Row & { children: Row[] }>` (top-level rows in input order, each with its sub-albums in input order; rows whose parent is missing are dropped), `sameParent(a, b): boolean` (null-safe on `parent_id`), `findGalleryAlbum(gallery, id): GalleryAlbum | GallerySub | undefined` (searches top-level albums then their `subAlbums`).

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect } from "vitest"
import { buildAlbumTree, sameParent, findGalleryAlbum } from "./albumTree"

const rows = [
  { id: 1, title: "A", parent_id: null },
  { id: 3, title: "A-2", parent_id: 1 },
  { id: 2, title: "B" },
  { id: 4, title: "A-1", parent_id: 1 },
  { id: 9, title: "orphan", parent_id: 777 },
]

describe("buildAlbumTree", () => {
  it("nests children under parents preserving input order", () => {
    const tree = buildAlbumTree(rows)
    expect(tree.map((t) => t.id)).toEqual([1, 2])
    expect(tree[0].children.map((c) => c.id)).toEqual([3, 4])
    expect(tree[1].children).toEqual([])
  })
  it("treats undefined parent_id as top-level and drops orphans", () => {
    expect(buildAlbumTree(rows).flatMap((t) => [t.id, ...t.children.map((c) => c.id)])).not.toContain(9)
  })
})

describe("sameParent", () => {
  it("is null-safe", () => {
    expect(sameParent({ parent_id: null }, { })).toBe(true)
    expect(sameParent({ parent_id: 1 }, { parent_id: 1 })).toBe(true)
    expect(sameParent({ parent_id: 1 }, { parent_id: null })).toBe(false)
  })
})

describe("findGalleryAlbum", () => {
  const gallery = [{ id: 1, items: [], subAlbums: [{ id: 5, items: [{ id: 50 }] }] }, { id: 2, items: [] }]
  it("finds top-level albums, sub-albums, and tolerates missing subAlbums", () => {
    expect(findGalleryAlbum(gallery, 2).id).toBe(2)
    expect(findGalleryAlbum(gallery, 5).items).toEqual([{ id: 50 }])
    expect(findGalleryAlbum(gallery, 99)).toBeUndefined()
  })
})
```

- [ ] **Step 2:** run - Expected: FAIL.
- [ ] **Step 3: Implement**

```js
export const sameParent = (a, b) => (a.parent_id ?? null) === (b.parent_id ?? null)

export function buildAlbumTree(rows) {
  return rows
    .filter((r) => r.parent_id == null)
    .map((p) => ({ ...p, children: rows.filter((c) => c.parent_id === p.id) }))
}

export function findGalleryAlbum(gallery, id) {
  for (const album of gallery) {
    if (album.id === id) return album
    const sub = (album.subAlbums || []).find((s) => s.id === id)
    if (sub) return sub
  }
  return undefined
}
```

- [ ] **Step 4:** run - Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(admin): album tree helpers" -- frontend/src/components/albumTree.js frontend/src/components/albumTree.test.js`

### Task adm-2: Nested list rendering

**Files:** Modify `AdminAlbums.jsx`, `AdminAlbums.test.jsx` (append; keep the existing test untouched).

Behavior: render `buildAlbumTree(albums)`; each top-level row as today, followed by its children as rows indented (`ml-6 sm:ml-8`, `data-sub-album-row`), each with the same buttons (Quản lý ảnh / Sửa / Xóa) but no "Thêm album con". Keep `data-album-row` on every row (both kinds).

- [ ] **Step 1: Failing test** - append:

```jsx
function mockAlbumsApi(rows, handlers = {}) {
  api.defaults.adapter = (config) => {
    const key = `${config.method} ${config.url}`
    if (handlers[key]) return handlers[key](config)
    if (key === "get /api/albums") return Promise.resolve({ data: rows, status: 200, config, headers: {} })
    return Promise.reject(new Error(`unexpected request: ${key}`))
  }
}

describe("AdminAlbums - sub-album nesting", () => {
  const rows = [
    { id: 1, title: "Cosplay", description: "", parent_id: null },
    { id: 11, title: "Nino", description: "", parent_id: 1 },
    { id: 2, title: "Event", description: "", parent_id: null },
  ]
  const originalAdapter = api.defaults.adapter
  afterEach(() => { api.defaults.adapter = originalAdapter })

  it("renders sub-albums indented under their parent", async () => {
    mockAlbumsApi(rows)
    const c = await renderAlbums()
    await flush()
    const all = [...c.querySelectorAll("[data-album-row]")]
    expect(all.map((r) => r.querySelector("h3").textContent)).toEqual(["Cosplay", "Nino", "Event"])
    expect(c.querySelectorAll("[data-sub-album-row]")).toHaveLength(1)
    expect(c.querySelector("[data-sub-album-row]").querySelector("h3").textContent).toBe("Nino")
  })
})
```

- [ ] **Step 2:** run - Expected: FAIL (no `data-sub-album-row`; order may match but the attribute check fails).
- [ ] **Step 3: Implement** - extract the row markup into a local `renderRow(a, { isSub })` inside the component (reuse the exact JSX and classes from the current row; add `data-sub-album-row` and the indent class `ml-6 sm:ml-8` when `isSub`), then render:

```jsx
      <div className="space-y-2 mb-6 sm:mb-8">
        {buildAlbumTree(albums).map((p) => (
          <div key={p.id} className="space-y-2">
            {renderRow(p, { isSub: false })}
            {p.children.map((c) => renderRow(c, { isSub: true }))}
          </div>
        ))}
      </div>
```

  with `import { buildAlbumTree, sameParent } from "./albumTree"`. The row `key` for sub rows is `c.id` via the wrapper `renderRow` returning an element with `key={a.id}`.
- [ ] **Step 4:** run `npx vitest run src/components/AdminAlbums.test.jsx` - Expected: PASS (both tests).
- [ ] **Step 5: Commit** `git commit -m "feat(admin): show sub-albums nested under their album" -- frontend/src/components/AdminAlbums.jsx frontend/src/components/AdminAlbums.test.jsx`

### Task adm-3: "Add sub-album" action

**Files:** Modify `AdminAlbums.jsx`, `AdminAlbums.test.jsx`.

Behavior: top-level rows get a `+ Album con` button (text exactly `+ Album con`); sub-album rows do not. Clicking opens `AdminAlbumForm` with title `Tạo album con trong: <parent title>`; saving calls `POST /api/albums` with `{ title, description, parent_id: <parent id> }`, refetches, and closes the form. Top-level "+ Thêm album" still sends no `parent_id`.

- [ ] **Step 1: Failing test** - append inside the nesting `describe`:

```jsx
  it("adds a sub-album under the chosen parent", async () => {
    let posted
    mockAlbumsApi(rows, {
      "post /api/albums": (config) => {
        posted = JSON.parse(config.data)
        return Promise.resolve({ data: { ok: true, id: 50 }, status: 200, config, headers: {} })
      },
    })
    const c = await renderAlbums()
    await flush()
    const addButtons = [...c.querySelectorAll("button")].filter((b) => b.textContent === "+ Album con")
    expect(addButtons).toHaveLength(2)
    await act(async () => { addButtons[0].click() })
    expect(c.textContent).toContain("Tạo album con trong: Cosplay")
    const input = c.querySelector('input[type="text"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Miku")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => { c.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    await flush()
    expect(posted).toMatchObject({ title: "Miku", parent_id: 1 })
  })
```

- [ ] **Step 2:** run - Expected: FAIL.
- [ ] **Step 3: Implement** - add state `const [subParent, setSubParent] = useState(null)`; generalize `createAlbum(title, description, parentId)` to send `{ title, description, ...(parentId ? { parent_id: parentId } : {}) }` and to `setShowForm(false); setSubParent(null)` on success; render a second form block:

```jsx
      {subParent && (
        <AdminAlbumForm
          onSave={(title, desc) => createAlbum(title, desc, subParent.id)}
          onCancel={() => setSubParent(null)}
          title={`Tạo album con trong: ${subParent.title}`}
        />
      )}
```

  The existing top-level form passes `onSave={(t, d) => createAlbum(t, d)}`. In `renderRow`, when `!isSub`, add before "Quản lý ảnh":

```jsx
              <button
                onClick={() => setSubParent(a)}
                className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-cosplay-border text-gray-600 dark:text-slate-400 hover:text-pink-500 dark:hover:text-pink-400 hover:border-pink-500/50"
              >
                + Album con
              </button>
```

  Opening a sub-album form closes the top-level form and vice versa (`setShowForm(false)` / `setSubParent(null)` at the click handlers).
- [ ] **Step 4:** run - Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(admin): add sub-album action on top-level albums" -- frontend/src/components/AdminAlbums.jsx frontend/src/components/AdminAlbums.test.jsx`

### Task adm-4: Sibling-scoped drag reorder

**Files:** Modify `AdminAlbums.jsx`, `AdminAlbums.test.jsx`.

Behavior: dragging a row onto another row of the SAME parent reorders only that sibling set and sends `PUT /api/albums/reorder` with `albumIds` of just those siblings in new order; dropping onto a row with a different parent is ignored (no request, no state change). Local state keeps non-sibling rows in place.

- [ ] **Step 1: Failing test** - append:

```jsx
  it("reorders only siblings and ignores cross-parent drops", async () => {
    const two = [
      { id: 1, title: "A", description: "", parent_id: null },
      { id: 11, title: "A1", description: "", parent_id: 1 },
      { id: 12, title: "A2", description: "", parent_id: 1 },
      { id: 2, title: "B", description: "", parent_id: null },
    ]
    const reorderBodies = []
    mockAlbumsApi(two, {
      "put /api/albums/reorder": (config) => {
        reorderBodies.push(JSON.parse(config.data))
        return Promise.resolve({ data: { ok: true }, status: 200, config, headers: {} })
      },
    })
    const c = await renderAlbums()
    await flush()
    const rowOf = (title) => [...c.querySelectorAll("[data-album-row]")].find((r) => r.querySelector("h3").textContent === title)
    const drag = async (from, to) => {
      const dt = { effectAllowed: "", dropEffect: "", setData() {} }
      await act(async () => {
        const src = rowOf(from).querySelector("[draggable]")
        src.dispatchEvent(Object.assign(new Event("dragstart", { bubbles: true }), { dataTransfer: dt }))
        rowOf(to).dispatchEvent(Object.assign(new Event("drop", { bubbles: true, cancelable: true }), { dataTransfer: dt }))
      })
    }
    await drag("A2", "A1")
    expect(reorderBodies).toEqual([{ albumIds: [12, 11] }])
    await drag("A1", "B")
    expect(reorderBodies).toHaveLength(1)
    expect([...c.querySelectorAll("[data-album-row] h3")].map((h) => h.textContent)).toEqual(["A", "A2", "A1", "B"])
  })
```

  (If jsdom lacks `DragEvent`, the plain `Event` with an attached `dataTransfer` shown above is what React reads; adjust only the test scaffolding, not the component contract.)
- [ ] **Step 2:** run - Expected: FAIL (current code reorders the flat list and sends all ids).
- [ ] **Step 3: Implement** - replace the body of `handleDrop` after the guard `if (fromId == null || fromId === targetAlbum.id) return`:

```js
    const dragged = albums.find((x) => x.id === fromId)
    if (!dragged || !sameParent(dragged, targetAlbum)) {
      setDraggedId(null)
      return
    }
    const siblings = albums.filter((x) => sameParent(x, targetAlbum))
    const fromIdx = siblings.findIndex((x) => x.id === fromId)
    const toIdx = siblings.findIndex((x) => x.id === targetAlbum.id)
    if (fromIdx === -1 || toIdx === -1) return
    const nextSiblings = [...siblings]
    const [removed] = nextSiblings.splice(fromIdx, 1)
    nextSiblings.splice(toIdx, 0, removed)
    let k = 0
    const next = albums.map((x) => (sameParent(x, targetAlbum) ? nextSiblings[k++] : x))
    setAlbums(next)
    setDraggedId(null)
    setReorderPending(true)
    api
      .put("/api/albums/reorder", { albumIds: nextSiblings.map((x) => x.id) })
      .then(() => setReorderPending(false))
      .catch((err) => {
        setReorderPending(false)
        fetchAlbums()
        console.error("[AdminAlbums] Reorder failed:", err.response?.data || err.message)
      })
```

- [ ] **Step 4:** run - Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(admin): reorder albums within their sibling set only" -- frontend/src/components/AdminAlbums.jsx frontend/src/components/AdminAlbums.test.jsx`

### Task adm-5: Delete confirm text and `AdminAlbumImages` for sub-albums

**Files:** Modify `AdminAlbums.jsx`, `AdminAlbumImages.jsx`, `AdminAlbums.test.jsx`, `AdminAlbumImages.test.jsx`.

Behavior:
- Delete confirm text: top-level with n>0 sub-albums `Xóa album, ${n} album con và tất cả ảnh?`; top-level without sub-albums unchanged `Xóa album và tất cả ảnh trong album?`; a sub-album `Xóa album con và tất cả ảnh trong album con?`.
- `AdminAlbumImages` loads its photos with `findGalleryAlbum(r.data, album.id)?.items || []` so it works for sub-albums (the gallery endpoint nests them).

- [ ] **Step 1: Failing tests**
  - In `AdminAlbums.test.jsx` (nesting `describe`):

```jsx
  it("warns about sub-albums in the delete confirmation", async () => {
    mockAlbumsApi(rows, { "delete /api/albums/1": (config) => Promise.resolve({ data: { ok: true }, status: 200, config, headers: {} }) })
    const c = await renderAlbums()
    await flush()
    const delButtons = [...c.querySelectorAll("button")].filter((b) => b.textContent === "Xóa")
    await act(async () => { delButtons[0].click() })
    expect(window.confirm).toHaveBeenCalledWith("Xóa album, 1 album con và tất cả ảnh?")
    window.confirm.mockClear()
    await act(async () => { delButtons[1].click() })
    expect(window.confirm).toHaveBeenCalledWith("Xóa album con và tất cả ảnh trong album con?")
  })
```

  - In `AdminAlbumImages.test.jsx` add (follow that file's existing render helper): mock `GET /api/gallery` returning `[{ id: 1, group: "P", items: [], subAlbums: [{ id: 5, title: "S", items: [{ id: 50, src: "/s.webp", fullSrc: "/s.webp" }] }] }]`, render `<AdminAlbumImages album={{ id: 5, title: "S" }} onClose={() => {}} />` and assert one `img` with `src` `/s.webp` is shown.
- [ ] **Step 2:** run both files - Expected: FAIL.
- [ ] **Step 3: Implement**
  - `AdminAlbums.jsx`: change `deleteAlbum(id)` to take the album object (`deleteAlbum(a)`), compute `const subCount = albums.filter((x) => x.parent_id === a.id).length` and `const message = a.parent_id != null ? "Xóa album con và tất cả ảnh trong album con?" : subCount > 0 ? \`Xóa album, ${subCount} album con và tất cả ảnh?\` : "Xóa album và tất cả ảnh trong album?"`, `if (!confirm(message)) return`; use `a.id` for the request and for clearing `selected` (also clear `selected` when the deleted album is its parent: `selected?.parent_id === a.id`). Update the Xóa button to `onClick={() => deleteAlbum(a)}`. The pre-existing error-handling test must still pass untouched.
  - `AdminAlbumImages.jsx`: `import { findGalleryAlbum } from "./albumTree"` and in `fetchGallery`: `setGallery(findGalleryAlbum(r.data, album.id)?.items || [])`.
- [ ] **Step 4:** run `npx vitest run src/components/AdminAlbums.test.jsx src/components/AdminAlbumImages.test.jsx` - Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(admin): sub-album-aware delete confirm and photo manager" -- frontend/src/components/AdminAlbums.jsx frontend/src/components/AdminAlbumImages.jsx frontend/src/components/AdminAlbums.test.jsx frontend/src/components/AdminAlbumImages.test.jsx`

### Task adm-6: Admin verification

- [ ] **Step 1:** `cd frontend && npx vitest run src/components` - Expected: PASS (all admin component tests, including those you do not own).
- [ ] **Step 2:** `npm run lint` clean; `npm run build` success.
- [ ] **Step 3:** Check `AdminAlbumForm.jsx` still fits both uses (its `album` prop is unused for creation); only touch it if the sub-album title prop needs a change - it should not. Report completion to the lead.

---

# Lead-only steps

### Task L-0: Setup (before spawning)

- [ ] Create the branch `git switch -c feat/sub-albums` (spec commit `5a81d06` is on `main`; the plan file is committed here first).
- [ ] Create the lock script in the scratchpad and export it for spawn prompts:

```bash
cat > "$SCRATCH/locked-test.sh" <<'EOF'
#!/bin/bash
LOCK="$SCRATCH/cosplay-test.lock"
until mkdir "$LOCK" 2>/dev/null; do sleep 3; done
trap 'rmdir "$LOCK"' EXIT
cd /Users/phucth/vibes/cosplay-portfolio/backend
DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx "$@"
EOF
chmod +x "$SCRATCH/locked-test.sh"
```

  `$SCRATCH` = `/private/tmp/claude-501/-Users-phucth-vibes-cosplay-portfolio/f4419f7f-1542-4758-a885-a732e1fc1bae/scratchpad`. In the plan, `$LOCK` means `$SCRATCH/locked-test.sh` (so `$LOCK vitest run tests/x.test.js`). Add the DB/Redis host+port variables from CLAUDE.md to the script if the backend `.env` does not provide them.
- [ ] Confirm MySQL (3307) and Redis (6380) are up: `docker compose ps`.

### Task L-1: Final verification and review (after all teammate tasks)

- [ ] Backend: `$LOCK vitest run` (full) - Expected: all green.
- [ ] Frontend: `cd frontend && npx vitest run && npm run lint && npm run build` - Expected: all green.
- [ ] Contract check: start the stack (`docker compose up -d --build`), `curl -s localhost:5000/api/gallery | head -c 600` and confirm `subAlbums` appears; hit the nested admin flow against the API with a real token (create album, create sub-album, upload an image to it via `POST /api/image`, fetch the stored image through `/api/storage/...` and confirm the tiled mark is visible).
- [ ] Spawn a `reviewer` teammate (agent-skills:code-reviewer) to review `git diff main...feat/sub-albums` against the spec; fix findings through the file's owner.
- [ ] Hand off to `superpowers:finishing-a-development-branch` (lead only). Squash to one commit before any PR (user preference); never push without asking.

---

# Team spawn prompts (what the lead must include for each teammate)

Every spawn prompt contains: (1) the "Global Constraints" and the `GET /api/gallery` contract verbatim; (2) the teammate's section of this plan (its tasks with code); (3) its owned files and the rule "never edit files you do not own - message the owner via SendMessage"; (4) the conventions from the project `CLAUDE.md` (real-DB tests never concurrent, UTC/date conventions n/a, no bare status updates n/a, i18n `{vi,en}`), the user's code-style rules (no inline comments on self-documenting code, terse), and commit rules (path-limited `git commit -- <your paths>`, retry if `.git/index.lock` exists, detailed body, no Co-Authored-By trailer, never push); (5) acceptance criteria = the task's tests green + lint clean (frontend) + full-file test run before marking complete; use superpowers TDD and verification-before-completion; (6) for `api`/`wm` the lock script path; (7) dependencies: `api-5` waits for `wm-1`; `wm-5` waits for `api-6`, `pub-6`, `adm-6`.

| Teammate | Owns | Tasks |
|---|---|---|
| `api` | `backend/migrations/050_*`, `backend/albums.js`, `backend/server.js`, `backend/tests/{albumParentSchema,albumsRoutes,galleryNesting,albumImageWatermark}.test.js` | api-1..api-6 |
| `wm` | `backend/watermark.js`, `backend/shop/images.js`, `backend/worker.js`, `backend/tests/{watermark,workerThumbnailWatermark,shopImages}.test.js`, `docs/DECISIONS.md`, `CLAUDE.md` | wm-1..wm-5 |
| `pub` | `frontend/src/pages/Portfolio.jsx`, `frontend/src/pages/portfolioAlbums.*`, `frontend/src/components/portfolio/**` | pub-1..pub-6 |
| `adm` | `frontend/src/components/{AdminAlbums,AdminAlbumForm,AdminAlbumImages,albumTree}.*` | adm-1..adm-6 |
