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

const HCM_ACCEPTED_FORMS = new Set(["ho chi minh", "hcm", "sai gon"])

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
  return HCM_ACCEPTED_FORMS.has(stripped)
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

module.exports = {
  ORDER_CODE_PREFIX, orderCode,
  SERVICE_INTRA_HCM, SERVICE_INTER_PROVINCE, isHoChiMinh, selectService,
  assembleAddress,
}
