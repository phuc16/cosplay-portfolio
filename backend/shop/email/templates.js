const db = require("./../../db")

const PLACEHOLDERS = [
  "order_id", "order_token", "order_url", "buyer_name", "total", "items",
  "status", "payment_method", "fulfillment_method", "tracking_code",
  "payment_note", "shop_name",
]

const SHOP_NAME = process.env.SHOP_NAME || "Shop"
const SITE_URL = process.env.SITE_URL || ""

/** Buyer-controlled values reach an HTML email; escape before substitution. */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

const formatVnd = (n) => `${Number(n || 0).toLocaleString("vi-VN")}₫`

function itemsHtml(items = []) {
  const rows = items.map((i) => `
    <tr>
      <td style="padding:6px 0">${escapeHtml(i.product_name_snapshot)} · ${escapeHtml(i.variant_label_snapshot)} × ${Number(i.qty)}</td>
      <td style="padding:6px 0;text-align:right">${formatVnd(i.unit_price_snapshot * i.qty)}</td>
    </tr>`).join("")
  return `<table style="width:100%;border-collapse:collapse">${rows}</table>`
}

function buildVars(order) {
  return {
    order_id: escapeHtml(order.id),
    order_token: escapeHtml(order.order_token),
    order_url: `${SITE_URL}/order/${order.order_token}`,
    buyer_name: escapeHtml(order.buyer_name),
    total: formatVnd(order.total),
    items: itemsHtml(order.items),           // built from escaped parts above
    status: escapeHtml(order.status),
    payment_method: escapeHtml(order.payment_method),
    fulfillment_method: escapeHtml(order.fulfillment_method),
    tracking_code: escapeHtml(order.tracking_code || ""),
    payment_note: escapeHtml(order.payment_note || ""),
    shop_name: escapeHtml(SHOP_NAME),
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

const wrap = (inner) => `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222">
  <h2 style="margin:0 0 16px">{{shop_name}}</h2>
  ${inner}
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="font-size:12px;color:#888">Xem đơn hàng: <a href="{{order_url}}">{{order_url}}</a></p>
</div>`

const DEFAULT_TEMPLATES = {
  order_placed: {
    subject: "Đã nhận đơn hàng #{{order_id}}",
    body_html: wrap(`
      <p>Chào {{buyer_name}},</p>
      <p>Mình đã nhận được đơn hàng của bạn. Vui lòng thanh toán và tải ảnh chuyển khoản lên trang đơn hàng để mình xác nhận nhé.</p>
      {{items}}
      <p style="font-weight:bold;margin-top:12px">Tổng: {{total}}</p>
      <p style="font-size:13px;color:#666">Phí ship trả cho shipper khi nhận hàng.</p>
      <p>{{payment_note}}</p>`),
  },
  payment_confirmed: {
    subject: "Đã xác nhận thanh toán đơn #{{order_id}}",
    body_html: wrap(`
      <p>Chào {{buyer_name}},</p>
      <p>Mình đã xác nhận thanh toán cho đơn hàng của bạn. Mình sẽ chuẩn bị và gửi hàng sớm nhất có thể.</p>
      {{items}}
      <p style="font-weight:bold;margin-top:12px">Tổng: {{total}}</p>`),
  },
  shipped: {
    subject: "Đơn #{{order_id}} đã được gửi đi",
    body_html: wrap(`
      <p>Chào {{buyer_name}},</p>
      <p>Đơn hàng của bạn đã được bàn giao cho đơn vị vận chuyển.</p>
      <p>Mã vận đơn: <strong>{{tracking_code}}</strong></p>
      <p style="font-size:13px;color:#666">Phí ship trả cho shipper khi nhận hàng.</p>`),
  },
  cancelled: {
    subject: "Đơn #{{order_id}} đã bị hủy",
    body_html: wrap(`
      <p>Chào {{buyer_name}},</p>
      <p>Đơn hàng của bạn đã bị hủy. Nếu bạn đã thanh toán, vui lòng liên hệ để mình hoàn tiền.</p>
      {{items}}`),
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
  PLACEHOLDERS, DEFAULT_TEMPLATES,
  buildVars, renderTemplate, validatePlaceholders, getTemplate, upsertTemplate, escapeHtml,
}
