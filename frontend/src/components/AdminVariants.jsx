import { useEffect, useRef, useState } from "react"
import { adminSaveVariants, adminUploadImage } from "../api/shop"

/**
 * Variants are edited as a whole list and saved in one request, because a
 * photocard sheet is 40-odd codes entered at once.
 */
// Older variants only ever had a single image_url; normalize every row to
// an `images` array so the rest of the component has one shape to work with.
const withImages = (v) => ({ ...v, images: v.images?.length ? v.images : (v.image_url ? [v.image_url] : []) })

export default function AdminVariants({ product, onSaved }) {
  const [rows, setRows] = useState(
    product.variants?.length ? product.variants.map(withImages) : [{ label: "", stock_qty: "", images: [] }]
  )
  const [bulk, setBulk] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [batchUploading, setBatchUploading] = useState(false)
  const [draggedIdx, setDraggedIdx] = useState(null)

  // This component is keyed by the parent on the stable product.id, so it is
  // NOT remounted after a save -- `rows` would otherwise keep holding
  // pre-save rows (missing the ids the server just assigned to new variants),
  // and a second save would resend them id-less, making replaceVariants treat
  // them as brand-new inserts and delete the just-created ones. `onSaved()`
  // triggers the parent to re-fetch and pass a fresh `product` prop down, so
  // resync `rows` from `product.variants` right after that -- but only then,
  // not on every parent re-render, or in-progress unsaved edits would be
  // clobbered whenever the parent happens to re-render for an unrelated reason.
  const awaitingResync = useRef(false)
  useEffect(() => {
    if (!awaitingResync.current) return
    awaitingResync.current = false
    setRows(product.variants?.length ? product.variants.map(withImages) : [{ label: "", stock_qty: "", images: [] }])
  }, [product.variants])

  const update = (i, field, value) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))

  const addRow = () => setRows([...rows, { label: "", stock_qty: "", images: [] }])
  const removeRow = (i) => setRows(rows.filter((_, idx) => idx !== i))

  // Row order IS sort_order - save() sends `rows` in array order and
  // catalogRepo.replaceVariants derives sort_order from each entry's index,
  // so moving a row here is the entire reorder feature; nothing else needed.
  const moveRow = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    setRows(next)
  }

  // Drag-and-drop reorders `rows` by index, same as moveRow - nothing is
  // persisted until "Lưu phân loại" is pressed, matching the up/down arrows.
  const handleDragStart = (e, i) => {
    setDraggedIdx(i)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", String(i))
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }

  const handleDrop = (e, targetIdx) => {
    e.preventDefault()
    const fromIdx = draggedIdx
    setDraggedIdx(null)
    if (fromIdx == null || fromIdx === targetIdx) return
    setRows((prev) => {
      const next = [...prev]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(targetIdx, 0, moved)
      return next
    })
  }

  const stripExt = (filename) => filename.replace(/\.[^./\\]+$/, "").trim()

  // "A1, A2, A10, B1" instead of plain string order putting "A10" before
  // "A2" - splits each label into alternating text/number chunks and
  // compares number chunks numerically, text chunks as strings.
  const labelChunks = (label) => String(label).match(/\d+|\D+/g) || []
  const compareLabelsNatural = (a, b) => {
    const chunksA = labelChunks(a.label)
    const chunksB = labelChunks(b.label)
    const len = Math.max(chunksA.length, chunksB.length)
    for (let i = 0; i < len; i++) {
      const chunkA = chunksA[i] ?? ""
      const chunkB = chunksB[i] ?? ""
      const numA = Number(chunkA)
      const numB = Number(chunkB)
      const bothNumeric = chunkA !== "" && chunkB !== "" && !Number.isNaN(numA) && !Number.isNaN(numB)
      const cmp = bothNumeric ? numA - numB : chunkA.localeCompare(chunkB)
      if (cmp !== 0) return cmp
    }
    return 0
  }
  const sortRowsByLabel = () => setRows((prev) => [...prev].sort(compareLabelsNatural))

  // One image per variant code: filename (minus extension) becomes the
  // label, so a seller can select a whole folder of "A1.png, A2.png..."
  // photocards at once instead of adding rows one at a time. Uploaded rows
  // land in the review list alongside existing ones - nothing is saved
  // until the seller presses "Lưu phân loại", so this is a staging step,
  // not an immediate write.
  const batchUpload = async (files) => {
    setError("")
    setBatchUploading(true)
    try {
      const uploaded = []
      for (const file of files) {
        try {
          const { url } = await adminUploadImage(file, `products/${product.id}/variants`)
          uploaded.push({ label: stripExt(file.name), stock_qty: "", images: [url] })
        } catch (e) {
          setError(e.response?.data?.message || e.message || `Tải ảnh "${file.name}" thất bại`)
        }
      }
      if (uploaded.length) {
        setRows([...rows.filter((r) => r.label.trim()), ...uploaded].sort(compareLabelsNatural))
      }
    } finally {
      setBatchUploading(false)
    }
  }

  // Each row's photo is uploaded on pick (same pattern as AdminProducts),
  // rather than deferred to save time - a photocard sheet is entered one
  // row at a time and the seller needs to see each thumbnail land before
  // moving to the next code. Most rows carry exactly one photo, but a row
  // can hold several (e.g. a preview sheet plus a close-up) - new uploads
  // append to that row's gallery instead of replacing it.
  const pickImages = async (i, files) => {
    setError("")
    setBatchUploading(true)
    try {
      for (const file of files) {
        try {
          const { url } = await adminUploadImage(file, `products/${product.id}/variants`)
          setRows((prev) => prev.map((r, idx) => (
            idx === i ? { ...r, images: [...(r.images || []), url] } : r
          )))
        } catch (e) {
          setError(e.response?.data?.message || e.message || `Tải ảnh "${file.name}" thất bại`)
        }
      }
    } finally {
      setBatchUploading(false)
    }
  }

  const removeImage = (i, url) => {
    setRows((prev) => prev.map((r, idx) => (
      idx === i ? { ...r, images: (r.images || []).filter((u) => u !== url) } : r
    )))
  }

  // Separate from `images` (the variant's own photo gallery) - never shown
  // as one of the variant's pictures, only as the cover in the picker grid.
  const pickThumbnail = async (i, file) => {
    setError("")
    setBatchUploading(true)
    try {
      const { url } = await adminUploadImage(file, `products/${product.id}/variants`)
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, thumbnail_image: url } : r)))
    } catch (e) {
      setError(e.response?.data?.message || e.message || `Tải ảnh "${file.name}" thất bại`)
    } finally {
      setBatchUploading(false)
    }
  }

  const removeThumbnail = (i) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, thumbnail_image: "" } : r)))
  }

  // "A1, A2, B1" or one code per line -> one row each.
  const applyBulk = () => {
    const labels = bulk.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
    if (!labels.length) return
    setRows(
      [...rows.filter((r) => r.label.trim()), ...labels.map((label) => ({ label, stock_qty: "", images: [] }))]
        .sort(compareLabelsNatural)
    )
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
          images: r.images || [],
          thumbnail_image: r.thumbnail_image || "",
          description: r.description || "",
          // Empty means unlimited, which the API expects as null rather than 0.
          stock_qty: r.stock_qty === "" || r.stock_qty === null ? null : Number(r.stock_qty),
        }))
      await adminSaveVariants(product.id, payload)
      awaitingResync.current = true
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
        <button
          type="button"
          onClick={sortRowsByLabel}
          disabled={rows.length < 2}
          title="Sắp xếp danh sách theo mã (A1, A2, ... A10, B1)"
          className="px-3 py-1 rounded-lg border border-[var(--border-brand)] disabled:opacity-50"
        >
          Sắp xếp theo mã
        </button>
      </div>

      <div className="mb-3">
        <label
          className={`inline-block px-3 py-1 text-sm rounded-lg border border-[var(--border-brand)] cursor-pointer ${batchUploading ? "opacity-50 pointer-events-none" : ""}`}
        >
          {batchUploading ? "Đang tải ảnh..." : "Tải ảnh hàng loạt (tên file = mã)"}
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="Tải ảnh hàng loạt"
            onChange={(e) => {
              const files = [...(e.target.files || [])]
              e.target.value = ""
              if (files.length) batchUpload(files)
            }}
            disabled={batchUploading}
            className="hidden"
          />
        </label>
        <p className="text-xs opacity-60 mt-1">
          Ví dụ: A1.png, A2.png, B1.png → tạo 3 phân loại A1, A2, B1. Kiểm tra và sửa lại trước khi lưu.
        </p>
      </div>

      {rows.map((r, i) => (
        <div
          key={r.id || i}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, i)}
          className="mb-3 p-3 rounded-xl border border-[var(--border-brand)]"
        >
          <div className="flex gap-3 items-start">
            <div className="flex flex-col items-center gap-1 shrink-0 pt-1">
              <span
                draggable
                onDragStart={(e) => handleDragStart(e, i)}
                className="opacity-50 select-none cursor-grab active:cursor-grabbing leading-none"
                title="Kéo để đổi thứ tự"
                aria-hidden="true"
              >
                ⋮⋮
              </span>
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => moveRow(i, -1)}
                  disabled={i === 0}
                  aria-label={`Đưa lên trên: ${r.label || `dòng ${i + 1}`}`}
                  className="px-1 leading-none disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => moveRow(i, 1)}
                  disabled={i === rows.length - 1}
                  aria-label={`Đưa xuống dưới: ${r.label || `dòng ${i + 1}`}`}
                  className="px-1 leading-none disabled:opacity-30"
                >
                  ▼
                </button>
              </div>
            </div>

            <div className="w-14 h-14 shrink-0 rounded-lg overflow-hidden border border-[var(--border-brand)] bg-[var(--surface-neutral)]">
              {(r.thumbnail_image || r.images?.[0]) && (
                <img src={r.thumbnail_image || r.images[0]} alt="" className="w-14 h-14 object-cover" />
              )}
            </div>

            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <div className="flex gap-2 flex-wrap items-center">
                <input
                  value={r.label}
                  onChange={(e) => update(i, "label", e.target.value)}
                  placeholder="Mã (A1) hoặc size (M)"
                  className="flex-1 min-w-[140px] px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
                />
                <input
                  value={r.stock_qty ?? ""}
                  onChange={(e) => update(i, "stock_qty", e.target.value)}
                  placeholder="SL (trống = không giới hạn)"
                  inputMode="numeric"
                  className="w-44 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  aria-label={`Xóa dòng: ${r.label || `dòng ${i + 1}`}`}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-[var(--border-danger)] text-[var(--text-danger)] opacity-80 hover:opacity-100"
                >
                  ✕
                </button>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <label className="inline-block px-2.5 py-1 rounded-lg border border-[var(--border-brand)] cursor-pointer">
                  Ảnh sản phẩm
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    aria-label={`Ảnh cho ${r.label || `dòng ${i + 1}`}`}
                    onChange={(e) => {
                      const files = [...(e.target.files || [])]
                      e.target.value = ""
                      if (files.length) pickImages(i, files)
                    }}
                    disabled={batchUploading}
                    className="hidden"
                  />
                </label>
                <label className="inline-block px-2.5 py-1 rounded-lg border border-[var(--border-brand)] cursor-pointer">
                  Ảnh thumbnail riêng
                  <input
                    type="file"
                    accept="image/*"
                    aria-label={`Ảnh thumbnail cho ${r.label || `dòng ${i + 1}`}`}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ""
                      if (file) pickThumbnail(i, file)
                    }}
                    disabled={batchUploading}
                    className="hidden"
                  />
                </label>
                <span className="self-center opacity-50">
                  (Thumbnail tuỳ chọn - nếu bỏ trống, dùng ảnh sản phẩm đầu tiên)
                </span>
              </div>

              {(r.images?.length > 0 || r.thumbnail_image) && (
                <div className="flex gap-2 flex-wrap">
                  {r.images?.map((url) => (
                    <div key={url} className="relative">
                      <img src={url} alt="" className="w-10 h-10 object-cover rounded-lg border border-[var(--border-brand)]" />
                      <button
                        type="button"
                        onClick={() => removeImage(i, url)}
                        aria-label="Xóa ảnh"
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-black/70 text-white text-[10px] leading-none"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {r.thumbnail_image && (
                    <div className="relative">
                      <img src={r.thumbnail_image} alt="" className="w-10 h-10 object-cover rounded-lg border-2 border-[var(--brand)]" />
                      <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1 rounded-full bg-[var(--brand)] text-white text-[9px] leading-tight whitespace-nowrap">
                        thumb
                      </span>
                      <button
                        type="button"
                        onClick={() => removeThumbnail(i)}
                        aria-label={`Xóa ảnh thumbnail: ${r.label || `dòng ${i + 1}`}`}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-black/70 text-white text-[10px] leading-none"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              )}

              <textarea
                value={r.description || ""}
                onChange={(e) => update(i, "description", e.target.value)}
                placeholder="Mô tả riêng cho phân loại này (markdown, tùy chọn - ví dụ: bảng size)"
                rows={2}
                className="w-full px-2 py-1 text-sm rounded-lg border border-[var(--border-brand)] bg-transparent"
              />
            </div>
          </div>
        </div>
      ))}

      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      <div className="flex gap-2 flex-wrap">
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
