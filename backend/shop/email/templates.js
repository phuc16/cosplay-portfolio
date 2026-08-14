const db = require("./../../db")
const { formatOrderCode } = require("./../orders/domain")

const PLACEHOLDERS = [
  "order_id", "order_token", "order_url", "buyer_name", "total", "items",
  "status", "payment_method", "fulfillment_method", "tracking_code",
  "payment_note", "shop_name",
]

const SHOP_NAME = process.env.SHOP_NAME || "Shop"
const SITE_URL = process.env.SITE_URL || ""
// Same address every send actually comes "from" (sender.js) — the point of
// showing it is so a buyer's "add to contacts" click keeps future mail out
// of spam, so it has to be the literal envelope sender, not a display name.
const SHOP_EMAIL = process.env.SMTP_FROM || process.env.SMTP_USER || ""

// Only these three — the shop's actual channels, not every platform the
// (unused-here) fixed social-platform list in AdminSettings supports. Real
// brand glyphs (same path data as the portfolio page's icons), not text
// badges: embedded as data-URI <img>s rather than inline <svg>, since an
// <img> degrades more predictably across mail clients than an inline SVG
// element (Outlook's Word-based renderer in particular often drops the latter).
const SOCIAL_ICON = {
  facebook: {
    color: "#1877F2",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
  },
  instagram: {
    color: "#E4405F",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>',
  },
  messenger: {
    color: "#0084FF",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.654V24l4.088-2.242c1.092.301 2.246.464 3.443.464 6.627 0 12-4.975 12-11.111C24 4.974 18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.13 3.26L19.752 8l-6.561 6.963z"/></svg>',
  },
}

const socialIconDataUri = (platform) =>
  `data:image/svg+xml;base64,${Buffer.from(SOCIAL_ICON[platform].svg).toString("base64")}`

/**
 * Footer badges (facebook/instagram/messenger only, from site_settings —
 * see sender.js's getSocialLinks) + the "automated email" notice. Appended
 * by sender.js AFTER the order-QR block rather than substituted into the
 * template body, so it always renders as the very last section of the
 * mail, below the QR — not baked into `wrap()`, which finishes before the
 * QR is even built.
 */
function footerHtml(social = []) {
  const links = social.filter((s) => SOCIAL_ICON[s.platform] && s.url)
  const badges = links.length
    ? `<table role="presentation" style="width:100%;margin-top:20px"><tr><td style="text-align:center">${links.map((s) => `
      <a href="${escapeHtml(s.url)}" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:50%;background:${SOCIAL_ICON[s.platform].color};text-align:center;text-decoration:none;margin:0 4px"><img src="${socialIconDataUri(s.platform)}" width="16" height="16" alt="${s.platform}" style="vertical-align:middle;border:0"/></a>`).join("")}
    </td></tr></table>`
    : ""
  return `${badges}
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

function itemsHtml(items = []) {
  const rows = items.map((i) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px">${escapeHtml(i.product_name_snapshot)} · ${escapeHtml(i.variant_label_snapshot)} × ${Number(i.qty)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-size:14px;white-space:nowrap">${formatVnd(i.unit_price_snapshot * i.qty)}</td>
    </tr>`).join("")
  return `<table style="width:100%;border-collapse:collapse;margin-top:12px">${rows}</table>`
}

// A visually distinct total row, reused across templates below — table-based
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
  return {
    order_id: escapeHtml(formatOrderCode(order.id, order.created_at)),
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

// Header bar + card, with the "view order" link as a footer — same shape
// for every email so the seller's mail always reads as one consistent brand.
const wrap = (inner) => `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;background:#fff">
  <div style="background:${BRAND};padding:18px 24px;border-radius:12px 12px 0 0">
    <span style="color:#fff;font-size:17px;font-weight:700">{{shop_name}}</span>
  </div>
  <div style="padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;color:#222;font-size:14px;line-height:1.6">
    ${inner}
    <p style="margin:20px 0 0;font-size:14px">Trân trọng,<br/>{{shop_name}}</p>
    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#999">
      <a href="{{order_url}}" style="color:${BRAND};text-decoration:none;font-weight:600">Xem đơn hàng →</a>
    </p>
  </div>
</div>`

const DEFAULT_TEMPLATES = {
  order_placed: {
    subject: "Đã nhận đơn hàng #{{order_id}}",
    body_html: wrap(`
      <p style="margin:0 0 12px">Cảm ơn <strong>{{buyer_name}}</strong> đã đặt hàng! Vui lòng chuyển khoản và tải ảnh chuyển khoản lên trang đơn hàng để mình xác nhận nhé.</p>
      {{items}}
      ${TOTAL_ROW}
      <p style="font-size:12px;color:#888;margin:12px 0 0">Phí ship trả cho shipper khi nhận hàng.</p>
      <p style="font-size:13px;margin:8px 0 0">{{payment_note}}</p>`),
  },
  payment_confirmed: {
    subject: "Đã xác nhận thanh toán đơn #{{order_id}}",
    body_html: wrap(`
      <p style="margin:0 0 12px">Chào <strong>{{buyer_name}}</strong>, mình đã xác nhận thanh toán — sẽ chuẩn bị và gửi hàng sớm nhất có thể.</p>
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
      <p style="font-size:12px;color:#888;margin:12px 0 0">Phí ship trả cho shipper khi nhận hàng.</p>`),
  },
  cancelled: {
    subject: "Đơn #{{order_id}} đã bị hủy",
    body_html: wrap(`
      <p style="margin:0 0 12px">Chào <strong>{{buyer_name}}</strong>, đơn hàng của bạn đã bị hủy. Nếu bạn đã thanh toán, vui lòng liên hệ để mình hoàn tiền.</p>
      {{items}}
      ${TOTAL_ROW}`),
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
  footerHtml,
}
