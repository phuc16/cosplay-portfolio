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
