import { useState } from "react"
import { useLanguage } from "../../contexts/LanguageContext"
import { formatVnd } from "../../utils/money"

/** Copy-to-clipboard button; silently no-ops where the Clipboard API is unavailable. */
function CopyButton({ value }) {
  const { t } = useLanguage()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard permission denied or unavailable — the value is still
      // visible on screen for a manual copy, so this is not fatal.
    }
  }

  return (
    <button type="button" onClick={copy}
      className="ml-2 px-2 py-0.5 text-xs rounded-md border border-[var(--border-brand)] hover:bg-[var(--brand-soft)]">
      {copied ? t("paymentCopied") : t("paymentCopy")}
    </button>
  )
}

function Row({ label, value, copyable }) {
  if (!value) return null
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-[var(--border-default)] last:border-0">
      <span className="text-sm opacity-70">{label}</span>
      <span className="text-sm font-medium flex items-center">
        {value}
        {copyable && <CopyButton value={value} />}
      </span>
    </div>
  )
}

/**
 * Renders method-specific payment instructions. Only the details for the
 * order's own method ever arrive here — the shape comes straight from
 * GET /api/orders/:token/payment (backend/shop/payments/instructions.js).
 */
export default function PaymentInstructions({ instructions, token }) {
  const { t } = useLanguage()
  if (!instructions) return null

  const { method, amount, payment_note } = instructions

  return (
    <div className="p-4 rounded-xl border border-[var(--border-brand)] mb-6">
      <h2 className="font-semibold mb-3">
        {method === "bank" && t("paymentBank")}
        {method === "momo" && t("paymentMomo")}
        {method === "paypal" && t("paymentPaypal")}
        {method === "cod" && t("paymentCod")}
      </h2>

      <Row label={t("paymentAmount")} value={formatVnd(amount)} />

      {method === "bank" && (
        <>
          <Row label={t("paymentBankName")} value={instructions.bank_name} />
          <Row label={t("paymentAccountNumber")} value={instructions.account_number} copyable />
          <Row label={t("paymentAccountHolder")} value={instructions.account_holder} />
          <Row label={t("paymentTransferNote")} value={instructions.transfer_note} copyable />

          {instructions.vietqr_payload ? (
            <div className="mt-4 flex flex-col items-center">
              <img
                src={`/api/orders/${token}/payment/qr.svg`}
                alt={t("paymentScanQr")}
                className="w-48 h-48 rounded-lg border border-[var(--border-default)]"
              />
              <p className="text-xs opacity-60 mt-2">{t("paymentScanQrHint")}</p>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-error)] mt-3">{t("paymentQrUnavailable")}</p>
          )}
        </>
      )}

      {method === "momo" && (
        <>
          <Row label={t("paymentMomoPhone")} value={instructions.momo_phone} copyable />
          <Row label={t("paymentAccountHolder")} value={instructions.momo_account_holder} />
          <Row label={t("paymentTransferNote")} value={instructions.transfer_note} copyable />
          {instructions.momo_qr_image ? (
            <div className="mt-4 flex justify-center">
              <img src={instructions.momo_qr_image} alt={t("paymentScanQr")}
                className="w-48 h-48 object-contain rounded-lg border border-[var(--border-default)]" />
            </div>
          ) : (
            <p className="text-sm text-[var(--text-error)] mt-3">{t("paymentQrUnavailable")}</p>
          )}
        </>
      )}

      {method === "paypal" && (
        <>
          {instructions.paypal_link ? (
            <a href={instructions.paypal_link} target="_blank" rel="noreferrer"
              className="block mt-3 text-center py-2 rounded-lg bg-[var(--brand)] text-white">
              {t("paymentPaypalPay")}
            </a>
          ) : (
            <p className="text-sm text-[var(--text-error)] mt-3">{t("paymentQrUnavailable")}</p>
          )}
        </>
      )}

      {method === "cod" && <p className="text-sm opacity-70 mt-2">{t("paymentCodNote")}</p>}

      {payment_note && <p className="text-sm mt-3 italic opacity-70">{payment_note}</p>}
    </div>
  )
}
