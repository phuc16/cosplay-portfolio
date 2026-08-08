import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { fetchOrder, fetchPaymentInstructions, uploadPaymentProof } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import { formatVnd } from "../utils/money"
import PaymentInstructions from "../components/shop/PaymentInstructions"

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

      <label className="block">
        <span className="block text-sm mb-1 opacity-70">
          {uploadedUrl ? t("proofReplace") : t("proofUpload")}
        </span>
        <input type="file" accept="image/*" onChange={onFile} disabled={uploading} />
      </label>

      {uploading && <p className="text-sm opacity-60 mt-1">{t("proofUploading")}</p>}
      {error && <p className="text-sm text-[var(--text-error)] mt-1">{error}</p>}
    </div>
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

  if (order === undefined) return <main className="max-w-2xl mx-auto px-4 py-10 opacity-60">...</main>
  if (order === null) {
    return <main className="max-w-2xl mx-auto px-4 py-10 opacity-70">{t("orderNotFound")}</main>
  }

  const isPending = order.status === "pending"
  const showPaymentInstructions = isPending && instructions && instructions.method !== "cod"

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-1">{t("orderPlaced")}</h1>
      <p className="text-sm opacity-70 mb-6">{t("orderSaveLink")}</p>

      <div className="p-4 rounded-xl border border-[var(--border-brand)] mb-6">
        <p className="text-sm opacity-70">{t("orderStatus")}</p>
        <p className="font-semibold">{t(STATUS_KEY[order.status])}</p>
        {order.tracking_code && <p className="text-sm mt-1">#{order.tracking_code}</p>}
      </div>

      {showPaymentInstructions && <PaymentInstructions instructions={instructions} token={token} />}

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

      <div className="mt-6 flex flex-col items-center">
        <img src={`/api/orders/${token}/qr.svg`} alt={t("orderQrCaption")}
          className="w-40 h-40 rounded-lg border border-[var(--border-brand)]" />
        <p className="text-xs opacity-60 mt-2 text-center">{t("orderQrCaption")}</p>
      </div>
    </main>
  )
}
