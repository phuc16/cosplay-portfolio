const db = require("./../db")
const sender = require("./email/sender")
const templates = require("./email/templates")

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SHOP_NAME = process.env.SHOP_NAME || "Shop"
const SITE_URL = process.env.SITE_URL || ""

class VariantNotFoundError extends Error {}
class NotSoldOutError extends Error {}

/** A variant is only "sold out" when its stock is a tracked, exhausted count - NULL means unlimited. */
function isSoldOut(stockQty) {
  return stockQty !== null && stockQty !== undefined && stockQty <= 0
}

/**
 * Stores (or re-arms) a request to be emailed once `variantId` is no longer
 * sold out. Rejected outright for a variant that already isn't sold out, so
 * the table never accumulates requests nobody needed.
 */
async function requestNotify(variantId, email) {
  const trimmed = String(email || "").trim().toLowerCase()
  if (!trimmed || !EMAIL_RE.test(trimmed)) {
    throw new Error("invalid_email")
  }

  const [[variant]] = await db.query(
    "SELECT id, stock_qty FROM product_variants WHERE id = ?",
    [variantId]
  )
  if (!variant) throw new VariantNotFoundError()
  if (!isSoldOut(variant.stock_qty)) throw new NotSoldOutError()

  // A repeat sign-up while still pending just refreshes created_at (no new
  // row); a repeat sign-up after already being notified once re-arms it -
  // notified_at back to NULL - so a second restock also gets emailed.
  await db.query(
    `INSERT INTO stock_notify_requests (product_variant_id, email)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE notified_at = NULL, created_at = NOW()`,
    [variant.id, trimmed]
  )
}

/** `products.images` can come back from mysql2 as either a JSON string or an already-parsed array. */
function firstImage(images) {
  if (!images) return null
  const arr = typeof images === "string" ? JSON.parse(images) : images
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : null
}

function absoluteUrl(relativeUrl) {
  return relativeUrl ? SITE_URL + relativeUrl : null
}

async function sendOne(row) {
  const label = row.label ? ` - ${templates.escapeHtml(row.label)}` : ""
  const img = absoluteUrl(row.image_url || firstImage(row.images))
  const shopUrl = SITE_URL ? `${SITE_URL}/merchandise` : null

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:${templates.BRAND};font-size:18px">
        🎉 ${templates.escapeHtml(row.product_name)}${label} đã có hàng trở lại!
      </h2>
      ${img ? `<img src="${templates.escapeHtml(img)}" alt="" style="width:100%;border-radius:12px;margin:12px 0;display:block" />` : ""}
      <p style="font-size:14px">
        Sản phẩm bạn đăng ký nhận thông báo vừa có hàng trở lại. Số lượng có thể có hạn, đặt hàng sớm để không bỏ lỡ nhé!
      </p>
      ${shopUrl ? `
      <p style="margin:16px 0">
        <a href="${templates.escapeHtml(shopUrl)}" style="display:inline-block;padding:10px 20px;background:${templates.BRAND};color:#fff;border-radius:8px;text-decoration:none;font-size:14px">
          Xem ngay
        </a>
      </p>` : ""}
      ${templates.footerHtml()}
    </div>`

  await sender.getTransport().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: row.email,
    subject: `${row.product_name}${label} đã có hàng trở lại - ${SHOP_NAME}`,
    html,
  })
}

/**
 * Emails everyone still waiting on a variant that is no longer sold out.
 * Called once per worker tick, alongside the order-expiry sweep and the
 * order email queue - deliberately its own small table/loop rather than
 * riding the order-coupled email_queue (see the design doc for why).
 */
async function sendPendingNotifications() {
  if (!sender.isConfigured()) return { sent: 0 }

  const [rows] = await db.query(
    `SELECT snr.id AS request_id, snr.email, v.label, v.image_url, p.name AS product_name, p.images
       FROM stock_notify_requests snr
       JOIN product_variants v ON v.id = snr.product_variant_id
       JOIN products p ON p.id = v.product_id
      WHERE snr.notified_at IS NULL
        AND (v.stock_qty IS NULL OR v.stock_qty > 0)
      LIMIT 50`
  )

  let sent = 0
  for (const row of rows) {
    try {
      await sendOne(row)
      await db.query("UPDATE stock_notify_requests SET notified_at = NOW() WHERE id = ?", [row.request_id])
      sent += 1
    } catch (err) {
      // One bad address/transient SMTP error must not stall the rest of the
      // batch - same isolation sendQueued() already guarantees for order mail.
      console.error(`[STOCK NOTIFY] Gửi thất bại cho request ${row.request_id}:`, err.message)
    }
  }
  return { sent }
}

module.exports = { requestNotify, sendPendingNotifications, VariantNotFoundError, NotSoldOutError }
