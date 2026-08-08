const QRCode = require("qrcode")

const SITE_URL = () => process.env.SITE_URL || ""

/** The QR encodes the buyer-facing URL, so any phone camera opens the order. */
function orderUrl(token) {
  return `${SITE_URL()}/order/${token}`
}

// Derived from the token on demand — never stored, so no disk cost.
const qrSvg = (text) => QRCode.toString(text, { type: "svg", margin: 1, width: 220 })
const qrPngBuffer = (text) => QRCode.toBuffer(text, { type: "png", margin: 1, width: 320 })

module.exports = { orderUrl, qrSvg, qrPngBuffer }
