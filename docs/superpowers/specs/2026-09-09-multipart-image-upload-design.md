# Multipart Image Upload Migration — Design

## Problem

Every image upload endpoint accepts the image as a base64 string inside a
JSON body, parsed via `express.json({ limit: "70mb" })`. `JSON.parse()` and
the subsequent `Buffer.from(base64, "base64")` decode are both synchronous
and scale with payload size. Node is single-threaded for JS execution: while
either of those runs on a large payload, the entire backend process cannot
service *any* other request, from *any* user, until it finishes.

Confirmed in production (`kamidayhehe.com`): an admin uploading a large shop
product photo caused every other visitor's API calls to stall concurrently
(`/api/shop/collections`, `/api/settings`, etc. — all served by the same
Node process). One capture showed a single upload failing after 19.27s with
several duplicate `image` requests stacked up pending behind it, because the
admin UI doesn't disable the upload control while a request is in flight,
so a stalled-looking upload invites repeated clicks that compound the
blocking (each stacks another large synchronous parse behind the last).

The blocking scales with the *original* file size, which is why this wasn't
caught in casual staging testing — smaller test images and no concurrent
traffic during that test hid a bug that is 100% present in the same staging
code, just imperceptible under those conditions.

## Root Cause

`server.js`'s `largeJson = express.json({ limit: "70mb" })` gates these 6
routes (all POST):

1. `/api/upload/hero` — portfolio hero image — body `{ base64 }`
2. `/api/upload/thumbnail` — portfolio thumbnail — body `{ base64 }`
3. `/api/upload/event-image` — portfolio event image — body `{ base64 }`
4. `/api/image` — portfolio album image — body `{ album_id, base64 }`
5. `/api/admin/shop/image` — shop catalog image — body `{ base64, folder }`
6. `/api/orders/:token/proof` — buyer payment-proof upload — body `{ base64 }`

Each handler does `Buffer.from(req.body.base64, "base64")` after
`express.json()` has already synchronously parsed the whole request body as
one JSON string. `sharp()` itself is not the problem — its resize/encode
calls are properly async via libuv's threadpool — the blocking happens
entirely in the JSON parse + base64 decode step, before any image
processing begins.

## Solution

Replace base64-JSON with `multipart/form-data`, parsed via `multer` in
memory-storage mode. Multer's streaming multipart parser processes the body
incrementally without ever holding-then-synchronously-parsing one giant
string, removing the event-loop block regardless of file size or
concurrent load.

### Backend

- Add `multer` as a backend dependency.
- `const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })`
  — 50MB flat, matching `shop/images.js`'s existing `MAX_UPLOAD_BYTES`. No
  more base64 inflation math needed for these routes, so the `"70mb"`
  `UPLOAD_LIMIT` constant is removed for this code path (other JSON routes —
  tracking-import, generic small JSON — keep their own existing limits
  untouched).
- Each of the 6 routes swaps its `largeJson` gate for `upload.single("file")`
  ahead of the handler (after any `auth`/`orderAccess` middleware, same
  chain order as today).
- Each handler swaps `Buffer.from(req.body.base64, "base64")` for
  `req.file.buffer`, and reads a missing-file case (`!req.file`) where it
  previously checked `!base64`.
- Non-file fields (`album_id` on `/api/image`, `folder` on
  `/api/admin/shop/image`) travel as regular multipart form fields; multer
  parses those into `req.body` same as `express.json()` did.
- A thrown `MulterError` with `code === "LIMIT_FILE_SIZE"` is caught and
  mapped to the same "too large" message shape the current
  `InvalidImageError`/`entity.too.large` paths already return, so
  buyer/admin-facing error text is unchanged.

### Frontend

- New shared helper, `frontend/src/api/upload.js`:
  `uploadImage(url, file, extraFields = {})` — builds a `FormData`, appends
  `file` plus any extra fields, POSTs via the existing shared `api` axios
  instance. Axios sets the multipart boundary header automatically for a
  `FormData` body — no manual header needed.
- All 7 call sites (`AdminSettings.jsx`, `AdminAlbumImages.jsx`,
  `AdminVariants.jsx`, `AdminCollections.jsx`, `AdminProducts.jsx`,
  `Order.jsx`, `api/shop.js`) switch from `FileReader.readAsDataURL()` +
  base64-JSON to passing the raw `File` object (already available from the
  `<input type="file">` change event) into the helper.
- Each call site gains an `isUploading` state that disables the upload
  control/button for the duration of the request, closing the
  double-submit bug observed in production (a stalled-looking upload
  inviting repeated clicks that stack multiple blocking requests).

### Testing

- Backend tests currently doing `.send({ base64 })` switch to supertest's
  `.attach("file", buffer, filename)` (+ `.field(...)` for extra fields
  like `folder`/`album_id`). Affected files: `adminCatalogRoutes.test.js`,
  `paymentProof.test.js`, `portfolioImageUpload.test.js`,
  `orderAccess.test.js`.
- `imageValidation.test.js` is unaffected — it unit-tests
  `validateImageBuffer()` directly, not through an HTTP route.
- `adminShippingExport.test.js`/`adminShippingTrackingImport.test.js` use
  base64 for CSV/spreadsheet import data through a *different* JSON gate
  (`importJson`, 10mb) — out of scope, untouched.
- Frontend tests mocking `FileReader` switch to constructing a real `File`/
  `Blob` and asserting against the `FormData` sent.

## Out of Scope

- CSV/tracking-import upload endpoints (different content type, different
  problem class — small payloads, not images).
- Disk-based multer storage (memory storage was chosen: same peak-RAM
  profile as today's `Buffer.from(base64)` approach, no temp-file cleanup
  complexity, and the VPS isn't currently RAM-constrained enough to need
  the tradeoff).
- Any change to `sharp()`/`processShopImage`/`processImage` pipelines —
  they already consume a `Buffer` and need no changes.
