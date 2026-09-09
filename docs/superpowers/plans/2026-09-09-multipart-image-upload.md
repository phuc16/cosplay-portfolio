# Multipart Image Upload Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a single image upload from freezing the entire backend for every concurrent user, and cut real upload duration on slow connections by shrinking bytes client-side before they're sent.

**Architecture:** Replace base64-JSON uploads (which force Node to synchronously `JSON.parse`/`Buffer.from` a giant string, blocking its single event loop for everyone) with `multipart/form-data`, streamed via `multer` in memory-storage mode, across all 6 image-upload endpoints. On the frontend, a shared `uploadImage()` helper downscales/re-encodes any image to WebP at a capped dimension via `<canvas>` before sending it, then posts it as `FormData` — cutting transfer bytes on top of removing the server-side block.

**Tech Stack:** Node/Express, `multer` (new dependency), `sharp` (unchanged), React, native Canvas API (no new frontend dependency).

## Global Constraints

- Max upload size stays 50MB decoded, matching `shop/images.js`'s existing `MAX_UPLOAD_BYTES` — do not change this ceiling.
- Every upload is still re-encoded to WebP server-side regardless of what the client sends (unchanged `sharp` pipelines in `shop/images.js`/`server.js`).
- Buyer/admin-facing error message text must not change for cases that already have a message (oversize, invalid format, missing file) — same Vietnamese strings, just reached via a different code path.
- No new frontend dependency for downscaling — use the native Canvas API.
- Follow existing repo style: plain hyphens (` - `), never em dashes, in all comments/messages.
- `MAX_DIMENSION` for client-side downscaling is `1920`, matching the backend's own resize ceiling (`shop/images.js`'s `MAX_WIDTH`, `server.js`'s `MAX_FULL_WIDTH`) — downscaling further than the server would anyway lose no quality the server wasn't already discarding.

---

### Task 1: Shared multer upload middleware (backend)

**Files:**
- Create: `backend/shop/upload.js`
- Test: `backend/tests/uploadMiddleware.test.js`
- Modify: `backend/package.json` (add `multer` dependency)

**Interfaces:**
- Produces: `uploadSingleImage(fieldName = "file")` — returns an Express middleware. On success, populates `req.file.buffer` (a `Buffer`) and `req.body` (any other multipart form fields), then calls `next()`. On an oversized file, responds directly with `res.status(400).json({ error: "invalid_input", message: "Ảnh quá lớn, tối đa 50MB" })` (does not call `next()`).

- [ ] **Step 1: Add the `multer` dependency**

```bash
cd backend && npm install multer
```

- [ ] **Step 2: Write the failing test**

Create `backend/tests/uploadMiddleware.test.js`:

```javascript
import { describe, it, expect } from "vitest"
import express from "express"
import request from "supertest"
import { uploadSingleImage } from "../shop/upload.js"
import { MAX_UPLOAD_BYTES } from "../shop/images.js"

function buildApp() {
  const app = express()
  app.post("/test-upload", uploadSingleImage(), (req, res) => {
    res.json({
      hasBuffer: Buffer.isBuffer(req.file?.buffer),
      size: req.file?.buffer?.length || 0,
      folder: req.body.folder || null,
    })
  })
  return app
}

describe("uploadSingleImage", () => {
  it("populates req.file.buffer and req.body fields from a multipart request", async () => {
    const app = buildApp()
    const res = await request(app)
      .post("/test-upload")
      .field("folder", "misc")
      .attach("file", Buffer.from("hello"), "test.png")

    expect(res.status).toBe(200)
    expect(res.body.hasBuffer).toBe(true)
    expect(res.body.size).toBe(5)
    expect(res.body.folder).toBe("misc")
  })

  it("returns 400 invalid_input with a size-specific message when the file exceeds MAX_UPLOAD_BYTES", async () => {
    const app = buildApp()
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0)

    const res = await request(app)
      .post("/test-upload")
      .attach("file", oversized, "big.jpg")

    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
    expect(res.body.message).toContain("quá lớn")
  })

  it("calls the handler with no file when none is attached", async () => {
    const app = buildApp()
    const res = await request(app).post("/test-upload").field("folder", "misc")

    expect(res.status).toBe(200)
    expect(res.body.hasBuffer).toBe(false)
    expect(res.body.folder).toBe("misc")
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/uploadMiddleware.test.js`

Expected: FAIL — `Cannot find module '../shop/upload.js'`

- [ ] **Step 4: Write the implementation**

Create `backend/shop/upload.js`:

```javascript
const multer = require("multer")
const { MAX_UPLOAD_BYTES } = require("./images")

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
})

/**
 * multipart/form-data image upload gate. On success, req.file.buffer holds
 * the raw bytes and req.body holds any other form fields (folder, album_id,
 * etc.) - the same req.body shape express.json() used to populate for the
 * base64-JSON routes this replaces.
 *
 * Maps multer's LIMIT_FILE_SIZE error to the same 400/invalid_input shape
 * shop/images.js's own validateImageBuffer oversize check already returns,
 * so callers and existing tests see identical error text regardless of
 * which layer catches the oversize (multer here, before any bytes are ever
 * decoded, vs. validateImageBuffer downstream for a base64 payload that
 * somehow got past this gate).
 */
function uploadSingleImage(fieldName = "file") {
  const middleware = multerUpload.single(fieldName)
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: "invalid_input",
          message: `Ảnh quá lớn, tối đa ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB`,
        })
      }
      if (err) return next(err)
      next()
    })
  }
}

module.exports = { uploadSingleImage }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/uploadMiddleware.test.js`

Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/shop/upload.js backend/tests/uploadMiddleware.test.js
git commit -m "feat(shop): add multer-based multipart upload middleware

Streaming multipart parsing removes the event-loop block that
base64-JSON uploads caused (JSON.parse/Buffer.from on a large
string is synchronous and freezes the whole Node process)."
```

---

### Task 2: Migrate portfolio upload routes (server.js)

**Files:**
- Modify: `backend/server.js:711-859` (imports + 4 route handlers)
- Test: `backend/tests/portfolioImageUpload.test.js`

**Interfaces:**
- Consumes: `uploadSingleImage` from Task 1 (`backend/shop/upload.js`).
- Produces: no change to any route's response shape or URL - only the request encoding changes.

- [ ] **Step 1: Update the failing test first**

Replace `backend/tests/portfolioImageUpload.test.js` in full:

```javascript
import { describe, it, expect, afterAll } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import { closeDb } from "./helpers/db.js"

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

afterAll(async () => {
  await closeDb()
})

// processImage runs the same validateImageBuffer magic-byte/size check as
// the shop's upload routes (backend/shop/images.js), so a non-image buffer
// must be rejected with 400 here too, not handed straight to sharp.
const notAnImage = Buffer.from("this is plain text, not an image at all")

describe("portfolio image uploads reject non-image input", () => {
  it("POST /api/upload/hero 400s on a non-image buffer", async () => {
    const res = await authed(request(app).post("/api/upload/hero"))
      .attach("file", notAnImage, "not-an-image.txt")
    expect(res.status).toBe(400)
  })

  it("POST /api/upload/thumbnail 400s on a non-image buffer", async () => {
    const res = await authed(request(app).post("/api/upload/thumbnail"))
      .attach("file", notAnImage, "not-an-image.txt")
    expect(res.status).toBe(400)
  })

  it("POST /api/upload/event-image 400s on a non-image buffer", async () => {
    const res = await authed(request(app).post("/api/upload/event-image"))
      .attach("file", notAnImage, "not-an-image.txt")
    expect(res.status).toBe(400)
  })

  it("POST /api/image 400s on a non-image buffer", async () => {
    const res = await authed(request(app).post("/api/image"))
      .field("album_id", "1")
      .attach("file", notAnImage, "not-an-image.txt")
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/portfolioImageUpload.test.js`

Expected: FAIL - the routes still read `req.body.base64`, which is `undefined` for a multipart request, so each responds 400 with message "Cần ảnh (base64)" (still a 400, so 3 of 4 tests happen to pass by coincidence) but the `/api/image` test fails: `album_id` currently comes from `req.body.album_id`, and since multer hasn't been wired in yet, `express.json()` never parses this multipart body at all, so `req.body` is `{}` and the route 400s with "Cần album_id và ảnh (base64)" - still technically a 400. To make the fail meaningful, temporarily add `expect(res.body.message).not.toContain("base64")` to one test locally to confirm today's code path is exercised, then remove that assertion before Step 4 (it's a manual sanity check, not part of the committed test).

- [ ] **Step 3: Add the import**

In `backend/server.js`, find (around line 712-713):

```javascript
const sharp = require("sharp")
const { validateImageBuffer, InvalidImageError } = require("./shop/images")
```

Add the new import immediately after:

```javascript
const sharp = require("sharp")
const { validateImageBuffer, InvalidImageError } = require("./shop/images")
const { uploadSingleImage } = require("./shop/upload")
```

- [ ] **Step 4: Migrate `/api/upload/hero`**

Find (around line 760-785):

```javascript
app.post(`${API_PREFIX}/upload/hero`, auth, async (req, res) => {
  try {
    const { base64 } = req.body
    if (!base64) {
      return res.status(400).json({ error: "invalid_input", message: "Cần ảnh (base64)" })
    }
    const buffer = Buffer.from(base64, "base64")
    const sizeKb = Math.round(buffer.length / 1024)
    console.log(`[UPLOAD/HERO] size≈${sizeKb}KB`)
```

Replace with:

```javascript
app.post(`${API_PREFIX}/upload/hero`, auth, uploadSingleImage(), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "invalid_input", message: "Cần ảnh" })
    }
    const buffer = req.file.buffer
    const sizeKb = Math.round(buffer.length / 1024)
    console.log(`[UPLOAD/HERO] size≈${sizeKb}KB`)
```

- [ ] **Step 5: Migrate `/api/upload/thumbnail`**

Find (around line 787-812):

```javascript
app.post(`${API_PREFIX}/upload/thumbnail`, auth, async (req, res) => {
  try {
    const { base64 } = req.body
    if (!base64) {
      return res.status(400).json({ error: "invalid_input", message: "Cần ảnh (base64)" })
    }
    const buffer = Buffer.from(base64, "base64")
    const sizeKb = Math.round(buffer.length / 1024)
    console.log(`[UPLOAD/THUMB] size≈${sizeKb}KB`)
```

Replace with:

```javascript
app.post(`${API_PREFIX}/upload/thumbnail`, auth, uploadSingleImage(), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "invalid_input", message: "Cần ảnh" })
    }
    const buffer = req.file.buffer
    const sizeKb = Math.round(buffer.length / 1024)
    console.log(`[UPLOAD/THUMB] size≈${sizeKb}KB`)
```

- [ ] **Step 6: Migrate `/api/upload/event-image`**

Find (around line 814-838):

```javascript
app.post(`${API_PREFIX}/upload/event-image`, auth, async (req, res) => {
  try {
    const { base64 } = req.body
    if (!base64) {
      return res.status(400).json({ error: "invalid_input", message: "Cần ảnh (base64)" })
    }
    const buffer = Buffer.from(base64, "base64")
    const sizeKb = Math.round(buffer.length / 1024)
    console.log(`[UPLOAD/EVENT] size≈${sizeKb}KB`)
```

Replace with:

```javascript
app.post(`${API_PREFIX}/upload/event-image`, auth, uploadSingleImage(), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "invalid_input", message: "Cần ảnh" })
    }
    const buffer = req.file.buffer
    const sizeKb = Math.round(buffer.length / 1024)
    console.log(`[UPLOAD/EVENT] size≈${sizeKb}KB`)
```

- [ ] **Step 7: Migrate `/api/image`**

Find (around line 840-850):

```javascript
app.post(`${API_PREFIX}/image`, auth, async (req, res) => {
  try {
    const { album_id, base64 } = req.body
    if (!album_id || !base64) {
      console.warn("[IMAGE] Thiếu album_id hoặc base64")
      return res.status(400).json({ error: "invalid_input", message: "Cần album_id và ảnh (base64)" })
    }

    const buffer = Buffer.from(base64, "base64")
    const sizeKb = Math.round(buffer.length / 1024)
    console.log(`[IMAGE] Upload: album=${album_id}, size≈${sizeKb}KB`)
```

Replace with:

```javascript
app.post(`${API_PREFIX}/image`, auth, uploadSingleImage(), async (req, res) => {
  try {
    const { album_id } = req.body
    if (!album_id || !req.file) {
      console.warn("[IMAGE] Thiếu album_id hoặc ảnh")
      return res.status(400).json({ error: "invalid_input", message: "Cần album_id và ảnh" })
    }

    const buffer = req.file.buffer
    const sizeKb = Math.round(buffer.length / 1024)
    console.log(`[IMAGE] Upload: album=${album_id}, size≈${sizeKb}KB`)
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/portfolioImageUpload.test.js`

Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
git add backend/server.js backend/tests/portfolioImageUpload.test.js
git commit -m "feat(shop): migrate portfolio image upload routes to multipart

hero/thumbnail/event-image/album routes now use multer instead of
base64-JSON, removing the synchronous JSON.parse/Buffer.from step
that blocked Node's event loop for every concurrent user."
```

---

### Task 3: Migrate shop catalog image route (adminCatalog.js)

**Files:**
- Modify: `backend/routes/adminCatalog.js:1-3,241-263`
- Test: `backend/tests/adminCatalogRoutes.test.js:513-569`

**Interfaces:**
- Consumes: `uploadSingleImage` from Task 1.

- [ ] **Step 1: Update the failing test first**

In `backend/tests/adminCatalogRoutes.test.js`, replace the `describe("POST /api/admin/shop/image", ...)` block (lines 513-569) in full:

```javascript
describe("POST /api/admin/shop/image", () => {
  it("returns 400 invalid_input for a buffer that isn't an image at all", async () => {
    const garbage = Buffer.from("not a real image, just garbage bytes that are not valid webp/jpeg/png data")

    const res = await authed(request(app).post("/api/admin/shop/image"))
      .field("folder", "misc")
      .attach("file", garbage, "garbage.jpg")

    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("returns 400 invalid_input for a truncated/corrupted image buffer (not a 500)", async () => {
    // A genuine JPEG with a valid-looking header, truncated mid-body - this is what a
    // partial upload / network truncation actually produces, and sharp reports it as
    // "Input buffer has corrupt header: ..." rather than "unsupported image format".
    const realJpeg = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).jpeg().toBuffer()
    const truncated = realJpeg.subarray(0, 20)

    const res = await authed(request(app).post("/api/admin/shop/image"))
      .field("folder", "misc")
      .attach("file", truncated, "truncated.jpg")

    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
  })

  it("returns 400 invalid_input for an oversized image, rejected before sharp decode", async () => {
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0)
    oversized[0] = 0xff
    oversized[1] = 0xd8
    oversized[2] = 0xff // valid jpeg magic bytes - this must fail on size, not type

    const res = await authed(request(app).post("/api/admin/shop/image"))
      .field("folder", "misc")
      .attach("file", oversized, "big.jpg")

    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
    // The regression that matters: an admin seeing this needs to know it was
    // too big, not a generic "invalid image" that hides what to actually fix.
    expect(res.body.message).toContain("quá lớn")
  })

  it("still accepts a real, correctly-sized image", async () => {
    const real = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 128, b: 255 } },
    }).png().toBuffer()

    const res = await authed(request(app).post("/api/admin/shop/image"))
      .field("folder", "misc")
      .attach("file", real, "real.png")

    expect(res.status).toBe(201)
    expect(res.body.url).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/adminCatalogRoutes.test.js -t "POST /api/admin/shop/image"`

Expected: FAIL - route still reads `req.body.base64`, undefined for multipart, so all 4 tests fail (first 3 expect 400 but get it for the wrong reason / last expects 201 but gets 400 "Cần ảnh (base64)").

- [ ] **Step 3: Add the import**

In `backend/routes/adminCatalog.js`, find (line 1-3):

```javascript
const express = require("express")
const repo = require("../shop/catalogRepo")
const { processShopImage, storeShopImage, InvalidImageError } = require("../shop/images")
```

Replace with:

```javascript
const express = require("express")
const repo = require("../shop/catalogRepo")
const { processShopImage, storeShopImage, InvalidImageError } = require("../shop/images")
const { uploadSingleImage } = require("../shop/upload")
```

- [ ] **Step 4: Migrate the route**

Find (around line 241-263):

```javascript
  router.post("/shop/image", async (req, res) => {
    const { base64, folder } = req.body
    if (!base64) return bad(res, "Cần ảnh (base64)")

    const buffer = Buffer.from(base64, "base64")
    console.log(`[ADMIN/CATALOG] upload ảnh shop size≈${Math.round(buffer.length / 1024)}KB`)
```

Replace with:

```javascript
  router.post("/shop/image", uploadSingleImage(), async (req, res) => {
    if (!req.file) return bad(res, "Cần ảnh")
    const folder = req.body.folder

    const buffer = req.file.buffer
    console.log(`[ADMIN/CATALOG] upload ảnh shop size≈${Math.round(buffer.length / 1024)}KB`)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/adminCatalogRoutes.test.js`

Expected: PASS (all tests in the file, not just the image describe block - confirms nothing else in this file broke)

- [ ] **Step 6: Commit**

```bash
git add backend/routes/adminCatalog.js backend/tests/adminCatalogRoutes.test.js
git commit -m "feat(shop): migrate shop catalog image upload to multipart"
```

---

### Task 4: Migrate payment-proof route + remove dead base64-JSON code

**Files:**
- Modify: `backend/routes/orders.js:1-10,329-360`
- Modify: `backend/server.js:29-84,955` (remove now-dead `UPLOAD_LIMIT`/`largeJson`)
- Test: `backend/tests/paymentProof.test.js`

**Interfaces:**
- Consumes: `uploadSingleImage` from Task 1.

- [ ] **Step 1: Update the failing test first**

In `backend/tests/paymentProof.test.js`, replace the `png` helper (lines 35-36) to return a Buffer instead of base64:

Find:

```javascript
const png = () => sharp({ create: { width: 300, height: 300, channels: 3, background: "#fff" } })
  .png().toBuffer().then((b) => b.toString("base64"))
```

Replace with:

```javascript
const png = () => sharp({ create: { width: 300, height: 300, channels: 3, background: "#fff" } })
  .png().toBuffer()
```

Then replace every `.send({ base64: await png() })` in this file with `.attach("file", await png(), "proof.png")`. There are 9 occurrences (lines 57, 96, 103, 111, 117, 137, 156, 171, 187, 201 - use a project-wide find/replace within this file only, since the pattern is identical everywhere it appears).

Also update these 3 specific cases that use different bodies:

Find (line ~72-77):

```javascript
  it("rejects a non-image payload", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).post(`/api/orders/${o.order_token}/proof`))
      .send({ base64: Buffer.from("not an image at all").toString("base64") })
    expect(res.status).toBe(400)
  })
```

Replace with:

```javascript
  it("rejects a non-image payload", async () => {
    const o = await seedOrder()
    const res = await authed(request(app).post(`/api/orders/${o.order_token}/proof`))
      .attach("file", Buffer.from("not an image at all"), "not-an-image.txt")
    expect(res.status).toBe(400)
  })
```

Find (line ~79-93):

```javascript
  it("rejects an oversized proof image, before sharp decode is attempted", async () => {
    const o = await seedOrder()
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0)
    oversized[0] = 0xff
    oversized[1] = 0xd8
    oversized[2] = 0xff // valid jpeg magic bytes - must fail on size, not type

    const res = await authed(request(app).post(`/api/orders/${o.order_token}/proof`))
      .send({ base64: oversized.toString("base64") })

    expect(res.status).toBe(400)
    // The regression that matters: a buyer seeing this needs to know it was
    // too big, not a generic "invalid image" that hides what to actually fix.
    expect(res.body.message).toContain("quá lớn")
  })
```

Replace with:

```javascript
  it("rejects an oversized proof image, before sharp decode is attempted", async () => {
    const o = await seedOrder()
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0)
    oversized[0] = 0xff
    oversized[1] = 0xd8
    oversized[2] = 0xff // valid jpeg magic bytes - must fail on size, not type

    const res = await authed(request(app).post(`/api/orders/${o.order_token}/proof`))
      .attach("file", oversized, "big.jpg")

    expect(res.status).toBe(400)
    // The regression that matters: a buyer seeing this needs to know it was
    // too big, not a generic "invalid image" that hides what to actually fix.
    expect(res.body.message).toContain("quá lớn")
  })
```

Find (line ~67-70):

```javascript
  it("rejects a missing image", async () => {
    const o = await seedOrder()
    expect((await authed(request(app).post(`/api/orders/${o.order_token}/proof`)).send({})).status).toBe(400)
  })
```

Leave this one as-is - `.send({})` with no `.attach()` still exercises the "no file" path correctly (`req.file` stays `undefined`), so no change is needed here.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/paymentProof.test.js`

Expected: FAIL - route still reads `req.body.base64`, undefined for multipart requests.

- [ ] **Step 3: Add the import**

In `backend/routes/orders.js`, find (line 1-10):

```javascript
const express = require("express")
const repo = require("../shop/orders/orderRepo")
const paymentSettings = require("../shop/payments/settingsRepo")
const { buildInstructions } = require("../shop/payments/instructions")
const { processShopImage, storeShopImage, InvalidImageError } = require("../shop/images")
const emailQueue = require("../shop/email/queue")
const qr = require("../shop/orders/qr")
const db = require("../db")
const { orderAccess, verifyPin, issueOrderSessionToken } = require("../shop/orders/orderAccess")
const { formatOrderCode } = require("../shop/orders/domain")
```

Replace with:

```javascript
const express = require("express")
const repo = require("../shop/orders/orderRepo")
const paymentSettings = require("../shop/payments/settingsRepo")
const { buildInstructions } = require("../shop/payments/instructions")
const { processShopImage, storeShopImage, InvalidImageError } = require("../shop/images")
const { uploadSingleImage } = require("../shop/upload")
const emailQueue = require("../shop/email/queue")
const qr = require("../shop/orders/qr")
const db = require("../db")
const { orderAccess, verifyPin, issueOrderSessionToken } = require("../shop/orders/orderAccess")
const { formatOrderCode } = require("../shop/orders/domain")
```

- [ ] **Step 4: Migrate the route**

Find (around line 329-358):

```javascript
  router.post("/:token/proof", orderAccess, async (req, res) => {
    try {
      const { base64 } = req.body
      if (!base64) return bad(res, "Cần ảnh chuyển khoản")

      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      // Once confirmed there is nothing left to prove, and accepting an upload
      // would let anyone with the link overwrite the evidence after the fact.
      if (order.status !== "pending") {
        return res.status(409).json({
          error: "invalid_state",
          message: "Đơn hàng đã được xử lý, không cần tải ảnh nữa",
        })
      }

      // Decoding/processing failures mean the input itself is bad (corrupt,
      // truncated, too large, or an unsupported format) - always a 400.
      // InvalidImageError's message is written for the buyer (e.g. "too
      // large, max 50MB") and safe to show as-is; any other error is an
      // unexpected sharp failure, so it falls back to a generic message
      // rather than leaking internals. Storage failures below are real
      // server errors and fall through to the outer catch.
      let processed
      try {
        processed = await processShopImage(Buffer.from(base64, "base64"))
      } catch (err) {
        return bad(res, err instanceof InvalidImageError ? err.message : "Ảnh không hợp lệ")
      }
```

Replace with:

```javascript
  router.post("/:token/proof", orderAccess, uploadSingleImage(), async (req, res) => {
    try {
      if (!req.file) return bad(res, "Cần ảnh chuyển khoản")

      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      // Once confirmed there is nothing left to prove, and accepting an upload
      // would let anyone with the link overwrite the evidence after the fact.
      if (order.status !== "pending") {
        return res.status(409).json({
          error: "invalid_state",
          message: "Đơn hàng đã được xử lý, không cần tải ảnh nữa",
        })
      }

      // Decoding/processing failures mean the input itself is bad (corrupt,
      // truncated, too large, or an unsupported format) - always a 400.
      // InvalidImageError's message is written for the buyer (e.g. "too
      // large, max 50MB") and safe to show as-is; any other error is an
      // unexpected sharp failure, so it falls back to a generic message
      // rather than leaking internals. Storage failures below are real
      // server errors and fall through to the outer catch.
      let processed
      try {
        processed = await processShopImage(req.file.buffer)
      } catch (err) {
        return bad(res, err instanceof InvalidImageError ? err.message : "Ảnh không hợp lệ")
      }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run tests/paymentProof.test.js`

Expected: PASS (all tests)

- [ ] **Step 6: Remove now-dead base64-JSON code from server.js**

All 6 image-upload routes are now migrated - `largeJson`/`UPLOAD_LIMIT` have no remaining caller. Find (around line 29-42):

```javascript
app.set("trust proxy", 2)
// Images are capped at 50MB decoded (shop/images.js MAX_UPLOAD_BYTES); base64
// inflates that by ~4/3, plus a little JSON overhead - 70mb comfortably fits
// the largest image this app will ever accept.
const UPLOAD_LIMIT = "70mb"
// A VTP result spreadsheet is at most MAX_IMPORT_ROWS (200) data rows of
// plain text - a few hundred KB even with formatting. 10mb is a generous
// ceiling for that, far below the image limit, so a malformed/huge
// upload here can't be used to bypass the image path's specific tuning.
const IMPORT_LIMIT = "10mb"
const TRACKING_IMPORT_PREVIEW_PATH = "/api/admin/shipping/tracking-import/preview"
const largeJson = express.json({ limit: UPLOAD_LIMIT })
const importJson = express.json({ limit: IMPORT_LIMIT })
const smallJson = express.json({ limit: "1mb" })
```

Replace with:

```javascript
app.set("trust proxy", 2)
// A VTP result spreadsheet is at most MAX_IMPORT_ROWS (200) data rows of
// plain text - a few hundred KB even with formatting. 10mb is a generous
// ceiling for that.
const IMPORT_LIMIT = "10mb"
const SMALL_LIMIT = "1mb"
const TRACKING_IMPORT_PREVIEW_PATH = "/api/admin/shipping/tracking-import/preview"
const importJson = express.json({ limit: IMPORT_LIMIT })
const smallJson = express.json({ limit: SMALL_LIMIT })
```

Find (around line 66-73):

```javascript
app.use((req, res, next) => {
  if (req.method === "POST" && /^\/api\/(image$|upload\/|admin\/shop\/image$|orders\/[^/]+\/proof$)/.test(req.path)) {
    return largeJson(req, res, next)
  }
  if (req.method === "POST" && req.path === TRACKING_IMPORT_PREVIEW_PATH) {
    return importJson(req, res, next)
  }
  return smallJson(req, res, next)
})
```

Replace with:

```javascript
app.use((req, res, next) => {
  if (req.method === "POST" && req.path === TRACKING_IMPORT_PREVIEW_PATH) {
    return importJson(req, res, next)
  }
  return smallJson(req, res, next)
})
```

Find (around line 75-84):

```javascript
// Error handler for payload too large (413) - must be immediately after body-parser
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    const isTrackingImport = req.path === TRACKING_IMPORT_PREVIEW_PATH
    const limit = isTrackingImport ? IMPORT_LIMIT : UPLOAD_LIMIT
    const message = isTrackingImport
      ? `File quá lớn. Giới hạn: ${IMPORT_LIMIT}. Hãy dùng file kết quả ViettelPost nhỏ hơn.`
      : `Ảnh quá lớn. Giới hạn: ${UPLOAD_LIMIT}. Hãy chọn ảnh nhỏ hơn hoặc nén trước khi upload.`
    console.error(`[ERROR] Payload too large: ${req.url} - limit ${limit}`)
    return res.status(413).json({ error: "payload_too_large", message })
  }
  next(err)
})
```

Replace with:

```javascript
// Error handler for payload too large (413) - must be immediately after body-parser
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    const isTrackingImport = req.path === TRACKING_IMPORT_PREVIEW_PATH
    const limit = isTrackingImport ? IMPORT_LIMIT : SMALL_LIMIT
    const message = isTrackingImport
      ? `File quá lớn. Giới hạn: ${IMPORT_LIMIT}. Hãy dùng file kết quả ViettelPost nhỏ hơn.`
      : `Dữ liệu gửi lên quá lớn. Giới hạn: ${SMALL_LIMIT}.`
    console.error(`[ERROR] Payload too large: ${req.url} - limit ${limit}`)
    return res.status(413).json({ error: "payload_too_large", message })
  }
  next(err)
})
```

Find the one other remaining `UPLOAD_LIMIT` reference (search `grep -n UPLOAD_LIMIT backend/server.js` to locate it - it's in the startup log line, around line 955):

```javascript
    console.log(`[SERVER] Backend listening on :5000, body limit ${UPLOAD_LIMIT}`)
```

Replace with:

```javascript
    console.log(`[SERVER] Backend listening on :5000`)
```

Confirm no other reference remains: `grep -n "UPLOAD_LIMIT\|largeJson" backend/server.js` must print nothing.

- [ ] **Step 7: Run the full backend suite to confirm the cleanup didn't break anything else**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run`

Expected: PASS (all files, all tests - this touches shared server.js middleware used by every route, so the full suite is the right scope here, not just the files this task edited)

- [ ] **Step 8: Commit**

```bash
git add backend/routes/orders.js backend/server.js backend/tests/paymentProof.test.js
git commit -m "feat(shop): migrate payment-proof upload to multipart, remove dead base64-JSON code

All 6 image-upload routes are now multipart/form-data. UPLOAD_LIMIT/
largeJson had no remaining caller after this - removed rather than
left as dead code, along with simplifying the payload-too-large
error handler down to the two limits still actually in use."
```

---

### Task 5: Client-side image downscaling utility (frontend)

**Files:**
- Create: `frontend/src/utils/imageDownscale.js`
- Test: `frontend/src/utils/imageDownscale.test.js`

**Interfaces:**
- Produces: `MAX_DIMENSION` (`1920`), `DOWNSCALE_QUALITY` (`0.82`), `computeDownscaleDimensions(width, height, maxDimension)` - pure function, returns `{ width, height }` scaled down to fit within `maxDimension` on the longer side, preserving aspect ratio, never upscaling. `downscaleImage(file)` - returns a `Promise<File>`; resolves to a re-encoded WebP `File` at the capped dimension, or the original `file` unchanged if it isn't an image, or if canvas/decode fails for any reason (never rejects - a failed downscale must not block the upload itself; the server's own `sharp` pipeline is the real safety net either way).

Note: per this codebase's established pattern for browser-API code jsdom cannot exercise (`AdminQrScanner.jsx`'s doc comment: "the surrounding camera/canvas code, which jsdom cannot exercise"), only `computeDownscaleDimensions` is unit tested here. `downscaleImage` itself (the `<canvas>`/`Image` orchestration) is verified manually in Task 6, since jsdom has no real canvas/image-decode backend.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/utils/imageDownscale.test.js`:

```javascript
import { describe, it, expect } from "vitest"
import { computeDownscaleDimensions, MAX_DIMENSION } from "./imageDownscale"

describe("computeDownscaleDimensions", () => {
  it("leaves an image already within the cap unchanged", () => {
    expect(computeDownscaleDimensions(800, 600, MAX_DIMENSION)).toEqual({ width: 800, height: 600 })
  })

  it("scales down a wide image to fit the cap on its longer side", () => {
    expect(computeDownscaleDimensions(4000, 3000, 1920)).toEqual({ width: 1920, height: 1440 })
  })

  it("scales down a tall image to fit the cap on its longer side", () => {
    expect(computeDownscaleDimensions(3000, 4000, 1920)).toEqual({ width: 1440, height: 1920 })
  })

  it("never upscales an image smaller than the cap", () => {
    expect(computeDownscaleDimensions(100, 50, 1920)).toEqual({ width: 100, height: 50 })
  })

  it("rounds fractional dimensions to whole pixels", () => {
    expect(computeDownscaleDimensions(4001, 3000, 1920)).toEqual({ width: 1920, height: 1440 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/utils/imageDownscale.test.js`

Expected: FAIL - `Cannot find module './imageDownscale'`

- [ ] **Step 3: Write the implementation**

Create `frontend/src/utils/imageDownscale.js`:

```javascript
// Matches the backend's own resize ceiling (shop/images.js MAX_WIDTH,
// server.js MAX_FULL_WIDTH) - downscaling further than the server would
// anyway loses no quality the server wasn't already going to discard,
// while cutting upload bytes (and therefore transfer time) for any photo
// the server was going to shrink either way.
export const MAX_DIMENSION = 1920
export const DOWNSCALE_QUALITY = 0.82

/** Pure dimension math - never upscales, always fits the longer side to maxDimension. */
export function computeDownscaleDimensions(width, height, maxDimension) {
  const scale = Math.min(1, maxDimension / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * Downscales and re-encodes an image File to WebP via <canvas>, capped at
 * MAX_DIMENSION on its longer side. Falls back to returning the original
 * file unchanged on any failure (non-image input, decode error, canvas
 * unsupported) - a failed downscale must never block the upload itself,
 * since the server re-encodes every upload through sharp anyway regardless
 * of what the client sends.
 */
export function downscaleImage(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) return Promise.resolve(file)

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      try {
        const { width, height } = computeDownscaleDimensions(img.naturalWidth, img.naturalHeight, MAX_DIMENSION)
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) return resolve(file)
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          (blob) => resolve(blob ? new File([blob], file.name, { type: "image/webp" }) : file),
          "image/webp",
          DOWNSCALE_QUALITY
        )
      } catch {
        resolve(file)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(file)
    }
    img.src = objectUrl
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/utils/imageDownscale.test.js`

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/imageDownscale.js frontend/src/utils/imageDownscale.test.js
git commit -m "feat(shop): add client-side image downscale utility

Shrinks an image to 1920px on its longer side and re-encodes to
WebP via canvas before upload, cutting transfer bytes (and
therefore duration) on a slow connection. Falls back to the
original file on any failure - the server's own sharp pipeline
re-encodes every upload regardless, so this is a bandwidth
optimization, not a correctness dependency."
```

---

### Task 6: Shared frontend upload helper + wire into api/shop.js

**Files:**
- Create: `frontend/src/api/upload.js`
- Test: `frontend/src/api/upload.test.js`
- Modify: `frontend/src/api/shop.js:57-58,99-100`

**Interfaces:**
- Consumes: `downscaleImage` from Task 5 (`frontend/src/utils/imageDownscale.js`).
- Produces: `uploadImage(url, file, extraFields = {}, config = {})` - downscales `file`, builds a `FormData` with it under the `"file"` field plus any `extraFields`, POSTs via the shared `api` axios instance, returns `Promise<responseData>` (mirrors every other function in `api/shop.js`, which all resolve to `r.data`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/upload.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../utils/imageDownscale", () => ({
  downscaleImage: vi.fn((file) => Promise.resolve(file)),
}))
vi.mock("./api", () => ({
  api: { post: vi.fn(() => Promise.resolve({ data: { url: "https://example.com/img.webp" } })) },
}))

import { uploadImage } from "./upload"
import { api } from "./api"
import { downscaleImage } from "../utils/imageDownscale"

beforeEach(() => {
  api.post.mockClear()
  downscaleImage.mockClear()
})

describe("uploadImage", () => {
  it("downscales the file, then posts it as FormData under the 'file' field", async () => {
    const file = new File(["x"], "photo.png", { type: "image/png" })
    const data = await uploadImage("/api/admin/shop/image", file)

    expect(downscaleImage).toHaveBeenCalledWith(file)
    expect(api.post).toHaveBeenCalledTimes(1)
    const [url, body] = api.post.mock.calls[0]
    expect(url).toBe("/api/admin/shop/image")
    expect(body).toBeInstanceOf(FormData)
    expect(body.get("file")).toBe(file)
    expect(data).toEqual({ url: "https://example.com/img.webp" })
  })

  it("appends extraFields onto the FormData", async () => {
    const file = new File(["x"], "photo.png", { type: "image/png" })
    await uploadImage("/api/admin/shop/image", file, { folder: "collections" })

    const [, body] = api.post.mock.calls[0]
    expect(body.get("folder")).toBe("collections")
  })

  it("passes config (e.g. headers) through to api.post", async () => {
    const file = new File(["x"], "photo.png", { type: "image/png" })
    await uploadImage("/api/orders/tok/proof", file, {}, { headers: { "X-Test": "1" } })

    const [, , config] = api.post.mock.calls[0]
    expect(config).toEqual({ headers: { "X-Test": "1" } })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/api/upload.test.js`

Expected: FAIL - `Cannot find module './upload'`

- [ ] **Step 3: Write the implementation**

Create `frontend/src/api/upload.js`:

```javascript
import { api } from "./api"
import { downscaleImage } from "../utils/imageDownscale"

/**
 * Shared upload path for every image-upload call site (portfolio hero/
 * thumbnail/event/album images, shop catalog images, buyer payment-proof
 * screenshots). Downscales the file client-side first (cuts transfer bytes
 * on a slow connection), then sends it as multipart/form-data - the server
 * side no longer accepts base64-in-JSON, since JSON.parse on a large
 * string blocks Node's single event loop for every concurrent user.
 */
export async function uploadImage(url, file, extraFields = {}, config = {}) {
  const processed = await downscaleImage(file)
  const formData = new FormData()
  formData.append("file", processed)
  for (const [key, value] of Object.entries(extraFields)) {
    formData.append(key, value)
  }
  const res = await api.post(url, formData, config)
  return res.data
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/api/upload.test.js`

Expected: PASS (3 tests)

- [ ] **Step 5: Wire `adminUploadImage`/`uploadPaymentProof` through the helper**

In `frontend/src/api/shop.js`, add the import at the top (line 1):

```javascript
import { api } from "./api"
import { uploadImage } from "./upload"
```

Find (line 57-58):

```javascript
export const adminUploadImage = (base64, folder) =>
  api.post("/api/admin/shop/image", { base64, folder }).then((r) => r.data)
```

Replace with:

```javascript
export const adminUploadImage = (file, folder) =>
  uploadImage("/api/admin/shop/image", file, { folder })
```

Find (line 99-100):

```javascript
export const uploadPaymentProof = (token, base64, headers = {}) =>
  api.post(`/api/orders/${token}/proof`, { base64 }, { headers }).then((r) => r.data)
```

Replace with:

```javascript
export const uploadPaymentProof = (token, file, headers = {}) =>
  uploadImage(`/api/orders/${token}/proof`, file, {}, { headers })
```

- [ ] **Step 6: Run the frontend suite to confirm nothing else broke**

Run: `cd frontend && npm test -- --run`

Expected: same baseline as before this task (40 files / 516 tests, plus the 3 new tests from this task and 5 from Task 5 = 524 tests) - no caller of `adminUploadImage`/`uploadPaymentProof` has been updated yet (that's Tasks 7-12), so nothing calls these with the new `File`-first signature yet; this step only confirms the file compiles/imports cleanly.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/upload.js frontend/src/api/upload.test.js frontend/src/api/shop.js
git commit -m "feat(shop): add shared uploadImage helper, wire into api/shop.js

adminUploadImage/uploadPaymentProof now take a File instead of a
base64 string and send multipart/form-data. Callers are updated in
the next few tasks - this task only changes the shared surface."
```

---

### Task 7: Migrate AdminSettings.jsx (portfolio hero/thumbnail/event images)

**Files:**
- Modify: `frontend/src/components/AdminSettings.jsx:1-25,49-69,491-537`

**Interfaces:**
- Consumes: `uploadImage` from Task 6 (`frontend/src/api/upload.js`).

- [ ] **Step 1: Add the import**

Find (line 1-2):

```javascript
import { useState, useEffect, useRef, useCallback } from "react"
import { api } from "../api/api"
```

Replace with:

```javascript
import { useState, useEffect, useRef, useCallback } from "react"
import { api } from "../api/api"
import { uploadImage } from "../api/upload"
```

- [ ] **Step 2: Migrate `ImageUpload`'s `onDrop`**

Find (line 11-25):

```javascript
  const onDrop = (files) => {
    if (!files[0]) return
    setError("")
    setUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(",")[1]
      api
        .post(endpoint, { base64 })
        .then((r) => onUpload(r.data.url))
        .catch((err) => setError(err.response?.data?.message || "Upload thất bại"))
        .finally(() => setUploading(false))
    }
    reader.readAsDataURL(files[0])
  }
```

Replace with:

```javascript
  const onDrop = (files) => {
    if (!files[0]) return
    setError("")
    setUploading(true)
    uploadImage(endpoint, files[0])
      .then((data) => onUpload(data.url))
      .catch((err) => setError(err.response?.data?.message || "Upload thất bại"))
      .finally(() => setUploading(false))
  }
```

- [ ] **Step 3: Migrate `ClickUpload`'s `handleChange`**

Find (line 54-69):

```javascript
  const handleChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(",")[1]
      api
        .post(endpoint, { base64 })
        .then((r) => onUrl(r.data.url))
        .catch(() => {})
        .finally(() => setUploading(false))
    }
    reader.readAsDataURL(file)
  }
```

Replace with:

```javascript
  const handleChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setUploading(true)
    uploadImage(endpoint, file)
      .then((data) => onUrl(data.url))
      .catch(() => {})
      .finally(() => setUploading(false))
  }
```

- [ ] **Step 4: Migrate `onHeroImagesDrop`**

Find (line 491-509):

```javascript
  const onHeroImagesDrop = (files) => {
    if (!files.length) return
    setHeroImagesUploadError("")
    setHeroImagesUploading(true)
    const uploadOne = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = reader.result.split(",")[1]
          api.post("/api/upload/thumbnail", { base64 })
            .then((r) => { addHeroImage(r.data.url, r.data.accentColor); resolve() })
            .catch(reject)
        }
        reader.readAsDataURL(file)
      })
    Promise.all(files.map(uploadOne))
      .catch((err) => setHeroImagesUploadError(err.response?.data?.message || err.message || "Upload thất bại"))
      .finally(() => setHeroImagesUploading(false))
  }
```

Replace with:

```javascript
  const onHeroImagesDrop = (files) => {
    if (!files.length) return
    setHeroImagesUploadError("")
    setHeroImagesUploading(true)
    const uploadOne = (file) =>
      uploadImage("/api/upload/thumbnail", file).then((data) => addHeroImage(data.url, data.accentColor))
    Promise.all(files.map(uploadOne))
      .catch((err) => setHeroImagesUploadError(err.response?.data?.message || err.message || "Upload thất bại"))
      .finally(() => setHeroImagesUploading(false))
  }
```

- [ ] **Step 5: Migrate `onLatestDrop`**

Find (line 519-536):

```javascript
  const onLatestDrop = (files) => {
    if (!files.length) return
    setLatestUploadError("")
    setLatestUploading(true)
    const uploadOne = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          api.post("/api/upload/thumbnail", { base64: reader.result.split(",")[1] })
            .then((r) => { setDirty(true); setConfig((prev) => ({ ...prev, latestPhotos: [...(prev.latestPhotos || []), r.data.url] })); resolve() })
            .catch(reject)
        }
        reader.readAsDataURL(file)
      })
    Promise.all(files.map(uploadOne))
      .catch((err) => setLatestUploadError(err.response?.data?.message || err.message || "Upload thất bại"))
      .finally(() => setLatestUploading(false))
  }
```

Replace with:

```javascript
  const onLatestDrop = (files) => {
    if (!files.length) return
    setLatestUploadError("")
    setLatestUploading(true)
    const uploadOne = (file) =>
      uploadImage("/api/upload/thumbnail", file).then((data) => {
        setDirty(true)
        setConfig((prev) => ({ ...prev, latestPhotos: [...(prev.latestPhotos || []), data.url] }))
      })
    Promise.all(files.map(uploadOne))
      .catch((err) => setLatestUploadError(err.response?.data?.message || err.message || "Upload thất bại"))
      .finally(() => setLatestUploading(false))
  }
```

- [ ] **Step 6: Verify manually**

`npm run dev` in `frontend/`, log into `/admin`, and in Settings: upload a hero image via drag-drop, upload a logo via click-upload, upload an event image, drag-drop a hero carousel image, and drag-drop a latest-photo. Confirm each preview renders and no console error appears. This exercises the real `<canvas>`/`Image` downscale path that jsdom cannot - this is the manual verification Task 5 deferred to here.

- [ ] **Step 7: Run the frontend suite**

Run: `cd frontend && npm test -- --run`

Expected: no new failures (AdminSettings.jsx has no dedicated test file today, so this step confirms nothing else regressed)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/AdminSettings.jsx
git commit -m "feat(shop): migrate AdminSettings image uploads to uploadImage helper"
```

---

### Task 8: Migrate AdminAlbumImages.jsx

**Files:**
- Modify: `frontend/src/components/AdminAlbumImages.jsx:1-42`

**Interfaces:**
- Consumes: `uploadImage` from Task 6.

- [ ] **Step 1: Add the import and an `uploading` guard state**

Find (line 1-11):

```javascript
import { useState, useEffect } from "react"
import { api } from "../api/api"
import { useDropzone } from "react-dropzone"

export default function AdminAlbumImages({ album, onClose }) {
  const [gallery, setGallery] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploadError, setUploadError] = useState("")
  const [error, setError] = useState("")
  const [draggedId, setDraggedId] = useState(null)
  const [reorderPending, setReorderPending] = useState(false)
```

Replace with:

```javascript
import { useState, useEffect } from "react"
import { api } from "../api/api"
import { uploadImage } from "../api/upload"
import { useDropzone } from "react-dropzone"

export default function AdminAlbumImages({ album, onClose }) {
  const [gallery, setGallery] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploadError, setUploadError] = useState("")
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [draggedId, setDraggedId] = useState(null)
  const [reorderPending, setReorderPending] = useState(false)
```

- [ ] **Step 2: Migrate `onDrop` and disable the dropzone while uploading**

Find (line 24-42):

```javascript
  const onDrop = (files) => {
    setUploadError("")
    files.forEach((f) => {
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = reader.result.split(",")[1]
        api
          .post("/api/image", { album_id: album.id, base64 })
          .then(() => fetchGallery())
          .catch((err) => {
            const msg = err.response?.data?.message || err.message || "Upload thất bại"
            setUploadError(msg)
          })
      }
      reader.readAsDataURL(f)
    })
  }

  const { getRootProps, getInputProps } = useDropzone({ onDrop, accept: { "image/*": [] } })
```

Replace with:

```javascript
  const onDrop = (files) => {
    if (!files.length) return
    setUploadError("")
    setUploading(true)
    Promise.all(
      files.map((f) =>
        uploadImage("/api/image", f, { album_id: album.id }).catch((err) => {
          const msg = err.response?.data?.message || err.message || "Upload thất bại"
          setUploadError(msg)
        })
      )
    )
      .then(() => fetchGallery())
      .finally(() => setUploading(false))
  }

  const { getRootProps, getInputProps } = useDropzone({ onDrop, accept: { "image/*": [] }, disabled: uploading })
```

- [ ] **Step 3: Verify manually**

`npm run dev`, open an album in `/admin`, drag-drop 2-3 images at once, confirm they all appear and the dropzone shows disabled while uploading (matches the `disabled: uploading` pattern already used elsewhere in `AdminSettings.jsx`).

- [ ] **Step 4: Run the frontend suite**

Run: `cd frontend && npm test -- --run`

Expected: no new failures (no dedicated test file for this component)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminAlbumImages.jsx
git commit -m "feat(shop): migrate AdminAlbumImages upload to uploadImage helper, disable dropzone while uploading"
```

---

### Task 9: Migrate AdminVariants.jsx

**Files:**
- Modify: `frontend/src/components/AdminVariants.jsx` (imports, `batchUpload`, `pickImages`, `pickThumbnail`, and their file inputs)

**Interfaces:**
- Consumes: `adminUploadImage` from Task 6 (already migrated to take a `File`).

- [ ] **Step 1: Find the current import of `adminUploadImage`**

Run: `grep -n "adminUploadImage" frontend/src/components/AdminVariants.jsx` to confirm the import line - it's imported from `../api/shop` alongside other functions already, no import change needed since `adminUploadImage`'s signature changed (Task 6) but its import path/name did not.

- [ ] **Step 2: Migrate `batchUpload`**

Find (line 89-112):

```javascript
  const batchUpload = async (files) => {
    setError("")
    setBatchUploading(true)
    try {
      const uploaded = []
      for (const file of files) {
        try {
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result).split(",")[1])
            reader.onerror = () => reject(new Error("Không đọc được file ảnh"))
            reader.readAsDataURL(file)
          })
          const { url } = await adminUploadImage(base64, `products/${product.id}/variants`)
          uploaded.push({ label: stripExt(file.name), stock_qty: "", images: [url] })
        } catch (e) {
          setError(e.response?.data?.message || e.message || `Tải ảnh "${file.name}" thất bại`)
        }
      }
      if (uploaded.length) setRows([...rows.filter((r) => r.label.trim()), ...uploaded])
    } finally {
      setBatchUploading(false)
    }
  }
```

Replace with:

```javascript
  const batchUpload = async (files) => {
    setError("")
    setBatchUploading(true)
    try {
      const uploaded = []
      for (const file of files) {
        try {
          const { url } = await adminUploadImage(file, `products/${product.id}/variants`)
          uploaded.push({ label: stripExt(file.name), stock_qty: "", images: [url] })
        } catch (e) {
          setError(e.response?.data?.message || e.message || `Tải ảnh "${file.name}" thất bại`)
        }
      }
      if (uploaded.length) setRows([...rows.filter((r) => r.label.trim()), ...uploaded])
    } finally {
      setBatchUploading(false)
    }
  }
```

- [ ] **Step 3: Migrate `pickImages` and add an uploading guard**

Find (line 120-138):

```javascript
  const pickImages = async (i, files) => {
    setError("")
    for (const file of files) {
      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).split(",")[1])
          reader.onerror = () => reject(new Error("Không đọc được file ảnh"))
          reader.readAsDataURL(file)
        })
        const { url } = await adminUploadImage(base64, `products/${product.id}/variants`)
        setRows((prev) => prev.map((r, idx) => (
          idx === i ? { ...r, images: [...(r.images || []), url] } : r
        )))
      } catch (e) {
        setError(e.response?.data?.message || e.message || `Tải ảnh "${file.name}" thất bại`)
      }
    }
  }
```

Replace with:

```javascript
  const pickImages = async (i, files) => {
    setError("")
    setBatchUploading(true)
    try {
      for (const file of files) {
        try {
          const { url } = await adminUploadImage(file, `products/${product.id}/variants`)
          setRows((prev) => prev.map((r, idx) => (
            idx === i ? { ...r, images: [...(r.images || []), url] } : r
          )))
        } catch (e) {
          setError(e.response?.data?.message || e.message || `Tải ảnh "${file.name}" thất bại`)
        }
      }
    } finally {
      setBatchUploading(false)
    }
  }
```

Note: this reuses the existing `batchUploading` state (already declared, already disables the batch-upload file input) as the shared busy-guard for per-row uploads too, rather than introducing a second, near-identical state variable - one "an upload is in flight" flag for this component is enough since a seller isn't expected to fire off two uploads in this panel simultaneously.

- [ ] **Step 4: Migrate `pickThumbnail`**

Find (line 148-162):

```javascript
  const pickThumbnail = async (i, file) => {
    setError("")
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(",")[1])
        reader.onerror = () => reject(new Error("Không đọc được file ảnh"))
        reader.readAsDataURL(file)
      })
      const { url } = await adminUploadImage(base64, `products/${product.id}/variants`)
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, thumbnail_image: url } : r)))
    } catch (e) {
      setError(e.response?.data?.message || e.message || `Tải ảnh "${file.name}" thất bại`)
    }
  }
```

Replace with:

```javascript
  const pickThumbnail = async (i, file) => {
    setError("")
    setBatchUploading(true)
    try {
      const { url } = await adminUploadImage(file, `products/${product.id}/variants`)
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, thumbnail_image: url } : r)))
    } catch (e) {
      setError(e.response?.data?.message || e.message || `Tải ảnh "${file.name}" thất bại`)
    } finally {
      setBatchUploading(false)
    }
  }
```

- [ ] **Step 5: Disable the per-row file inputs while `batchUploading`**

Run: `grep -n 'type="file"' frontend/src/components/AdminVariants.jsx` to find the two per-row inputs (around line 316 for `pickImages`, line 331 for `pickThumbnail`). Read the surrounding ~10 lines of each with the Read tool, then add `disabled={batchUploading}` alongside their existing `type="file"` attribute, matching the batch-upload input's existing pattern (line 232: `disabled={batchUploading}`). Since the exact JSX indentation/surrounding props at these two call sites isn't reproduced verbatim in this plan, use the Read tool on `frontend/src/components/AdminVariants.jsx` around those two line numbers before editing, to match existing formatting exactly.

- [ ] **Step 6: Verify manually**

`npm run dev`, open a product's variants in `/admin`, batch-upload a folder of images, pick a single row's image, pick a row's thumbnail. Confirm all three flows still work and each disables its input while in flight.

- [ ] **Step 7: Run the frontend suite**

Run: `cd frontend && npm test -- --run`

Expected: no new failures (no dedicated test file for this component)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/AdminVariants.jsx
git commit -m "feat(shop): migrate AdminVariants image uploads to uploadImage helper, guard per-row inputs while uploading"
```

---

### Task 10: Migrate AdminCollections.jsx

**Files:**
- Modify: `frontend/src/components/AdminCollections.jsx:1-86,296-305`

**Interfaces:**
- Consumes: `adminUploadImage` from Task 6.

- [ ] **Step 1: Add an `uploading` state**

Read the top of `frontend/src/components/AdminCollections.jsx` (state declarations around line 57-66) with the Read tool to match exact formatting, then add `const [uploading, setUploading] = useState(false)` alongside the existing `useState` declarations there.

- [ ] **Step 2: Migrate `upload`**

Find (line 72-86):

```javascript
  const upload = async (file, field) => {
    setError("")
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(",")[1])
        reader.onerror = () => reject(new Error("Không đọc được file ảnh"))
        reader.readAsDataURL(file)
      })
      const { url } = await adminUploadImage(base64, "collections")
      setDraft((d) => ({ ...d, [field]: url }))
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Tải ảnh lên thất bại")
    }
  }
```

Replace with:

```javascript
  const upload = async (file, field) => {
    setError("")
    setUploading(true)
    try {
      const { url } = await adminUploadImage(file, "collections")
      setDraft((d) => ({ ...d, [field]: url }))
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Tải ảnh lên thất bại")
    } finally {
      setUploading(false)
    }
  }
```

- [ ] **Step 3: Disable both file inputs while uploading**

Find (line 296-305, the two cover/thumbnail image inputs):

```javascript
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "cover_image")} className="block mt-1" />
```

Replace with:

```javascript
            <input type="file" accept="image/*" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "cover_image")} className="block mt-1" />
```

Find:

```javascript
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "thumbnail_image")} className="block mt-1" />
```

Replace with:

```javascript
            <input type="file" accept="image/*" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "thumbnail_image")} className="block mt-1" />
```

(Read the file with the Read tool first to get exact current indentation/surrounding lines before editing - the two lines above are reproduced from earlier research in this same session and should match, but verify before replacing.)

- [ ] **Step 4: Verify manually**

`npm run dev`, create/edit a collection in `/admin`, upload a cover image and a thumbnail image, confirm both work and disable while uploading.

- [ ] **Step 5: Run the frontend suite**

Run: `cd frontend && npm test -- --run`

Expected: no new failures (no dedicated test file for this component)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AdminCollections.jsx
git commit -m "feat(shop): migrate AdminCollections image uploads to uploadImage helper, disable inputs while uploading"
```

---

### Task 11: Migrate AdminProducts.jsx

**Files:**
- Modify: `frontend/src/components/AdminProducts.jsx:37-73,218-223`

**Interfaces:**
- Consumes: `adminUploadImage` from Task 6.

- [ ] **Step 1: Add an `uploading` state**

Find (line 37-47):

```javascript
export default function AdminProducts({ collection }) {
  const [products, setProducts] = useState([])
  const [draft, setDraft] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState("")
  const [expandedProductId, setExpandedProductId] = useState(null)
  const [draggedId, setDraggedId] = useState(null)
  const [reorderPending, setReorderPending] = useState(false)
  const [search, setSearch] = useState("")
  const [stockFilter, setStockFilter] = useState("")
  const [sortBy, setSortBy] = useState("default")
```

Replace with:

```javascript
export default function AdminProducts({ collection }) {
  const [products, setProducts] = useState([])
  const [draft, setDraft] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState("")
  const [uploading, setUploading] = useState(false)
  const [expandedProductId, setExpandedProductId] = useState(null)
  const [draggedId, setDraggedId] = useState(null)
  const [reorderPending, setReorderPending] = useState(false)
  const [search, setSearch] = useState("")
  const [stockFilter, setStockFilter] = useState("")
  const [sortBy, setSortBy] = useState("default")
```

- [ ] **Step 2: Migrate `pickImage`**

Find (line 59-73):

```javascript
  const pickImage = async (file) => {
    setError("")
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(",")[1])
        reader.onerror = () => reject(new Error("Không đọc được file ảnh"))
        reader.readAsDataURL(file)
      })
      const { url } = await adminUploadImage(base64, `products/${collection.id}`)
      setDraft((d) => ({ ...d, images: [...(d.images || []), url] }))
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Tải ảnh lên thất bại")
    }
  }
```

Replace with:

```javascript
  const pickImage = async (file) => {
    setError("")
    setUploading(true)
    try {
      const { url } = await adminUploadImage(file, `products/${collection.id}`)
      setDraft((d) => ({ ...d, images: [...(d.images || []), url] }))
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Tải ảnh lên thất bại")
    } finally {
      setUploading(false)
    }
  }
```

- [ ] **Step 3: Disable the file input while uploading**

Find (line 218-223):

```javascript
      <input
        type="file"
        accept="image/*"
        onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])}
        className="mb-2 text-sm"
      />
```

Replace with:

```javascript
      <input
        type="file"
        accept="image/*"
        disabled={uploading}
        onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])}
        className="mb-2 text-sm"
      />
```

- [ ] **Step 4: Verify manually**

`npm run dev`, create/edit a product in `/admin`, upload a product image, confirm it works and disables the input while uploading.

- [ ] **Step 5: Run the frontend suite**

Run: `cd frontend && npm test -- --run`

Expected: no new failures (no dedicated test file for this component)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AdminProducts.jsx
git commit -m "feat(shop): migrate AdminProducts image upload to uploadImage helper, disable input while uploading"
```

---

### Task 12: Migrate AdminPaymentSettings.jsx (Momo QR image)

**Files:**
- Modify: `frontend/src/components/AdminPaymentSettings.jsx:1-43`

**Interfaces:**
- Consumes: `adminUploadImage` from Task 6 (already migrated to take a `File`).

This call site was missed in the original research pass behind this plan
(caught only after a real production bug report: uploading a Momo QR image
and saving always failed validation, unrelated to this migration but
discovered while investigating it - see the `fix(shop): accept the app's
own storage-proxy path for momo_qr_image` commit for that separate fix).
`uploadQr` already has its own `uploading` state disabling nothing today -
check Step 3 below for whether the file input needs a `disabled` prop added.

- [ ] **Step 1: Add the import**

Find (line 1-3):

```javascript
import { useEffect, useState } from "react"
import { adminGetPaymentSettings, adminSavePaymentSettings, adminUploadImage } from "../api/shop"
import { sanitizeVietQrInfo, willTruncateInVietQr, VIETQR_INFO_MAX_LEN } from "../shop/vietqrSanitize"
```

No import change needed - `adminUploadImage` is already imported from `../api/shop`, and its signature changed in Task 6 without changing its name/path.

- [ ] **Step 2: Migrate `uploadQr`**

Find (line 25-43):

```javascript
  const uploadQr = async (file) => {
    if (!file) return
    setError("")
    setUploading(true)
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(",")[1])
        reader.onerror = () => reject(new Error("Không đọc được file ảnh"))
        reader.readAsDataURL(file)
      })
      const { url } = await adminUploadImage(base64, "payments")
      set("momo_qr_image", url)
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Tải ảnh lên thất bại")
    } finally {
      setUploading(false)
    }
  }
```

Replace with:

```javascript
  const uploadQr = async (file) => {
    if (!file) return
    setError("")
    setUploading(true)
    try {
      const { url } = await adminUploadImage(file, "payments")
      set("momo_qr_image", url)
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Tải ảnh lên thất bại")
    } finally {
      setUploading(false)
    }
  }
```

- [ ] **Step 3: Check whether the QR file input already disables while uploading**

Run: `grep -n 'type="file"\|uploading' frontend/src/components/AdminPaymentSettings.jsx` and read the surrounding lines with the Read tool. `uploading` state already exists (line 17, set by `uploadQr`) - if the `<input type="file">` for the Momo QR doesn't already have `disabled={uploading}`, add it there, matching the pattern used in every other migrated call site in this plan. If it's already present, no change needed - just confirm.

- [ ] **Step 4: Verify manually**

`npm run dev`, open `/admin` → Payment Settings, enable Momo, upload a QR image, confirm the preview renders, then Save and confirm it succeeds (this is the exact flow that was broken before the separate `momo_qr_image` validation fix - confirm both fixes now work together).

- [ ] **Step 5: Run the frontend suite**

Run: `cd frontend && npm test -- --run`

Expected: no new failures (no dedicated test file for this component)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AdminPaymentSettings.jsx
git commit -m "feat(shop): migrate AdminPaymentSettings Momo QR upload to uploadImage helper"
```

---

### Task 13: Migrate Order.jsx (buyer payment-proof upload)

**Files:**
- Modify: `frontend/src/pages/Order.jsx:1-101`

**Interfaces:**
- Consumes: `uploadPaymentProof` from Task 6 (already migrated to take a `File`).

- [ ] **Step 1: Remove the now-unused `readFileAsBase64` helper**

Find (line 39-46):

```javascript
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "")
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Well under the backend's 50MB limit - rejects an oversized photo before it burns a retry against the proof rate limiter.
const MAX_PROOF_BYTES = 8 * 1024 * 1024
```

Replace with:

```javascript
// Well under the backend's 50MB limit - rejects an oversized photo before it burns a retry against the proof rate limiter.
const MAX_PROOF_BYTES = 8 * 1024 * 1024
```

- [ ] **Step 2: Migrate `submit`**

Find (line 84-101):

```javascript
  const submit = async () => {
    if (!pendingFile) return
    setError("")
    setUploading(true)
    try {
      const base64 = await readFileAsBase64(pendingFile)
      const { url } = await uploadPaymentProof(token, base64, orderAuthHeaders(token))
      setUploadedUrl(url)
      onUploaded?.()
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl)
      setPendingFile(null)
      setPendingPreviewUrl(null)
    } catch (err) {
      setError(err.response?.data?.message || t("proofError"))
    } finally {
      setUploading(false)
    }
  }
```

Replace with:

```javascript
  const submit = async () => {
    if (!pendingFile) return
    setError("")
    setUploading(true)
    try {
      const { url } = await uploadPaymentProof(token, pendingFile, orderAuthHeaders(token))
      setUploadedUrl(url)
      onUploaded?.()
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl)
      setPendingFile(null)
      setPendingPreviewUrl(null)
    } catch (err) {
      setError(err.response?.data?.message || t("proofError"))
    } finally {
      setUploading(false)
    }
  }
```

(The double-submit guard already exists here - `disabled={uploading}` on both the submit and cancel buttons, unchanged by this task.)

- [ ] **Step 3: Verify manually**

`npm run dev`, place a test order with bank transfer, open its order page, upload a payment-proof screenshot, confirm it uploads and the preview/confirmation renders.

- [ ] **Step 4: Run the frontend suite**

Run: `cd frontend && npm test -- --run`

Expected: no new failures (check for an `Order.test.jsx` file first via `find frontend/src -iname "Order.test*"` - if one exists and references `readFileAsBase64` or base64 payloads, update it to construct a `File` instead; if none exists, this step is just the standard regression check)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Order.jsx
git commit -m "feat(shop): migrate Order.jsx payment-proof upload to uploadPaymentProof(file)"
```

---

### Task 14: Full-branch verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass npx vitest run`

Expected: PASS, all files

- [ ] **Step 2: Run the full frontend suite**

Run: `cd frontend && npm test -- --run`

Expected: PASS, all files

- [ ] **Step 3: Run frontend lint**

Run: `cd frontend && npm run lint`

Expected: no new errors (the two pre-existing unrelated `Portfolio.jsx` warnings from earlier this session are expected to remain)

- [ ] **Step 4: Confirm no remaining base64 image-upload code**

Run: `grep -rn "base64" backend/server.js backend/routes/adminCatalog.js backend/routes/orders.js` - expected: no matches (the only remaining `base64` references in the backend should be unrelated, e.g. none at all after this migration).

Run: `grep -rln "readAsDataURL" frontend/src` - expected: no matches remain in any of the 8 migrated call sites (`ShippingTrackingImport.jsx`/`ShippingExport.jsx` are out of scope per the spec and may still legitimately use base64 for CSV data - confirm any remaining hits are only in those two files).

- [ ] **Step 5: Manual end-to-end smoke test**

With `docker compose up -d` running locally: log into `/admin`, upload a large (several MB) real photo to a shop product, and open the Network tab to confirm (a) the request `Content-Type` is `multipart/form-data`, not `application/json`, and (b) the uploaded bytes are smaller than the original file (confirms downscaling ran). While that upload is in flight, open a second tab and confirm `/api/shop/collections` (or any other page) still responds immediately - this is the actual regression test for the bug this whole plan exists to fix.
