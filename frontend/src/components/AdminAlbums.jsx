import { useState, useEffect } from "react"
import { api } from "../api/api"
import AdminAlbumForm from "./AdminAlbumForm"
import AdminAlbumImages from "./AdminAlbumImages"
import { buildAlbumTree, sameParent } from "./albumTree"

export default function AdminAlbums() {
  const [albums, setAlbums] = useState([])
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [subParent, setSubParent] = useState(null)
  const [draggedId, setDraggedId] = useState(null)
  const [reorderPending, setReorderPending] = useState(false)
  const [error, setError] = useState("")

  const fetchAlbums = () => {
    api.get("/api/albums").then((r) => setAlbums(r.data))
  }

  useEffect(() => {
    fetchAlbums()
  }, [])

  const createAlbum = (title, description, parentId) => {
    setError("")
    return api.post("/api/albums", { title, description, ...(parentId ? { parent_id: parentId } : {}) }).then(() => {
      fetchAlbums()
      setShowForm(false)
      setSubParent(null)
    }).catch((err) => {
      setError(err.response?.data?.message || "Tạo album thất bại")
    })
  }

  const updateAlbum = (id, title, description) => {
    setError("")
    return api.put(`/api/albums/${id}`, { title, description }).then(() => {
      fetchAlbums()
      setEditing(null)
      if (selected?.id === id) setSelected({ ...selected, title, description })
    }).catch((err) => {
      setError(err.response?.data?.message || "Sửa album thất bại")
    })
  }

  const deleteAlbum = (a) => {
    const subCount = albums.filter((x) => x.parent_id === a.id).length
    const message = a.parent_id != null
      ? "Xóa album con và tất cả ảnh trong album con?"
      : subCount > 0
        ? `Xóa album, ${subCount} album con và tất cả ảnh?`
        : "Xóa album và tất cả ảnh trong album?"
    if (!confirm(message)) return
    setError("")
    api.delete(`/api/albums/${a.id}`).then(() => {
      fetchAlbums()
      if (selected?.id === a.id || selected?.parent_id === a.id) setSelected(null)
    }).catch((err) => {
      setError(err.response?.data?.message || "Xóa album thất bại")
    })
  }

  const handleDragStart = (e, a) => {
    setDraggedId(a.id)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", String(a.id))
    const row = e.target.closest("[data-album-row]")
    if (row) row.classList.add("opacity-50", "ring-2", "ring-pink-500")
  }

  const handleDragEnd = (e) => {
    const row = e.target.closest("[data-album-row]")
    if (row) row.classList.remove("opacity-50", "ring-2", "ring-pink-500")
    setDraggedId(null)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = "move"
  }

  const handleDrop = (e, targetAlbum) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.classList.remove("ring-2", "ring-pink-400")
    const fromId = draggedId
    if (fromId == null || fromId === targetAlbum.id) return
    const dragged = albums.find((x) => x.id === fromId)
    if (!dragged || !sameParent(dragged, targetAlbum)) {
      setDraggedId(null)
      return
    }
    const siblings = albums.filter((x) => sameParent(x, targetAlbum))
    const fromIdx = siblings.findIndex((x) => x.id === fromId)
    const toIdx = siblings.findIndex((x) => x.id === targetAlbum.id)
    if (fromIdx === -1 || toIdx === -1) return
    const nextSiblings = [...siblings]
    const [removed] = nextSiblings.splice(fromIdx, 1)
    nextSiblings.splice(toIdx, 0, removed)
    let k = 0
    const next = albums.map((x) => (sameParent(x, targetAlbum) ? nextSiblings[k++] : x))
    setAlbums(next)
    setDraggedId(null)
    setReorderPending(true)
    api
      .put("/api/albums/reorder", { albumIds: nextSiblings.map((x) => x.id) })
      .then(() => setReorderPending(false))
      .catch((err) => {
        setReorderPending(false)
        fetchAlbums()
        console.error("[AdminAlbums] Reorder failed:", err.response?.data || err.message)
      })
  }

  const handleDragEnter = (e, a) => {
    if (draggedId && a.id !== draggedId) e.currentTarget.classList.add("ring-2", "ring-pink-400")
  }

  const handleDragLeave = (e) => {
    e.currentTarget.classList.remove("ring-2", "ring-pink-400")
  }

  const renderRow = (a, { isSub }) => (
        <div
          key={a.id}
          data-album-row
          {...(isSub ? { "data-sub-album-row": true } : {})}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, a)}
          onDragEnter={(e) => handleDragEnter(e, a)}
          onDragLeave={handleDragLeave}
          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${isSub ? "ml-6 sm:ml-8 " : ""}bg-white dark:bg-cosplay-card rounded-lg border border-gray-200 dark:border-cosplay-border p-3 hover:border-pink-500/30 transition-shadow`}
        >
          <div
            draggable
            onDragStart={(e) => handleDragStart(e, a)}
            onDragEnd={handleDragEnd}
            className="flex items-center gap-2 min-w-0 flex-1 cursor-grab active:cursor-grabbing touch-none"
            title="Kéo để đổi thứ tự"
          >
            <span className="shrink-0 text-gray-400 dark:text-slate-500 select-none" aria-hidden="true">⋮⋮</span>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm sm:text-base text-gray-800 dark:text-slate-200 truncate">{a.title}</h3>
            {a.description && (
              <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-500 truncate max-w-full sm:max-w-md">{a.description}</p>
            )}
          </div>
          </div>
          <div className="flex gap-2 flex-wrap shrink-0">
            {!isSub && (
              <button
                onClick={() => { setShowForm(false); setSubParent(a) }}
                className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-cosplay-border text-gray-600 dark:text-slate-400 hover:text-pink-500 dark:hover:text-pink-400 hover:border-pink-500/50"
              >
                + Album con
              </button>
            )}
            <button
              onClick={() => setSelected(selected?.id === a.id ? null : a)}
              className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-cosplay-border text-gray-600 dark:text-slate-400 hover:text-pink-500 dark:hover:text-pink-400 hover:border-pink-500/50"
            >
              {selected?.id === a.id ? "Đóng" : "Quản lý ảnh"}
            </button>
            <button
              onClick={() => setEditing(a)}
              className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-cosplay-border text-gray-600 dark:text-slate-400 hover:text-pink-500 dark:hover:text-pink-400 hover:border-pink-500/50"
            >
              Sửa
            </button>
            <button
              onClick={() => deleteAlbum(a)}
              className="px-3 py-1 text-sm rounded border border-red-500/50 text-red-400 hover:bg-red-500/10"
            >
              Xóa
            </button>
          </div>
        </div>
  )

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-slate-100">Quản lý Albums</h2>
        <button
          onClick={() => { setSubParent(null); setShowForm(true) }}
          className="px-4 py-2 rounded-md bg-pink-500 text-white text-sm font-medium hover:bg-pink-400 w-full sm:w-auto"
        >
          + Thêm album
        </button>
      </div>

      {showForm && (
        <AdminAlbumForm
          onSave={(t, d) => createAlbum(t, d)}
          onCancel={() => setShowForm(false)}
          title="Tạo album mới"
        />
      )}

      {subParent && (
        <AdminAlbumForm
          onSave={(title, desc) => createAlbum(title, desc, subParent.id)}
          onCancel={() => setSubParent(null)}
          title={`Tạo album con trong: ${subParent.title}`}
        />
      )}

      {editing && (
        <AdminAlbumForm
          album={editing}
          onSave={(title, desc) => updateAlbum(editing.id, title, desc)}
          onCancel={() => setEditing(null)}
          title="Sửa album"
        />
      )}

      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      <p className="text-sm text-gray-500 dark:text-slate-400 mb-2">Kéo thả album để đổi thứ tự.</p>
      {reorderPending && (
        <p className="text-sm text-pink-500 dark:text-pink-400 mb-2">Đang lưu thứ tự...</p>
      )}
      <div className="space-y-2 mb-6 sm:mb-8">
        {buildAlbumTree(albums).map((p) => (
          <div key={p.id} className="space-y-2">
            {renderRow(p, { isSub: false })}
            {p.children.map((c) => renderRow(c, { isSub: true }))}
          </div>
        ))}
      </div>

      {selected && <AdminAlbumImages album={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
