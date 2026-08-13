const sharp = require("sharp")
const crypto = require("crypto")
const storage = require("./../storage")

const MAX_WIDTH = 1920
const WEBP_QUALITY = 82

// Comfortably above the frontend's 8MB client-side guard on payment-proof
// uploads (frontend/src/pages/Order.jsx MAX_PROOF_BYTES) so a file the client
// already accepted is never rejected here, and well under the 50MB request
// body limit (server.js UPLOAD_LIMIT) — this caps how much memory/CPU a
// single sharp decode can be made to spend on the 2GB droplet, independent
// of how big a base64 payload the body parser will even accept.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

// Sniffed from magic bytes rather than trusted from any client-supplied
// content-type/extension, since both upload call sites only ever receive a
// bare base64 string.
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]

class InvalidImageError extends Error {
  constructor(message) {
    super(message)
    this.name = "InvalidImageError"
  }
}

/** Identify an image buffer by its magic bytes, or null if unrecognized. */
function sniffImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg"
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return "image/png"
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp"
  }
  return null
}

/**
 * Reject an oversized or unrecognized-type buffer before it is ever handed to
 * sharp for decode. Both upload call sites (admin catalog image upload,
 * buyer payment-proof upload) route through processShopImage, so this runs
 * for both without either needing its own copy of the check.
 */
function validateImageBuffer(buffer) {
  if (!buffer || buffer.length === 0) throw new InvalidImageError("Ảnh không hợp lệ")
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new InvalidImageError(`Ảnh quá lớn, tối đa ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB`)
  }
  if (!ALLOWED_TYPES.includes(sniffImageType(buffer))) {
    throw new InvalidImageError("Định dạng ảnh không được hỗ trợ, chỉ nhận JPEG/PNG/WebP")
  }
}

/**
 * Same pipeline as the portfolio uploads in server.js: auto-orient from EXIF,
 * cap the width, and encode WebP (smaller than JPEG and keeps alpha).
 */
async function processShopImage(buffer) {
  validateImageBuffer(buffer)

  const meta = await sharp(buffer).metadata()
  let pipeline = sharp(buffer).rotate()

  if (meta.width > MAX_WIDTH) {
    pipeline = pipeline.resize(MAX_WIDTH, null, { withoutEnlargement: true })
  }
  return pipeline.webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer()
}

/**
 * Store an already-processed (webp) buffer under shop/<folder>/, returning the proxy URL.
 * Split out from `uploadShopImage` so callers can catch decode failures (processShopImage)
 * separately from storage failures (this) — see adminCatalog.js, which maps the former
 * to 400 (bad input) and the latter to 500 (real server error).
 */
async function storeShopImage(folder, processed) {
  const safeFolder = String(folder || "misc").replace(/[^a-z0-9/_-]/gi, "")
  // crypto.randomBytes, not Date.now()+Math.random(): these keys are the only
  // thing gating access to a buyer's payment-proof photo behind the public,
  // unauthenticated /api/storage proxy, so the suffix needs to be
  // unguessable, not merely unique.
  const key = `shop/${safeFolder}/${crypto.randomBytes(16).toString("hex")}.webp`

  await storage.upload(key, processed, "image/webp")
  return storage.proxyUrl(key)
}

/** Process and store under shop/<folder>/, returning the proxy URL. */
async function uploadShopImage(folder, buffer) {
  const processed = await processShopImage(buffer)
  return storeShopImage(folder, processed)
}

module.exports = {
  processShopImage,
  storeShopImage,
  uploadShopImage,
  validateImageBuffer,
  InvalidImageError,
  MAX_UPLOAD_BYTES,
}
