import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import axios from "axios"
import { LanguageProvider } from "../contexts/LanguageContext"
import { ThemeProvider } from "../contexts/ThemeContext"

const fetchOrder = vi.fn()
const fetchPaymentInstructions = vi.fn()
const uploadPaymentProof = vi.fn()
const verifyOrderPin = vi.fn()
const fetchOrderQrBlob = vi.fn()

vi.mock("../api/shop", () => ({
  fetchOrder: (...args) => fetchOrder(...args),
  fetchPaymentInstructions: (...args) => fetchPaymentInstructions(...args),
  uploadPaymentProof: (...args) => uploadPaymentProof(...args),
  verifyOrderPin: (...args) => verifyOrderPin(...args),
  fetchOrderQrBlob: (...args) => fetchOrderQrBlob(...args),
}))

// ShopFooter (rendered on every shop page) fetches /api/settings via `get`
// — mocked here alongside `post` so tests don't attempt a real network call.
vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal()
  return { default: { ...actual.default, post: vi.fn(), get: vi.fn().mockResolvedValue({ data: {} }) } }
})

// jsdom has no createObjectURL/revokeObjectURL; useBlobUrl calls both.
globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-qr")
globalThis.URL.revokeObjectURL = vi.fn()

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: Order, statusTimestamp } = await import("./Order")
const { formatVnDateTime } = await import("../utils/orderDeadline")

function baseOrder(over = {}) {
  return {
    id: 1, order_token: "tok123", status: "confirmed", total: 35000,
    fulfillment_method: "ship", tracking_code: null, created_at: new Date().toISOString(),
    items: [{ id: 1, product_name_snapshot: "Card", variant_label_snapshot: "A1", unit_price_snapshot: 35000, qty: 1 }],
    pickup_location: null, pickup_note: null, has_payment_proof: false, payment_proof_url: null,
    buyer_name: "Nguyễn Văn A", phone: "0900000000", address_raw: "1 ABC, Q1, TP.HCM",
    order_code: "2608145VR0F1LR",
    ...over,
  }
}

async function renderOrder() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/order/tok123"]}>
        <ThemeProvider>
          <LanguageProvider>
            <Routes>
              <Route path="/order/:token" element={<Order />} />
            </Routes>
          </LanguageProvider>
        </ThemeProvider>
      </MemoryRouter>
    )
  })
  return container
}

beforeEach(() => {
  fetchOrder.mockReset()
  fetchPaymentInstructions.mockReset()
  uploadPaymentProof.mockReset()
  verifyOrderPin.mockReset()
  fetchOrderQrBlob.mockReset()
  fetchOrderQrBlob.mockResolvedValue(new Blob(["<svg></svg>"], { type: "image/svg+xml" }))
  axios.post.mockReset()
  sessionStorage.clear()
  localStorage.clear()
})

function futureIso(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

function pastIso(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

describe("Order — order code", () => {
  it("shows the human-readable order code near the top of the page", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ order_code: "2609015VR0F1LR" }))

    const container = await renderOrder()

    expect(container.textContent).toContain("Order code")
    expect(container.textContent).toContain("2609015VR0F1LR")
  })
})

describe("Order — QR caption differs by fulfillment method", () => {
  it("shows both the pickup-flavored caption and the reopen-page caption for a pickup order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ fulfillment_method: "pickup", status: "confirmed" }))

    const container = await renderOrder()

    expect(container.textContent).toContain("Show this QR code at pickup")
    expect(container.textContent).toContain("reopen your order page")
  })

  it("shows the ship-flavored caption for a ship order, not the pickup wording", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ fulfillment_method: "ship", status: "confirmed" }))

    const container = await renderOrder()

    expect(container.textContent).toContain("reopen your order page")
    expect(container.textContent).not.toContain("Show this QR code at pickup")
  })
})

describe("Order — item photos", () => {
  it("shows the variant's photo for an item that has one", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      items: [{ id: 1, product_name_snapshot: "Card", variant_label_snapshot: "A1", unit_price_snapshot: 35000, qty: 1, image_url: "/api/storage/shop/a.webp" }],
    }))

    const container = await renderOrder()

    const img = container.querySelector('img[src="/api/storage/shop/a.webp"]')
    expect(img).not.toBeNull()
  })

  it("renders a placeholder, not a broken image, for an item with no photo", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      items: [{ id: 1, product_name_snapshot: "Card", variant_label_snapshot: "A1", unit_price_snapshot: 35000, qty: 1, image_url: null }],
    }))

    const container = await renderOrder()

    expect(container.querySelector('img[alt=""]')).toBeNull()
  })
})

describe("Order — digital items download link", () => {
  it("shows a download button for a digital item once the order is confirmed", async () => {
    fetchOrder.mockResolvedValue({
      ...baseOrder(),
      status: "confirmed",
      items: [{ id: 1, product_name_snapshot: "Digital Album", variant_label_snapshot: "", qty: 1, unit_price_snapshot: 99000, delivery_link_snapshot: "https://drive.google.com/x" }],
    })
    const container = await renderOrder()

    const link = container.querySelector('a[href="https://drive.google.com/x"]')
    expect(link).toBeTruthy()
  })
})

describe("Order — tracking code", () => {
  it("labels the tracking code as a ViettelPost code, not just a bare number", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "shipped", tracking_code: "151045353461" }))

    const container = await renderOrder()

    expect(container.textContent).toContain("ViettelPost tracking code")
    expect(container.textContent).toContain("#151045353461")
  })

  it("shows no tracking label when there is no tracking code yet", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "confirmed", tracking_code: null }))

    const container = await renderOrder()

    expect(container.textContent).not.toContain("ViettelPost tracking code")
  })
})

describe("Order — receiver info", () => {
  it("shows the buyer's name, phone, and address for a ship order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      fulfillment_method: "ship", buyer_name: "Trần Thị B", phone: "0909999999", address_raw: "10 Điện Biên Phủ, Q1",
    }))

    const container = await renderOrder()

    expect(container.textContent).toContain("Trần Thị B")
    expect(container.textContent).toContain("0909999999")
    expect(container.textContent).toContain("10 Điện Biên Phủ, Q1")
  })

  it("shows name and phone but no address line for a pickup order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      fulfillment_method: "pickup", buyer_name: "Trần Thị B", phone: "0909999999", address_raw: null,
    }))

    const container = await renderOrder()

    expect(container.textContent).toContain("Trần Thị B")
    expect(container.textContent).toContain("0909999999")
    expect(container.textContent).not.toContain("Address:")
  })
})

describe("Order pickup info", () => {
  it("shows pickup location and note for a pickup order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      fulfillment_method: "pickup",
      pickup_location: "Comic Fest, Booth 12",
      pickup_note: "9am-6pm, both days",
    }))

    const container = await renderOrder()

    expect(container.textContent).toContain("Comic Fest, Booth 12")
    expect(container.textContent).toContain("9am-6pm, both days")
  })

  it("does not render a pickup block for a ship order even if fields are somehow present", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      fulfillment_method: "ship",
      pickup_location: "Comic Fest, Booth 12",
    }))

    const container = await renderOrder()

    expect(container.textContent).not.toContain("Comic Fest, Booth 12")
  })

  it("renders no pickup block when the pickup order has neither location nor note", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ fulfillment_method: "pickup" }))

    const container = await renderOrder()

    expect(container.textContent).not.toContain("undefined")
    expect(container.querySelector('[class*="rounded-xl"][class*="opacity-80"]')).toBeNull()
  })
})

describe("Order — pickup code (Event Pickup Verification plan)", () => {
  it("shows the pickup code for a pickup order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ fulfillment_method: "pickup", pickup_code: "482913" }))
    const container = await renderOrder()
    expect(container.textContent).toContain("482913")
  })

  it("does not render a pickup code section for a ship order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ fulfillment_method: "ship", pickup_code: null }))
    const container = await renderOrder()
    expect(container.textContent).not.toContain("Pickup code")
  })
})

describe("Order — payment deadline (Phase 6)", () => {
  it("renders the deadline block for a pending, prepaid order with a future expires_at", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: futureIso(3) }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("Payment deadline:")
    expect(container.textContent).not.toContain("The payment deadline has passed")
  })

  it("renders nothing deadline-related for a COD order (null expires_at)", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: null, payment_method: "cod" }))
    fetchPaymentInstructions.mockResolvedValue({ method: "cod", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).not.toContain("Payment deadline:")
    expect(container.textContent).not.toContain("The payment deadline has passed")
    expect(container.textContent).not.toContain("Invalid Date")
  })

  it("renders the passed-deadline message, not a countdown, when expires_at is in the past but status is still pending (the sweep window)", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: pastIso(1) }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("The payment deadline has passed")
    expect(container.textContent).not.toContain("còn")
    expect(container.textContent).not.toContain("h left")
  })

  it("does not render the deadline block once the order is confirmed", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "confirmed", expires_at: futureIso(3) }))

    const container = await renderOrder()

    expect(container.textContent).not.toContain("Payment deadline:")
    expect(container.textContent).not.toContain("The payment deadline has passed")
  })

  it("renders the manual-confirmation note and the transfer-note explanation while pending", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: futureIso(3) }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("Payments are checked manually by the seller")
    expect(container.textContent).toContain("Please include the exact transfer note above")
  })

  it("renders the extended save-the-link line mentioning the email", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: futureIso(3) }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("We also emailed it to you.")
  })

  it("does not render the manual-confirm note for a pending COD order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: null, payment_method: "cod" }))
    fetchPaymentInstructions.mockResolvedValue({ method: "cod", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).not.toContain("Payments are checked manually by the seller")
  })

  it("does not render the manual-confirm note for a pending prepaid order whose deadline has passed", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: pastIso(1) }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("The payment deadline has passed")
    expect(container.textContent).not.toContain("Payments are checked manually by the seller")
  })

  it("still renders the manual-confirm note for a pending prepaid order with time remaining", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: futureIso(3) }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("Payments are checked manually by the seller")
  })
})

describe("Order — payment instructions/deadline are only for the pre-proof phase", () => {
  it("shows the deadline and bank/QR instructions before proof is submitted", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: futureIso(3), has_payment_proof: false }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("Payment deadline:")
    expect(container.querySelector('input[type="file"]')).toBeTruthy()
  })

  it("hides the deadline and bank/QR instructions once proof has been submitted, even with a future expires_at", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      status: "pending", expires_at: futureIso(3), has_payment_proof: true, payment_proof_url: "https://x/proof.jpg",
    }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).not.toContain("Payment deadline:")
    expect(container.textContent).not.toContain("Payments are checked manually by the seller")
  })

  it("shows a note that the deadline no longer applies once awaiting confirmation", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      status: "pending", expires_at: futureIso(3), has_payment_proof: true, payment_proof_url: "https://x/proof.jpg",
    }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("We've received your payment screenshot")
  })

  it("never shows the awaiting-confirmation note for a COD order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", has_payment_proof: false }))
    fetchPaymentInstructions.mockResolvedValue({ method: "cod", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).not.toContain("We've received your payment screenshot")
  })

  it("lets the buyer re-open the bank/QR details on demand while awaiting confirmation, without reviving the deadline", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      status: "pending", expires_at: futureIso(3), has_payment_proof: true, payment_proof_url: "https://x/proof.jpg",
    }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()
    expect(container.textContent).not.toContain("Bank transfer")

    const showBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Need to pay again? View payment details")
    await act(async () => showBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(container.textContent).toContain("Bank transfer")
    expect(container.textContent).not.toContain("Payment deadline:")
    const hideBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Hide payment details")
    expect(hideBtn).toBeTruthy()

    await act(async () => hideBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect([...container.querySelectorAll("button")].find((b) => b.textContent === "Need to pay again? View payment details")).toBeTruthy()
  })
})

describe("Order — Vietnamese countdown copy", () => {
  afterEach(() => {
    localStorage.removeItem("lang")
  })

  it("renders the Vietnamese 'còn N giờ' countdown when lang is vi", async () => {
    localStorage.setItem("lang", "vi")
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: futureIso(3) }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("còn 3 giờ")
  })
})

describe("Order — semantic status colour (Admin UI plan)", () => {
  it("renders the order status as a StatusBadge with the warning variant while pending", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", expires_at: null }))
    fetchPaymentInstructions.mockResolvedValue({ method: "cod", amount: 35000 })

    const container = await renderOrder()
    const badge = [...container.querySelectorAll("span")].find((el) => el.className.includes("var(--surface-"))
    expect(badge).toBeTruthy()
    expect(badge.className).toContain("var(--border-warning)")
  })

  it("renders the order status with the success variant once confirmed", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "confirmed" }))

    const container = await renderOrder()
    const badge = [...container.querySelectorAll("span")].find((el) => el.className.includes("var(--surface-"))
    expect(badge.className).toContain("var(--border-success)")
  })

  it("renders the order status with the danger variant once cancelled", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "cancelled" }))

    const container = await renderOrder()
    const badge = [...container.querySelectorAll("span")].find((el) => el.className.includes("var(--surface-"))
    expect(badge.className).toContain("var(--border-danger)")
  })

  it("still falls back to the raw status text for a status with no translation key, per STATUS_KEY's existing fallback", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "some_future_status" }))

    const container = await renderOrder()
    expect(container.textContent).toContain("some_future_status")
  })
})

describe("Order — awaiting-payment vs awaiting-confirmation status text", () => {
  it("shows 'awaiting your payment' for a pending prepaid order with no proof yet", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", has_payment_proof: false }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("Awaiting payment")
    expect(container.textContent).not.toContain("Awaiting confirmation")
  })

  it("shows 'awaiting payment confirmation' once proof has been submitted, from has_payment_proof", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      status: "pending", has_payment_proof: true, payment_proof_url: "https://x/proof.jpg",
    }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("Awaiting confirmation")
    expect(container.textContent).not.toContain("Awaiting payment")
  })

  it("switches from 'awaiting your payment' to 'awaiting payment confirmation' right after a successful submit, with no refetch", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", has_payment_proof: false }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })
    uploadPaymentProof.mockResolvedValue({ url: "https://x/proof.jpg" })

    const container = await renderOrder()
    expect(container.textContent).toContain("Awaiting payment")
    fetchOrder.mockClear()

    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(["x"], "proof.jpg", { type: "image/jpeg" })
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true })
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })))
    const submitBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Submit")
    await act(async () => submitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await act(async () => {})

    expect(container.textContent).toContain("Awaiting confirmation")
    expect(fetchOrder).not.toHaveBeenCalled()
  })

  it("never shows 'awaiting your payment' for a COD order (no payment step to wait on)", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", has_payment_proof: false }))
    fetchPaymentInstructions.mockResolvedValue({ method: "cod", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).not.toContain("Awaiting payment")
  })
})

describe("Order — page heading reserves 'Order placed' for a confirmed order", () => {
  it("shows 'Your order is awaiting payment' while pending with no proof yet, on a prepaid order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", has_payment_proof: false }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.querySelector("h1").textContent).toBe("Your order is awaiting payment")
  })

  it("shows 'Order received' (not 'Order placed' or the awaiting-payment title) once proof has been submitted", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      status: "pending", has_payment_proof: true, payment_proof_url: "https://x/proof.jpg",
    }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.querySelector("h1").textContent).toBe("Order received, awaiting confirmation")
  })

  it("shows 'Order received' (not the awaiting-payment title) for a pending COD order, which has no payment step", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", has_payment_proof: false }))
    fetchPaymentInstructions.mockResolvedValue({ method: "cod", amount: 35000 })

    const container = await renderOrder()

    expect(container.querySelector("h1").textContent).toBe("Order received, awaiting confirmation")
  })

  it("shows 'Order placed' once the seller has confirmed it", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "confirmed" }))

    const container = await renderOrder()

    expect(container.querySelector("h1").textContent).toBe("Order placed successfully")
  })

  it("shows a distinct title once the order has shipped", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "shipped" }))

    const container = await renderOrder()

    expect(container.querySelector("h1").textContent).toBe("Your order is on its way")
  })

  it("shows a distinct title once the order is completed", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "completed" }))

    const container = await renderOrder()

    expect(container.querySelector("h1").textContent).toBe("Order completed")
  })

  it("shows a distinct title, not 'Order placed successfully', for a cancelled order", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "cancelled" }))

    const container = await renderOrder()

    expect(container.querySelector("h1").textContent).toBe("Order cancelled")
  })
})

describe("Order — cancel reason", () => {
  it("shows the cancel reason inside the status card when the order was cancelled with one", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "cancelled", cancel_reason: "Hết hàng thực tế" }))

    const container = await renderOrder()

    expect(container.textContent).toContain("Cancellation reason")
    expect(container.textContent).toContain("Hết hàng thực tế")
  })

  it("shows no cancel reason line for a cancelled order that has none", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "cancelled", cancel_reason: null }))

    const container = await renderOrder()

    expect(container.textContent).not.toContain("Cancellation reason")
  })

  it("shows no cancel reason line for a non-cancelled order even if one is somehow present", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "confirmed", cancel_reason: "Hết hàng thực tế" }))

    const container = await renderOrder()

    expect(container.textContent).not.toContain("Cancellation reason")
  })
})

describe("Order — payment proof upload styling", () => {
  it("renders the file input inside a styled, button-looking label, not a bare native input", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending" }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput).toBeTruthy()

    const label = fileInput.closest("label")
    expect(label).toBeTruthy()
    expect(label.className).toContain("var(--border-brand)")
    expect(label.className).toContain("rounded-lg")
  })

  it("stages the picked file without uploading until Submit is pressed", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending" }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })
    uploadPaymentProof.mockResolvedValue({ url: "https://x/proof.jpg" })

    const container = await renderOrder()

    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(["x"], "proof.jpg", { type: "image/jpeg" })
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true })
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })))

    expect(uploadPaymentProof).not.toHaveBeenCalled()
    const submitBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Submit")
    expect(submitBtn).toBeTruthy()
  })

  it("discards the staged file without uploading when Cancel is pressed", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending" }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(["x"], "proof.jpg", { type: "image/jpeg" })
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true })
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })))

    const cancelBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel")
    await act(async () => cancelBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(uploadPaymentProof).not.toHaveBeenCalled()
    expect([...container.querySelectorAll("button")].find((b) => b.textContent === "Submit")).toBeUndefined()
    expect(container.querySelector('input[type="file"]')).toBeTruthy()
  })

  it("still uploads correctly through the restyled input once Submit is pressed", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending" }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })
    uploadPaymentProof.mockResolvedValue({ url: "https://x/proof.jpg" })

    const container = await renderOrder()

    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(["x"], "proof.jpg", { type: "image/jpeg" })
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true })
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })))
    const submitBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Submit")
    await act(async () => submitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await act(async () => {})

    expect(uploadPaymentProof).toHaveBeenCalled()
    const img = container.querySelector('img[src="https://x/proof.jpg"]')
    expect(img).toBeTruthy()
  })

  it("shows the success message and the uploaded image after a refresh, from payment_proof_url", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      status: "pending", has_payment_proof: true, payment_proof_url: "https://x/proof.jpg",
    }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("Uploaded")
    expect(container.querySelector('label input[type="file"]').closest("label").textContent).toContain("Replace")
    const img = container.querySelector('img[alt="Uploaded"]')
    expect(img).toBeTruthy()
    expect(img.src).toBe("https://x/proof.jpg")
  })

  it("tells the buyer they can still replace an already-submitted proof", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      status: "pending", has_payment_proof: true, payment_proof_url: "https://x/proof.jpg",
    }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).toContain("You can still replace it below")
  })

  it("hides the replace hint while a new pick is staged but not yet submitted", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      status: "pending", has_payment_proof: true, payment_proof_url: "https://x/proof.jpg",
    }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(["x"], "proof2.jpg", { type: "image/jpeg" })
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true })
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })))

    expect(container.textContent).not.toContain("You can still replace it below")
  })

  it("does not show the success message when no proof is on file", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending", has_payment_proof: false }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })

    const container = await renderOrder()

    expect(container.textContent).not.toContain("Uploaded")
  })

  it("shows a visible success message after a successful upload, not just an image", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "pending" }))
    fetchPaymentInstructions.mockResolvedValue({ method: "bank", amount: 35000 })
    uploadPaymentProof.mockResolvedValue({ url: "https://x/proof.jpg" })

    const container = await renderOrder()

    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(["x"], "proof.jpg", { type: "image/jpeg" })
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true })
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })))
    const submitBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Submit")
    await act(async () => submitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await act(async () => {})

    expect(container.textContent).toContain("Uploaded")
  })
})

describe("Order — PIN gate", () => {
  function setInputValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    setter.call(el, value)
    el.dispatchEvent(new Event("change", { bubbles: true }))
  }

  it("shows a PIN entry gate, not 'order not found', when the fetch comes back 401", async () => {
    fetchOrder.mockRejectedValue({ response: { status: 401, data: { error: "pin_required" } } })

    const container = await renderOrder()

    expect(container.textContent).toContain("Enter your PIN")
    expect(container.textContent).not.toContain("Order not found")
  })

  it("redeems a stale admin_token via admin_refresh_token and shows the order, not the PIN gate", async () => {
    localStorage.setItem("admin_token", "stale-jwt")
    localStorage.setItem("admin_refresh_token", "still-good-refresh-token")
    fetchOrder
      .mockRejectedValueOnce({ response: { status: 401, data: { error: "pin_required" } } })
      .mockResolvedValueOnce(baseOrder({ status: "confirmed" }))
    axios.post.mockResolvedValue({ data: { token: "fresh-jwt", refresh_token: "new-refresh-token" } })

    const container = await renderOrder()

    expect(axios.post).toHaveBeenCalledWith("/api/refresh", { refresh_token: "still-good-refresh-token" })
    expect(localStorage.getItem("admin_token")).toBe("fresh-jwt")
    expect(container.textContent).not.toContain("Enter your PIN")
    expect(fetchOrder).toHaveBeenCalledTimes(2)
  })

  it("falls back to the PIN gate when the refresh token is also invalid", async () => {
    localStorage.setItem("admin_token", "stale-jwt")
    localStorage.setItem("admin_refresh_token", "expired-refresh-token")
    fetchOrder.mockRejectedValue({ response: { status: 401, data: { error: "pin_required" } } })
    axios.post.mockRejectedValue({ response: { status: 401 } })

    const container = await renderOrder()

    expect(container.textContent).toContain("Enter your PIN")
    expect(localStorage.getItem("admin_refresh_token")).toBeNull()
  })

  it("still shows 'order not found' for a 404, not the PIN gate", async () => {
    fetchOrder.mockRejectedValue({ response: { status: 404 } })

    const container = await renderOrder()

    expect(container.textContent).toContain("Order not found")
    expect(container.textContent).not.toContain("Enter your PIN")
  })

  it("unlocks the order after a correct PIN, refetching and rendering it", async () => {
    fetchOrder
      .mockRejectedValueOnce({ response: { status: 401, data: { error: "pin_required" } } })
      .mockResolvedValueOnce(baseOrder({ status: "confirmed" }))
    verifyOrderPin.mockResolvedValue({ access_token: "session-jwt" })

    const container = await renderOrder()
    expect(container.textContent).toContain("Enter your PIN")

    const input = container.querySelector('input[inputmode="numeric"]')
    await act(async () => setInputValue(input, "123456"))
    const form = container.querySelector("form")
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))

    expect(verifyOrderPin).toHaveBeenCalledWith("tok123", "123456")
    expect(sessionStorage.getItem("order_access:tok123")).toBe("session-jwt")
    expect(container.textContent).not.toContain("Enter your PIN")
    expect(fetchOrder).toHaveBeenCalledTimes(2)
  })

  it("shows an error and stays on the gate when the PIN is wrong", async () => {
    fetchOrder.mockRejectedValue({ response: { status: 401, data: { error: "pin_required" } } })
    verifyOrderPin.mockRejectedValue({ response: { status: 401, data: { error: "invalid_pin" } } })

    const container = await renderOrder()
    const input = container.querySelector('input[inputmode="numeric"]')
    await act(async () => setInputValue(input, "000000"))
    const form = container.querySelector("form")
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))

    expect(container.textContent).toContain("Incorrect PIN")
    expect(sessionStorage.getItem("order_access:tok123")).toBeNull()
  })

  it("shows a lockout message, not the generic wrong-PIN error, after too many attempts (429)", async () => {
    fetchOrder.mockRejectedValue({ response: { status: 401, data: { error: "pin_required" } } })
    verifyOrderPin.mockRejectedValue({
      response: { status: 429, data: { error: "too_many_attempts", message: "Sai mã PIN quá nhiều lần. Thử lại sau 15 phút." } },
    })

    const container = await renderOrder()
    const input = container.querySelector('input[inputmode="numeric"]')
    await act(async () => setInputValue(input, "000000"))
    const form = container.querySelector("form")
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))

    expect(container.textContent).toContain("Thử lại sau 15 phút")
  })
})

describe("statusTimestamp", () => {
  it("picks the timestamp matching the order's current status", () => {
    expect(statusTimestamp({ status: "confirmed", confirmed_at: "2026-08-14T06:00:00Z" })).toBe("2026-08-14T06:00:00Z")
    expect(statusTimestamp({ status: "shipped", shipped_at: "2026-08-15T06:00:00Z" })).toBe("2026-08-15T06:00:00Z")
    expect(statusTimestamp({ status: "completed", completed_at: "2026-08-16T06:00:00Z" })).toBe("2026-08-16T06:00:00Z")
    expect(statusTimestamp({ status: "cancelled", cancelled_at: "2026-08-17T06:00:00Z" })).toBe("2026-08-17T06:00:00Z")
    expect(statusTimestamp({ status: "pending", created_at: "2026-08-13T06:00:00Z" })).toBe("2026-08-13T06:00:00Z")
  })

  it("returns null when the matching timestamp is missing (e.g. a legacy order predating this field)", () => {
    expect(statusTimestamp({ status: "shipped", shipped_at: null })).toBeNull()
  })
})

describe("Order — status timestamp", () => {
  it("shows the timestamp for the order's current status", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "confirmed", confirmed_at: "2026-08-14T06:00:00Z" }))

    const container = await renderOrder()

    expect(container.textContent).toContain(formatVnDateTime("2026-08-14T06:00:00Z"))
  })

  it("shows nothing extra when the matching timestamp is missing", async () => {
    fetchOrder.mockResolvedValue(baseOrder({ status: "shipped", shipped_at: null }))

    const container = await renderOrder()

    // Just confirms no stray "Invalid Date" text renders — the absence of a
    // specific timestamp string isn't otherwise assertable here.
    expect(container.textContent).not.toContain("Invalid Date")
  })
})
