import { useEffect, useState } from "react"
import { adminFetchPrizes, adminSavePrizes, adminUploadImage } from "../api/shop"

const TIERS = [
  { code: "common", name: "Thường" },
  { code: "rare", name: "Hiếm" },
  { code: "mythical", name: "Sử thi" },
  { code: "legendary", name: "Huyền thoại" },
  { code: "ancient", name: "Cổ vật" },
]

const blankRow = () => ({ name: "", tier: "common", display_price: "", quantity_total: "", image_url: "", description: "" })

// A prize that already has draws can never go below what's been handed out -
// replacePrizes rejects it server-side, so mirror that floor in the input.
const drawnCount = (r) =>
  r.quantity_total != null && r.quantity_remaining != null
    ? Math.max(0, Number(r.quantity_total) - Number(r.quantity_remaining))
    : 0

/**
 * The prize pool is edited as a whole list and saved in one request: a booth
 * sheet is a dozen-odd prizes entered at once, and the backend replaces the
 * pool atomically.
 */
export default function AdminGachaPrizeEditor({ productId }) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    adminFetchPrizes(productId)
      .then((prizes) => {
        if (cancelled) return
        setRows(prizes?.length ? prizes : [blankRow()])
      })
      .catch(() => { if (!cancelled) setError("Không tải được danh sách phần thưởng") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [productId])

  const update = (i, field, value) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))

  const addRow = () => setRows((prev) => [...prev, blankRow()])
  const removeRow = (i) => setRows((prev) => prev.filter((_, idx) => idx !== i))

  // Row order IS sort_order - save() sends `rows` in array order and
  // prizeRepo.replacePrizes derives sort_order from each entry's index.
  const moveRow = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    setRows((prev) => {
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  // Uploaded on pick, same as AdminVariants - the seller needs to see the
  // thumbnail land before moving on. Nothing is persisted until save.
  const pickImage = async (i, file) => {
    setError("")
    setUploading(true)
    try {
      const { url } = await adminUploadImage(file, `products/${productId}/gacha`)
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, image_url: url } : r)))
    } catch (e) {
      setError(e.response?.data?.message || e.message || `Tải ảnh "${file.name}" thất bại`)
    } finally {
      setUploading(false)
    }
  }

  const removeImage = (i) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, image_url: "" } : r)))

  const save = async () => {
    setError("")
    setSaving(true)
    try {
      const payload = rows
        .filter((r) => String(r.name).trim())
        .map((r) => ({
          id: r.id,
          name: String(r.name).trim(),
          tier: r.tier,
          display_price: Number(r.display_price) || 0,
          quantity_total: Number(r.quantity_total) || 0,
          // The backend overwrites these unconditionally on every save, so
          // omitting them would null out photos/descriptions the admin never
          // touched. Round-trip whatever came back from adminFetchPrizes.
          image_url: r.image_url || "",
          description: r.description || "",
        }))
      await adminSavePrizes(productId, payload)
      // Newly added rows have no id until the server assigns one, and this
      // component is not remounted after a save - without this resync a
      // second save would resend them id-less, which replacePrizes reads as
      // "delete the existing rows" (id churn, or a 409 once draws exist).
      try {
        const fresh = await adminFetchPrizes(productId)
        setRows(fresh?.length ? fresh : [blankRow()])
      } catch {
        setError("Đã lưu, nhưng không tải lại được danh sách - hãy mở lại trước khi sửa tiếp")
      }
    } catch (e) {
      setError(e.response?.data?.message || "Lưu phần thưởng thất bại")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 p-3 rounded-xl border border-[var(--border-brand)]">
      <p className="font-medium mb-2">Phần thưởng (gacha)</p>

      {loading && <p className="text-sm opacity-70 mb-2">Đang tải...</p>}

      {rows.map((r, i) => {
        const drawn = drawnCount(r)
        return (
          <div key={r.id || i} className="mb-3 p-3 rounded-xl border border-[var(--border-brand)]">
            <div className="flex gap-2 flex-wrap items-center">
              <div className="flex flex-col shrink-0">
                <button
                  type="button"
                  onClick={() => moveRow(i, -1)}
                  disabled={i === 0}
                  aria-label={`Đưa lên trên: ${r.name || `dòng ${i + 1}`}`}
                  className="px-1 leading-none disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => moveRow(i, 1)}
                  disabled={i === rows.length - 1}
                  aria-label={`Đưa xuống dưới: ${r.name || `dòng ${i + 1}`}`}
                  className="px-1 leading-none disabled:opacity-30"
                >
                  ▼
                </button>
              </div>

              <div className="relative w-14 h-14 shrink-0 rounded-lg overflow-hidden border border-[var(--border-brand)] bg-[var(--surface-neutral)]">
                {r.image_url && <img src={r.image_url} alt="" className="w-14 h-14 object-cover" />}
              </div>

              <div className="flex flex-col gap-1 shrink-0 text-xs">
                <label className={`inline-block px-2.5 py-1 rounded-lg border border-[var(--border-brand)] cursor-pointer ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
                  {uploading ? "Đang tải..." : "Ảnh"}
                  <input
                    type="file"
                    accept="image/*"
                    aria-label={`Ảnh phần thưởng: ${r.name || `dòng ${i + 1}`}`}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ""
                      if (file) pickImage(i, file)
                    }}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
                {r.image_url && (
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label={`Xóa ảnh phần thưởng: ${r.name || `dòng ${i + 1}`}`}
                    className="px-2.5 py-1 rounded-lg border border-[var(--border-danger)] text-[var(--text-danger)] opacity-80 hover:opacity-100"
                  >
                    Xóa ảnh
                  </button>
                )}
              </div>

              <input
                value={r.name ?? ""}
                onChange={(e) => update(i, "name", e.target.value)}
                placeholder="Tên phần thưởng"
                className="flex-1 min-w-[140px] px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
              />
              <select
                value={r.tier || "common"}
                onChange={(e) => update(i, "tier", e.target.value)}
                aria-label={`Độ hiếm: ${r.name || `dòng ${i + 1}`}`}
                className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
              >
                {TIERS.map((t) => (
                  <option key={t.code} value={t.code}>{t.name}</option>
                ))}
              </select>
              <input
                value={r.quantity_total ?? ""}
                onChange={(e) => update(i, "quantity_total", e.target.value)}
                placeholder="Số lượng"
                inputMode="numeric"
                className="w-28 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
              />
              <input
                value={r.display_price ?? ""}
                onChange={(e) => update(i, "display_price", e.target.value)}
                placeholder="Giá trị hiển thị (VND)"
                inputMode="numeric"
                className="w-44 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label={`Xóa phần thưởng: ${r.name || `dòng ${i + 1}`}`}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-[var(--border-danger)] text-[var(--text-danger)] opacity-80 hover:opacity-100"
              >
                ✕
              </button>
            </div>
            {drawn > 0 && (
              <p className="text-xs opacity-60 mt-1">
                Đã trúng: {drawn} - không thể giảm số lượng xuống dưới mức này.
              </p>
            )}
          </div>
        )
      })}

      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={addRow} className="px-3 py-1 rounded-lg border border-[var(--border-brand)]">
          + Thêm phần thưởng
        </button>
        <button type="button" onClick={save} disabled={saving} className="px-3 py-1 rounded-lg bg-[var(--brand)] text-white disabled:opacity-50">
          {saving ? "Đang lưu..." : "Lưu phần thưởng"}
        </button>
      </div>
    </div>
  )
}
