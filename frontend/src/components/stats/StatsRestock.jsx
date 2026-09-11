import { useEffect, useState } from "react"
import { adminListCollections, adminGetRestockStats, adminDownloadRestockStatsCsv } from "../../api/shop"
import SearchableSelect from "../SearchableSelect"

function formatPercent(ratio) {
  if (ratio === null || ratio === undefined) return "-"
  return `${Math.round(ratio * 1000) / 10}%`
}

export default function StatsRestock() {
  const [collections, setCollections] = useState([])
  const [collectionId, setCollectionId] = useState("")
  const [rows, setRows] = useState([])
  const [error, setError] = useState("")
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    adminListCollections().then(setCollections).catch(() => setCollections([]))
  }, [])

  useEffect(() => {
    setError("")
    adminGetRestockStats(collectionId || undefined)
      .then(setRows)
      .catch(() => setError("Không tải được thống kê restock"))
  }, [collectionId])

  const downloadCsv = async () => {
    setError("")
    setExporting(true)
    try {
      const blob = await adminDownloadRestockStatsCsv(collectionId || undefined)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "restock.csv"
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
      <p className="text-sm opacity-70 mb-3">
        Vận tốc bán = số lượng đã bán ÷ số ngày mở bán. Danh sách được sắp xếp theo vận tốc, nhanh
        nhất trước - đây là gợi ý nên in thêm gì và nên dừng in gì.
      </p>
      <p className="mb-4 text-xs opacity-60">
        Lưu ý: một khi một phân loại đã bán hết, nhu cầu thực tế sau đó không còn hiển thị được -
        không ai đặt được đơn nữa để tính vào số liệu. Thời gian bán hết chỉ là ước lượng tốt nhất,
        không phải nhu cầu thật.
      </p>

      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <label className="flex flex-col text-xs gap-1 max-w-xs">
          Bộ sưu tập
          <SearchableSelect padding="px-2 py-1" height="h-[38px]"
            value={collectionId}
            onChange={setCollectionId}
            options={[{ code: "", name: "- Tất cả bộ sưu tập -" }, ...collections.map((c) => ({ code: String(c.id), name: c.title }))]}
            placeholder="- Tất cả bộ sưu tập -"
          />
        </label>
        <button
          type="button"
          onClick={downloadCsv}
          disabled={exporting}
          className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] disabled:opacity-50"
        >
          {exporting ? "Đang xuất..." : "Xuất CSV"}
        </button>
      </div>

      {error && <p className="text-red-500 mb-3">{error}</p>}
      {rows.length === 0 && !error && <p className="opacity-60">Chưa có dữ liệu.</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left opacity-70">
                <th className="pr-2">Bộ sưu tập</th>
                <th className="pr-2">Sản phẩm</th>
                <th className="pr-2">Phân loại</th>
                <th className="pr-2">Đã bán</th>
                <th className="pr-2">Còn lại</th>
                <th className="pr-2">Vận tốc (đơn vị/ngày)</th>
                <th className="pr-2">Tỷ lệ bán hết</th>
                <th>Thời gian bán hết</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.variant_id} className="border-t border-[var(--border-brand)]">
                  <td className="pr-2 py-1">{v.collection_title}</td>
                  <td className="pr-2 py-1">{v.product_name}</td>
                  <td className="pr-2 py-1">{v.label}</td>
                  <td className="pr-2 py-1">{v.sold}</td>
                  <td className="pr-2 py-1">{v.unlimited ? "không giới hạn" : v.remaining}</td>
                  <td className="pr-2 py-1">{Math.round(v.velocity * 100) / 100}</td>
                  <td className="pr-2 py-1">
                    {v.unlimited ? "không giới hạn" : formatPercent(v.sell_through)}
                  </td>
                  <td className="py-1">
                    {v.time_to_sellout_days === null ? "-" : `${Math.ceil(v.time_to_sellout_days)} ngày`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
