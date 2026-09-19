const nodemailer = require("nodemailer")
const db = require("./../../db")
const queue = require("./queue")
const templates = require("./templates")
const orderRepo = require("./../orders/orderRepo")
const settingsRepo = require("./../payments/settingsRepo")
const qr = require("./../orders/qr")

let transport = null

// Templates in this set are sent to the admin, not a buyer - the PIN
// reminder and QR/pickup-code block below are both meaningless to someone
// who accesses orders via their own admin login, not a PIN or a printed QR.
const ADMIN_EMAIL_TYPES = new Set(["payment_proof_uploaded"])

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

      let payload
      try { payload = JSON.parse(row.payload) } catch { payload = null }

      // access_pin_hash is one-way, so the plaintext only exists here.
      if (!ADMIN_EMAIL_TYPES.has(row.type)) {
        if (row.type === "order_placed") {
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

      // Same reasoning as cancel_reason above: which fields changed, who
      // made the change, and the closing guidance all depend on this
      // specific edit and can't be expressed as a static template
      // placeholder - spliced in directly, right after the greeting, ahead
      // of the link, same insertion point as cancel_reason.
      //
      // The actor line and guidance differ by who made the edit (safe to
      // name now that email is locked to the order's own address - see
      // orderRepo.updateBuyerInfo - so the real buyer always receives this
      // regardless of who edited):
      // - buyer: "Bạn vừa tự..." so a buyer who made the edit recognizes it
      //   immediately ("oh right, I did that"), with a pointer to just fix
      //   it themselves if something's wrong, or contact support if this
      //   wasn't them at all ("wait, I didn't do that").
      // - admin: "Người bán vừa..." so the buyer knows to contact the seller
      //   (not self-edit - the order may no longer be pending) about it.
      // - missing/unknown actor (legacy queued rows predating this field):
      //   falls back to the original neutral "if this wasn't you" wording.
      if (row.type === "order_updated") {
        const rows = (payload?.changes || []).map((c) => `
          <p style="font-size:14px;margin:4px 0 0">
            <strong>${templates.escapeHtml(c.label)}:</strong> ${templates.escapeHtml(c.old || "-")} → ${templates.escapeHtml(c.new || "-")}
          </p>`).join("")
        const actor = payload?.actor
        const actorLine = actor === "buyer"
          ? `<p style="margin:8px 0 0;font-size:14px"><strong>Bạn</strong> vừa tự thực hiện thay đổi này.</p>`
          : actor === "admin"
            ? `<p style="margin:8px 0 0;font-size:14px"><strong>Người bán</strong> vừa thực hiện thay đổi này.</p>`
            : ""
        const note = actor === "buyer"
          ? `<p style="margin:12px 0 0;font-size:13px;color:#888">Nếu thông tin trên chưa đúng, bạn có thể tự chỉnh sửa lại ngay trên trang đơn hàng của mình. Nếu đây không phải do bạn thực hiện, vui lòng liên hệ ngay để được hỗ trợ.</p>`
          : actor === "admin"
            ? `<p style="margin:12px 0 0;font-size:13px;color:#888">Nếu bạn có thắc mắc hoặc cần điều chỉnh thêm về thay đổi này, vui lòng liên hệ chúng tôi để được hỗ trợ.</p>`
            : `<p style="margin:12px 0 0;font-size:13px;color:#888">Nếu không phải bạn thực hiện thay đổi này, vui lòng liên hệ ngay để được hỗ trợ.</p>`
        const block = actorLine + rows + note
        const firstP = html.indexOf("</p>")
        const greetingClose = firstP === -1 ? -1 : html.indexOf("</p>", firstP + 1)
        html = greetingClose === -1
          ? html + block
          : html.slice(0, greetingClose + "</p>".length) + block + html.slice(greetingClose + "</p>".length)
      }

      // Included even for a cancelled order, so the buyer can still check its
      // final state - but never for an admin-audience email (no reason for
      // the seller to scan their own shop's order QR).
      if (!ADMIN_EMAIL_TYPES.has(row.type)) {
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

module.exports = { sendQueued, isConfigured, listFailed, getTransport }
