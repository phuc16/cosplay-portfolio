import { useEffect, useState } from "react"
import { adminListBoothOrders, adminListCollections, adminSetOrderPrepared } from "../api/shop"
import { formatVnd } from "../utils/money"
import { groupOrderItems } from "../utils/groupOrderItems"
import StatusBadge from "./StatusBadge"
import SearchableSelect from "./SearchableSelect"
import { variantForStatus } from "../constants/statusVariant"
import { STATUS_LABELS, labelFor } from "../admin/orderLabels"

// Booth staff glance at this screen throughout the event rather than
// reloading it themselves - polling keeps it current without a push infra
// this app doesn't have anywhere else (no WebSocket/SSE). 15s is plenty
// responsive at booth scale (a few buyers per minute, not per second).
const POLL_INTERVAL_MS = 15000

export default function AdminBoothOrders() {
  const [orders, setOrders] = useState([])
  const [collections, setCollections] = useState([])
  const [collectionId, setCollectionId] = useState("")
  const [search, setSearch] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")

  // Client-side, like ShippingRoster's own search: the list is already fully
  // fetched (and polled) for this screen, and booth-scale order counts never
  // justify a server round trip just to filter by name.
  const visibleOrders = orders.filter((o) =>
    !search.trim() || o.buyer_name.toLowerCase().includes(search.trim().toLowerCase())
  )

  const reload = () =>
    adminListBoothOrders(collectionId ? { collection_id: collectionId } : {}).then(setOrders)

  const refresh = async () => {
    setRefreshing(true)
    try {
      await reload()
      setError("")
    } catch {
      setError("Không tải được danh sách đơn tại quầy")
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    adminListCollections().then(setCollections).catch(() => setCollections([]))
  }, [])

  useEffect(() => {
    reload().catch(() => setOrders([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId])

  // Paused while the browser tab isn't visible, so a backgrounded tab never
  // polls for nothing.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") reload().catch(() => {})
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId])

  const togglePrepared = async (order) => {
    const next = !order.prepared
    try {
      const res = await adminSetOrderPrepared(order.id, next)
      if (res?.ok) {
        setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, prepared: next } : o)))
      }
    } catch {
      setError("Không cập nhật được trạng thái trao quà")
    }
  }

  return (
    <div>
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <h3 className="text-xl font-semibold">Đơn tại quầy</h3>
        <label className="flex flex-col text-xs gap-1">
          Bộ sưu tập
          <SearchableSelect padding="px-2 py-1" height="h-[38px]"
            value={collectionId}
            onChange={setCollectionId}
            options={[{ code: "", name: "Tất cả" }, ...collections.map((c) => ({ code: String(c.id), name: c.title }))]}
            placeholder="Tất cả"
          />
        </label>
        <label className="flex flex-col text-xs gap-1">
          Tìm kiếm
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tên người mua..."
            className="h-[38px] px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
        </label>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)] disabled:opacity-50"
        >
          {refreshing ? "Đang tải..." : "Làm mới"}
        </button>
      </div>

      {error && <p className="text-red-500 mb-3">{error}</p>}

      {orders.length === 0 && <p className="opacity-60">Chưa có đơn tại quầy nào.</p>}
      {orders.length > 0 && visibleOrders.length === 0 && (
        <p className="opacity-60">Không tìm thấy đơn nào khớp.</p>
      )}

      {visibleOrders.map((o) => (
        <div key={o.id} className="mb-4 p-3 rounded-xl border border-[var(--border-brand)]">
          <div className="flex justify-between items-start gap-2 flex-wrap">
            <div>
              <p className="font-medium">{o.buyer_name}</p>
              <p className="text-sm opacity-70">
                {formatVnd(o.total)} · {new Date(o.created_at).toLocaleString("vi-VN")}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge label={labelFor(STATUS_LABELS, o.status)} variant={variantForStatus(o.status)} />
              <button
                type="button"
                data-testid={`prepared-${o.id}`}
                onClick={() => togglePrepared(o)}
                className={`px-3.5 py-2 text-sm rounded-full border font-medium whitespace-nowrap ${
                  o.prepared
                    ? "bg-[var(--surface-success)] border-[var(--border-success)] text-[var(--text-success)]"
                    : "bg-[var(--surface-warning)] border-[var(--border-warning)] text-[var(--text-warning)]"
                }`}
              >
                {o.prepared ? "Đã trao quà" : "Chưa trao quà"}
              </button>
            </div>
          </div>
          <ul className="mt-2">
            {o.items.length === 0 && <li className="text-sm opacity-60">Chưa quay lượt nào</li>}
            {groupOrderItems(
              o.items,
              (i) => `${i.product_name_snapshot}|${i.variant_label_snapshot}|${i.unit_price_snapshot}|${i.is_gift}|${i.gacha_tier_snapshot || ""}`
            ).map((i, idx) => (
              <li key={idx} className="flex items-center gap-2 py-0.5 text-sm">
                {i.image_url
                  ? <img src={i.image_url} alt="" className="w-8 h-8 object-cover rounded" />
                  : <span className="w-8 h-8 rounded bg-[var(--surface-neutral)]" />}
                {i.product_name_snapshot}{i.variant_label_snapshot ? ` · ${i.variant_label_snapshot}` : ""} × {i.qty}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
