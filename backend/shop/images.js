const sharp = require("sharp")
const crypto = require("crypto")
const storage = require("./../storage")

const MAX_WIDTH = 1920
const WEBP_QUALITY = 82

// Matches server.js's UPLOAD_LIMIT (the request body ceiling) - every
// uploaded image is re-encoded to WebP right away (processShopImage), so a
// large *input* never becomes a large stored file; this constant only bounds
// what a single sharp decode has to handle per request, not disk usage.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

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

/**
 * Same pipeline as the portfolio uploads in server.js: auto-orient from EXIF,
 * cap the width, and encode WebP (smaller than JPEG and keeps alpha).
 * `watermark: true` stamps the shop name over buyer-facing product/variant
 * photos - never used for the buyer's private payment-proof upload.
 */
async function processShopImage(buffer, { watermark = false } = {}) {
  validateImageBuffer(buffer)

  const meta = await sharp(buffer).metadata()
  let pipeline = sharp(buffer).rotate()

  if (meta.width > MAX_WIDTH) {
    pipeline = pipeline.resize(MAX_WIDTH, null, { withoutEnlargement: true })
  }

  const { data, info } = await pipeline.webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer({ resolveWithObject: true })
  if (!watermark) return data

  const shopName = process.env.SHOP_NAME || "Shop"
  return sharp(data)
    .composite([{ input: watermarkSvg(shopName, info.width, info.height), top: 0, left: 0 }])
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer()
}

/**
 * Store an already-processed (webp) buffer under shop/<folder>/, returning the proxy URL.
 * Split out from `uploadShopImage` so callers can catch decode failures (processShopImage)
 * separately from storage failures (this) - see adminCatalog.js, which maps the former
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
