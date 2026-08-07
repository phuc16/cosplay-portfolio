/**
 * VietQR (EMVCo / NAPAS) payload generation.
 *
 * Built locally rather than via an image service so the seller's account
 * details never transit a third party, the QR keeps working if that service
 * disappears, and every branch is unit-testable.
 */

const GUID = "A000000727"

/** EMVCo TLV field: two-digit id, two-digit length, value. */
function tlv(id, value) {
  const v = String(value)
  return `${id}${String(v.length).padStart(2, "0")}${v}`
}

/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection. */
function crc16(payload) {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0")
}

/**
 * Additional-data text must stay inside the printable ASCII the TLV encoding
 * assumes; diacritics and punctuation are stripped rather than escaped, since
 * banking apps display this field verbatim.
 */
function sanitizeInfo(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "D")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .slice(0, 25)
}

function buildVietQrPayload({ bankBin, accountNumber, amount, addInfo }) {
  if (!bankBin) throw new Error("Thiếu mã ngân hàng (BIN)")
  if (!accountNumber) throw new Error("Thiếu số tài khoản")
  if (amount !== null && amount !== undefined) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`Số tiền không hợp lệ: ${amount}`)
    }
  }

  const merchantAccount = tlv("00", GUID) + tlv("01", tlv("00", bankBin) + tlv("01", accountNumber))

  let payload =
    tlv("00", "01") +                                   // format indicator
    tlv("01", amount ? "12" : "11") +                   // 12 dynamic (one-off), 11 static
    tlv("38", merchantAccount + tlv("02", "QRIBFTTA")) +
    tlv("53", "704") +                                  // VND
    (amount ? tlv("54", String(amount)) : "") +
    tlv("58", "VN")

  const info = sanitizeInfo(addInfo)
  if (info) payload += tlv("62", tlv("08", info))

  payload += "6304"                                     // CRC tag and length
  return payload + crc16(payload)
}

module.exports = { crc16, tlv, buildVietQrPayload, sanitizeInfo }
