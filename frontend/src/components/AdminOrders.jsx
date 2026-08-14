import { useEffect, lazy, Suspense, useState } from "react"
import {
  adminListOrders, adminTransitionOrder, adminGetOrder, fetchPaymentInstructions,
  adminBulkCancelOrders, adminBulkCompleteOrders, adminListCollections,
} from "../api/shop"
import { formatVnd } from "../utils/money"
import OrderTimeline from "./OrderTimeline"
import StatusBadge from "./StatusBadge"
import { variantForStatus, variantForAction } from "../constants/statusVariant"
import {
  STATUS_LABELS, PAYMENT_METHOD_LABELS, FULFILLMENT_METHOD_LABELS, ACTION_LABELS, labelFor,
} from "../admin/orderLabels"

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

// Every class string references only tokens asserted to exist by
// frontend/src/utils/semanticTokens.test.js.
const ACTION_BUTTON_CLASSES = {
  success: "border-[var(--border-success)] text-[var(--text-success)] hover:bg-[var(--surface-success)]",
  danger: "border-[var(--border-danger)] text-[var(--text-danger)] hover:bg-[var(--surface-danger)]",
  neutral: "border-[var(--border-neutral)] text-[var(--text-neutral)] hover:bg-[var(--surface-neutral)]",
}

/** Orders with at least one legal transition surface first, so the seller
 * doesn't have to scan a full list to find what needs attention. Stable
 * sort (Array.prototype.sort is stable since ES2019) — orders within each
 * group keep the API's original relative order. */
function byActionableFirst(a, b) {
  const aRank = nextStatuses(a).length > 0 ? 0 : 1
  const bRank = nextStatuses(b).length > 0 ? 0 : 1
  return aRank - bRank
}

/** Strips filter params that are empty, so the query string only ever
 * carries what the seller actually chose. */
function buildFilterParams({ status, collectionId, dateFrom, dateTo, search }) {
  const params = {}
  if (status) params.status = status
  if (collectionId) params.collection_id = collectionId
  if (dateFrom) params.date_from = dateFrom
  if (dateTo) params.date_to = dateTo
  if (search) params.search = search
  return params
}

export default function AdminOrders() {
  const [orders, setOrders] = useState([])
  const [collections, setCollections] = useState([])
  const [filter, setFilter] = useState("")
  const [collectionId, setCollectionId] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  // Debounced separately from the other filters (which apply immediately on
  // change) so typing a name/phone/email doesn't fire a request per
  // keystroke — only once the seller pauses for 400ms.
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => clearTimeout(timer)
  }, [searchInput])
  const [detail, setDetail] = useState(null)
  // The transfer note is derived (backend/shop/payments/instructions.js
  // transferNote), not stored on the order row — reused via the same public
  // endpoint the buyer's order page calls rather than re-deriving it here.
  const [paymentInfo, setPaymentInfo] = useState(null)
  const [error, setError] = useState("")
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanError, setScanError] = useState("")

  const [selected, setSelected] = useState(() => new Set())
  const [bulkResults, setBulkResults] = useState(null)
  const [bulkAction, setBulkAction] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  const filters = { status: filter, collectionId, dateFrom, dateTo, search }
  const reload = () => adminListOrders(buildFilterParams(filters)).then(setOrders)

  useEffect(() => {
    adminListCollections().then(setCollections).catch(() => setCollections([]))
  }, [])

  useEffect(() => {
    reload().catch(() => setOrders([]))
    // Filters changing invalidates any in-flight bulk selection/result view.
    setSelected(new Set())
    setBulkResults(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, collectionId, dateFrom, dateTo, search])

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
    if (to === "cancelled") {
      if (!confirm("Hủy đơn này? Kho sẽ được hoàn lại.")) return
      // Included in the buyer's cancellation email when present — see
      // sender.js. Cancelling the prompt itself (Escape/Cancel) just skips
      // the reason, not the cancellation already confirmed above.
      const reason = prompt("Lý do hủy đơn (có thể bỏ trống, sẽ gửi kèm email cho khách):")
      if (reason && reason.trim()) payload.cancel_reason = reason.trim()
    }

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

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelected((prev) => (prev.size === orders.length ? new Set() : new Set(orders.map((o) => o.id))))
  }

  const bulkCancel = async () => {
    if (selected.size === 0) return
    if (!confirm(`Hủy ${selected.size} đơn đã chọn? Thao tác này không thể hoàn tác — kho sẽ được hoàn lại cho những đơn hủy thành công.`)) {
      return
    }

    setBulkBusy(true)
    setBulkResults(null)
    setBulkAction("cancel")
    try {
      // A 200 here only means the request was well-formed — each order's own
      // ok/error must be read individually; some may fail (e.g. an order
      // that was already completed cannot legally move to cancelled).
      const { results } = await adminBulkCancelOrders([...selected])
      setBulkResults(results)
      await reload()
      setSelected(new Set())
    } catch (e) {
      setBulkResults([{ id: null, ok: false, error: "server_error", message: e.response?.data?.message || "Huỷ hàng loạt thất bại" }])
    } finally {
      setBulkBusy(false)
    }
  }

  // For staff who verified pickup buyers offline via the printed roster's
  // pickup_code (weak event-venue connectivity), applying the actual
  // completed status can happen later, in one batch, instead of one order
  // at a time. Same shape as bulkCancel — a 200 only means the request was
  // well-formed, each order's own ok/error must be read individually.
  const bulkComplete = async () => {
    if (selected.size === 0) return

    setBulkBusy(true)
    setBulkResults(null)
    setBulkAction("complete")
    try {
      const { results } = await adminBulkCompleteOrders([...selected])
      setBulkResults(results)
      await reload()
      setSelected(new Set())
    } catch (e) {
      setBulkResults([{ id: null, ok: false, error: "server_error", message: e.response?.data?.message || "Hoàn tất hàng loạt thất bại" }])
    } finally {
      setBulkBusy(false)
    }
  }

  const failedBulkResults = (bulkResults || []).filter((r) => !r.ok)

  return (
    <div>
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <h3 className="text-xl font-semibold">Đơn hàng</h3>

        <label className="flex flex-col text-xs gap-1">
          Tìm kiếm
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Mã đơn, tên, SĐT, email..."
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent w-48"
          />
        </label>

        <label className="flex flex-col text-xs gap-1">
          Trạng thái
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent">
            {STATUSES.map((s) => <option key={s} value={s}>{s ? labelFor(STATUS_LABELS, s) : "Tất cả"}</option>)}
          </select>
        </label>

        <label className="flex flex-col text-xs gap-1">
          Bộ sưu tập
          <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent">
            <option value="">Tất cả</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>

        <label className="flex flex-col text-xs gap-1">
          Từ ngày
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent" />
        </label>

        <label className="flex flex-col text-xs gap-1">
          Đến ngày
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent" />
        </label>

        <button type="button" onClick={() => { setScanError(""); setScannerOpen(true) }}
          className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">
          Quét QR
        </button>
      </div>

      {orders.length > 0 && (
        <div className="flex items-center gap-3 mb-3 flex-wrap text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={selected.size === orders.length} onChange={toggleSelectAll} />
            Chọn tất cả ({selected.size}/{orders.length})
          </label>
          <button type="button" onClick={bulkCancel} disabled={selected.size === 0 || bulkBusy}
            className={`px-2 py-1 text-sm border rounded-lg ${ACTION_BUTTON_CLASSES.danger} disabled:opacity-50`}>
            {bulkBusy ? "Đang huỷ..." : `Huỷ đã chọn (${selected.size})`}
          </button>
          <button type="button" onClick={bulkComplete} disabled={selected.size === 0 || bulkBusy}
            className={`px-2 py-1 text-sm border rounded-lg ${ACTION_BUTTON_CLASSES.success} disabled:opacity-50`}>
            {bulkBusy ? "Đang xử lý..." : `Hoàn tất đã chọn (${selected.size})`}
          </button>
        </div>
      )}

      {bulkResults && (
        <div className="mb-3 p-3 rounded-xl border border-[var(--border-brand)] text-sm" role="status">
          <p className="font-medium">
            {bulkAction === "complete"
              ? (failedBulkResults.length === 0
                  ? `Đã hoàn tất ${bulkResults.length} đơn.`
                  : `Hoàn tất thành công ${bulkResults.length - failedBulkResults.length}/${bulkResults.length} đơn.`)
              : (failedBulkResults.length === 0
                  ? `Đã huỷ ${bulkResults.length} đơn.`
                  : `Huỷ thành công ${bulkResults.length - failedBulkResults.length}/${bulkResults.length} đơn.`)}
          </p>
          {failedBulkResults.length > 0 && (
            <ul className="mt-1 text-red-500">
              {failedBulkResults.map((r, i) => (
                <li key={r.id ?? i}>
                  {r.id != null ? `#${r.id}: ` : ""}{r.message || r.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {scanError && <p className="text-red-500 mb-3">{scanError}</p>}
      {error && <p className="text-red-500 mb-3">{error}</p>}
      {orders.length === 0 && <p className="opacity-60">Chưa có đơn nào.</p>}

      {scannerOpen && (
        <Suspense fallback={null}>
          <AdminQrScanner onToken={onScanToken} onClose={() => setScannerOpen(false)} />
        </Suspense>
      )}

      {[...orders].sort(byActionableFirst).map((o) => (
        <div key={o.id} data-order-id={o.id} className="mb-3 p-3 rounded-xl border border-[var(--border-brand)]">
          <div className="flex justify-between items-start gap-3 flex-wrap">
            <div className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={selected.has(o.id)}
                onChange={() => toggleSelected(o.id)} aria-label={`Chọn đơn #${o.order_code || o.id}`} />
              <div>
                <p className="font-medium">#{o.order_code || o.id} · {o.buyer_name} · {o.phone}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <StatusBadge label={labelFor(STATUS_LABELS, o.status)} variant={variantForStatus(o.status)} />
                  <span className="text-sm opacity-70">{labelFor(FULFILLMENT_METHOD_LABELS, o.fulfillment_method)}</span>
                  <span className="text-sm opacity-70">{labelFor(PAYMENT_METHOD_LABELS, o.payment_method)}</span>
                  <span className="text-sm opacity-70">{formatVnd(o.total)}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => (detail?.id === o.id ? setDetail(null) : openDetail(o.id))}
                className={`px-2 py-1 text-sm border rounded-lg ${ACTION_BUTTON_CLASSES.neutral}`}>
                {detail?.id === o.id ? "Ẩn" : "Chi tiết"}
              </button>
              {nextStatuses(o).map((to) => (
                <button key={to} type="button" onClick={() => move(o, to)}
                  className={`px-2 py-1 text-sm border rounded-lg ${ACTION_BUTTON_CLASSES[variantForAction(to)]}`}>
                  {labelFor(ACTION_LABELS, to)}
                </button>
              ))}
            </div>
          </div>

          {detail?.id === o.id && (
            <div className="mt-3 pt-3 border-t border-[var(--border-brand)] text-sm">
              <div className="mb-2 overflow-x-auto">
                <OrderTimeline order={detail} />
              </div>

              <p className="opacity-70">{detail.email}</p>
              {detail.fulfillment_method === "ship" && <p className="opacity-70">{detail.address_raw}</p>}
              {detail.note && <p className="mt-1 italic opacity-70">“{detail.note}”</p>}

              <p className="mt-2">
                Thanh toán: <strong>{labelFor(PAYMENT_METHOD_LABELS, detail.payment_method)}</strong>
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
