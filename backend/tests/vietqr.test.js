import { describe, it, expect } from "vitest"
import { crc16, tlv, buildVietQrPayload, sanitizeInfo } from "../shop/payments/vietqr.js"

describe("crc16", () => {
  it("matches the known CRC-16/CCITT-FALSE check value", () => {
    expect(crc16("123456789")).toBe("29B1")
  })

  it("always returns four uppercase hex characters", () => {
    for (const s of ["", "a", "hello world", "0".repeat(200)]) {
      expect(crc16(s)).toMatch(/^[0-9A-F]{4}$/)
    }
  })
})

describe("buildVietQrPayload", () => {
  const base = { bankBin: "970416", accountNumber: "123456789", amount: 35000, addInfo: "DH ABC123" }

  it("starts with the EMVCo format indicator", () => {
    expect(buildVietQrPayload(base).startsWith("000201")).toBe(true)
  })

  it("marks a payload carrying an amount as dynamic", () => {
    expect(buildVietQrPayload(base)).toContain("010212")
  })

  it("marks a payload without an amount as static", () => {
    expect(buildVietQrPayload({ ...base, amount: null })).toContain("010211")
  })

  it("uses the NAPAS GUID and embeds bank and account", () => {
    const p = buildVietQrPayload(base)
    expect(p).toContain("A000000727")
    expect(p).toContain("970416")
    expect(p).toContain("123456789")
  })

  it("declares VND and Vietnam", () => {
    const p = buildVietQrPayload(base)
    expect(p).toContain("5303704")
    expect(p).toContain("5802VN")
  })

  it("encodes the amount with its own length prefix", () => {
    expect(buildVietQrPayload(base)).toContain("540535000")
  })

  it("embeds the order reference so the transfer can be matched", () => {
    expect(buildVietQrPayload(base)).toContain("DH ABC123")
  })

  it("ends with a CRC that validates against the rest of the payload", () => {
    const p = buildVietQrPayload(base)
    const body = p.slice(0, -4)
    expect(body.endsWith("6304")).toBe(true)
    expect(p.slice(-4)).toBe(crc16(body))
  })

  it("produces a different CRC when the amount changes", () => {
    const a = buildVietQrPayload(base)
    const b = buildVietQrPayload({ ...base, amount: 70000 })
    expect(a.slice(-4)).not.toBe(b.slice(-4))
  })

  it("rejects a missing bank BIN or account number", () => {
    expect(() => buildVietQrPayload({ ...base, bankBin: null })).toThrow()
    expect(() => buildVietQrPayload({ ...base, accountNumber: "" })).toThrow()
  })

  it("rejects a bank BIN containing a space or letters", () => {
    expect(() => buildVietQrPayload({ ...base, bankBin: "9704 16" })).toThrow()
    expect(() => buildVietQrPayload({ ...base, bankBin: "ABC416" })).toThrow()
  })

  it("rejects an account number containing a space", () => {
    expect(() => buildVietQrPayload({ ...base, accountNumber: "123 456789" })).toThrow()
  })

  it("rejects an account number over 19 characters", () => {
    expect(() => buildVietQrPayload({ ...base, accountNumber: "1".repeat(20) })).toThrow()
  })

  it("accepts realistic valid bank BINs and account numbers", () => {
    expect(() => buildVietQrPayload({ ...base, bankBin: "970416", accountNumber: "0123456789012345" })).not.toThrow()
    expect(() => buildVietQrPayload({ ...base, bankBin: "970436", accountNumber: "ABC123" })).not.toThrow()
    expect(() => buildVietQrPayload({ ...base, accountNumber: "1".repeat(19) })).not.toThrow()
  })

  it("rejects a non-integer amount, which would corrupt the transfer", () => {
    expect(() => buildVietQrPayload({ ...base, amount: 35000.5 })).toThrow()
    expect(() => buildVietQrPayload({ ...base, amount: -1 })).toThrow()
  })

  it("strips characters that would break the TLV encoding", () => {
    const p = buildVietQrPayload({ ...base, addInfo: "DH#ABC/123 xin chào" })
    expect(p).not.toContain("#")
    expect(p).not.toContain("/")
  })
})
