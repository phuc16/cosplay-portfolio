/* eslint-disable react-refresh/only-export-components -- statusTimestamp is
   exported alongside the component so its pure status->timestamp logic is
   directly unit-testable, same pattern as OrderTimeline's buildTimelineSteps. */
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { fetchOrder, fetchPaymentInstructions, uploadPaymentProof, verifyOrderPin, fetchOrderQrBlob, updateOrderBuyerInfo } from "../api/shop"
import ProductReviewForm from "../components/shop/ProductReviewForm"
import { orderAuthHeaders, setOrderSessionToken, refreshAdminSession } from "../utils/orderAuth"
import { useBlobUrl } from "../hooks/useBlobUrl"
import { useLanguage } from "../contexts/LanguageContext"
import { formatVnd } from "../utils/money"
import { formatDeadline, formatVnDateTime } from "../utils/orderDeadline"
import PaymentInstructions from "../components/shop/PaymentInstructions"
import AddressFields from "../components/shop/AddressFields"
import ShopHeader from "../components/shop/ShopHeader"
import ShopFooter from "../components/shop/ShopFooter"
import StatusBadge from "../components/StatusBadge"
import { variantForStatus } from "../constants/statusVariant"

const STATUS_KEY = {
  pending: "orderPending", confirmed: "orderConfirmed", shipped: "orderShipped",
  completed: "orderCompleted", cancelled: "orderCancelled",
}

// The big page heading - distinct per status, unlike STATUS_KEY's compact badge text.
const ORDER_TITLE_KEY = {
  confirmed: "orderPlaced", shipped: "orderShippedTitle",
  completed: "orderCompletedTitle", cancelled: "orderCancelledTitle",
}

// Which timestamp column matches the order's *current* status. Kept pure and separate from render so it's directly unit-testable.
const STATUS_TIMESTAMP_FIELD = {
  pending: "created_at", confirmed: "confirmed_at", shipped: "shipped_at",
  completed: "completed_at", cancelled: "cancelled_at",
}

export function statusTimestamp(order) {
  return order[STATUS_TIMESTAMP_FIELD[order.status]] || null
}

// Well under the backend's 50MB limit - rejects an oversized photo before it burns a retry against the proof rate limiter.
const MAX_PROOF_BYTES = 8 * 1024 * 1024

function ProofUpload({ token, existingProofUrl, onUploaded }) {
  const { t } = useLanguage()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  // Picking a file only stages it - nothing sends until proofSubmit is pressed.
  const [pendingFile, setPendingFile] = useState(null)
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState(null)
  // Overrides existingProofUrl so a fresh upload updates the preview without a refetch.
  const [uploadedUrl, setUploadedUrl] = useState(null)
  const previewUrl = pendingPreviewUrl || uploadedUrl || existingProofUrl
  const alreadyUploaded = Boolean(uploadedUrl || existingProofUrl)

  const onFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return

    if (file.size > MAX_PROOF_BYTES) {
      setError(t("proofTooLarge"))
      return
    }

    setError("")
    setPendingFile(file)
    setPendingPreviewUrl(URL.createObjectURL(file))
  }

  const cancelPending = () => {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl)
    setPendingFile(null)
    setPendingPreviewUrl(null)
  }

  const submit = async () => {
    if (!pendingFile) return
    setError("")
    setUploading(true)
    try {
      const { url } = await uploadPaymentProof(token, pendingFile, orderAuthHeaders(token))
      setUploadedUrl(url)
      onUploaded?.()
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl)
      setPendingFile(null)
      setPendingPreviewUrl(null)
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
      {!pendingFile && alreadyUploaded && (
        <>
          <p className="text-sm text-[var(--text-success)] mb-1">✓ {t("proofUploaded")}</p>
          <p className="text-sm opacity-70 mb-2">{t("proofCanReplace")}</p>
        </>
      )}

      {pendingFile ? (
        <div>
          <p className="text-sm opacity-70 mb-2">{t("proofPendingHint")}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={uploading}
              className="px-3 py-1.5 text-sm rounded-lg bg-[var(--brand)] text-white disabled:opacity-50"
            >
              {uploading ? t("proofUploading") : t("proofSubmit")}
            </button>
            <button
              type="button"
              onClick={cancelPending}
              disabled={uploading}
              className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] disabled:opacity-50"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : (
        <label className="inline-block px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] cursor-pointer hover:bg-[var(--brand-soft)]">
          {alreadyUploaded ? t("proofReplace") : t("proofUpload")}
          <input type="file" accept="image/*" onChange={onFile} className="hidden" />
        </label>
      )}

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

  // Composed here rather than as a fixed translation key, since it wraps a number in locale-specific phrasing.
  const remaining = lang === "vi" ? `còn ${info.remainingHours} giờ` : `${info.remainingHours}h left`
  return (
    <p className="text-sm mt-1 text-[var(--text-warning)]">
      {t("orderDeadline", { time: info.absolute, remaining })}
    </p>
  )
}

// Backend requires either an admin session (see orderAuthHeaders) or this PIN, emailed to the buyer at order creation.
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
      if (err.response?.status === 429) {
        // Built from the server's retry_after_seconds, not its message -
        // that message is Vietnamese-only, and would show up untranslated
        // for a buyer on the English UI otherwise.
        const seconds = err.response?.data?.retry_after_seconds
        const minutes = Number.isFinite(seconds) ? Math.ceil(seconds / 60) : 15
        setError(t("orderPinLocked", { minutes }))
      } else {
        setError(t("orderPinError"))
      }
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
      <ShopFooter />
    </>
  )
}

export default function Order() {
  const { token } = useParams()
  const { t } = useLanguage()
  const [order, setOrder] = useState(undefined)
  const [instructions, setInstructions] = useState(null)
  const [needsPin, setNeedsPin] = useState(false)
  // Bumped after PIN verification to retrigger the fetch below (token/params alone don't change).
  const [unlockCount, setUnlockCount] = useState(0)
  // Lets the buyer re-open the bank/QR panel on demand once proof is submitted (hidden by default at that point).
  const [showPaymentAgain, setShowPaymentAgain] = useState(false)
  const [editingBuyerInfo, setEditingBuyerInfo] = useState(false)
  const [buyerInfoDraft, setBuyerInfoDraft] = useState(null)
  const [buyerInfoError, setBuyerInfoError] = useState("")

  const startEditBuyerInfo = () => {
    // Email is deliberately excluded - it's not editable (backend ignores
    // it even if sent), so there's no field for it here. It's also never
    // part of this page's own order data in the first place (toPublicOrder
    // never exposes it).
    setBuyerInfoDraft({
      buyer_name: order.buyer_name, phone: order.phone,
      note: order.note || "",
      address_raw: order.address_raw || "",
      address_street: order.address_street || "",
      address_ward: order.address_ward || "",
      address_district: order.address_district || "",
      address_province: order.address_province || "",
    })
    setBuyerInfoError("")
    setEditingBuyerInfo(true)
  }

  const saveBuyerInfo = async () => {
    setBuyerInfoError("")
    try {
      await updateOrderBuyerInfo(token, buyerInfoDraft, orderAuthHeaders(token))
      const fresh = await fetchOrder(token, orderAuthHeaders(token))
      setOrder(fresh)
      setEditingBuyerInfo(false)
    } catch (e) {
      setBuyerInfoError(e.response?.data?.message || t("orderEditSaveFailed"))
    }
  }

  useEffect(() => {
    // Belt and braces with the server's X-Robots-Tag - must never be indexed.
    const meta = document.createElement("meta")
    meta.name = "robots"
    meta.content = "noindex, nofollow"
    document.head.appendChild(meta)

    fetchOrder(token, orderAuthHeaders(token))
      .then((data) => { setNeedsPin(false); setOrder(data) })
      .catch(async (err) => {
        if (err.response?.status !== 401) {
          setNeedsPin(false)
          setOrder(null)
          return
        }
        // admin_token can be merely expired (24h) while its refresh token (30d) is still good - redeem and retry once.
        if (await refreshAdminSession()) {
          try {
            const data = await fetchOrder(token, orderAuthHeaders(token))
            setNeedsPin(false)
            setOrder(data)
            return
          } catch {
            // fall through to the PIN gate
          }
        }
        setNeedsPin(true)
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
        <ShopFooter />
      </>
    )
  }
  if (order === null) {
    return (
      <>
        <ShopHeader />
        <main className="max-w-2xl mx-auto px-4 py-10 opacity-70">{t("orderNotFound")}</main>
        <ShopFooter />
      </>
    )
  }

  const isPending = order.status === "pending"
  // COD has no payment step, so it skips straight to the normal pending copy.
  const awaitingPayment = isPending && instructions && instructions.method !== "cod" && !order.has_payment_proof
  const awaitingConfirmation = isPending && instructions && instructions.method !== "cod" && order.has_payment_proof
  // Hidden by default once proof is submitted, but the buyer can re-open it (showPaymentAgain).
  const showPaymentInstructions = awaitingPayment || (awaitingConfirmation && showPaymentAgain)
  const deadlineInfo = formatDeadline(order.expires_at)
  const showManualConfirmNote = awaitingPayment && !deadlineInfo?.passed
  const isPickupOrder = order.fulfillment_method === "pickup"

  return (
    <>
      <ShopHeader />
      <main className="max-w-2xl mx-auto px-4 py-10">
      {/* "Order placed" is reserved for once the seller has confirmed it - the other phases get their own titles. */}
      <h1 className="text-2xl font-bold mb-1">
        {t(awaitingPayment ? "orderAwaitingPaymentTitle" : (isPending ? "orderReceivedTitle" : (ORDER_TITLE_KEY[order.status] ?? "orderPlaced")))}
      </h1>
      {order.order_code && <p className="text-sm opacity-70">{t("orderCodeLabel")}: <strong>{order.order_code}</strong></p>}
      <p className="text-sm opacity-70 mb-6">{t("orderSaveLink")}</p>

      <div className="p-4 rounded-xl border border-[var(--border-brand)] mb-6">
        <p className="text-sm opacity-70">{t("orderStatus")}</p>
        <p className="font-semibold">
          {/* An unrecognized status falls through to its raw text via t()'s own key ?? key chain. */}
          <StatusBadge
            label={t(awaitingPayment ? "orderAwaitingPayment" : (STATUS_KEY[order.status] ?? order.status))}
            variant={variantForStatus(order.status)}
          />
        </p>
        {formatVnDateTime(statusTimestamp(order)) && (
          <p className="text-xs opacity-60 mt-1">{formatVnDateTime(statusTimestamp(order))}</p>
        )}
        {order.status === "cancelled" && order.cancel_reason && (
          <p className="text-sm mt-2">
            <span className="opacity-70">{t("orderCancelReasonLabel")}:</span> {order.cancel_reason}
          </p>
        )}
        {order.tracking_code && (
          <div className="mt-1">
            <p className="text-xs opacity-60">{t("orderTrackingCodeLabel")}</p>
            <p className="text-sm font-medium">#{order.tracking_code}</p>
          </div>
        )}
        {/* Deadline only applies before proof is submitted/confirmed - the backend stops enforcing it too. */}
        {awaitingPayment && <DeadlineBlock expiresAt={order.expires_at} />}
        {showManualConfirmNote && <p className="text-sm opacity-70 mt-1">{t("orderManualConfirmNote")}</p>}
        {awaitingConfirmation && (
          <>
            <p className="text-sm opacity-70 mt-1">{t("orderAwaitingConfirmNote")}</p>
            <button
              type="button"
              onClick={() => setShowPaymentAgain((v) => !v)}
              className="text-sm text-[var(--text-link)] mt-2 underline"
            >
              {showPaymentAgain ? t("orderHidePaymentInfo") : t("orderShowPaymentInfoAgain")}
            </button>
          </>
        )}
      </div>

      {showPaymentInstructions && <PaymentInstructions instructions={instructions} token={token} />}

      {showPaymentInstructions && <p className="text-xs opacity-70 mb-4">{t("orderTransferNoteExplain")}</p>}

      {/* Mirrors the server rule: proof uploads are refused once an order leaves pending. */}
      {isPending && (
        <ProofUpload
          token={token}
          existingProofUrl={order.payment_proof_url}
          onUploaded={() => setOrder((prev) => (prev ? { ...prev, has_payment_proof: true } : prev))}
        />
      )}

      <h2 className="font-semibold mb-2">{t("orderItems")}</h2>
      {order.items.map((i) => (
        <div key={i.id} className="flex justify-between items-center gap-3 py-2 border-b border-[var(--border-brand)]">
          <div className="flex items-center gap-3 min-w-0">
            {i.image_url
              ? <img src={i.image_url} alt="" className="w-12 h-12 object-cover rounded-lg shrink-0" />
              : <div className="w-12 h-12 rounded-lg bg-[var(--surface-neutral)] shrink-0" />}
            <div className="min-w-0">
              <span className="truncate block">
                {i.product_name_snapshot}{i.variant_label_snapshot ? ` · ${i.variant_label_snapshot}` : ""} × {i.qty}
                {Boolean(i.is_gift) && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--brand-soft)]">🎁 {t("orderGiftBadge")}</span>
                )}
              </span>
              {i.delivery_link_snapshot && (
                <a href={i.delivery_link_snapshot} target="_blank" rel="noreferrer" className="text-sm text-[var(--text-link)] underline">
                  {t("orderDownloadLink")}
                </a>
              )}
              {/* A review is about a received item - only offered once the
                  order is completed, and never for the free gift (which has
                  no catalog relationship at all, so there's nothing to
                  attach a review to). */}
              {order.status === "completed" && !i.is_gift && i.product_variant_id && (
                <ProductReviewForm token={token} variantId={i.product_variant_id} authHeaders={orderAuthHeaders(token)} />
              )}
            </div>
          </div>
          <span className="shrink-0">{formatVnd(i.unit_price_snapshot * i.qty)}</span>
        </div>
      ))}

      <div className="flex justify-between mt-4 text-lg font-bold">
        <span>{t("orderTotalLabel")}</span>
        <span className="text-[var(--brand)]">{formatVnd(order.total)}</span>
      </div>

      {order.fulfillment_method === "ship" && (
        <p className="text-xs opacity-70 mt-1">{t("checkoutShippingNote")}</p>
      )}

      <div className="mt-4 p-4 rounded-xl border border-[var(--border-brand)] text-sm">
        <p className="font-semibold mb-2">{t("orderReceiverInfoTitle")}</p>
        <p>{t("orderReceiverName")}: {order.buyer_name}</p>
        <p>{t("orderReceiverPhone")}: {order.phone}</p>
        {order.fulfillment_method === "ship" && order.address_raw && (
          <p>{t("orderReceiverAddress")}: {order.address_raw}</p>
        )}
        {order.note && (
          <p>{t("orderReceiverNote")}: {order.note}</p>
        )}

        {order.status === "pending" && !editingBuyerInfo && (
          <button
            type="button"
            onClick={startEditBuyerInfo}
            className="mt-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-[var(--brand)] text-white"
          >
            {t("orderEditInfo")}
          </button>
        )}

        {editingBuyerInfo && (
          <div className="mt-2 p-3 rounded-lg border border-[var(--border-brand)]">
            {buyerInfoError && <p className="text-red-500 text-sm mb-2">{buyerInfoError}</p>}
            <input
              data-testid="edit-buyer-name"
              value={buyerInfoDraft.buyer_name}
              onChange={(e) => setBuyerInfoDraft({ ...buyerInfoDraft, buyer_name: e.target.value })}
              placeholder={t("orderEditName")}
              className="w-full mb-2 px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
            />
            <input
              value={buyerInfoDraft.phone}
              onChange={(e) => setBuyerInfoDraft({ ...buyerInfoDraft, phone: e.target.value })}
              placeholder={t("orderEditPhone")}
              className="w-full mb-2 px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
            />
            {order.fulfillment_method === "ship" && (
              <div className="mb-2">
                <AddressFields
                  value={buyerInfoDraft}
                  onChange={(addr) => setBuyerInfoDraft({ ...buyerInfoDraft, ...addr })}
                />
              </div>
            )}
            <textarea
              value={buyerInfoDraft.note}
              onChange={(e) => setBuyerInfoDraft({ ...buyerInfoDraft, note: e.target.value })}
              placeholder={t("orderEditNote")}
              rows={2}
              className="w-full mb-2 px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
            />
            <div className="flex gap-2">
              <button type="button" onClick={saveBuyerInfo} className="px-4 py-2 rounded-lg bg-[var(--brand)] text-white text-sm">
                {t("orderEditSave")}
              </button>
              <button type="button" onClick={() => setEditingBuyerInfo(false)} className="px-4 py-2 rounded-lg border border-[var(--border-brand)] text-sm">
                {t("orderEditCancel")}
              </button>
            </div>
          </div>
        )}
      </div>

      {order.fulfillment_method === "pickup" && order.pickup_locations?.length > 0 && (
        <div className="mt-4 p-4 rounded-xl border border-[var(--border-brand)] opacity-80 text-sm space-y-3">
          {order.pickup_locations.map((loc) => (
            <div key={loc.collection_id}>
              {order.pickup_locations.length > 1 && (
                <p className="text-xs uppercase tracking-wide opacity-60">{loc.collection_title}</p>
              )}
              {loc.pickup_location && (
                <p className="font-semibold">{t("shopPickupLocation")}: {loc.pickup_location}</p>
              )}
              {loc.pickup_note && <p>{t("shopPickupNote")}: {loc.pickup_note}</p>}
            </div>
          ))}
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
          <img src={qrSrc} alt={isPickupOrder ? t("orderQrCaptionPickup") : t("orderQrCaptionShip")}
            className="w-40 h-40 rounded-lg border border-[var(--border-brand)]" />
          <p className="text-xs opacity-60 mt-2 text-center">
            {isPickupOrder && <>{t("orderQrCaptionPickup")}<br /></>}
            {t("orderQrCaptionShip")}
          </p>
        </div>
      )}
      </main>
      <ShopFooter />
    </>
  )
}
