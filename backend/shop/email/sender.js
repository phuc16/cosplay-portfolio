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
 * message - one bad address must not stall the rest of the queue.
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

      const isPickup = order.fulfillment_method === "pickup"
      // The code is only meaningful once the order is actually paid for -
      // matches the same gate toPublicOrder applies to the buyer's order
      // page, so an unpaid pending order's confirmation email never reveals
      // it early. Read at send time (not enqueue time), so an order
      // confirmed between enqueue and send still gets the code correctly.
      const isPaid = ["confirmed", "completed"].includes(order.status)

      let html = rendered.html
      const attachments = []

      // Inserts before the card's closing </div> (the link sits in its own
      // nested <div>, so this skips two </div>s, not one).
      function spliceBeforeCardClose(htmlIn, block) {
        const linkIndex = htmlIn.indexOf("Xem đơn hàng")
        if (linkIndex === -1) return htmlIn + block
        const linkDivClose = htmlIn.indexOf("</div>", linkIndex)
        const cardCloseIndex = linkDivClose === -1 ? -1 : htmlIn.indexOf("</div>", linkDivClose + 1)
        return cardCloseIndex === -1
          ? htmlIn + block
          : htmlIn.slice(0, cardCloseIndex) + block + htmlIn.slice(cardCloseIndex)
      }

      // access_pin_hash is one-way, so the plaintext only exists here.
      if (row.type === "order_placed") {
        let payload
        try { payload = JSON.parse(row.payload) } catch { payload = null }
        if (payload?.access_pin) {
          html = spliceBeforeCardClose(html, `
            <p style="margin:12px 0 0;font-size:13px">
              Mã PIN xác thực đơn hàng: <strong style="color:${templates.BRAND}">${templates.escapeHtml(payload.access_pin)}</strong><br/>
              <span style="font-size:12px;color:#888">Cần mã này để xem lại đơn hàng qua link nếu trang yêu cầu xác thực.</span>
            </p>`)
        }
      } else {
        html = spliceBeforeCardClose(html, `
          <p style="margin:12px 0 0;font-size:12px;color:#888">
            Nếu trang yêu cầu mã PIN, mã đã được gửi trong email xác nhận lúc bạn đặt hàng.
          </p>`)
      }

      // Spliced right after the greeting paragraph (not appended at the end)
      // rather than a template placeholder: the cancelled template is static
      // and shared by every cancellation, most of which have no reason at
      // all (admin skipped the prompt, or the order predates this field) -
      // a placeholder would either always show an empty "Lý do hủy:" label
      // or need its own conditional the substitution engine can't express,
      // same reasoning as the QR block below. wrap()'s own "Mã đơn hàng:"
      // line is always the first <p> in the card, so the SECOND </p> is the
      // greeting's close - inserting there puts the reason where a buyer's
      // eye actually lands first, ahead of the item list/total, without
      // depending on the greeting's exact (admin-editable) wording.
      if (order.status === "cancelled" && order.cancel_reason) {
        const firstP = html.indexOf("</p>")
        const greetingClose = firstP === -1 ? -1 : html.indexOf("</p>", firstP + 1)
        const block = `
          <p style="font-size:14px;margin:12px 0 0">
            <strong>Lý do hủy:</strong> ${templates.escapeHtml(order.cancel_reason)}
          </p>`
        html = greetingClose === -1
          ? html + block
          : html.slice(0, greetingClose + "</p>".length) + block + html.slice(greetingClose + "</p>".length)
      }

      // Included even for a cancelled order, so the buyer can still check its final state.
      {
        // cid: attachment rather than a data URI (Gmail strips those) or a
        // remote URL (blocked by default in many clients).
        const png = await qr.qrPngBuffer(qr.orderUrl(order.order_token))
        // A ship order's QR is just a convenient link to the order page - no
        // pickup instructions apply, so it gets a plain, ungated caption.
        const caption = !isPickup
          ? `<p style="font-size:12px;color:#888">Mã QR đơn hàng</p>`
          : isPaid
            ? `
            <p style="font-size:12px;color:#888">Đưa mã này khi nhận hàng tại sự kiện</p>
            ${order.pickup_code ? `
            <p style="font-size:14px;margin-top:8px">
              Mã xác nhận nhận hàng: <strong>${order.pickup_code}</strong>
            </p>
            <p style="font-size:12px;color:#888">
              Nếu không quét được mã QR (mạng yếu tại sự kiện), hãy đọc mã này cho nhân viên.
            </p>` : ""}`
            : `<p style="font-size:12px;color:#888">Mã QR đơn hàng - hướng dẫn nhận hàng sẽ hiển thị sau khi đơn được xác nhận thanh toán.</p>`
        html += `
          <div style="text-align:center;margin-top:16px">
            <img src="cid:orderqr" alt="QR đơn hàng" width="160" height="160">
            ${caption}
          </div>`
        attachments.push({ filename: "order-qr.png", content: png, cid: "orderqr" })
      }

      // Always last - below the QR block above, whether or not it rendered.
      html += templates.footerHtml()

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
