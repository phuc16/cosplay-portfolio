const nodemailer = require("nodemailer")
const db = require("./../../db")
const queue = require("./queue")
const templates = require("./templates")
const orderRepo = require("./../orders/orderRepo")
const settingsRepo = require("./../payments/settingsRepo")
const qr = require("./../orders/qr")

let transport = null

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  }
  return transport
}

/**
 * Dispatch queued mail. Rendering happens at send time so a template edit
 * applies to anything still queued. Every failure is contained to its own
 * message — one bad address must not stall the rest of the queue.
 */
async function sendQueued(limit = 10) {
  if (!isConfigured()) return { sent: 0, failed: 0, skipped: true }

  const pending = await queue.claimPending(limit)
  let sent = 0
  let failed = 0

  for (const row of pending) {
    try {
      const order = await orderRepo.getOrderById(row.order_id)
      if (!order) { await queue.markFailed(row.id, "order không tồn tại"); failed += 1; continue }

      const settings = await settingsRepo.getSettings()
      const tpl = await templates.getTemplate(row.type)
      if (!tpl) { await queue.markFailed(row.id, `không có mẫu email: ${row.type}`); failed += 1; continue }

      const rendered = templates.renderTemplate(
        tpl,
        templates.buildVars({ ...order, payment_note: settings.payment_note })
      )

      // The QR block only makes sense for a pickup order that is still
      // collectible — a ship order has no event pickup counter to scan it
      // at, and a cancelled order has nothing left to hand over, so skip
      // generating and attaching it entirely rather than just hiding it
      // visually.
      const isPickup = order.fulfillment_method === "pickup" && order.status !== "cancelled"
      // The code is only meaningful once the order is actually paid for —
      // matches the same gate toPublicOrder applies to the buyer's order
      // page, so an unpaid pending order's confirmation email never reveals
      // it early. Read at send time (not enqueue time), so an order
      // confirmed between enqueue and send still gets the code correctly.
      const isPaid = ["confirmed", "completed"].includes(order.status)

      let html = rendered.html
      const attachments = []
      if (isPickup) {
        // cid: attachment rather than a data URI (Gmail strips those) or a
        // remote URL (blocked by default in many clients).
        const png = await qr.qrPngBuffer(qr.orderUrl(order.order_token))
        html += `
          <div style="text-align:center;margin-top:16px">
            <img src="cid:orderqr" alt="QR đơn hàng" width="160" height="160">
            <p style="font-size:12px;color:#888">Đưa mã này khi nhận hàng tại sự kiện</p>
            ${order.pickup_code && isPaid ? `
            <p style="font-size:14px;margin-top:8px">
              Mã xác nhận nhận hàng: <strong>${order.pickup_code}</strong>
            </p>
            <p style="font-size:12px;color:#888">
              Nếu không quét được mã QR (mạng yếu tại sự kiện), hãy đọc mã này cho nhân viên.
            </p>` : ""}
          </div>`
        attachments.push({ filename: "order-qr.png", content: png, cid: "orderqr" })
      }

      await getTransport().sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: row.to_email,
        subject: rendered.subject,
        html,
        attachments,
      })

      await queue.markSent(row.id)
      sent += 1
      console.log(`[EMAIL] Đã gửi ${row.type} cho đơn ${row.order_id}`)
    } catch (err) {
      await queue.markFailed(row.id, err.message)
      failed += 1
      console.warn(`[EMAIL] Gửi thất bại ${row.type} đơn ${row.order_id}: ${err.message}`)
    }
  }

  return { sent, failed, skipped: false }
}

/** Failed messages, for surfacing in the admin. */
async function listFailed() {
  const [rows] = await db.query(
    "SELECT * FROM email_queue WHERE status = 'failed' ORDER BY id DESC LIMIT 50"
  )
  return rows
}

module.exports = { sendQueued, isConfigured, listFailed }
