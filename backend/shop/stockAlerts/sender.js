const emailSender = require("../email/sender")
const { escapeHtml } = require("../email/templates")
const queue = require("./queue")

const SHOP_NAME = process.env.SHOP_NAME || "Shop"
const SITE_URL = process.env.SITE_URL || ""

/**
 * Fixed, plain-Vietnamese message - not one of the four buyer-order-lifecycle
 * templates in email/templates.js and does not need admin-editable
 * templating (see the 2026-09-26 design doc).
 */
function buildMessage(row) {
  const variantSuffix = row.variant_label_snapshot ? ` - ${row.variant_label_snapshot}` : ""
  const subject = `${row.product_name_snapshot}${variantSuffix} đã có hàng trở lại`
  const link = row.collection_slug_snapshot ? `${SITE_URL}/merchandise/${row.collection_slug_snapshot}` : SITE_URL
  const escapedSuffix = row.variant_label_snapshot ? ` - ${escapeHtml(row.variant_label_snapshot)}` : ""
  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto">
      <p>Xin chào,</p>
      <p>
        <strong>${escapeHtml(row.product_name_snapshot)}${escapedSuffix}</strong>
        mà bạn đăng ký nhận thông báo đã có hàng trở lại tại ${escapeHtml(SHOP_NAME)}.
      </p>
      <p><a href="${escapeHtml(link)}">Xem sản phẩm</a></p>
      <p style="margin-top:16px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#999">
        Đây là email tự động, vui lòng không trả lời email này.
      </p>
    </div>`
  return { subject, html }
}

/**
 * Mirrors email/sender.js::sendQueued's shape/isolation guarantees, for the
 * independent stock_alert_queue pipeline - one bad row must not stall the
 * rest of the batch. Reuses the shared transport singleton/config check
 * rather than re-deriving SMTP env vars a second time.
 */
async function sendQueuedStockAlerts(limit = 10) {
  if (!emailSender.isConfigured()) return { sent: 0, failed: 0, skipped: true }

  const pending = await queue.claimPending(limit)
  let sent = 0
  let failed = 0

  for (const row of pending) {
    try {
      const { subject, html } = buildMessage(row)
      await emailSender.getTransport().sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: row.email,
        subject,
        html,
      })
      await queue.markSent(row.id)
      sent += 1
      console.log(`[STOCK-ALERT] Đã gửi thông báo còn hàng cho ${row.email}`)
    } catch (err) {
      await queue.markFailed(row.id, err.message)
      failed += 1
      console.warn(`[STOCK-ALERT] Gửi thất bại cho ${row.email}: ${err.message}`)
    }
  }

  return { sent, failed, skipped: false }
}

module.exports = { sendQueuedStockAlerts }
