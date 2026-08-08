import { useEffect, useState } from "react"
import { adminListCollections, adminGetDropStats } from "../../api/shop"
import { formatVnd } from "../../utils/money"

const STATUS_LABELS = {
  pending: "Chờ xử lý", confirmed: "Đã xác nhận", shipped: "Đã gửi",
  completed: "Hoàn tất", cancelled: "Đã hủy",
}

function formatPercent(ratio) {
  if (ratio === null || ratio === undefined) return "—"
  return `${Math.round(ratio * 1000) / 10}%`
}

export default function StatsDrop() {
  const [collections, setCollections] = useState([])
  const [collectionId, setCollectionId] = useState("")
  const [stats, setStats] = useState(null)
  const [error, setError] = useState("")

  useEffect(() => {
    adminListCollections().then(setCollections).catch(() => setCollections([]))
  }, [])

  /* eslint-disable react-hooks/set-state-in-effect -- clear stale stats immediately when the collection selection changes */
  useEffect(() => {
    if (!collectionId) { setStats(null); return }
    setError("")
    adminGetDropStats(collectionId).then(setStats).catch(() => {
      setStats(null)
      setError("Không tải được thống kê cho bộ sưu tập này")
    })
  }, [collectionId])
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div>
      <label className="flex flex-col text-xs gap-1 mb-4 max-w-xs">
        Bộ sưu tập
        <select
          value={collectionId}
          onChange={(e) => setCollectionId(e.target.value)}
          className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        >
          <option value="">— Chọn một bộ sưu tập —</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      </label>

      {error && <p className="text-red-500 mb-3">{error}</p>}
      {!collectionId && <p className="opacity-60">Chọn một bộ sưu tập để xem thống kê.</p>}

      {stats && (
        Object.values(stats.order_counts).every((c) => c === 0) ? (
          <p className="opacity-60">Bộ sưu tập này chưa có đơn hàng nào.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Đã nhận</p>
                <p className="text-lg font-semibold">{formatVnd(stats.received_total)}</p>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Chờ thanh toán</p>
                <p className="text-lg font-semibold">{formatVnd(stats.awaiting_payment)}</p>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Thu khi giao</p>
                <p className="text-lg font-semibold">{formatVnd(stats.to_collect)}</p>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Đã mất</p>
                <p className="text-lg font-semibold">{formatVnd(stats.lost)}</p>
              </div>
            </div>

            <p className="mb-2 text-sm">
              Số đơn: {Object.entries(stats.order_counts).map(([s, c]) => `${STATUS_LABELS[s]} ${c}`).join(" · ")}
            </p>
            <p className="mb-2 text-sm">Tổng số lượng đã bán: {stats.units_sold}</p>
            <p className="mb-2 text-sm">
              Giao hàng: {stats.fulfillment_counts.ship} · Nhận tại chỗ: {stats.fulfillment_counts.pickup}
            </p>
            <p className="mb-4 text-sm">
              Tỷ lệ hết hạn:{" "}
              {stats.expiry_rate === null
                ? "— (không có đơn trả trước)"
                : `${formatPercent(stats.expiry_rate)} (${stats.expired_order_count}/${stats.prepaid_order_count} đơn trả trước)`}
            </p>

            <p className="mb-2 text-xs opacity-60">
              Tỷ lệ bán hết được tính trên số lượng tồn kho hiện tại, không phải tồn kho gốc — nếu
              admin đã nhập thêm hàng giữa đợt bán, tỷ lệ này sẽ thay đổi theo.
            </p>

            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left opacity-70">
                    <th className="pr-2">Sản phẩm</th>
                    <th className="pr-2">Phân loại</th>
                    <th className="pr-2">Đã bán</th>
                    <th className="pr-2">Còn lại</th>
                    <th className="pr-2">Tỷ lệ bán hết</th>
                    <th>Thời gian bán hết</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.variants.map((v, i) => (
                    <tr key={v.variant_id ?? `deleted-${i}`} className="border-t border-[var(--border-brand)]">
                      <td className="pr-2 py-1">{v.product_name}</td>
                      <td className="pr-2 py-1">{v.variant_label}</td>
                      <td className="pr-2 py-1">{v.sold}</td>
                      <td className="pr-2 py-1">
                        {v.deleted ? "—" : v.unlimited ? "không giới hạn" : v.remaining}
                      </td>
                      <td className="pr-2 py-1">
                        {v.unlimited || v.deleted ? "—" : formatPercent(v.sell_through)}
                      </td>
                      <td className="py-1">
                        {v.time_to_sellout_days === null ? "—" : `${Math.ceil(v.time_to_sellout_days)} ngày`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </div>
  )
}
