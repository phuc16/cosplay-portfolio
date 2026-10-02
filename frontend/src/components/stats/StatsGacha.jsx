import { useEffect, useRef, useState } from "react"
import { adminListGachaProducts, adminGetGachaDropStats } from "../../api/shop"
import { formatVnd } from "../../utils/money"
import { tierLabel } from "../../shop/gacha/tiers"
import SearchableSelect from "../SearchableSelect"

export default function StatsGacha() {
  const [products, setProducts] = useState([])
  const [productId, setProductId] = useState("")
  const [stats, setStats] = useState(null)
  const [error, setError] = useState("")
  const requestIdRef = useRef(0)

  useEffect(() => {
    adminListGachaProducts().then(setProducts).catch(() => setProducts([]))
  }, [])

  useEffect(() => {
    const requestId = ++requestIdRef.current
    if (!productId) return
    adminGetGachaDropStats(productId).then((data) => {
      if (requestIdRef.current !== requestId) return
      setError("")
      setStats(data)
    }).catch(() => {
      if (requestIdRef.current !== requestId) return
      setStats(null)
      setError("Không tải được thống kê cho sản phẩm gacha này")
    })
  }, [productId])

  return (
    <div>
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <label className="flex flex-col text-xs gap-1 max-w-xs">
          Sản phẩm gacha
          <SearchableSelect padding="px-2 py-1" height="h-[38px]"
            value={productId}
            onChange={(id) => { setStats(null); setProductId(id) }}
            options={[
              { code: "", name: "- Chọn một sản phẩm gacha -" },
              ...products.map((p) => ({ code: String(p.id), name: `${p.collection_title} · ${p.name}` })),
            ]}
            placeholder="- Chọn một sản phẩm gacha -"
          />
        </label>
      </div>

      {error && <p className="text-red-500 mb-3">{error}</p>}
      {!productId && <p className="opacity-60">Chọn một sản phẩm gacha để xem thống kê.</p>}

      {stats && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-xl border border-[var(--border-brand)]">
              <p className="text-xs opacity-70">Doanh thu (online)</p>
              <p className="text-lg font-semibold">{formatVnd(stats.revenue.online)}</p>
            </div>
            <div className="p-3 rounded-xl border border-[var(--border-brand)]">
              <p className="text-xs opacity-70">Doanh thu (tại quầy)</p>
              <p className="text-lg font-semibold">{formatVnd(stats.revenue.booth)}</p>
            </div>
            <div className="p-3 rounded-xl border border-[var(--border-brand)]">
              <p className="text-xs opacity-70">Tổng doanh thu</p>
              <p className="text-lg font-semibold">{formatVnd(stats.revenue.total)}</p>
            </div>
            <div className="p-3 rounded-xl border border-[var(--border-brand)]">
              <p className="text-xs opacity-70">Giá trị đã trao (online + tại quầy)</p>
              <p className="text-lg font-semibold">{formatVnd(stats.value_given_out.total)}</p>
              <p className="text-xs opacity-60">
                Online {formatVnd(stats.value_given_out.online)} · Tại quầy {formatVnd(stats.value_given_out.booth)}
              </p>
            </div>
          </div>

          <p className="mb-2 text-sm font-medium">Theo độ hiếm</p>
          <div className="overflow-x-auto -mx-1 px-1 mb-4">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-left opacity-70">
                  <th className="pr-2">Độ hiếm</th>
                  <th className="pr-2">Đã trúng (online)</th>
                  <th className="pr-2">Đã trúng (tại quầy)</th>
                  <th className="pr-2">Tổng</th>
                  <th>Giá trị đã trao</th>
                </tr>
              </thead>
              <tbody>
                {stats.tiers.map((t) => (
                  <tr key={t.tier} className="border-t border-[var(--border-brand)] hover:bg-[var(--brand-soft)]">
                    <td className="pr-2 py-1">{tierLabel(t.tier)}</td>
                    <td className="pr-2 py-1">{t.drawn_online}</td>
                    <td className="pr-2 py-1">{t.drawn_booth}</td>
                    <td className="pr-2 py-1">{t.drawn_online + t.drawn_booth}</td>
                    <td className="py-1">{formatVnd(t.value_online + t.value_booth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mb-2 text-sm font-medium">Theo phần thưởng</p>
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left opacity-70">
                  <th className="pr-2">Phần thưởng</th>
                  <th className="pr-2">Độ hiếm</th>
                  <th className="pr-2">Đã trúng (online)</th>
                  <th className="pr-2">Đã trúng (tại quầy)</th>
                  <th className="pr-2">Còn lại</th>
                  <th>Tổng số lượng</th>
                </tr>
              </thead>
              <tbody>
                {stats.prizes.map((p) => (
                  <tr key={p.id} className="border-t border-[var(--border-brand)] hover:bg-[var(--brand-soft)]">
                    <td className="pr-2 py-1">{p.name}</td>
                    <td className="pr-2 py-1">{tierLabel(p.tier)}</td>
                    <td className="pr-2 py-1">{p.drawn_online}</td>
                    <td className="pr-2 py-1">{p.drawn_booth}</td>
                    <td className="pr-2 py-1">{p.quantity_remaining}</td>
                    <td className="py-1">{p.quantity_total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
