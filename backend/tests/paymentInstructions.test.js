import { describe, it, expect } from "vitest"
import { buildInstructions, transferNote } from "../shop/payments/instructions.js"
import { crc16 } from "../shop/payments/vietqr.js"

const order = { order_token: "abc123def456", total: 35000, payment_method: "bank" }
const settings = {
  bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
  bank_account_number: "123456789", bank_account_holder: "NGUYEN VAN A",
  momo_enabled: true, momo_phone: "0900000000", momo_account_holder: "NGUYEN VAN A",
  paypal_enabled: true, paypal_link: "https://paypal.me/x",
  cod_enabled: true, payment_note: "Ghi chú",
}

describe("transferNote", () => {
  it("derives a short uppercase reference from the token", () => {
    const note = transferNote(order.order_token)
    expect(note).toMatch(/^DH[A-Z0-9]+$/)
    expect(note.length).toBeLessThanOrEqual(25)
  })

  it("is stable for the same order", () => {
    expect(transferNote(order.order_token)).toBe(transferNote(order.order_token))
  })

  it("differs between orders", () => {
    expect(transferNote("aaaa1111")).not.toBe(transferNote("bbbb2222"))
  })
})

describe("buildInstructions", () => {
  it("returns a scannable VietQR payload for bank transfer", () => {
    const i = buildInstructions(order, settings)
    expect(i.method).toBe("bank")
    expect(i.bank_name).toBe("ACB")
    expect(i.account_number).toBe("123456789")
    expect(i.amount).toBe(35000)
    expect(i.vietqr_payload).toContain("970416")
    expect(i.vietqr_payload.slice(-4)).toBe(crc16(i.vietqr_payload.slice(0, -4)))
  })

  it("embeds the transfer note in the QR so the seller can match the payment", () => {
    const i = buildInstructions(order, settings)
    expect(i.transfer_note).toBeTruthy()
    expect(i.vietqr_payload).toContain(i.transfer_note)
  })

  it("returns Momo details without a VietQR payload", () => {
    const i = buildInstructions({ ...order, payment_method: "momo" }, settings)
    expect(i.method).toBe("momo")
    expect(i.momo_phone).toBe("0900000000")
    expect(i.vietqr_payload).toBeUndefined()
  })

  it("returns the PayPal link", () => {
    const i = buildInstructions({ ...order, payment_method: "paypal" }, settings)
    expect(i.paypal_link).toBe("https://paypal.me/x")
  })

  it("returns an amount due for COD and no account details", () => {
    const i = buildInstructions({ ...order, payment_method: "cod" }, settings)
    expect(i.method).toBe("cod")
    expect(i.amount).toBe(35000)
    expect(i.account_number).toBeUndefined()
    expect(i.vietqr_payload).toBeUndefined()
  })

  it("never returns bank details for a Momo order", () => {
    const i = buildInstructions({ ...order, payment_method: "momo" }, settings)
    expect(JSON.stringify(i)).not.toContain("123456789")
  })

  it("degrades gracefully when the bank is misconfigured", () => {
    const i = buildInstructions(order, { ...settings, bank_bin: null })
    expect(i.method).toBe("bank")
    expect(i.vietqr_payload).toBeNull()
    expect(i.account_number).toBe("123456789")
  })
})
