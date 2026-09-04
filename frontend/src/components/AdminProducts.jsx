import { useCallback, useEffect, useState } from "react"
import {
  adminGetCollection, adminCreateProduct, adminUpdateProduct, adminDeleteProduct, adminUploadImage,
  adminReorderProducts,
} from "../api/shop"
import AdminVariants from "./AdminVariants"
import { formatVnd } from "../utils/money"

const blank = { name: "", description: "", price: "", images: [] }

const SORTS = [
  { value: "default", label: "Thứ tự kéo thả" },
  { value: "name_asc", label: "Tên A-Z" },
  { value: "name_desc", label: "Tên Z-A" },
  { value: "price_asc", label: "Giá thấp-cao" },
  { value: "price_desc", label: "Giá cao-thấp" },
]

// A product with no variants isn't a purchasable stock item, so it's never "sold out".
const isProductSoldOut = (p) => p.variants?.length > 0 && p.variants.every(
  (v) => v.stock_qty !== null && v.stock_qty !== undefined && v.stock_qty <= 0
)

function sortProducts(list, sortBy) {
  const sorted = [...list]
  if (sortBy === "name_asc") sorted.sort((a, b) => a.name.localeCompare(b.name, "vi"))
  else if (sortBy === "name_desc") sorted.sort((a, b) => b.name.localeCompare(a.name, "vi"))
  else if (sortBy === "price_asc") sorted.sort((a, b) => a.price - b.price)
  else if (sortBy === "price_desc") sorted.sort((a, b) => b.price - a.price)
  return sorted
}

export default function AdminProducts({ collection }) {
  const [products, setProducts] = useState([])
  const [draft, setDraft] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState("")
  const [expandedProductId, setExpandedProductId] = useState(null)
  const [draggedId, setDraggedId] = useState(null)
  const [reorderPending, setReorderPending] = useState(false)
  const [search, setSearch] = useState("")
  const [stockFilter, setStockFilter] = useState("")
  const [sortBy, setSortBy] = useState("default")

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

  const handleDragStart = (e, p) => {
    setDraggedId(p.id)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", String(p.id))
    const row = e.target.closest("[data-product-row]")
    if (row) row.classList.add("opacity-50", "ring-2", "ring-[var(--brand)]")
  }

  const handleDragEnd = (e) => {
    const row = e.target.closest("[data-product-row]")
    if (row) row.classList.remove("opacity-50", "ring-2", "ring-[var(--brand)]")
    setDraggedId(null)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = "move"
  }

  const handleDragEnter = (e, p) => {
    if (draggedId && p.id !== draggedId) e.currentTarget.classList.add("ring-2", "ring-[var(--brand)]")
  }

  const handleDragLeave = (e) => {
    e.currentTarget.classList.remove("ring-2", "ring-[var(--brand)]")
  }

  const handleDrop = (e, target) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.classList.remove("ring-2", "ring-[var(--brand)]")
    const fromId = draggedId
    setDraggedId(null)
    if (fromId == null || fromId === target.id) return
    const fromIdx = products.findIndex((x) => x.id === fromId)
    const toIdx = products.findIndex((x) => x.id === target.id)
    if (fromIdx === -1 || toIdx === -1) return

    const next = [...products]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    setProducts(next)
    setReorderPending(true)
    adminReorderProducts(collection.id, next.map((x) => x.id))
      .catch(() => reload())
      .finally(() => setReorderPending(false))
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

  const isDefaultView = sortBy === "default" && !search.trim() && !stockFilter
  const visibleProducts = sortProducts(
    products.filter((p) => {
      if (search.trim() && !p.name.toLowerCase().includes(search.trim().toLowerCase())) return false
      if (stockFilter === "in_stock" && isProductSoldOut(p)) return false
      if (stockFilter === "sold_out" && !isProductSoldOut(p)) return false
      return true
    }),
    sortBy
  )

  return (
    <div className="mt-4 pl-4 border-l border-[var(--border-brand)]">
      <h4 className="font-semibold mb-2">Sản phẩm</h4>

      {products.length === 0 && (
        <p className="text-sm opacity-70 mb-3">Chưa có sản phẩm nào.</p>
      )}

      {products.length > 1 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên..."
            className="flex-1 min-w-[160px] px-2 py-1 text-sm rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
          <select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value)}
            className="px-2 py-1 text-sm rounded-lg border border-[var(--border-brand)] bg-transparent"
          >
            <option value="">Tất cả</option>
            <option value="in_stock">Còn hàng</option>
            <option value="sold_out">Hết hàng</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1 text-sm rounded-lg border border-[var(--border-brand)] bg-transparent"
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      )}

      {products.length > 1 && (
        isDefaultView
          ? <p className="text-xs opacity-60 mb-2">Kéo thả sản phẩm để đổi thứ tự.{reorderPending ? " Đang lưu thứ tự..." : ""}</p>
          : <p className="text-xs opacity-60 mb-2">Đang lọc/sắp xếp — kéo thả để đổi thứ tự chỉ khả dụng ở chế độ mặc định.</p>
      )}

      {products.length > 0 && visibleProducts.length === 0 && (
        <p className="text-sm opacity-70 mb-3">Không tìm thấy sản phẩm nào khớp.</p>
      )}

      {visibleProducts.map((p) => (
        <div
          key={p.id}
          data-product-row
          onDragOver={isDefaultView ? handleDragOver : undefined}
          onDrop={isDefaultView ? (e) => handleDrop(e, p) : undefined}
          onDragEnter={isDefaultView ? (e) => handleDragEnter(e, p) : undefined}
          onDragLeave={isDefaultView ? handleDragLeave : undefined}
          className="mb-4 p-3 rounded-xl border border-[var(--border-brand)]"
        >
          <div className="flex justify-between items-start gap-2">
            <div
              draggable={isDefaultView}
              onDragStart={isDefaultView ? (e) => handleDragStart(e, p) : undefined}
              onDragEnd={isDefaultView ? handleDragEnd : undefined}
              className={"flex items-start gap-2 min-w-0" + (isDefaultView ? " cursor-grab active:cursor-grabbing" : "")}
              title={isDefaultView ? "Kéo để đổi thứ tự" : undefined}
            >
              <span className="shrink-0 opacity-50 select-none leading-6" aria-hidden="true">⋮⋮</span>
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-sm opacity-70">{formatVnd(p.price)}</p>
              </div>
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
