import { useEffect, lazy, Suspense, useState } from "react"
import { adminListOrders, adminTransitionOrder, adminGetOrder, fetchPaymentInstructions } from "../api/shop"
import { formatVnd } from "../utils/money"

// Statically importing this would ship the scanner/camera component code to
// every buyer, even though only the admin route ever renders it (the jsqr
// library itself was already dynamically imported inside the component —
// this closes the remaining gap: the component's own code).
const AdminQrScanner = lazy(() => import("./AdminQrScanner"))

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
  // The transfer note is derived (backend/shop/payments/instructions.js
  // transferNote), not stored on the order row — reused via the same public
  // endpoint the buyer's order page calls rather than re-deriving it here.
  const [paymentInfo, setPaymentInfo] = useState(null)
  const [error, setError] = useState("")
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanError, setScanError] = useState("")

  const reload = () => adminListOrders(filter ? { status: filter } : {}).then(setOrders)

  useEffect(() => { reload().catch(() => setOrders([])) }, [filter])

  const openDetail = async (id) => {
    const o = await adminGetOrder(id)
    setDetail(o)
    setPaymentInfo(null)
    if (o.order_token) {
      fetchPaymentInstructions(o.order_token).then(setPaymentInfo).catch(() => setPaymentInfo(null))
    }
  }

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
      if (detail?.id === order.id) await openDetail(order.id)
    } catch (e) {
      setError(e.response?.data?.message || "Đổi trạng thái thất bại")
    }
  }

  const onScanToken = async (token) => {
    setScanError("")
    try {
      // The scanner only extracts a token from the public order URL; looking
      // it up by order_token and opening the authenticated admin detail view
      // (rather than the buyer's read-only page) happens here. There is no
      // admin "get by token" endpoint, so this searches the full order list.
      const all = await adminListOrders({})
      const match = all.find((o) => o.order_token === token)
      if (!match) {
        setScanError("Không tìm thấy đơn hàng cho mã QR này")
        return
      }
      setScannerOpen(false)
      await openDetail(match.id)
    } catch {
      setScanError("Không tìm thấy đơn hàng cho mã QR này")
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h3 className="text-xl font-semibold">Đơn hàng</h3>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent">
          {STATUSES.map((s) => <option key={s} value={s}>{s || "Tất cả"}</option>)}
        </select>
        <button type="button" onClick={() => { setScanError(""); setScannerOpen(true) }}
          className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">
          Quét QR
        </button>
      </div>

      {scanError && <p className="text-red-500 mb-3">{scanError}</p>}
      {error && <p className="text-red-500 mb-3">{error}</p>}
      {orders.length === 0 && <p className="opacity-60">Chưa có đơn nào.</p>}

      {scannerOpen && (
        <Suspense fallback={null}>
          <AdminQrScanner onToken={onScanToken} onClose={() => setScannerOpen(false)} />
        </Suspense>
      )}

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
              <button type="button" onClick={() => openDetail(o.id)}
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

              <p className="mt-2">
                Thanh toán: <strong>{detail.payment_method}</strong>
                {paymentInfo?.transfer_note && <> · Nội dung CK: <strong>{paymentInfo.transfer_note}</strong></>}
              </p>

              {detail.payment_proof_url && (
                <div className="mt-2">
                  <p className="opacity-70 mb-1">Ảnh chuyển khoản:</p>
                  <a href={detail.payment_proof_url} target="_blank" rel="noreferrer">
                    <img src={detail.payment_proof_url} alt="Ảnh chuyển khoản"
                      className="w-32 h-32 object-cover rounded-lg border border-[var(--border-brand)]" />
                  </a>
                </div>
              )}

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
