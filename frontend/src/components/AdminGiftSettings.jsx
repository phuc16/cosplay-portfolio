import { useEffect, useState } from "react"
import { adminGetGiftSettings, adminSaveGiftSettings, adminUploadImage } from "../api/shop"

const blank = {
  enabled: false, name: "", image_url: null, min_total: 0, note: "", delivery_link: "",
}

export default function AdminGiftSettings() {
  const [settings, setSettings] = useState(blank)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)

  const reload = () => adminGetGiftSettings().then((s) => setSettings({ ...blank, ...s }))

  useEffect(() => { reload().catch(() => {}) }, [])

  const set = (key, value) => { setSettings((s) => ({ ...s, [key]: value })); setSaved(false) }

  const uploadPicture = async (file) => {
    if (!file) return
    setError("")
    setUploading(true)
    try {
      const { url } = await adminUploadImage(file, "gifts")
      set("image_url", url)
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Tải ảnh lên thất bại")
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    setError("")
    setSaved(false)
    try {
      // The API is the single source of truth for validity - no client-side
      // rule duplication, whatever it rejects is shown verbatim.
      await adminSaveGiftSettings({ ...settings, min_total: Number(settings.min_total) || 0 })
      setSaved(true)
      await reload()
    } catch (e) {
      setError(e.response?.data?.message || "Lưu cấu hình thất bại")
    }
  }

  return (
    <div className="max-w-xl mt-8">
      <h3 className="text-xl font-semibold mb-4">🎁 Quà tặng miễn phí</h3>

      {error && <p className="text-red-500 mb-3">{error}</p>}
      {saved && <p className="text-green-600 mb-3">Đã lưu.</p>}

      <div className="p-3 rounded-xl border border-[var(--border-brand)]">
        <label className="flex items-center gap-2 mb-3">
          <input type="checkbox" checked={settings.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          <span className="font-medium">Bật quà tặng cho đơn đạt mức tối thiểu</span>
        </label>

        {settings.enabled && (
          <>
            <label className="block mb-2">
              <span className="block text-sm mb-1 opacity-70">Tên quà tặng</span>
              <input
                type="text"
                value={settings.name}
                onChange={(e) => set("name", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
              />
            </label>

            <label className="block mb-2">
              <span className="block text-sm mb-1 opacity-70">Mức đơn tối thiểu (VND)</span>
              <input
                type="number" min="0"
                value={settings.min_total}
                onChange={(e) => set("min_total", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
              />
            </label>

            <label className="block mb-2">
              <span className="block text-sm mb-1 opacity-70">Ảnh quà tặng</span>
              {settings.image_url && (
                <img src={settings.image_url} alt="Quà tặng" className="w-24 h-24 object-cover rounded-lg border border-[var(--border-brand)] mb-2" />
              )}
              <input type="file" accept="image/*" disabled={uploading}
                onChange={(e) => uploadPicture(e.target.files?.[0])} />
            </label>

            <label className="block mb-2">
              <span className="block text-sm mb-1 opacity-70">Ghi chú cho khách (tùy chọn)</span>
              <textarea value={settings.note || ""} onChange={(e) => set("note", e.target.value)} rows={2}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent" />
            </label>

            <label className="block mb-2">
              <span className="block text-sm mb-1 opacity-70">
                Link tải về (nếu quà tặng là sản phẩm số - để trống nếu là quà vật lý)
              </span>
              <input
                type="text"
                value={settings.delivery_link || ""}
                onChange={(e) => set("delivery_link", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
              />
            </label>
          </>
        )}
      </div>

      <button type="button" onClick={save}
        className="mt-4 px-4 py-2 rounded-lg bg-[var(--brand)] text-white">
        Lưu cấu hình
      </button>
    </div>
  )
}
