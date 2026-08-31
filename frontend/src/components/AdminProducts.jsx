import { useCallback, useEffect, useState } from "react"
import {
  adminGetCollection, adminCreateProduct, adminUpdateProduct, adminDeleteProduct, adminUploadImage,
} from "../api/shop"
import AdminVariants from "./AdminVariants"
import { formatVnd } from "../utils/money"

const blank = { name: "", description: "", price: "", images: [] }

export default function AdminProducts({ collection }) {
  const [products, setProducts] = useState([])
  const [draft, setDraft] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState("")
  const [expandedProductId, setExpandedProductId] = useState(null)

  // Admin-scoped route: no status filter, so draft/archived collections'
  // products are reachable here too (unlike the public storefront route).
  const reload = useCallback(() => {
    return adminGetCollection(collection.id)
      .then((data) => setProducts(data.products))
      .catch(() => setProducts([]))
  }, [collection.id])

  useEffect(() => { reload() }, [reload])

  const pickImage = async (file) => {
    setError("")
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(",")[1])
        reader.onerror = () => reject(new Error("Không đọc được file ảnh"))
        reader.readAsDataURL(file)
      })
      const { url } = await adminUploadImage(base64, `products/${collection.id}`)
      setDraft((d) => ({ ...d, images: [...(d.images || []), url] }))
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Tải ảnh lên thất bại")
    }
  }

  const save = async () => {
    setError("")
    try {
      const payload = { ...draft, price: Number(draft.price) || 0 }
      if (editingId) await adminUpdateProduct(editingId, payload)
      else await adminCreateProduct(collection.id, payload)

      setDraft(blank)
      setEditingId(null)
      await reload()
    } catch (e) {
      setError(e.response?.data?.message || "Lưu sản phẩm thất bại")
    }
  }

  const edit = (p) => {
    setEditingId(p.id)
    setDraft({ name: p.name, description: p.description || "", price: p.price, images: p.images || [] })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft(blank)
    setError("")
  }

  const remove = async (id) => {
    if (!confirm("Xóa sản phẩm này?")) return
    setError("")
    try {
      await adminDeleteProduct(id)
      await reload()
    } catch (e) {
      setError(e.response?.data?.message || "Xóa sản phẩm thất bại")
    }
  }

  const form = (
    <div className="p-3 rounded-xl border border-dashed border-[var(--border-brand)]">
      <p className="font-medium mb-2">{editingId ? "Sửa sản phẩm" : "Thêm sản phẩm"}</p>

      <input
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="Tên sản phẩm"
        className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
      />
      <input
        value={draft.price}
        onChange={(e) => setDraft({ ...draft, price: e.target.value })}
        placeholder="Giá (VND, ví dụ 35000)"
        inputMode="numeric"
        className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
      />
      <textarea
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        placeholder="Mô tả (markdown)"
        rows={3}
        className="w-full mb-2 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
      />
      <input
        type="file"
        accept="image/*"
        onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])}
        className="mb-2 text-sm"
      />

      {draft.images?.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {draft.images.map((url) => (
            <div key={url} className="relative">
              <img src={url} alt="" className="w-16 h-16 object-cover rounded-lg" />
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, images: d.images.filter((u) => u !== url) }))}
                aria-label="Xóa ảnh"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-black/70 text-white text-xs leading-none"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={save} className="px-3 py-1 rounded-lg bg-[var(--brand)] text-white">
          {editingId ? "Cập nhật" : "Thêm"}
        </button>
        {editingId && (
          <button type="button" onClick={cancelEdit} className="px-3 py-1 rounded-lg border border-[var(--border-brand)]">
            Hủy
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="mt-4 pl-4 border-l border-[var(--border-brand)]">
      <h4 className="font-semibold mb-2">Sản phẩm</h4>

      {products.length === 0 && (
        <p className="text-sm opacity-70 mb-3">Chưa có sản phẩm nào.</p>
      )}

      {products.map((p) => (
        <div key={p.id} className="mb-4 p-3 rounded-xl border border-[var(--border-brand)]">
          <div className="flex justify-between items-start gap-2">
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-sm opacity-70">{formatVnd(p.price)}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setExpandedProductId(expandedProductId === p.id ? null : p.id)}
                className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]"
              >
                {expandedProductId === p.id ? "Thu gọn" : "Phân loại"}
              </button>
              <button type="button" onClick={() => edit(p)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Sửa</button>
              <button type="button" onClick={() => remove(p.id)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Xóa</button>
            </div>
          </div>
          {expandedProductId === p.id && <AdminVariants product={p} onSaved={reload} />}
          {editingId === p.id && <div className="mt-3">{form}</div>}
        </div>
      ))}

      {!editingId && form}
    </div>
  )
}
