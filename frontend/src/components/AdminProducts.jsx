import { useCallback, useEffect, useState } from "react"
import {
  fetchCollection, adminCreateProduct, adminUpdateProduct, adminDeleteProduct, adminUploadImage,
} from "../api/shop"
import AdminVariants from "./AdminVariants"
import { formatVnd } from "../utils/money"

const blank = { name: "", description: "", price: "", images: [] }

export default function AdminProducts({ collection }) {
  // Raw fetch result only; the "draft" case is derived below rather than
  // reset synchronously in the effect, which avoids a
  // react-hooks/set-state-in-effect violation (setState called before any
  // await, in the same tick the effect runs).
  const [fetched, setFetched] = useState([])
  const [draft, setDraft] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState("")

  // Draft collections are not exposed publicly, so nothing to list until published.
  const products = collection.status === "draft" ? [] : fetched

  const reload = useCallback(() => {
    if (collection.status === "draft") return Promise.resolve()
    return fetchCollection(collection.slug)
      .then((data) => setFetched(data.products))
      .catch(() => setFetched([]))
  }, [collection.slug, collection.status])

  useEffect(() => { reload() }, [reload])

  const pickImage = async (file) => {
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(",")[1])
      reader.readAsDataURL(file)
    })
    const { url } = await adminUploadImage(base64, `products/${collection.id}`)
    setDraft((d) => ({ ...d, images: [...(d.images || []), url] }))
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

  const remove = async (id) => {
    if (!confirm("Xóa sản phẩm này?")) return
    await adminDeleteProduct(id)
    await reload()
  }

  return (
    <div className="mt-4 pl-4 border-l border-[var(--border-brand)]">
      <h4 className="font-semibold mb-2">Sản phẩm</h4>

      {collection.status === "draft" && (
        <p className="text-sm opacity-70 mb-3">
          Đổi trạng thái sang &quot;active&quot; để xem và thêm sản phẩm.
        </p>
      )}

      {products.map((p) => (
        <div key={p.id} className="mb-4 p-3 rounded-xl border border-[var(--border-brand)]">
          <div className="flex justify-between items-start gap-2">
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-sm opacity-70">{formatVnd(p.price)}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={() => edit(p)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Sửa</button>
              <button type="button" onClick={() => remove(p.id)} className="px-2 py-1 text-sm border rounded-lg border-[var(--border-brand)]">Xóa</button>
            </div>
          </div>
          <AdminVariants product={p} onSaved={reload} />
        </div>
      ))}

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
              <img key={url} src={url} alt="" className="w-16 h-16 object-cover rounded-lg" />
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

        <button type="button" onClick={save} className="px-3 py-1 rounded-lg bg-[var(--brand)] text-white">
          {editingId ? "Cập nhật" : "Thêm"}
        </button>
      </div>
    </div>
  )
}
