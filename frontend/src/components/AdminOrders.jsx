import { useEffect, useState } from "react"
import { adminListOrders, adminTransitionOrder, adminGetOrder } from "../api/shop"
import { formatVnd } from "../utils/money"

const STATUSES = ["", "pending", "confirmed", "shipped", "completed", "cancelled"]

// The legal next-statuses come straight from the API's allowed_transitions
// field (computed server-side from the real canTransition state machine in
// backend/shop/orders/domain.js) — the frontend keeps zero independent copy
// of the transition rules.
const nextStatuses = (order) => order.allowed_transitions || []

export default function AdminOrders() {
  const [orders, setOrders] = useState([])
  const [filter, setFilter] = useState("")
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState("")

  const reload = () => adminListOrders(filter ? { status: filter } : {}).then(setOrders)

  useEffect(() => { reload().catch(() => setOrders([])) }, [filter])

  const move = async (order, to) => {
    setError("")
    const payload = { to }
    if (to === "shipped") {
      const code = prompt("Mã vận đơn (có thể bỏ trống):")
      if (code) payload.tracking_code = code
    }
    if (to === "cancelled" && !confirm("Hủy đơn này? Kho sẽ được hoàn lại.")) return

    try {
      await adminTransitionOrder(order.id, payload)
      await reload()
      if (detail?.id === order.id) setDetail(await adminGetOrder(order.id))
    } catch (e) {
      setError(e.response?.data?.message || "Đổi trạng thái thất bại")
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-xl font-semibold">Đơn hàng</h3>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent">
          {STATUSES.map((s) => <option key={s} value={s}>{s || "Tất cả"}</option>)}
        </select>
      </div>

      {error && <p className="text-red-500 mb-3">{error}</p>}
      {orders.length === 0 && <p className="opacity-60">Chưa có đơn nào.</p>}

      {orders.map((o) => (
        <div key={o.id} className="mb-3 p-3 rounded-xl border border-[var(--border-brand)]">
          <div className="flex justify-between items-start gap-3 flex-wrap">
            <div>
              <p className="font-medium">#{o.id} · {o.buyer_name} · {o.phone}</p>
              <p className="text-sm opacity-70">
                {o.status} · {o.fulfillment_method} · {o.payment_method} · {formatVnd(o.total)}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={async () => setDetail(await adminGetOrder(o.id))}
                className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Chi tiết</button>
              {nextStatuses(o).map((to) => (
                <button key={to} type="button" onClick={() => move(o, to)}
                  className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">{to}</button>
              ))}
            </div>
          </div>

          {detail?.id === o.id && (
            <div className="mt-3 pt-3 border-t border-[var(--border-brand)] text-sm">
              <p className="opacity-70">{detail.email}</p>
              {detail.fulfillment_method === "ship" && <p className="opacity-70">{detail.address_raw}</p>}
              {detail.note && <p className="mt-1 italic opacity-70">“{detail.note}”</p>}
              <ul className="mt-2">
                {detail.items.map((i) => (
                  <li key={i.id}>
                    {i.product_name_snapshot} · {i.variant_label_snapshot} × {i.qty} —{" "}
                    {formatVnd(i.unit_price_snapshot * i.qty)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
