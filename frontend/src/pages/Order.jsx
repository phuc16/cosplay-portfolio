import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { fetchOrder, fetchPaymentInstructions, uploadPaymentProof } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import { formatVnd } from "../utils/money"
import { formatDeadline } from "../utils/orderDeadline"
import PaymentInstructions from "../components/shop/PaymentInstructions"
import ShopHeader from "../components/shop/ShopHeader"
import StatusBadge from "../components/StatusBadge"
import { variantForStatus } from "../constants/statusVariant"

const STATUS_KEY = {
  pending: "orderPending", confirmed: "orderConfirmed", shipped: "orderShipped",
  completed: "orderCompleted", cancelled: "orderCancelled",
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "")
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Well under the backend's 50MB body limit — rejects an obviously oversized
// photo client-side before it's ever base64-encoded and sent, so a buyer
// doesn't burn a retry against the proof rate limiter on a doomed upload.
const MAX_PROOF_BYTES = 8 * 1024 * 1024

function ProofUpload({ token }) {
  const { t } = useLanguage()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  // Session-only: the buyer-facing order does not expose an existing
  // payment_proof_url (that field is intentionally stripped for buyers), so
  // this reflects only what was uploaded during this visit, not history from
  // an earlier visit or device.
  const [uploadedUrl, setUploadedUrl] = useState(null)

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return

    if (file.size > MAX_PROOF_BYTES) {
      setError(t("proofTooLarge"))
      return
    }

    setError("")
    setUploading(true)
    try {
      const base64 = await readFileAsBase64(file)
      const { url } = await uploadPaymentProof(token, base64)
      setUploadedUrl(url)
    } catch (err) {
      setError(err.response?.data?.message || t("proofError"))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="p-4 rounded-xl border border-[var(--border-brand)] mb-6">
      <h2 className="font-semibold mb-2">{t("proofTitle")}</h2>

      {uploadedUrl && (
        <img src={uploadedUrl} alt={t("proofUploaded")}
          className="w-32 h-32 object-cover rounded-lg border border-[var(--border-default)] mb-2" />
      )}

      <label
        className={`inline-block px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] cursor-pointer hover:bg-[var(--brand-soft)] ${uploading ? "opacity-50 pointer-events-none" : ""}`}
      >
        {uploadedUrl ? t("proofReplace") : t("proofUpload")}
        <input type="file" accept="image/*" onChange={onFile} disabled={uploading} className="hidden" />
      </label>

      {uploading && <p className="text-sm opacity-60 mt-1">{t("proofUploading")}</p>}
      {error && <p className="text-sm text-[var(--text-error)] mt-1">{error}</p>}
    </div>
  )
}

function DeadlineBlock({ expiresAt }) {
  const { t, lang } = useLanguage()
  const info = formatDeadline(expiresAt)
  if (!info) return null

  if (info.passed) {
    return <p className="text-sm text-[var(--text-danger)] mt-1">{t("orderDeadlinePassed")}</p>
  }

  // "còn {n} giờ" / "{n}h left" is composed here, not stored as a sixth
  // translation key — see Task 3 Step 2's note: this phrase is a number
  // wrapped in locale-specific phrasing, not a fixed label on its own.
  const remaining = lang === "vi" ? `còn ${info.remainingHours} giờ` : `${info.remainingHours}h left`
  return (
    <p className="text-sm mt-1 text-[var(--text-warning)]">
      {t("orderDeadline", { time: info.absolute, remaining })}
    </p>
  )
}

export default function Order() {
  const { token } = useParams()
  const { t } = useLanguage()
  const [order, setOrder] = useState(undefined)
  const [instructions, setInstructions] = useState(null)

  useEffect(() => {
    // Belt and braces with the server's X-Robots-Tag: the order page is
    // protected only by an unguessable token and must never be indexed.
    const meta = document.createElement("meta")
    meta.name = "robots"
    meta.content = "noindex, nofollow"
    document.head.appendChild(meta)

    fetchOrder(token).then(setOrder).catch(() => setOrder(null))
    return () => document.head.removeChild(meta)
  }, [token])

  useEffect(() => {
    if (order?.status !== "pending") return
    fetchPaymentInstructions(token).then(setInstructions).catch(() => setInstructions(null))
  }, [order?.status, token])

  if (order === undefined) {
    return (
      <>
        <ShopHeader />
        <main className="max-w-2xl mx-auto px-4 py-10 opacity-60">...</main>
      </>
    )
  }
  if (order === null) {
    return (
      <>
        <ShopHeader />
        <main className="max-w-2xl mx-auto px-4 py-10 opacity-70">{t("orderNotFound")}</main>
      </>
    )
  }

  const isPending = order.status === "pending"
  const showPaymentInstructions = isPending && instructions && instructions.method !== "cod"
  // Transfer-specific copy: only relevant when there's a transfer to make
  // (showPaymentInstructions already excludes COD) and only while the
  // deadline hasn't passed — once it has, DeadlineBlock's passed message is
  // the one true statement about this order, and inviting a faster upload
  // of an order that's being cancelled would contradict it.
  const deadlineInfo = formatDeadline(order.expires_at)
  const showManualConfirmNote = showPaymentInstructions && !deadlineInfo?.passed

  return (
    <>
      <ShopHeader />
      <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-1">{t("orderPlaced")}</h1>
      <p className="text-sm opacity-70 mb-6">{t("orderSaveLink")}</p>

      <div className="p-4 rounded-xl border border-[var(--border-brand)] mb-6">
        <p className="text-sm opacity-70">{t("orderStatus")}</p>
        <p className="font-semibold">
          {/* STATUS_KEY[order.status] is undefined for an unrecognized status;
              t(undefined) falls through LanguageContext's own key ?? key
              chain to return the raw status text — this fallback is already
              in place and is not changed here, only the wrapping badge is
              added. */}
          <StatusBadge label={t(STATUS_KEY[order.status] ?? order.status)} variant={variantForStatus(order.status)} />
        </p>
        {order.tracking_code && <p className="text-sm mt-1">#{order.tracking_code}</p>}
        {/* Deadline is only meaningful while the seller hasn't yet confirmed
            the transfer — expires_at is never cleared on confirm, so this
            gate (not the helper) is what stops a stale countdown from
            reappearing on a confirmed/shipped/completed order. */}
        {isPending && <DeadlineBlock expiresAt={order.expires_at} />}
        {showManualConfirmNote && <p className="text-sm opacity-70 mt-1">{t("orderManualConfirmNote")}</p>}
      </div>

      {showPaymentInstructions && <PaymentInstructions instructions={instructions} token={token} />}

      {/* The exact transfer note only exists on PaymentInstructions, so this
          explanation is only relevant alongside it. */}
      {showPaymentInstructions && <p className="text-xs opacity-70 mb-4">{t("orderTransferNoteExplain")}</p>}

      {/* Hidden entirely once the order leaves pending — the API itself
          refuses uploads past that point, so this mirrors the server rule. */}
      {isPending && <ProofUpload token={token} />}

      <h2 className="font-semibold mb-2">{t("orderItems")}</h2>
      {order.items.map((i) => (
        <div key={i.id} className="flex justify-between py-2 border-b border-[var(--border-brand)]">
          <span>{i.product_name_snapshot} · {i.variant_label_snapshot} × {i.qty}</span>
          <span>{formatVnd(i.unit_price_snapshot * i.qty)}</span>
        </div>
      ))}

      <div className="flex justify-between mt-4 text-lg font-bold">
        <span>{t("orderTotalLabel")}</span>
        <span className="text-[var(--brand)]">{formatVnd(order.total)}</span>
      </div>

      {order.fulfillment_method === "ship" && (
        <p className="text-xs opacity-70 mt-1">{t("checkoutShippingNote")}</p>
      )}

      {order.fulfillment_method === "pickup" && (order.pickup_location || order.pickup_note) && (
        <div className="mt-4 p-4 rounded-xl border border-[var(--border-brand)] opacity-80 text-sm">
          {order.pickup_location && (
            <p className="font-semibold">{t("shopPickupLocation")}: {order.pickup_location}</p>
          )}
          {order.pickup_note && <p>{t("shopPickupNote")}: {order.pickup_note}</p>}
        </div>
      )}

      {order.fulfillment_method === "pickup" && order.pickup_code && (
        <div className="mt-4 p-4 rounded-xl border border-[var(--border-warning)] bg-[var(--surface-warning)] text-center">
          <p className="text-xs opacity-70">{t("orderPickupCode")}</p>
          <p className="text-2xl font-bold tracking-widest">{order.pickup_code}</p>
          <p className="text-xs opacity-60 mt-1">{t("orderPickupCodeHint")}</p>
        </div>
      )}

      <div className="mt-6 flex flex-col items-center">
        <img src={`/api/orders/${token}/qr.svg`} alt={t("orderQrCaption")}
          className="w-40 h-40 rounded-lg border border-[var(--border-brand)]" />
        <p className="text-xs opacity-60 mt-2 text-center">{t("orderQrCaption")}</p>
      </div>
      </main>
    </>
  )
}
