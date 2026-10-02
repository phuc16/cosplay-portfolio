import { useEffect, useRef, useState } from "react"
import { adminListCollections, adminGetDropStats, adminDownloadDropStatsCsv } from "../../api/shop"
import { formatVnd } from "../../utils/money"
import { STATUS_LABELS } from "../../admin/orderLabels"
import SearchableSelect from "../SearchableSelect"

function formatPercent(ratio) {
  if (ratio === null || ratio === undefined) return "-"
  return `${Math.round(ratio * 1000) / 10}%`
}

export default function StatsDrop() {
  const [collections, setCollections] = useState([])
  const [collectionId, setCollectionId] = useState("")
  const [stats, setStats] = useState(null)
  const [error, setError] = useState("")
  const [exporting, setExporting] = useState(false)
  const requestIdRef = useRef(0)

  useEffect(() => {
    adminListCollections().then(setCollections).catch(() => setCollections([]))
  }, [])

  useEffect(() => {
    const requestId = ++requestIdRef.current
    if (!collectionId) return
    adminGetDropStats(collectionId).then((data) => {
      if (requestIdRef.current !== requestId) return
      setError("")
      setStats(data)
    }).catch(() => {
      if (requestIdRef.current !== requestId) return
      setStats(null)
      setError("Không tải được thống kê cho bộ sưu tập này")
    })
  }, [collectionId])

  const downloadCsv = async () => {
    if (!collectionId) return
    setError("")
    setExporting(true)
    try {
      const blob = await adminDownloadDropStatsCsv(collectionId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `drop-${collectionId}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError("Không xuất được CSV")
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <label className="flex flex-col text-xs gap-1 max-w-xs">
          Bộ sưu tập
          <SearchableSelect padding="px-2 py-1" height="h-[38px]"
            value={collectionId}
            onChange={(id) => { setStats(null); setCollectionId(id) }}
            options={[{ code: "", name: "- Chọn một bộ sưu tập -" }, ...collections.map((c) => ({ code: String(c.id), name: c.title }))]}
            placeholder="- Chọn một bộ sưu tập -"
          />
        </label>
        {stats && (
          <button
            type="button"
            onClick={downloadCsv}
            disabled={exporting}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] disabled:opacity-50"
          >
            {exporting ? "Đang xuất..." : "Xuất CSV"}
          </button>
        )}
      </div>

      {error && <p className="text-red-500 mb-3">{error}</p>}
      {!collectionId && <p className="opacity-60">Chọn một bộ sưu tập để xem thống kê.</p>}

      {stats && (
        Object.values(stats.order_counts).every((c) => c === 0) ? (
          <p className="opacity-60">Bộ sưu tập này chưa có đơn hàng nào.</p>
        ) : (
          <>
            <div className="mb-4">
              {/* Received is the figure the seller actually cares about - made
                  dominant. No figure is removed, renamed, or recomputed: the
                  same five values render below, just at unequal visual weight. */}
              <div className="p-4 rounded-xl border border-[var(--border-success)] bg-[var(--surface-success)] mb-3">
                <p className="text-sm opacity-70">Đã nhận</p>
                <p className="text-3xl font-bold text-[var(--text-success)]">{formatVnd(stats.received_total)}</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl border border-[var(--border-neutral)]">
                  <p className="text-xs opacity-70">Chờ thanh toán</p>
                  <p className="text-base font-semibold">{formatVnd(stats.awaiting_payment)}</p>
                </div>
                <div className="p-3 rounded-xl border border-[var(--border-neutral)]">
                  <p className="text-xs opacity-70">Thu khi giao</p>
                  <p className="text-base font-semibold">{formatVnd(stats.to_collect)}</p>
                </div>
                <div className="p-3 rounded-xl border border-[var(--border-neutral)]">
                  <p className="text-xs opacity-70">Đã mất</p>
                  <p className="text-base font-semibold">{formatVnd(stats.lost)}</p>
                </div>
                <div className="p-3 rounded-xl border border-[var(--border-neutral)]">
                  <p className="text-xs opacity-70">Đơn COD chưa xác nhận</p>
                  <p className="text-base font-semibold">{formatVnd(stats.pending_cod)}</p>
                </div>
              </div>
            </div>

            <p className="mb-2 text-sm">
              Số đơn: {Object.entries(stats.order_counts).map(([s, c]) => `${STATUS_LABELS[s]} ${c}`).join(" · ")}
            </p>
            <p className="mb-2 text-sm">Tổng số lượng đã bán: {stats.units_sold}</p>
            <p className="mb-2 text-sm">
              Giao hàng: {stats.fulfillment_counts.ship} · Nhận tại chỗ: {stats.fulfillment_counts.pickup} · Sản
              phẩm số: {stats.fulfillment_counts.digital} · Tại quầy: {stats.fulfillment_counts.booth}
            </p>
            <p className="mb-2 text-sm">
              Đã nhận theo phương thức: Ngân hàng {formatVnd(stats.received.bank)} · Momo{" "}
              {formatVnd(stats.received.momo)} · PayPal {formatVnd(stats.received.paypal)} · COD{" "}
              {formatVnd(stats.received.cod)} · Tiền mặt (tại quầy) {formatVnd(stats.received.cash)}
            </p>
            <p className="mb-4 text-sm">
              Tỷ lệ hết hạn:{" "}
              {stats.expiry_rate === null
                ? "- (không có đơn trả trước)"
                : `${formatPercent(stats.expiry_rate)} (${stats.expired_order_count}/${stats.prepaid_order_count} đơn trả trước)`}
            </p>

            <p className="mb-2 text-xs opacity-60">
              Tỷ lệ bán hết được tính trên số lượng tồn kho hiện tại, không phải tồn kho gốc - nếu
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
                    <tr key={v.variant_id ?? `deleted-${i}`} className="border-t border-[var(--border-brand)] hover:bg-[var(--brand-soft)]">
                      <td className="pr-2 py-1">{v.product_name}</td>
                      <td className="pr-2 py-1">{v.variant_label}</td>
                      <td className="pr-2 py-1">{v.sold}</td>
                      <td className="pr-2 py-1">
                        {v.deleted ? "-" : v.unlimited ? "không giới hạn" : v.remaining}
                      </td>
                      <td className="pr-2 py-1">
                        {v.deleted ? "-" : v.unlimited ? "không giới hạn" : formatPercent(v.sell_through)}
                      </td>
                      <td className="py-1">
                        {v.time_to_sellout_days === null ? "-" : `${Math.ceil(v.time_to_sellout_days)} ngày`}
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
