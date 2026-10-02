const path = require("path")
const PDFDocument = require("pdfkit")
const sharp = require("sharp")
const storage = require("../../storage")

const formatVnd = (n) => `${Number(n || 0).toLocaleString("vi-VN")}₫`

// pdfkit's built-in "Helvetica"/"Times-Roman" etc. are the 14 standard PDF
// fonts, which only support WinAnsi encoding - no Vietnamese diacritics at
// all (đ, ạ, ầ, ố, ộ, ươ, ...). Every one of those glyphs would either
// silently drop or render as a wrong/garbled character. DejaVu Sans has full
// Vietnamese (Latin Extended Additional) coverage and a permissive license
// (Bitstream Vera-derived, see fonts/DEJAVU-LICENSE.txt) - bundled here
// rather than relying on the OS having it installed (true in the Docker
// image per backend/Dockerfile's fontconfig/fonts-dejavu-core, NOT
// guaranteed on a developer's own machine running `node server.js` directly).
const FONT_REGULAR = path.join(__dirname, "fonts", "DejaVuSans.ttf")
const FONT_BOLD = path.join(__dirname, "fonts", "DejaVuSans-Bold.ttf")

const MARGIN = 40
// Smaller than a typical thumbnail on purpose: an order with 8+ items (a
// real one, not a hypothetical) turned into a page of oversized photos with
// barely any text density - this is a roster to scan quickly, not a photo
// gallery. 24pt is still large enough to recognize a product at a glance.
const PHOTO_SIZE = 24
const ROW_GAP = 4
const BLOCK_PADDING = 8
const BOTTOM_LIMIT = 760 // A4 page height (~842pt) minus a bottom margin
// Empty squares to pen-tick, same idea as the "☐" column the on-screen
// roster table already renders for the same physical handover process - one
// per order (the whole buyer handed off) and one per item (each product
// actually handed over), since a buyer's cart can be handed over in pieces.
const CHECKBOX_SIZE = 10
const CHECKBOX_GAP = 6

function drawCheckbox(doc, x, y) {
  doc.rect(x, y, CHECKBOX_SIZE, CHECKBOX_SIZE).strokeColor("#333333").stroke()
}

/**
 * Every shop image is stored/served as a webp proxied through
 * /api/storage/<key> (see storage.js's proxyUrl and shop/images.js's own
 * webp-only output) - never an external URL, since product/variant photos
 * only ever reach storage through this app's own upload endpoints. pdfkit
 * cannot decode webp directly, so this re-encodes to JPEG via sharp (already
 * a dependency) before handing it to doc.image().
 *
 * Returns null on any failure (missing key, deleted object, corrupt file) -
 * the caller draws a placeholder box instead. One buyer's dead image link
 * must never fail the whole roster's PDF.
 */
async function fetchImageAsJpeg(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith("/api/storage/")) return null
  try {
    const key = imageUrl.slice("/api/storage/".length)
    const webp = await storage.getBuffer(key)
    return await sharp(webp).jpeg().toBuffer()
  } catch {
    return null
  }
}

/** Pre-fetches every distinct item image up front (not once per PDF row) - a
 *  buyer's cart can repeat the same photo across items/orders, and a printed
 *  roster is generated on demand, not cached, so this keeps a big collection
 *  from re-fetching the same object from MinIO dozens of times. */
async function preloadImages(rows) {
  const urls = new Set()
  for (const row of rows) {
    for (const item of row.items) {
      if (item.image_url) urls.add(item.image_url)
    }
  }
  const cache = new Map()
  for (const url of urls) {
    cache.set(url, await fetchImageAsJpeg(url))
  }
  return cache
}

function drawPlaceholder(doc, x, y) {
  doc.rect(x, y, PHOTO_SIZE, PHOTO_SIZE).fillAndStroke("#eeeeee", "#cccccc")
}

/**
 * A print-ready PDF of the pickup roster, one bordered block per order, each
 * item shown with its actual product photo - unlike the plain-text xlsx
 * export or the on-screen/printed HTML table (whose print stylesheet hides
 * every image entirely), this is meant to be opened straight into a PDF
 * viewer and printed from there, photos included.
 *
 * Each order is drawn as its own bordered rectangle (not just flowing text
 * with a gap) precisely because that gap alone reads ambiguously once
 * blocks vary in height - a 5-item order can visually blend into the next
 * order's header without a hard boundary between them.
 */
async function buildRosterPdf(rows) {
  const images = await preloadImages(rows)
  const doc = new PDFDocument({ size: "A4", margin: MARGIN })
  doc.registerFont("body", FONT_REGULAR)
  doc.registerFont("body-bold", FONT_BOLD)
  const chunks = []
  doc.on("data", (chunk) => chunks.push(chunk))
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
  })

  doc.font("body-bold").fontSize(16).text("Danh sách nhận hàng", { align: "center" })
  doc.moveDown(0.5)

  const contentWidth = doc.page.width - MARGIN * 2

  rows.forEach((row, i) => {
    if (i > 0) doc.moveDown(0.6)

    // A rough per-order height estimate (header lines + one row per item) so
    // a short order doesn't get split across a page break mid-block - exact
    // to within a line or two, which is enough headroom for the check below.
    const estimatedHeight = 90 + row.items.length * (PHOTO_SIZE + ROW_GAP) + BLOCK_PADDING * 2
    if (doc.y + estimatedHeight > BOTTOM_LIMIT) doc.addPage()

    let blockTop = doc.y
    const contentX = MARGIN + BLOCK_PADDING
    // Every header line indents past the order-level checkbox, so the
    // checkbox sits cleanly to the left of the whole text block rather than
    // just the first line.
    const textX = contentX + CHECKBOX_SIZE + CHECKBOX_GAP
    const textWidth = contentWidth - BLOCK_PADDING * 2 - CHECKBOX_SIZE - CHECKBOX_GAP
    doc.x = textX
    doc.y = blockTop + BLOCK_PADDING

    drawCheckbox(doc, contentX, doc.y + 2)

    const stt = row.queue_number ?? "-"
    doc.font("body-bold").fontSize(13).fillColor("#000000")
      .text(`STT ${stt} · ${row.order_code} · ${row.buyer_name} · ${row.phone}`, textX, doc.y, {
        width: textWidth,
      })
    // Its own highlighted badge, not just another item in a gray "·"-joined
    // line - this is the one thing staff actually read out loud against the
    // buyer's own screen at handover, so it needs to be the first thing the
    // eye lands on in the block, same amber-badge language the on-screen STT
    // pill already uses.
    if (row.pickup_code) {
      const badgeText = `Mã nhận hàng: ${row.pickup_code}`
      doc.font("body-bold").fontSize(11)
      const badgeWidth = doc.widthOfString(badgeText) + 12
      const badgeTop = doc.y
      doc.rect(textX, badgeTop, badgeWidth, 18).fill("#fef3c7")
      doc.fillColor("#92400e").text(badgeText, textX + 6, badgeTop + 4)
      doc.fillColor("#000000")
      doc.y = badgeTop + 18
      doc.x = textX
      doc.moveDown(0.2)
    }

    doc.font("body").fontSize(10).fillColor("#555555")
    doc.text(row.paid ? "Đã thanh toán" : `Thu khi giao: ${formatVnd(row.amount_due)}`, textX, doc.y, {
      width: textWidth,
    })
    if (row.note) doc.text(`Ghi chú: ${row.note}`, textX, doc.y, { width: textWidth })
    doc.fillColor("#000000")
    doc.moveDown(0.3)

    // A table-style rule under the header, and one under every item row -
    // this, together with the block border drawn after the loop, is what
    // gives the roster an actual grid rather than plain flowing text.
    doc.moveTo(contentX, doc.y).lineTo(MARGIN + contentWidth - BLOCK_PADDING, doc.y).strokeColor("#dddddd").stroke()
    doc.moveDown(0.3)

    // Images/text below are placed at explicit x/y (needed to lay them out
    // side by side), which pdfkit does NOT auto-paginate the way flowing
    // doc.text() does - an order with enough items to outrun a single page
    // would otherwise silently draw past the page bottom. Closing off the
    // current block's border and starting a fresh (unbordered-until-closed)
    // continuation block on a new page keeps every item actually visible.
    row.items.forEach((item, itemIndex) => {
      if (doc.y + PHOTO_SIZE + ROW_GAP > BOTTOM_LIMIT) {
        doc.rect(MARGIN, blockTop, contentWidth, doc.y + BLOCK_PADDING - blockTop).strokeColor("#999999").stroke()
        doc.addPage()
        blockTop = doc.y
        doc.y = blockTop + BLOCK_PADDING
      }

      const rowY = doc.y
      drawCheckbox(doc, contentX, rowY + PHOTO_SIZE / 2 - CHECKBOX_SIZE / 2)

      const photoX = contentX + CHECKBOX_SIZE + CHECKBOX_GAP
      const buffer = images.get(item.image_url)
      if (buffer) {
        doc.image(buffer, photoX, rowY, { width: PHOTO_SIZE, height: PHOTO_SIZE })
      } else {
        drawPlaceholder(doc, photoX, rowY)
      }

      const label = item.variant_label ? `${item.product_name} · ${item.variant_label}` : item.product_name
      const suffix = item.is_gift ? " (Quà tặng)" : item.delivery_link ? " (Sản phẩm số)" : ""
      doc.font("body").fontSize(11).fillColor("#000000")
        .text(`${label} × ${item.qty}${suffix}`, photoX + PHOTO_SIZE + 10, rowY + PHOTO_SIZE / 2 - 6, {
          width: contentWidth - BLOCK_PADDING * 2 - CHECKBOX_SIZE - CHECKBOX_GAP - PHOTO_SIZE - 10,
        })

      doc.y = rowY + PHOTO_SIZE + ROW_GAP
      doc.x = contentX
      if (itemIndex < row.items.length - 1) {
        doc.moveTo(contentX, doc.y - ROW_GAP / 2).lineTo(MARGIN + contentWidth - BLOCK_PADDING, doc.y - ROW_GAP / 2)
          .strokeColor("#eeeeee").stroke()
      }
    })

    doc.y += BLOCK_PADDING
    doc.rect(MARGIN, blockTop, contentWidth, doc.y - blockTop).strokeColor("#999999").stroke()
    doc.x = MARGIN
  })

  doc.end()
  return done
}

module.exports = { buildRosterPdf }
