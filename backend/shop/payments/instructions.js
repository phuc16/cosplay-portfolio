const { buildVietQrPayload } = require("./vietqr")

/**
 * Short, uppercase, alphanumeric reference the buyer puts in the transfer
 * note. Derived from the order token so it is stable and unguessable, but
 * short enough for a banking app's note field.
 */
function transferNote(orderToken) {
  return `DH${String(orderToken).slice(0, 8).toUpperCase()}`
}

/**
 * Only the details for the order's own method are returned. A Momo order never
 * receives bank account details, so a leaked order page exposes the minimum.
 */
function buildInstructions(order, settings) {
  const note = transferNote(order.order_token)
  const base = { method: order.payment_method, amount: order.total, payment_note: settings.payment_note || null }

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

module.exports = { buildInstructions, transferNote }
