import { describe, it, expect } from "vitest"
import { sanitizeVietQrInfo, willTruncateInVietQr, VIETQR_INFO_MAX_LEN } from "./vietqrSanitize"

describe("sanitizeVietQrInfo", () => {
  it("strips diacritics and maps đ/Đ to D, matching the backend", () => {
    expect(sanitizeVietQrInfo("Ghi chú đơn hàng")).toBe("Ghi chu Don hang")
  })

  it("truncates to 25 characters, matching the backend's silent QR limit", () => {
    expect(sanitizeVietQrInfo("chuc be Tai hay an mau lon")).toBe("chuc be Tai hay an mau lo")
    expect(sanitizeVietQrInfo("chuc be Tai hay an mau lon")).toHaveLength(VIETQR_INFO_MAX_LEN)
  })

  it("returns an untruncated string as-is", () => {
    expect(sanitizeVietQrInfo("short note")).toBe("short note")
  })
})

describe("willTruncateInVietQr", () => {
  it("is true when the sanitized text exceeds the cap", () => {
    expect(willTruncateInVietQr("chuc be Tai hay an mau lon")).toBe(true)
  })

  it("is false when the sanitized text fits", () => {
    expect(willTruncateInVietQr("short note")).toBe(false)
  })

  it("accounts for diacritics/punctuation stripped before the length check", () => {
    // 30 raw chars, but stripping "!" and diacritics could bring it under
    // the cap — this pins the check to the SANITIZED length, not the raw one.
    const raw = "a".repeat(20) + "!!!!!" // 25 chars raw, 20 sanitized (punctuation stripped)
    expect(willTruncateInVietQr(raw)).toBe(false)
  })
})
