import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { LanguageProvider } from "../../contexts/LanguageContext"

const fetchPaymentQrBlob = vi.fn()

vi.mock("../../api/shop", () => ({
  fetchPaymentQrBlob: (...args) => fetchPaymentQrBlob(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-qr")
globalThis.URL.revokeObjectURL = vi.fn()

const { default: PaymentInstructions } = await import("./PaymentInstructions")

async function renderWith(instructions) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <LanguageProvider>
        <PaymentInstructions instructions={instructions} token="tok123" />
      </LanguageProvider>
    )
  })
  await act(async () => {})
  return container
}

beforeEach(() => {
  localStorage.clear()
  fetchPaymentQrBlob.mockReset()
  fetchPaymentQrBlob.mockResolvedValue(new Blob(["<svg></svg>"], { type: "image/svg+xml" }))
})

describe("PaymentInstructions", () => {
  it("shows the printed bank details and an unavailable notice, never a blank box, when vietqr_payload is null", async () => {
    const container = await renderWith({
      method: "bank", amount: 100000, payment_note: null,
      bank_name: "ACB", account_number: "123456789", account_holder: "NGUYEN VAN A",
      transfer_note: "DH12345678", vietqr_payload: null,
    })

    expect(container.querySelector("img")).toBeNull()
    expect(container.textContent).toContain("ACB")
    expect(container.textContent).toContain("123456789")
    expect(container.textContent).toContain("DH12345678")
    expect(container.textContent).toContain("unavailable")
  })

  it("renders the VietQR image from the payment qr.svg route when a payload is present", async () => {
    const container = await renderWith({
      method: "bank", amount: 100000, payment_note: null,
      bank_name: "ACB", account_number: "123456789", account_holder: "NGUYEN VAN A",
      transfer_note: "DH12345678", vietqr_payload: "0002010102...",
    })

    const img = [...container.querySelectorAll("img")].find((i) => i.src.startsWith("blob:"))
    expect(img).toBeTruthy()
    expect(fetchPaymentQrBlob).toHaveBeenCalledWith("tok123", expect.any(Object))
    expect(container.textContent).not.toContain("unavailable")
  })

  it("shows the VietQR logo above the QR, like VietQR's own official card layout", async () => {
    const container = await renderWith({
      method: "bank", amount: 100000, payment_note: null,
      bank_name: "ACB", account_number: "123456789", account_holder: "NGUYEN VAN A",
      transfer_note: "DH12345678", vietqr_payload: "0002010102...",
    })

    const imgs = [...container.querySelectorAll("img")]
    const badge = imgs.find((i) => i.alt === "VietQR")
    const qr = imgs.find((i) => i.src.startsWith("blob:"))
    expect(badge).toBeTruthy()
    expect(imgs.indexOf(badge)).toBeLessThan(imgs.indexOf(qr))
  })

  it("shows the NAPAS 247 caption and the account holder/number beneath the QR, like the official VietQR card", async () => {
    const container = await renderWith({
      method: "bank", amount: 100000, payment_note: null,
      bank_name: "ACB", account_number: "123456789", account_holder: "NGUYEN VAN A",
      transfer_note: "DH12345678", vietqr_payload: "0002010102...",
    })

    expect(container.textContent).toContain("NAPAS 247")
    expect(container.textContent).toContain("NGUYEN VAN A")
  })

  it("does not show the VietQR badge when the QR itself is unavailable", async () => {
    const container = await renderWith({
      method: "bank", amount: 100000, payment_note: null,
      bank_name: "ACB", account_number: "123456789", account_holder: "NGUYEN VAN A",
      transfer_note: "DH12345678", vietqr_payload: null,
    })

    expect(container.querySelector('img[alt="VietQR"]')).toBeNull()
  })

  it("does not show the VietQR badge for momo, which uses an admin-uploaded QR, not the VietQR standard", async () => {
    const container = await renderWith({
      method: "momo", amount: 50000, payment_note: null,
      momo_phone: "0900000000", momo_account_holder: "A", momo_qr_image: "https://x/img.png",
      transfer_note: "DH12345678",
    })

    expect(container.querySelector('img[alt="VietQR"]')).toBeNull()
  })

  it("renders momo details with the uploaded QR image", async () => {
    const container = await renderWith({
      method: "momo", amount: 50000, payment_note: null,
      momo_phone: "0900000000", momo_account_holder: "A", momo_qr_image: "https://x/img.png",
      transfer_note: "DH12345678",
    })

    expect(container.textContent).toContain("0900000000")
    const img = container.querySelector("img")
    expect(img.src).toBe("https://x/img.png")
  })

  it("shows the unavailable notice for momo without a QR image", async () => {
    const container = await renderWith({
      method: "momo", amount: 50000, payment_note: null,
      momo_phone: "0900000000", momo_account_holder: "A", momo_qr_image: null,
      transfer_note: "DH12345678",
    })

    expect(container.querySelector("img")).toBeNull()
    expect(container.textContent).toContain("unavailable")
  })

  it("renders a PayPal pay link", async () => {
    const container = await renderWith({
      method: "paypal", amount: 20000, payment_note: null,
      paypal_link: "https://paypal.me/x", transfer_note: "DH12345678",
    })

    const link = container.querySelector("a")
    expect(link.href).toBe("https://paypal.me/x")
  })

  it("renders COD with no account details at all", async () => {
    const container = await renderWith({ method: "cod", amount: 30000, payment_note: null })

    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("a")).toBeNull()
    expect(container.textContent).not.toContain("unavailable")
  })

  it("always shows payment_note when present", async () => {
    const container = await renderWith({ method: "cod", amount: 30000, payment_note: "Ship trong 3 ngày" })
    expect(container.textContent).toContain("Ship trong 3 ngày")
  })

  it("does not duplicate the note as a footer paragraph when it's already shown as the bank transfer-content row", async () => {
    const container = await renderWith({
      method: "bank", amount: 100000, payment_note: "Chuyen tien don hang",
      bank_name: "ACB", account_number: "123456789", account_holder: "A",
      transfer_note: "Chuyen tien don hang", vietqr_payload: null,
    })
    const occurrences = container.textContent.split("Chuyen tien don hang").length - 1
    expect(occurrences).toBe(1)
  })

  it("does not duplicate the note as a footer paragraph when it's already shown as the momo transfer-content row", async () => {
    const container = await renderWith({
      method: "momo", amount: 50000, payment_note: "Chuyen tien don hang",
      momo_phone: "0900000000", momo_account_holder: "A",
      transfer_note: "Chuyen tien don hang",
    })
    const occurrences = container.textContent.split("Chuyen tien don hang").length - 1
    expect(occurrences).toBe(1)
  })

  it("still shows the footer note for paypal, which has no transfer-content row", async () => {
    const container = await renderWith({
      method: "paypal", amount: 20000, payment_note: "Chuyen tien don hang",
      paypal_link: "https://paypal.me/x", transfer_note: "Chuyen tien don hang",
    })
    expect(container.textContent).toContain("Chuyen tien don hang")
  })

  it("renders nothing when instructions is not yet loaded", async () => {
    const container = await renderWith(null)
    expect(container.innerHTML).toBe("")
  })
})
