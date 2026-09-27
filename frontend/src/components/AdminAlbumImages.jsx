import { useState, useEffect } from "react"
import { api } from "../api/api"
import { uploadImage } from "../api/upload"
import { useDropzone } from "react-dropzone"

export default function AdminAlbumImages({ album, onClose }) {
  const [gallery, setGallery] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploadError, setUploadError] = useState("")
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [draggedId, setDraggedId] = useState(null)
  const [reorderPending, setReorderPending] = useState(false)
  const [pairError, setPairError] = useState("")
  const [pairingId, setPairingId] = useState(null)

  const fetchGallery = () => {
    api.get("/api/gallery").then((r) => {
      const g = r.data.find((x) => x.id === album.id)
      setGallery(g?.items || [])
    }).finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchGallery()
  }, [album.id])

  const onDrop = (files) => {
    if (!files.length) return
    setUploadError("")
    setUploading(true)
    Promise.all(
      files.map((f) =>
        uploadImage("/api/image", f, { album_id: album.id }).catch((err) => {
          const msg = err.response?.data?.message || err.message || "Upload thất bại"
          setUploadError(msg)
        })
      )
    )
      .then(() => fetchGallery())
      .finally(() => setUploading(false))
  }

  const { getRootProps, getInputProps } = useDropzone({ onDrop, accept: { "image/*": [] }, disabled: uploading })

  const deleteImage = (id) => {
    if (!confirm("Xóa ảnh này?")) return
    setError("")
    api.delete(`/api/image/${id}`).then(fetchGallery).catch((err) => {
      setError(err.response?.data?.message || "Xóa ảnh thất bại")
    })
  }

  const handleDragStart = (e, img) => {
    setDraggedId(img.id)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", String(img.id))
    e.target.classList.add("opacity-50", "ring-2", "ring-pink-500")
  }

  const handleDragEnd = (e) => {
    e.target.classList.remove("opacity-50", "ring-2", "ring-pink-500")
    setDraggedId(null)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }

  const handleDrop = (e, targetImg) => {
    e.preventDefault()
    e.target.classList.remove("ring-2", "ring-pink-400")
    const fromId = draggedId
    if (fromId == null || fromId === targetImg.id) return
    const fromIdx = gallery.findIndex((i) => i.id === fromId)
    const toIdx = gallery.findIndex((i) => i.id === targetImg.id)
    if (fromIdx === -1 || toIdx === -1) return
    const next = [...gallery]
    const [removed] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, removed)
    setGallery(next)
    setDraggedId(null)
    setReorderPending(true)
    api
      .put(`/api/albums/${album.id}/images/reorder`, { imageIds: next.map((i) => i.id) })
      .then(() => setReorderPending(false))
      .catch(() => {
        setReorderPending(false)
        fetchGallery()
      })
  }

  // pairedImageId null clears this image's (and its old partner's) pairing;
  // a number sets this image as "before" and that one as "after" - see
  // PUT /api/images/:id/pair (server.js) for the symmetric write + the
  // stale-old-partner cleanup this relies on.
  const setPair = (imageId, pairedImageId) => {
    setPairError("")
    setPairingId(imageId)
    api
      .put(`/api/images/${imageId}/pair`, { pairedImageId })
      .then(fetchGallery)
      .catch((err) => setPairError(err.response?.data?.message || "Không ghép được ảnh"))
      .finally(() => setPairingId(null))
  }

  const handleDragEnter = (e, img) => {
    if (draggedId && img.id !== draggedId) e.currentTarget.classList.add("ring-2", "ring-pink-400")
  }

  const handleDragLeave = (e) => {
    e.currentTarget.classList.remove("ring-2", "ring-pink-400")
  }

  return (
    <div className="bg-white dark:bg-cosplay-card rounded-lg sm:rounded-xl border border-gray-200 dark:border-cosplay-border p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
        <h3 className="font-bold text-base sm:text-lg text-gray-900 dark:text-slate-100 truncate max-w-full">Ảnh trong: {album.title}</h3>
        <button onClick={onClose} className="text-gray-500 dark:text-slate-500 hover:text-pink-500 dark:hover:text-pink-400">
          ✕ Đóng
        </button>
      </div>

      <div
        {...getRootProps()}
        className="border-2 border-dashed border-gray-300 dark:border-cosplay-border rounded-lg p-4 sm:p-6 md:p-8 text-center cursor-pointer hover:border-pink-500/50 hover:bg-pink-500/5 mb-4 sm:mb-6 text-sm sm:text-base text-gray-500 dark:text-slate-400"
      >
        <input {...getInputProps()} />
        <p>Kéo thả ảnh vào đây hoặc click để chọn (max 500MB)</p>
      </div>
      {uploadError && (
        <p className="mb-4 text-sm text-red-400">{uploadError}</p>
      )}
      {error && (
        <p className="mb-4 text-sm text-red-400">{error}</p>
      )}
      {pairError && (
        <p className="mb-4 text-sm text-red-400">{pairError}</p>
      )}

      {loading ? (
        <p className="text-gray-500 dark:text-slate-500">Loading...</p>
      ) : (
        <>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-2">Kéo thả ảnh để đổi thứ tự.</p>
          {reorderPending && (
            <p className="text-sm text-pink-500 dark:text-pink-400 mb-2">Đang lưu thứ tự...</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-4">
            {gallery.map((img) => (
              <div
                key={img.id}
                draggable
                onDragStart={(e) => handleDragStart(e, img)}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, img)}
                onDragEnter={(e) => handleDragEnter(e, img)}
                onDragLeave={handleDragLeave}
                className="relative group cursor-grab active:cursor-grabbing rounded-lg border border-gray-200 dark:border-cosplay-border transition-shadow"
              >
                <img
                  src={img.src || img.url}
                  alt=""
                  className="w-full h-24 sm:h-28 md:h-32 object-cover rounded-lg pointer-events-none"
                />
                {img.pairRole && (
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/65 text-white text-[10px] font-semibold">
                    {img.pairRole === "before" ? "Trước" : "Sau"}
                  </span>
                )}
                <button
                  onClick={() => deleteImage(img.id)}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-500 text-white text-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-red-600 z-10"
                >
                  ×
                </button>
                {/* Pairing is only ever driven from the "before" side - an
                    "after" image's partner is already set from its own row,
                    so showing a second picker here would let the two rows
                    disagree about who's paired with whom. */}
                {img.pairRole !== "after" && (
                  <select
                    value={img.pairImageId || ""}
                    disabled={pairingId === img.id}
                    onChange={(e) => setPair(img.id, e.target.value ? Number(e.target.value) : null)}
                    onMouseDown={(e) => e.stopPropagation()}
                    draggable={false}
                    className="mt-1 w-full text-xs rounded border border-gray-300 dark:border-cosplay-border bg-white dark:bg-cosplay-card text-gray-700 dark:text-slate-300 px-1 py-0.5"
                  >
                    <option value="">Ghép ảnh trước/sau...</option>
                    {gallery.filter((o) => o.id !== img.id && (o.id === img.pairImageId || o.pairRole !== "after")).map((o) => (
                      <option key={o.id} value={o.id}>Ghép với ảnh #{o.id}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
