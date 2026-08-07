import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { fetchOrder } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import { formatVnd } from "../utils/money"

const STATUS_KEY = {
  pending: "orderPending", confirmed: "orderConfirmed", shipped: "orderShipped",
  completed: "orderCompleted", cancelled: "orderCancelled",
}

export default function Order() {
  const { token } = useParams()
  const { t } = useLanguage()
  const [order, setOrder] = useState(undefined)

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

  if (order === undefined) return <main className="max-w-2xl mx-auto px-4 py-10 opacity-60">...</main>
  if (order === null) {
    return <main className="max-w-2xl mx-auto px-4 py-10 opacity-70">{t("orderNotFound")}</main>
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-1">{t("orderPlaced")}</h1>
      <p className="text-sm opacity-70 mb-6">{t("orderSaveLink")}</p>

      <div className="p-4 rounded-xl border border-[var(--border-brand)] mb-6">
        <p className="text-sm opacity-70">{t("orderStatus")}</p>
        <p className="font-semibold">{t(STATUS_KEY[order.status])}</p>
        {order.tracking_code && <p className="text-sm mt-1">#{order.tracking_code}</p>}
      </div>

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
    </main>
  )
}
