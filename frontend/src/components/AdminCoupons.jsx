import { useEffect, useState } from "react"
import { adminListCoupons, adminCreateCoupon, adminUpdateCoupon } from "../api/shop"

const blankForm = {
  code: "", type: "percent", value: "", min_total: "0", max_uses: "", expires_at: "",
}

function formatVnd(n) {
  return `${Number(n || 0).toLocaleString("vi-VN")}đ`
}

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState(null)
  const [form, setForm] = useState(blankForm)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const reload = () => adminListCoupons().then(setCoupons)

  useEffect(() => { reload().catch(() => setCoupons([])) }, [])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const create = async () => {
    setError("")
    setSaving(true)
    try {
      // The API is the single source of truth for validity - no client-side
      // rule duplication, whatever it rejects is shown verbatim (same
      // pattern AdminGiftSettings already uses).
      await adminCreateCoupon({
        code: form.code,
        type: form.type,
        value: Number(form.value) || 0,
        min_total: Number(form.min_total) || 0,
        max_uses: form.max_uses === "" ? null : Number(form.max_uses),
        expires_at: form.expires_at || null,
      })
      setForm(blankForm)
      await reload()
    } catch (e) {
      setError(e.response?.data?.message || "Tạo mã giảm giá thất bại")
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (coupon) => {
    await adminUpdateCoupon(coupon.id, { active: !coupon.active })
    await reload()
  }

  if (coupons === null) return <p className="opacity-60 mt-8">Đang tải...</p>

  return (
    <div className="max-w-2xl mt-8">
      <h3 className="text-xl font-semibold mb-4">Mã giảm giá</h3>

      {error && <p className="text-red-500 mb-3">{error}</p>}

      <div className="p-3 rounded-xl border border-[var(--border-brand)] mb-4">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="block">
            <span className="block text-sm mb-1 opacity-70">Mã</span>
            <input type="text" value={form.code} onChange={(e) => set("code", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent" />
          </label>
          <label className="block">
            <span className="block text-sm mb-1 opacity-70">Loại</span>
            <select value={form.type} onChange={(e) => set("type", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent">
              <option value="percent">% theo đơn</option>
              <option value="fixed">Số tiền cố định (VND)</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-sm mb-1 opacity-70">
              Giá trị {form.type === "percent" ? "(%)" : "(VND)"}
            </span>
            <input type="number" min="0" value={form.value} onChange={(e) => set("value", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent" />
          </label>
          <label className="block">
            <span className="block text-sm mb-1 opacity-70">Mức đơn tối thiểu (VND)</span>
            <input type="number" min="0" value={form.min_total} onChange={(e) => set("min_total", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent" />
          </label>
          <label className="block">
            <span className="block text-sm mb-1 opacity-70">Số lượt dùng tối đa (để trống = không giới hạn)</span>
            <input type="number" min="1" value={form.max_uses} onChange={(e) => set("max_uses", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent" />
          </label>
          <label className="block">
            <span className="block text-sm mb-1 opacity-70">Hết hạn (để trống = không hết hạn)</span>
            <input type="datetime-local" value={form.expires_at} onChange={(e) => set("expires_at", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent" />
          </label>
        </div>
        <button type="button" onClick={create} disabled={saving}
          className="px-4 py-2 rounded-lg bg-[var(--brand)] text-white disabled:opacity-50">
          Tạo mã
        </button>
      </div>

      {coupons.length === 0 ? (
        <p className="opacity-60">Chưa có mã giảm giá nào.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left opacity-60">
              <th className="py-1 pr-2">Mã</th>
              <th className="py-1 pr-2">Giá trị</th>
              <th className="py-1 pr-2">Đã dùng</th>
              <th className="py-1 pr-2">Trạng thái</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {coupons.map((c) => (
              <tr key={c.id} className="border-t border-[var(--border-brand)]">
                <td className="py-1.5 pr-2 font-mono">{c.code}</td>
                <td className="py-1.5 pr-2">{c.type === "percent" ? `${c.value}%` : formatVnd(c.value)}</td>
                <td className="py-1.5 pr-2">{c.times_used}{c.max_uses !== null ? ` / ${c.max_uses}` : ""}</td>
                <td className="py-1.5 pr-2">{c.active ? "Đang bật" : "Đã tắt"}</td>
                <td className="py-1.5">
                  <button type="button" onClick={() => toggleActive(c)}
                    className="text-xs underline opacity-70">
                    {c.active ? "Tắt" : "Bật"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
