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
// (unused-here) fixed social-platform list in AdminSettings supports.
// Plain colored circle + letter, not an image: a first attempt embedded
// each platform's real logo as a data-URI <img>, but that rendered as a
// broken-image icon with overlapping alt text in real-world testing (at
// least one major mail client blocks data-URI images) — worse than a
// clean letter badge. Plain background-color + text needs no image
// loading at all, so it can't fail this way.
const SOCIAL_BADGE = {
  facebook: { label: "f", color: "#1877F2" },
  messenger: { label: "M", color: "#0084FF" },
  instagram: { label: "IG", color: "#E4405F" },
}

/**
 * Footer badges (facebook/instagram/messenger only, from site_settings —
 * see sender.js's getSocialLinks) + the "automated email" notice. Appended
 * by sender.js AFTER the order-QR block rather than substituted into the
 * template body, so it always renders as the very last section of the
 * mail, below the QR — not baked into `wrap()`, which finishes before the
 * QR is even built.
 */
function footerHtml(social = []) {
  const links = social.filter((s) => SOCIAL_BADGE[s.platform] && s.url)
  const badges = links.length
    ? `<table role="presentation" style="width:100%;margin-top:20px"><tr><td style="text-align:center">${links.map((s) => `
      <a href="${escapeHtml(s.url)}" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:50%;background:${SOCIAL_BADGE[s.platform].color};color:#fff;text-align:center;text-decoration:none;font-size:13px;font-weight:700;margin:0 4px">${SOCIAL_BADGE[s.platform].label}</a>`).join("")}
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
