import { useEffect, useRef, useState } from "react"
import {
  adminListCollections, adminCreateCollection, adminUpdateCollection,
  adminDeleteCollection, adminCopyCollection, adminUploadImage,
} from "../api/shop"
import AdminProducts from "./AdminProducts"

const STATUSES = [
  { value: "draft", label: "Nháp (ẩn)" },
  { value: "active", label: "Đang mở bán" },
  { value: "closed", label: "Đã đóng (vẫn xem được)" },
  { value: "archived", label: "Lưu trữ (ẩn hẳn)" },
]

const blank = {
  title: "", description: "", status: "draft",
  allow_ship: true, allow_pickup: false,
  pickup_location: "", pickup_note: "",
  payment_deadline_hours: "",
  cover_image: "", thumbnail_image: "",
}

export default function AdminCollections() {
  const [collections, setCollections] = useState([])
  const [draft, setDraft] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [error, setError] = useState("")
  const formRef = useRef(null)

  const reload = () => adminListCollections().then(setCollections)

  useEffect(() => { reload().catch(() => setCollections([])) }, [])

  const upload = async (file, field) => {
    setError("")
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(",")[1])
        reader.onerror = () => reject(new Error("Không đọc được file ảnh"))
        reader.readAsDataURL(file)
      })
      const { url } = await adminUploadImage(base64, "collections")
      setDraft((d) => ({ ...d, [field]: url }))
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Tải ảnh lên thất bại")
    }
  }

  const save = async () => {
    setError("")
    try {
      if (editingId) await adminUpdateCollection(editingId, draft)
      else await adminCreateCollection(draft)

      setDraft(blank)
      setEditingId(null)
      await reload()
    } catch (e) {
      setError(e.response?.data?.message || "Lưu bộ sưu tập thất bại")
    }
  }

  const edit = (c) => {
    setEditingId(c.id)
    setDraft({
      title: c.title, description: c.description || "", status: c.status,
      allow_ship: c.allow_ship, allow_pickup: c.allow_pickup,
      pickup_location: c.pickup_location || "", pickup_note: c.pickup_note || "",
      payment_deadline_hours: c.payment_deadline_hours || "",
      cover_image: c.cover_image || "", thumbnail_image: c.thumbnail_image || "",
    })
    // The edit form is one shared block below the whole list, not inline
    // under each card — without this, clicking "Sửa" on an item far down
    // the list changes state invisibly, leaving the admin looking at
    // whatever they were already scrolled to.
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const remove = async (id) => {
    if (!confirm("Xóa bộ sưu tập này? Toàn bộ sản phẩm bên trong cũng bị xóa.")) return
    setError("")
    try {
      await adminDeleteCollection(id)
      await reload()
    } catch (e) {
      setError(e.response?.data?.message || "Xóa bộ sưu tập thất bại")
    }
  }

  const copy = async (id) => {
    setError("")
    try {
      await adminCopyCollection(id)
      await reload()
    } catch (e) {
      setError(e.response?.data?.message || "Sao chép bộ sưu tập thất bại")
    }
  }

  return (
    <div>
      <h3 className="text-xl font-semibold mb-4">Bộ sưu tập</h3>

      {collections.map((c) => (
        <div key={c.id} className="mb-4 p-4 rounded-2xl border border-[var(--border-brand)]">
          <div className="flex justify-between items-start gap-3">
            <div>
              <p className="font-semibold">{c.title}</p>
              <p className="text-sm opacity-70">/{c.slug} · {STATUSES.find((s) => s.value === c.status)?.label}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={() => setExpandedId(expandedId === c.id ? null : c.id)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">
                {expandedId === c.id ? "Ẩn" : "Sản phẩm"}
              </button>
              <button type="button" onClick={() => edit(c)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Sửa</button>
              <button type="button" onClick={() => copy(c.id)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Sao chép</button>
              <button type="button" onClick={() => remove(c.id)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Xóa</button>
            </div>
          </div>

          {expandedId === c.id && <AdminProducts collection={c} />}
        </div>
      ))}

      <div ref={formRef} className="p-4 rounded-2xl border border-dashed border-[var(--border-brand)]">
        <p className="font-medium mb-3">{editingId ? "Sửa bộ sưu tập" : "Tạo bộ sưu tập"}</p>

        <input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="Tên bộ sưu tập"
          className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        />
        <textarea
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="Mô tả (markdown: **đậm**, - danh sách, [link](url))"
          rows={4}
          className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        />

        <select
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          className="w-full mb-3 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
        >
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <label className="block text-sm mb-3">
          Hạn chuyển khoản (giờ, để trống dùng mặc định hệ thống)
          <input
            type="number"
            min="1"
            value={draft.payment_deadline_hours}
            onChange={(e) => setDraft({ ...draft, payment_deadline_hours: e.target.value })}
            placeholder="Mặc định"
            className="w-full mt-1 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
        </label>

        <div className="flex gap-4 mb-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.allow_ship} onChange={(e) => setDraft({ ...draft, allow_ship: e.target.checked })} />
            Giao toàn quốc
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.allow_pickup} onChange={(e) => setDraft({ ...draft, allow_pickup: e.target.checked })} />
            Nhận tại sự kiện
          </label>
        </div>

        {draft.allow_pickup && (
          <>
            <input
              value={draft.pickup_location}
              onChange={(e) => setDraft({ ...draft, pickup_location: e.target.value })}
              placeholder="Địa điểm nhận (tên sự kiện, gian hàng)"
              className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
            />
            <textarea
              value={draft.pickup_note}
              onChange={(e) => setDraft({ ...draft, pickup_note: e.target.value })}
              placeholder="Ghi chú nhận hàng (ngày, giờ)"
              rows={2}
              className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
            />
          </>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 text-sm">
          <label>
            Ảnh bìa (banner)
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "cover_image")} className="block mt-1" />
            {draft.cover_image && <img src={draft.cover_image} alt="" className="mt-2 w-full h-24 object-cover rounded-lg" />}
          </label>
          <label>
            Ảnh thumbnail (danh sách, không bắt buộc)
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "thumbnail_image")} className="block mt-1" />
            {draft.thumbnail_image && <img src={draft.thumbnail_image} alt="" className="mt-2 w-full h-24 object-cover rounded-lg" />}
          </label>
        </div>

        {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

        <button type="button" onClick={save} className="px-4 py-2 rounded-lg bg-[var(--brand)] text-white">
          {editingId ? "Cập nhật" : "Tạo"}
        </button>
      </div>
    </div>
  )
}
