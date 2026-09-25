import { useEffect, useState } from "react"
import { adminGetShopDisplaySettings, adminSaveShopDisplaySettings } from "../api/shop"

const GROUP_LABELS = { gacha: "Gacha", digital: "Sản phẩm số", physical: "Sản phẩm vật lý" }
const DEFAULT_ORDER = ["gacha", "digital", "physical"]

function swap(list, i, j) {
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

export default function AdminShopGroupOrder() {
  const [order, setOrder] = useState(DEFAULT_ORDER)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    adminGetShopDisplaySettings()
      .then((s) => setOrder(s.group_order))
      .catch(() => {})
  }, [])

  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    setOrder((prev) => swap(prev, i, j))
    setSaved(false)
  }

  const save = async () => {
    setError("")
    setSaved(false)
    setSaving(true)
    try {
      await adminSaveShopDisplaySettings(order)
      setSaved(true)
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Lưu thất bại")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-6 p-3 rounded-xl border border-[var(--border-brand)]">
      <p className="font-medium mb-2">Thứ tự nhóm trên trang Shop</p>
      <p className="text-xs opacity-70 mb-3">
        Thứ tự hiển thị của các nhóm "Gacha", "Sản phẩm số", "Sản phẩm vật lý" trên trang mua hàng công khai.
      </p>
      <ul className="space-y-1 mb-3">
        {order.map((key, i) => (
          <li key={key} className="flex items-center gap-2 px-2 py-1 rounded-lg border border-[var(--border-brand)]">
            <span className="flex-1">{GROUP_LABELS[key]}</span>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
              aria-label={`Đưa ${GROUP_LABELS[key]} lên`}
              className="px-2 py-0.5 text-sm border rounded-lg border-[var(--border-brand)] disabled:opacity-30">
              ↑
            </button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1}
              aria-label={`Đưa ${GROUP_LABELS[key]} xuống`}
              className="px-2 py-0.5 text-sm border rounded-lg border-[var(--border-brand)] disabled:opacity-30">
              ↓
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
      {saved && <p className="text-sm mb-2 opacity-70">Đã lưu.</p>}
      <button type="button" onClick={save} disabled={saving}
        className="px-3 py-1.5 text-sm rounded-lg bg-pink-500 text-white disabled:opacity-50">
        {saving ? "Đang lưu..." : "Lưu thứ tự"}
      </button>
    </div>
  )
}
