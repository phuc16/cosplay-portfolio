import { useEffect, useRef, useState } from "react"
import {
  adminListDiscountCodes, adminCreateDiscountCode, adminUpdateDiscountCode, adminDeleteDiscountCode,
} from "../api/shop"

const TYPES = [
  { value: "percent", label: "Phần trăm (%)" },
  { value: "fixed", label: "Số tiền cố định (VND)" },
]

const blank = {
  code: "", type: "percent", value: "", enabled: true,
  max_uses: "", min_total: "", expires_at: "",
}

/** MySQL DATETIME -> the `YYYY-MM-DDTHH:mm` shape a <input type="datetime-local"> needs, in local time. */
function toDatetimeLocal(value) {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatValue(c) {
  return c.type === "percent" ? `${c.value}%` : `${Number(c.value).toLocaleString("vi-VN")}đ`
}

export default function AdminDiscountCodes() {
  const [codes, setCodes] = useState([])
  const [draft, setDraft] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState("")
  const formRef = useRef(null)

  const reload = () => adminListDiscountCodes().then(setCodes)

  useEffect(() => { reload().catch(() => setCodes([])) }, [])

  const save = async () => {
    setError("")
    try {
      const payload = {
        ...draft,
        value: draft.value === "" ? null : Number(draft.value),
        max_uses: draft.max_uses === "" ? null : Number(draft.max_uses),
        min_total: draft.min_total === "" ? 0 : Number(draft.min_total),
        expires_at: draft.expires_at ? new Date(draft.expires_at).toISOString() : "",
      }
      if (editingId) await adminUpdateDiscountCode(editingId, payload)
      else await adminCreateDiscountCode(payload)

      setDraft(blank)
      setEditingId(null)
      await reload()
    } catch (e) {
      setError(e.response?.data?.message || "Lưu mã giảm giá thất bại")
    }
  }

  const edit = (c) => {
    setEditingId(c.id)
    setDraft({
      code: c.code, type: c.type, value: String(c.value), enabled: c.enabled,
      max_uses: c.max_uses === null || c.max_uses === undefined ? "" : String(c.max_uses),
      min_total: String(c.min_total ?? 0),
      expires_at: toDatetimeLocal(c.expires_at),
    })
    // Same reasoning as AdminCollections' edit form: the shared form lives
    // once, below the whole list - without this, clicking "Sửa" on a row far
    // down the list changes state invisibly, off-screen.
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft(blank)
    setError("")
  }

  const remove = async (id) => {
    if (!confirm("Xóa mã giảm giá này?")) return
    setError("")
    try {
      await adminDeleteDiscountCode(id)
      await reload()
    } catch (e) {
      setError(e.response?.data?.message || "Xóa mã giảm giá thất bại")
    }
  }

  const toggleEnabled = async (c) => {
    setError("")
    try {
      await adminUpdateDiscountCode(c.id, {
        code: c.code, type: c.type, value: c.value, enabled: !c.enabled,
        max_uses: c.max_uses, min_total: c.min_total, expires_at: c.expires_at || "",
      })
      await reload()
    } catch (e) {
      setError(e.response?.data?.message || "Cập nhật mã giảm giá thất bại")
    }
  }

  return (
    <div>
      <h3 className="text-xl font-semibold mb-4">Mã giảm giá</h3>

      {codes.length === 0 && <p className="opacity-60 mb-4">Chưa có mã giảm giá nào.</p>}

      {codes.map((c) => (
        <div key={c.id} className="mb-3 p-4 rounded-2xl border border-[var(--border-brand)] flex justify-between items-center gap-3 flex-wrap">
          <div>
            <p className="font-semibold">
              {c.code} <span className="opacity-70 font-normal">· {formatValue(c)}</span>
              {!c.enabled && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-[var(--surface-neutral)]">Đã tắt</span>}
            </p>
            <p className="text-sm opacity-70">
              Đã dùng {c.used_count}{c.max_uses !== null ? `/${c.max_uses}` : " (không giới hạn)"}
              {c.min_total > 0 && ` · Tối thiểu ${Number(c.min_total).toLocaleString("vi-VN")}đ`}
              {c.expires_at && ` · Hết hạn ${new Date(c.expires_at).toLocaleString("vi-VN")}`}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={() => toggleEnabled(c)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">
              {c.enabled ? "Tắt" : "Bật"}
            </button>
            <button type="button" onClick={() => edit(c)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Sửa</button>
            <button type="button" onClick={() => remove(c.id)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Xóa</button>
          </div>
        </div>
      ))}

      <div ref={formRef} className="p-4 rounded-2xl border border-dashed border-[var(--border-brand)] mt-4">
        <p className="font-medium mb-3">{editingId ? "Sửa mã giảm giá" : "Tạo mã giảm giá"}</p>

        <input
          value={draft.code}
          onChange={(e) => setDraft({ ...draft, code: e.target.value })}
          placeholder="Mã (VD: LAUNCH10)"
          className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
          <label className="block">
            <span className="block text-sm mb-1">Loại giảm giá</span>
            <select
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value })}
              className="w-full h-[38px] px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
            >
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm mb-1">Giá trị {draft.type === "percent" ? "(1-100)" : "(VND)"}</span>
            <input
              type="number" min="1"
              value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              className="w-full h-[38px] px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
          <label className="block">
            <span className="block text-sm mb-1">Số lượt sử dụng tối đa (để trống = không giới hạn)</span>
            <input
              type="number" min="1"
              value={draft.max_uses}
              onChange={(e) => setDraft({ ...draft, max_uses: e.target.value })}
              className="w-full h-[38px] px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
            />
          </label>
          <label className="block">
            <span className="block text-sm mb-1">Mức đơn tối thiểu (VND, để trống = không yêu cầu)</span>
            <input
              type="number" min="0"
              value={draft.min_total}
              onChange={(e) => setDraft({ ...draft, min_total: e.target.value })}
              className="w-full h-[38px] px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
            />
          </label>
        </div>

        <label className="block mb-3">
          <span className="block text-sm mb-1">Hết hạn (để trống = không hết hạn)</span>
          <input
            type="datetime-local"
            value={draft.expires_at}
            onChange={(e) => setDraft({ ...draft, expires_at: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
        </label>

        <label className="flex items-center gap-2 mb-3 text-sm">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
          Kích hoạt
        </label>

        {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={save} className="px-4 py-2 rounded-lg bg-[var(--brand)] text-white">
            {editingId ? "Cập nhật" : "Tạo"}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} className="px-4 py-2 rounded-lg border border-[var(--border-brand)]">
              Hủy
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
