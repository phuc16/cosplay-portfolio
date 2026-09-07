const { buildVietQrPayload } = require("./vietqr")

/**
 * Only the details for the order's own method are returned. A Momo order never
 * receives bank account details, so a leaked order page exposes the minimum.
 */
function buildInstructions(order, settings) {
  // Admin-authored, shared across every payment method — not per-order, by
  // design (the seller matches transfers by amount/timing/buyer contact
  // instead of a unique code).
  const note = settings.payment_note || null
  const base = { method: order.payment_method, amount: order.total, payment_note: note }

  if (order.payment_method === "bank") {
    let payload = null
    try {
      payload = buildVietQrPayload({
        bankBin: settings.bank_bin,
        accountNumber: settings.bank_account_number,
        amount: order.total,
        addInfo: note,
      })
    } catch (err) {
      // Misconfiguration must not blank the page — the buyer can still
      // transfer manually using the printed details below.
      console.warn("[PAYMENTS] Không tạo được VietQR:", err.message)
    }

    return {
      ...base,
      bank_name: settings.bank_name,
      account_number: settings.bank_account_number,
      account_holder: settings.bank_account_holder,
      transfer_note: note,
      vietqr_payload: payload,
    }
  }

  if (order.payment_method === "momo") {
    return {
      ...base,
      momo_phone: settings.momo_phone,
      momo_account_holder: settings.momo_account_holder,
      momo_qr_image: settings.momo_qr_image,
      transfer_note: note,
    }
  }

  if (order.payment_method === "paypal") {
    return { ...base, paypal_link: settings.paypal_link, transfer_note: note }
  }

  // COD: nothing to pay online; the amount is collected on handover.
  return base
}

module.exports = { buildInstructions }
