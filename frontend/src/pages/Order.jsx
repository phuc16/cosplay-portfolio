/* eslint-disable react-refresh/only-export-components -- statusTimestamp is
   exported alongside the component so its pure status->timestamp logic is
   directly unit-testable, same pattern as OrderTimeline's buildTimelineSteps. */
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { fetchOrder, fetchPaymentInstructions, uploadPaymentProof, verifyOrderPin, fetchOrderQrBlob } from "../api/shop"
import { orderAuthHeaders, setOrderSessionToken } from "../utils/orderAuth"
import { useBlobUrl } from "../hooks/useBlobUrl"
import { useLanguage } from "../contexts/LanguageContext"
import { formatVnd } from "../utils/money"
import { formatDeadline, formatVnDateTime } from "../utils/orderDeadline"
import PaymentInstructions from "../components/shop/PaymentInstructions"
import ShopHeader from "../components/shop/ShopHeader"
import StatusBadge from "../components/StatusBadge"
import { variantForStatus } from "../constants/statusVariant"

const STATUS_KEY = {
  pending: "orderPending", confirmed: "orderConfirmed", shipped: "orderShipped",
  completed: "orderCompleted", cancelled: "orderCancelled",
}

// Which timestamp column corresponds to the order's *current* status — the
// public order response now includes all of these (see routes/orders.js
// toPublicOrder), same fields the admin's OrderTimeline already reads for
// its full history. Kept separate from render for the same reason
// OrderTimeline.buildTimelineSteps is: pure, directly unit-testable logic.
const STATUS_TIMESTAMP_FIELD = {
  pending: "created_at", confirmed: "confirmed_at", shipped: "shipped_at",
  completed: "completed_at", cancelled: "cancelled_at",
}

export function statusTimestamp(order) {
  return order[STATUS_TIMESTAMP_FIELD[order.status]] || null
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

function ProofUpload({ token, existingProofUrl }) {
  const { t } = useLanguage()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  // A fresh upload this visit overrides what the order fetch returned, so
  // replacing the proof updates the preview immediately without a refetch.
  const [uploadedUrl, setUploadedUrl] = useState(null)
  const previewUrl = uploadedUrl || existingProofUrl
  const alreadyUploaded = Boolean(previewUrl)

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
      const { url } = await uploadPaymentProof(token, base64, orderAuthHeaders(token))
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

      {previewUrl && (
        <img src={previewUrl} alt={t("proofUploaded")}
          className="w-32 h-32 object-cover rounded-lg border border-[var(--border-default)] mb-2" />
      )}
      {alreadyUploaded && (
        <p className="text-sm text-[var(--text-success)] mb-2">✓ {t("proofUploaded")}</p>
      )}

      <label
        className={`inline-block px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] cursor-pointer hover:bg-[var(--brand-soft)] ${uploading ? "opacity-50 pointer-events-none" : ""}`}
      >
        {alreadyUploaded ? t("proofReplace") : t("proofUpload")}
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

// order_token in the URL alone used to be sufficient to view this page —
// anyone the buyer casually shared the link with could also see the pickup
// code and upload payment proof (able to overwrite a real buyer's proof
// with a fake one, causing admin to decline their order). The backend now
// requires either an admin session (attached automatically — see
// orderAuthHeaders) or this PIN, emailed to the buyer at order creation.
function PinGate({ token, onVerified }) {
  const { t } = useLanguage()
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (pin.length !== 6) return
    setError("")
    setBusy(true)
    try {
      const { access_token: accessToken } = await verifyOrderPin(token, pin)
      setOrderSessionToken(token, accessToken)
      onVerified()
    } catch (err) {
      setError(
        err.response?.status === 429
          ? (err.response?.data?.message || t("orderPinLocked"))
          : t("orderPinError")
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ShopHeader />
      <main className="max-w-md mx-auto px-4 py-10">
        <h1 className="text-xl font-bold mb-2">{t("orderPinTitle")}</h1>
        <p className="text-sm opacity-70 mb-6">{t("orderPinSubtitle")}</p>
        <form onSubmit={submit}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="w-full text-center text-2xl tracking-[0.5em] px-3 py-3 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
          {error && <p className="text-sm text-[var(--text-error)] mt-2">{error}</p>}
          <button
            type="submit"
            disabled={busy || pin.length !== 6}
            className="mt-4 w-full py-2.5 rounded-lg bg-[var(--brand)] text-white font-medium disabled:opacity-50"
          >
            {busy ? t("orderPinVerifying") : t("orderPinSubmit")}
          </button>
        </form>
      </main>
    </>
  )
}

export default function Order() {
  const { token } = useParams()
  const { t } = useLanguage()
  const [order, setOrder] = useState(undefined)
  const [instructions, setInstructions] = useState(null)
  const [needsPin, setNeedsPin] = useState(false)
  // Bumped after a successful PIN verification to retrigger the fetch below
  // with the now-available session token — token/params alone don't change.
  const [unlockCount, setUnlockCount] = useState(0)

  useEffect(() => {
    // Belt and braces with the server's X-Robots-Tag: the order page is
    // protected only by an unguessable token (+ PIN/admin session) and must
    // never be indexed.
    const meta = document.createElement("meta")
    meta.name = "robots"
    meta.content = "noindex, nofollow"
    document.head.appendChild(meta)

    fetchOrder(token, orderAuthHeaders(token))
      .then((data) => { setNeedsPin(false); setOrder(data) })
      .catch((err) => {
        if (err.response?.status === 401) {
          setNeedsPin(true)
        } else {
          setNeedsPin(false)
          setOrder(null)
        }
      })
    return () => document.head.removeChild(meta)
  }, [token, unlockCount])

  useEffect(() => {
    if (order?.status !== "pending") return
    fetchPaymentInstructions(token, orderAuthHeaders(token)).then(setInstructions).catch(() => setInstructions(null))
  }, [order?.status, token])

  const qrSrc = useBlobUrl(
    () => fetchOrderQrBlob(token, orderAuthHeaders(token)),
    [token, order],
    Boolean(order)
  )

  if (needsPin) {
    return <PinGate token={token} onVerified={() => setUnlockCount((c) => c + 1)} />
  }

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
        {formatVnDateTime(statusTimestamp(order)) && (
          <p className="text-xs opacity-60 mt-1">{formatVnDateTime(statusTimestamp(order))}</p>
        )}
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
      {isPending && <ProofUpload token={token} existingProofUrl={order.payment_proof_url} />}

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

      {qrSrc && (
        <div className="mt-6 flex flex-col items-center">
          <img src={qrSrc} alt={t("orderQrCaption")}
            className="w-40 h-40 rounded-lg border border-[var(--border-brand)]" />
          <p className="text-xs opacity-60 mt-2 text-center">{t("orderQrCaption")}</p>
        </div>
      )}
      </main>
    </>
  )
}
