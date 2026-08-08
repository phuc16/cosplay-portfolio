const ORDER_CODE_PREFIX = "DH"

/** Column B (Mã đơn hàng). Never order_token — see this plan's Global
 * Constraints and Task 3's security test. orders.id is already the
 * admin-facing identifier, stable, unique, and discloses nothing sensitive
 * to a courier who already receives the buyer's name, phone, and address. */
function orderCode(orderId) {
  return `${ORDER_CODE_PREFIX}${orderId}`
}

const SERVICE_INTRA_HCM = "PHS - Nội tỉnh tiết kiệm thỏa thuận"
const SERVICE_INTER_PROVINCE = "VTK - CP tiết kiệm thỏa thuận"

const HCM_ACCEPTED_FORMS = new Set(["ho chi minh", "hcm", "hcmc", "sai gon"])

/** Matches a leading administrative prefix ("TP", "TP.", "T.P", "Thành phố")
 * so it can be stripped before the equality check below. Deliberately does
 * NOT match anywhere else in the string — a prefix only counts at position 0. */
const HCM_PREFIX_RE = /^(thanh\s*pho|t\.?\s*p\.?)\s*\.?\s*/

/** Strips diacritics and lowercases so "Hồ Chí Minh", "HCM", and "Sài Gòn"
 * all match the same keyword list the seller's existing script used —
 * applied only to the structured address_province field, never the whole
 * address string (the spec's stated departure from the old script). */
function normalize(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim()
}

/** Requires the whole (prefix-stripped) province field to BE a Ho Chi Minh
 * City designation, not merely contain one as a substring. Substring
 * matching used to let "Đường Hồ Chí Minh" — a real highway running through
 * Nghệ An, Kon Tum, Đắk Lắk, Hòa Bình, Thanh Hóa, Bình Phước, etc. — falsely
 * select the intra-city service for a parcel nowhere near HCMC. Per spec
 * that's the dangerous direction: wrongly-inter-province only costs more
 * postage, wrongly-intra-province fails to deliver outright. */
function isHoChiMinh(province) {
  const n = normalize(province)
  if (!n) return false
  const stripped = n.replace(HCM_PREFIX_RE, "").trim()
  const withoutTrailingPunct = stripped.replace(/[.,]\s*$/, "").trim()
  return HCM_ACCEPTED_FORMS.has(withoutTrailingPunct)
}

/** Unknown/empty province defaults to the inter-province service — the
 * safe direction: a wrongly-inter-province shipment costs more, a
 * wrongly-intra-province one fails outright. */
function selectService(province) {
  return isHoChiMinh(province) ? SERVICE_INTRA_HCM : SERVICE_INTER_PROVINCE
}

/** Column E (Địa chỉ nhận). Structured fields take priority (they came
 * through address autocomplete and are more reliable); address_raw is the
 * fallback for a buyer who skipped autocomplete. Returns null when neither
 * source has anything usable — the caller must treat that as an export
 * error, never a blank column E (a shipment that cannot be delivered). */
function assembleAddress(order) {
  const parts = [order.address_street, order.address_ward, order.address_district, order.address_province]
    .map((p) => String(p || "").trim())
    .filter(Boolean)
  if (parts.length > 0) return parts.join(", ")

  const raw = String(order.address_raw || "").trim()
  return raw.length > 0 ? raw : null
}

const PAYER_BUYER = "Người nhận trả"
const PAYER_SELLER = "Người gửi trả"

// Verified from the template's "Loai hang hoa" reference sheet — exactly two values.
const LOAI_HANG_HOA_VALUES = ["Bưu kiện", "Tài liệu"]

/** Column J (Tiền thu hộ COD). Blank (null) for any prepaid order — VTP
 * should never be told to collect money that was already paid. A COD order
 * with no recorded cod_amount is an export ERROR, not a blank cell: a COD
 * shipment that collects nothing is money lost, and must be caught before
 * the parcel leaves, not discovered afterward. */
function resolveCod(order) {
  if (order.payment_method !== "cod") return { ok: true, value: null }
  if (order.cod_amount === null || order.cod_amount === undefined) {
    return {
      ok: false,
      reason: "cod_missing_amount",
      message: "Đơn COD nhưng chưa có số tiền thu hộ (cod_amount)",
    }
  }
  return { ok: true, value: order.cod_amount }
}

/** Column S (Người trả cước). Defaults to buyer-pays, matching migration
 * 017's column default — an order that predates the shipping_payer column
 * being set explicitly is never silently treated as freeship. */
function selectPayer(order) {
  return order.shipping_payer === "seller" ? PAYER_SELLER : PAYER_BUYER
}

/**
 * Map one order to its per-order VTP row values (columns B, C, D, E, I, J,
 * M, S — the batch-level columns F, G, H, K, U are filled by the caller,
 * see vtpWorkbook.js). Returns an explicit ok:false with a reason rather
 * than throwing, so a caller can skip one bad order without aborting a
 * whole export — the same per-row-isolation principle as the admin
 * bulk-cancel endpoint.
 *
 * Deliberately reads only the specific fields it needs off `order` — never
 * `order.order_token` — so a caller accidentally passing the full order row
 * (including order_token) can never leak it into the mapped row. See this
 * plan's Global Constraints.
 */
function mapOrderToRow(order) {
  const address = assembleAddress(order)
  if (!address) {
    return {
      ok: false,
      order_id: order.id,
      reason: "no_address",
      message: `${orderCode(order.id)}: không có địa chỉ nhận hàng hợp lệ`,
    }
  }

  const cod = resolveCod(order)
  if (!cod.ok) {
    return { ok: false, order_id: order.id, reason: cod.reason, message: `${orderCode(order.id)}: ${cod.message}` }
  }

  return {
    ok: true,
    order_id: order.id,
    row: {
      B: orderCode(order.id),
      C: order.buyer_name,
      D: String(order.phone || "").replace(/\s+/g, ""),
      E: address,
      I: order.total,
      J: cod.value,
      M: selectService(order.address_province),
      S: selectPayer(order),
    },
  }
}

module.exports = {
  ORDER_CODE_PREFIX, orderCode,
  SERVICE_INTRA_HCM, SERVICE_INTER_PROVINCE, isHoChiMinh, selectService,
  assembleAddress,
  PAYER_BUYER, PAYER_SELLER, LOAI_HANG_HOA_VALUES,
  resolveCod, selectPayer, mapOrderToRow,
}
