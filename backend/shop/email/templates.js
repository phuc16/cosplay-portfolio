const db = require("./../../db")
const { formatOrderCode } = require("./../orders/domain")

const PLACEHOLDERS = [
  "order_id", "order_token", "order_url", "buyer_name", "total", "items",
  "status", "payment_method", "fulfillment_method", "tracking_code",
  "payment_note", "shop_name", "receiver_info", "shipping_fee_note", "prep_note",
  "admin_url", "payment_proof_image",
]

const SHOP_NAME = process.env.SHOP_NAME || "Shop"
const SITE_URL = process.env.SITE_URL || ""
// Same address every send actually comes "from" (sender.js) - the point of
// showing it is so a buyer's "add to contacts" click keeps future mail out
// of spam, so it has to be the literal envelope sender, not a display name.
const SHOP_EMAIL = process.env.SMTP_FROM || process.env.SMTP_USER || ""

/**
 * The "automated email" notice, appended by sender.js AFTER the order-QR
 * block rather than substituted into the template body, so it always
 * renders as the very last section of the mail, below the QR - not baked
 * into `wrap()`, which finishes before the QR is even built.
 */
function footerHtml() {
  return `
    <p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center;line-height:1.6">
      Đây là email tự động, vui lòng không trả lời email này.<br/>
      Thêm <a href="mailto:${escapeHtml(SHOP_EMAIL)}" style="color:${BRAND};text-decoration:none">${escapeHtml(SHOP_EMAIL)}</a> vào danh bạ để không bỏ lỡ email từ ${escapeHtml(SHOP_NAME)}.
    </p>`
}

/** Buyer-controlled values reach an HTML email; escape before substitution. */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

const formatVnd = (n) => `${Number(n || 0).toLocaleString("vi-VN")}₫`

// Matches --brand in frontend/src/index.css, so mail visually matches the site.
const BRAND = "#6BBF59"

/**
 * "Thông tin nhận hàng" block: name/phone always, then either the ship
 * address or the pickup location/note, matching what the order page shows.
 */
function receiverInfoHtml(order) {
  // A 'digital' order falls through both branches below - name/phone only, no address or pickup info to show.
  const rows = [
    ["Tên người nhận", order.buyer_name],
    ["Số điện thoại", order.phone],
  ]
  if (order.fulfillment_method === "ship" && order.address_raw) {
    rows.push(["Địa chỉ nhận hàng", order.address_raw])
  }
  if (order.fulfillment_method === "pickup") {
    // A cart can span multiple collections, each with its own pickup spot -
    // only disambiguate with the collection title when there's more than one.
    const locations = order.pickup_locations || []
    const multi = locations.length > 1
    for (const loc of locations) {
      const suffix = multi ? ` (${loc.collection_title})` : ""
      if (loc.pickup_location) rows.push([`Địa điểm nhận${suffix}`, loc.pickup_location])
      if (loc.pickup_note) rows.push([`Ghi chú nhận hàng${suffix}`, loc.pickup_note])
    }
  }
  const cells = rows.map(([label, value]) => `
    <tr>
      <td style="padding:4px 12px 4px 0;font-size:13px;color:#888;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
      <td style="padding:4px 0;font-size:14px">${escapeHtml(value)}</td>
    </tr>`).join("")
  return `
    <p style="font-weight:700;font-size:14px;margin:16px 0 6px">Thông tin nhận hàng</p>
    <table style="width:100%;border-collapse:collapse">${cells}</table>`
}

function itemsHtml(items = [], { showDeliveryLink = false } = {}) {
  const rows = items.map((i) => `
    <tr>
      <td style="padding:8px 8px 8px 0;border-bottom:1px solid #f0f0f0;width:44px">
        ${i.image_url
          ? `<img src="${escapeHtml(SITE_URL + i.image_url)}" width="44" height="44" style="width:44px;height:44px;object-fit:cover;border-radius:8px;display:block" />`
          : ""}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px">
        ${escapeHtml(i.product_name_snapshot)}${i.variant_label_snapshot ? ` · ${escapeHtml(i.variant_label_snapshot)}` : ""} × ${Number(i.qty)}
        ${i.is_gift ? ` <span style="font-size:11px;font-weight:600;background:#f0f0f0;padding:1px 6px;border-radius:4px">🎁 Quà tặng</span>` : ""}
        ${showDeliveryLink && i.delivery_link_snapshot
          ? `<br/><a href="${escapeHtml(i.delivery_link_snapshot)}" style="color:${BRAND}">Tải về</a>`
          : ""}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-size:14px;white-space:nowrap">${i.is_gift ? "Miễn phí" : formatVnd(i.unit_price_snapshot * i.qty)}</td>
    </tr>`).join("")
  return `<table style="width:100%;border-collapse:collapse;margin-top:12px">${rows}</table>`
}

// A visually distinct total row, reused across templates below - table-based
// so it renders correctly in Outlook too. {{total}} is a literal placeholder
// here, substituted at render time like everywhere else.
const TOTAL_ROW = `
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <td style="padding:10px 0 0;font-weight:700;font-size:15px">Tổng cộng</td>
        <td style="padding:10px 0 0;font-weight:700;font-size:15px;text-align:right;color:${BRAND}">{{total}}</td>
      </tr>
    </table>`

function buildVars(order) {
  // The delivery link is only trustworthy once payment is confirmed - an
  // unpaid or cancelled order must never leak it, matching the route-layer gate.
  const showDeliveryLink = ["confirmed", "shipped", "completed"].includes(order.status)
  const hasDigitalItem = (order.items || []).some((i) => i.delivery_link_snapshot)
  const showDigitalNote = showDeliveryLink && hasDigitalItem
  const digitalNote = "Link tải sản phẩm số đã có trong danh sách bên dưới."

  return {
    order_id: escapeHtml(formatOrderCode(order.id, order.created_at)),
    order_token: escapeHtml(order.order_token),
    order_url: `${SITE_URL}/order/${order.order_token}`,
    buyer_name: escapeHtml(order.buyer_name),
    total: formatVnd(order.total),
    items: itemsHtml(order.items, { showDeliveryLink }),   // built from escaped parts above
    status: escapeHtml(order.status),
    payment_method: escapeHtml(order.payment_method),
    fulfillment_method: escapeHtml(order.fulfillment_method),
    tracking_code: escapeHtml(order.tracking_code || ""),
    payment_note: escapeHtml(order.payment_note || ""),
    shop_name: escapeHtml(SHOP_NAME),
    receiver_info: receiverInfoHtml(order),
    admin_url: `${SITE_URL}/admin`,
    payment_proof_image: order.payment_proof_url
      ? `<img src="${escapeHtml(SITE_URL + order.payment_proof_url)}" style="max-width:320px;width:100%;border-radius:8px;display:block;margin-top:8px" />`
      : "",
    // Only a ship order has a shipper to pay at the door - a pickup order's
    // buyer never encounters this fee, so the note would just be confusing.
    shipping_fee_note: order.fulfillment_method === "ship"
      ? `<p style="font-size:12px;color:#888;margin:12px 0 0">Phí ship trả cho shipper khi nhận hàng.</p>`
      : "",
    // payment_confirmed's "what happens next" line - a pickup order is never
    // "gửi hàng" (shipped), so it gets its own wording pointing at the
    // pickup code/QR instead. A digital order has nothing to ship or pick
    // up, and any order with a digital item alongside physical ones still
    // needs the download-link mention appended.
    prep_note: order.fulfillment_method === "digital"
      ? (showDigitalNote ? digitalNote : "sẽ chuẩn bị và gửi hàng sớm nhất có thể.")
      : order.fulfillment_method === "pickup"
        ? "sẽ chuẩn bị hàng - mang mã QR hoặc mã xác nhận nhận hàng đến sự kiện để nhận." + (showDigitalNote ? ` ${digitalNote}` : "")
        : "sẽ chuẩn bị và gửi hàng sớm nhất có thể." + (showDigitalNote ? ` ${digitalNote}` : ""),
  }
}

/** Unknown placeholders render empty, so a stale template never leaks braces. */
function substitute(text, vars) {
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "")
}

function renderTemplate(tpl, vars) {
  return {
    subject: substitute(tpl.subject, vars).replace(/<[^>]*>/g, ""),
    html: substitute(tpl.body_html, vars),
  }
}

/** Return placeholder names used in `text` that the renderer does not know. */
function validatePlaceholders(text) {
  const found = [...String(text || "").matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
  return [...new Set(found.filter((name) => !PLACEHOLDERS.includes(name)))]
}

// Header bar + card, shared by every template so the order code/receiver
// info/link show up the same way everywhere without each one repeating them.
// ctaUrlVar names the placeholder the "Xem đơn hàng" button links to -
// "order_url" (the buyer's own order page) for every buyer-facing template,
// "admin_url" for the admin-facing payment_proof_uploaded template below.
const wrap = (inner, ctaUrlVar = "order_url") => `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;background:#fff">
  <div style="background:${BRAND};padding:18px 24px;border-radius:12px 12px 0 0">
    <span style="color:#fff;font-size:17px;font-weight:700">{{shop_name}}</span>
  </div>
  <div style="padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;color:#222;font-size:14px;line-height:1.6">
    <p style="margin:0 0 14px;font-size:13px;color:#888">Mã đơn hàng: <strong style="color:#222">{{order_id}}</strong></p>
    ${inner}
    {{receiver_info}}
    <p style="margin:20px 0 0;font-size:14px">Trân trọng,<br/>{{shop_name}}</p>
    <div style="margin:24px 0 0;padding-top:16px;border-top:1px solid #eee;text-align:center">
      <a href="{{${ctaUrlVar}}}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px">Xem đơn hàng →</a>
    </div>
  </div>
</div>`

const DEFAULT_TEMPLATES = {
  order_placed: {
    subject: "Đơn #{{order_id}} đang chờ thanh toán",
    body_html: wrap(`
      <p style="margin:0 0 12px">Cảm ơn <strong>{{buyer_name}}</strong> đã đặt hàng! <strong>Đơn hàng đang chờ thanh toán</strong>.</p>
      <p style="margin:0 0 12px">Vui lòng chuyển khoản rồi tải ảnh chuyển khoản lên trang đơn hàng - đơn sẽ chuyển sang <strong>Chờ xác nhận</strong> ngay khi bạn gửi ảnh. Gửi nhầm ảnh cũng không sao, bạn có thể thay ảnh khác sau đó.</p>
      {{items}}
      ${TOTAL_ROW}
      {{shipping_fee_note}}`),
  },
  payment_confirmed: {
    subject: "Đã xác nhận thanh toán đơn #{{order_id}}",
    body_html: wrap(`
      <p style="margin:0 0 12px">Chào <strong>{{buyer_name}}</strong>, mình đã xác nhận thanh toán - {{prep_note}}</p>
      {{items}}
      ${TOTAL_ROW}`),
  },
  shipped: {
    subject: "Đơn #{{order_id}} đã được gửi đi",
    body_html: wrap(`
      <p style="margin:0 0 12px">Chào <strong>{{buyer_name}}</strong>, đơn hàng của bạn đã được bàn giao cho đơn vị vận chuyển.</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:10px 14px;background:#f6faf4;border-radius:8px;font-size:14px">
          Mã vận đơn: <strong style="color:${BRAND}">{{tracking_code}}</strong>
        </td></tr>
      </table>
      {{shipping_fee_note}}`),
  },
  cancelled: {
    subject: "Đơn #{{order_id}} đã bị hủy",
    body_html: wrap(`
      <p style="margin:0 0 12px">Chào <strong>{{buyer_name}}</strong>, đơn hàng của bạn đã bị hủy. Nếu bạn đã thanh toán, vui lòng liên hệ để mình hoàn tiền.</p>
      {{items}}
      ${TOTAL_ROW}`),
  },
  payment_proof_uploaded: {
    subject: "Đơn #{{order_id}} vừa gửi ảnh chuyển khoản",
    body_html: wrap(`
      <p style="margin:0 0 12px"><strong>{{buyer_name}}</strong> vừa tải ảnh chuyển khoản cho đơn hàng này - kiểm tra và xác nhận khi có thể.</p>
      {{items}}
      ${TOTAL_ROW}
      {{payment_proof_image}}`, "admin_url"),
  },
  order_updated: {
    subject: "Thông tin đơn #{{order_id}} đã được cập nhật",
    body_html: wrap(`
      <p style="margin:0 0 12px">Chào <strong>{{buyer_name}}</strong>, thông tin đơn hàng của bạn vừa được cập nhật.</p>`),
  },
}

async function getTemplate(type) {
  const [[row]] = await db.query("SELECT * FROM email_templates WHERE type = ? LIMIT 1", [type])
  return row || DEFAULT_TEMPLATES[type] || null
}

async function upsertTemplate(type, data) {
  const [[row]] = await db.query("SELECT id FROM email_templates WHERE type = ? LIMIT 1", [type])
  if (row) {
    await db.query(
      "UPDATE email_templates SET subject = ?, body_html = ?, updated_at = NOW() WHERE id = ?",
      [data.subject, data.body_html, row.id]
    )
  } else {
    await db.query(
      "INSERT INTO email_templates (type, subject, body_html) VALUES (?, ?, ?)",
      [type, data.subject, data.body_html]
    )
  }
}

module.exports = {
  PLACEHOLDERS, DEFAULT_TEMPLATES, BRAND,
  buildVars, renderTemplate, validatePlaceholders, getTemplate, upsertTemplate, escapeHtml,
  footerHtml,
}
