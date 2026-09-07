// Mirrors backend/shop/payments/vietqr.js's sanitizeInfo exactly, so the
// admin sees the same truncation the actual QR code will apply - banking
// apps display the QR's embedded content verbatim, in plain ASCII, capped
// at 25 characters.
export const VIETQR_INFO_MAX_LEN = 25

/** Same normalization as sanitizeVietQrInfo, but without the final length cap - used to detect whether truncation actually happened. */
function sanitizeVietQrInfoUncapped(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "D")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
}

export function sanitizeVietQrInfo(text) {
  return sanitizeVietQrInfoUncapped(text).slice(0, VIETQR_INFO_MAX_LEN)
}

export function willTruncateInVietQr(text) {
  return sanitizeVietQrInfoUncapped(text).length > VIETQR_INFO_MAX_LEN
}
