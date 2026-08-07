const sharp = require("sharp")
const storage = require("./../storage")

const MAX_WIDTH = 1920
const WEBP_QUALITY = 82

/**
 * Same pipeline as the portfolio uploads in server.js: auto-orient from EXIF,
 * cap the width, and encode WebP (smaller than JPEG and keeps alpha).
 */
async function processShopImage(buffer) {
  const meta = await sharp(buffer).metadata()
  let pipeline = sharp(buffer).rotate()

  if (meta.width > MAX_WIDTH) {
    pipeline = pipeline.resize(MAX_WIDTH, null, { withoutEnlargement: true })
  }
  return pipeline.webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer()
}

/** Process and store under shop/<folder>/, returning the proxy URL. */
async function uploadShopImage(folder, buffer) {
  const processed = await processShopImage(buffer)
  const safeFolder = String(folder || "misc").replace(/[^a-z0-9/_-]/gi, "")
  const key = `shop/${safeFolder}/${Date.now()}-${Math.round(Math.random() * 1e6)}.webp`

  await storage.upload(key, processed, "image/webp")
  return storage.proxyUrl(key)
}

module.exports = { processShopImage, uploadShopImage }
