import { useState } from "react"
import { adminSaveVariants } from "../api/shop"

/**
 * Variants are edited as a whole list and saved in one request, because a
 * photocard sheet is 40-odd codes entered at once.
 */
export default function AdminVariants({ product, onSaved }) {
  const [rows, setRows] = useState(
    product.variants?.length ? product.variants : [{ label: "", stock_qty: "" }]
  )
  const [bulk, setBulk] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const update = (i, field, value) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))

  const addRow = () => setRows([...rows, { label: "", stock_qty: "" }])
  const removeRow = (i) => setRows(rows.filter((_, idx) => idx !== i))

  // "A1, A2, B1" or one code per line -> one row each.
  const applyBulk = () => {
    const labels = bulk.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
    if (!labels.length) return
    setRows([...rows.filter((r) => r.label.trim()), ...labels.map((label) => ({ label, stock_qty: "" }))])
    setBulk("")
  }

  const save = async () => {
    setError("")
    setSaving(true)
    try {
      const payload = rows
        .filter((r) => String(r.label).trim())
        .map((r) => ({
          id: r.id,
          label: String(r.label).trim(),
          image_url: r.image_url || null,
          // Empty means unlimited, which the API expects as null rather than 0.
          stock_qty: r.stock_qty === "" || r.stock_qty === null ? null : Number(r.stock_qty),
        }))
      await adminSaveVariants(product.id, payload)
      onSaved?.()
    } catch (e) {
      setError(e.response?.data?.message || "Lưu phân loại thất bại")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 p-3 rounded-xl border border-[var(--border-brand)]">
      <p className="font-medium mb-2">Phân loại (size / mã ảnh)</p>

      <div className="flex gap-2 mb-3">
        <input
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          placeholder="Dán nhiều mã: A1, A2, B1..."
          className="flex-1 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        />
        <button type="button" onClick={applyBulk} className="px-3 py-1 rounded-lg border border-[var(--border-brand)]">
          Thêm hàng loạt
        </button>
      </div>

      {rows.map((r, i) => (
        <div key={r.id || i} className="flex gap-2 mb-2">
          <input
            value={r.label}
            onChange={(e) => update(i, "label", e.target.value)}
            placeholder="Mã (A1) hoặc size (M)"
            className="flex-1 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
          <input
            value={r.stock_qty ?? ""}
            onChange={(e) => update(i, "stock_qty", e.target.value)}
            placeholder="SL (trống = không giới hạn)"
            inputMode="numeric"
            className="w-48 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
          <button type="button" onClick={() => removeRow(i)} className="px-2 opacity-70">✕</button>
        </div>
      ))}

      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={addRow} className="px-3 py-1 rounded-lg border border-[var(--border-brand)]">
          + Thêm dòng
        </button>
        <button type="button" onClick={save} disabled={saving} className="px-3 py-1 rounded-lg bg-[var(--brand)] text-white disabled:opacity-50">
          {saving ? "Đang lưu..." : "Lưu phân loại"}
        </button>
      </div>
    </div>
  )
}
