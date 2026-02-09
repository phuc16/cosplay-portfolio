import { useState, useEffect } from "react"
import axios from "axios"
import { useDropzone } from "react-dropzone"

export default function AdminAlbumImages({ album, onClose }) {
  const [gallery, setGallery] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploadError, setUploadError] = useState("")

  const fetchGallery = () => {
    axios.get("/api/gallery").then((r) => {
      const g = r.data.find((x) => x.id === album.id)
      setGallery(g?.items || [])
    }).finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchGallery()
  }, [album.id])

  const onDrop = (files) => {
    setUploadError("")
    files.forEach((f) => {
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = reader.result.split(",")[1]
        axios
          .post("/api/image", { album_id: album.id, base64 })
          .then(() => fetchGallery())
          .catch((err) => {
            const msg = err.response?.data?.message || err.message || "Upload thất bại"
            setUploadError(msg)
          })
      }
      reader.readAsDataURL(f)
    })
  }

  const { getRootProps, getInputProps } = useDropzone({ onDrop, accept: { "image/*": [] } })

  const deleteImage = (id) => {
    if (!confirm("Xóa ảnh này?")) return
    axios.delete(`/api/image/${id}`).then(fetchGallery)
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

      {loading ? (
        <p className="text-gray-500 dark:text-slate-500">Loading...</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-4">
          {gallery.map((img) => (
            <div key={img.id} className="relative group">
              <img
                src={img.src || img.url}
                alt=""
                className="w-full h-24 sm:h-28 md:h-32 object-cover rounded-lg border border-gray-200 dark:border-cosplay-border"
              />
              <button
                onClick={() => deleteImage(img.id)}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-500 text-white text-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
