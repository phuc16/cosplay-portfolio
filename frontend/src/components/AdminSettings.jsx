import { useState, useEffect } from "react"
import axios from "axios"
import { useDropzone } from "react-dropzone"
import { toLocalizedObj } from "../utils/localize"

function EventImageUpload({ imageUrl, onUpload, onRemove }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const onDrop = (files) => {
    if (!files[0]) return
    setError("")
    setUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(",")[1]
      axios
        .post("/api/upload/event-image", { base64 })
        .then((r) => onUpload(r.data.url))
        .catch((err) => setError(err.response?.data?.message || "Upload thất bại"))
        .finally(() => setUploading(false))
    }
    reader.readAsDataURL(files[0])
  }
  const { getRootProps, getInputProps } = useDropzone({ onDrop, accept: { "image/*": [] }, disabled: uploading, maxFiles: 1 })
  return (
    <div>
      <div
        {...getRootProps()}
        className="border-2 border-dashed border-gray-300 dark:border-cosplay-border rounded-lg p-3 text-center cursor-pointer hover:border-pink-500/50 min-h-[80px] flex flex-col items-center justify-center"
      >
        <input {...getInputProps()} />
        {imageUrl ? (
          <img src={imageUrl} alt="" className="max-h-20 object-cover rounded" />
        ) : (
          <span className="text-xs text-gray-500 dark:text-slate-400">{uploading ? "Đang tải..." : "Thêm ảnh (1 ảnh)"}</span>
        )}
      </div>
      {imageUrl && <button type="button" onClick={onRemove} className="mt-1 text-xs text-red-400 hover:text-red-300">Xóa ảnh</button>}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}

const DEFAULT = {
  heroImageUrl: "",
  thumbnailImageUrl: "",
  artistName: { vi: "", en: "" },
  tagline: { vi: "", en: "" },
  about: { vi: "", en: "" },
  hero: {
    subtitle: { vi: "", en: "" },
    description: { vi: "", en: "" },
  },
  upcomingEvents: [],
  contact: {
    phone: "",
    email: "",
    contactLinks: [],
    social: [],
    supports: {
      gumroad: "",
      gank: "",
      paypal: "",
    },
  },
}

function normalizeConfig(raw) {
  if (!raw) return DEFAULT
  return {
    ...DEFAULT,
    ...raw,
    heroImageUrl: raw.heroImageUrl ?? "",
    thumbnailImageUrl: raw.thumbnailImageUrl ?? "",
    artistName: toLocalizedObj(raw.artistName),
    tagline: toLocalizedObj(raw.tagline),
    about: toLocalizedObj(raw.about),
    hero: {
      subtitle: toLocalizedObj(raw.hero?.subtitle),
      description: toLocalizedObj(raw.hero?.description),
    },
    upcomingEvents: (raw.upcomingEvents || []).map((ev) => ({
      ...ev,
      title: toLocalizedObj(ev.title),
      showPopup: !!ev.showPopup,
      imageUrl: ev.imageUrl ?? "",
    })),
    contact: {
      ...raw.contact,
      phone: raw.contact?.phone ?? "",
      email: raw.contact?.email ?? "",
      contactLinks: Array.isArray(raw.contact?.contactLinks)
        ? raw.contact.contactLinks.map((item) => ({ type: item.type || "zalo", value: item.value || "" }))
        : Array.isArray(raw.contact?.info) ? [] : [],
      social: raw.contact?.social ?? [],
      supports: raw.contact?.supports ?? { gumroad: "", gank: "", paypal: "" },
    },
  }
}

export default function AdminSettings() {
  const [config, setConfig] = useState(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState("")

  useEffect(() => {
    axios
      .get("/api/settings")
      .then((r) => setConfig(normalizeConfig(r.data)))
      .catch(() => setConfig(DEFAULT))
      .finally(() => setLoading(false))
  }, [])

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMsg("")
    try {
      await axios.put("/api/settings", config)
      setMsg("Saved!")
    } catch (err) {
      setMsg(err.response?.data?.message || "Error saving")
    } finally {
      setSaving(false)
    }
  }

  const update = (path, value) => {
    setConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev))
      if (path.includes(".")) {
        const [a, b, c] = path.split(".")
        if (c) next[a][b][c] = value
        else next[a][b] = value
      } else next[path] = value
      return next
    })
  }

  const getArr = (prev, arrKey) => {
    const [a, b] = arrKey.split(".")
    return b ? prev[a]?.[b] : prev[a]
  }
  const setArr = (next, arrKey, val) => {
    const [a, b] = arrKey.split(".")
    if (b) next[a][b] = val
    else next[a] = val
  }

  const addItem = (arrKey, item) => {
    setConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev))
      const arr = getArr(next, arrKey) || []
      const defaultItem = arrKey.includes("supports") || arrKey.includes("social")
        ? { label: "", url: "" }
        : { title: "", date: "", url: "" }
      setArr(next, arrKey, [...arr, typeof item === "object" ? item : defaultItem])
      return next
    })
  }

  const updateItem = (arrKey, idx, field, value) => {
    setConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev))
      const arr = getArr(next, arrKey) || []
      arr[idx] = { ...arr[idx], [field]: value }
      setArr(next, arrKey, arr)
      return next
    })
  }

  const updateLocalized = (path, lang, value) => {
    setConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev))
      const parts = path.split(".")
      let target = next
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i]
        if (!target[p] || typeof target[p] !== "object") target[p] = {}
        target = target[p]
      }
      const key = parts[parts.length - 1]
      const current = target[key]
      target[key] = toLocalizedObj(current)
      target[key][lang] = value
      return next
    })
  }

  const removeItem = (arrKey, idx) => {
    setConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev))
      const arr = (getArr(next, arrKey) || []).filter((_, i) => i !== idx)
      setArr(next, arrKey, arr)
      return next
    })
  }

  const [heroUploading, setHeroUploading] = useState(false)
  const [heroUploadError, setHeroUploadError] = useState("")

  const onHeroDrop = (files) => {
    if (!files[0]) return
    setHeroUploadError("")
    setHeroUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(",")[1]
      axios
        .post("/api/upload/hero", { base64 })
        .then((r) => {
          update("heroImageUrl", r.data.url)
        })
        .catch((err) => {
          setHeroUploadError(err.response?.data?.message || err.message || "Upload thất bại")
        })
        .finally(() => setHeroUploading(false))
    }
    reader.readAsDataURL(files[0])
  }
  const heroDropzone = useDropzone({ onDrop: onHeroDrop, accept: { "image/*": [] }, disabled: heroUploading, maxFiles: 1 })

  const [thumbnailUploading, setThumbnailUploading] = useState(false)
  const [thumbnailUploadError, setThumbnailUploadError] = useState("")
  const onThumbnailDrop = (files) => {
    if (!files[0]) return
    setThumbnailUploadError("")
    setThumbnailUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(",")[1]
      axios
        .post("/api/upload/thumbnail", { base64 })
        .then((r) => {
          update("thumbnailImageUrl", r.data.url)
        })
        .catch((err) => {
          setThumbnailUploadError(err.response?.data?.message || err.message || "Upload thất bại")
        })
        .finally(() => setThumbnailUploading(false))
    }
    reader.readAsDataURL(files[0])
  }
  const thumbnailDropzone = useDropzone({ onDrop: onThumbnailDrop, accept: { "image/*": [] }, disabled: thumbnailUploading, maxFiles: 1 })

  if (loading) return <p className="text-gray-500 dark:text-slate-500 p-4">Đang tải...</p>

  return (
    <form onSubmit={save} className="max-w-2xl space-y-4 sm:space-y-6 p-3 sm:p-4 md:p-8">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Cài đặt trang</h2>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-md bg-pink-500 text-white text-sm font-medium hover:bg-pink-400 disabled:opacity-50"
        >
          {saving ? "Đang lưu..." : "Lưu"}
        </button>
      </div>
      {msg && <p className="text-sm text-pink-500 dark:text-pink-400">{msg}</p>}

      <div className="bg-white dark:bg-cosplay-card border border-gray-200 dark:border-cosplay-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-gray-800 dark:text-slate-200">Thông tin chính (vi / en)</h3>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Tên hiển thị</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={config.artistName?.vi ?? ""}
              onChange={(e) => updateLocalized("artistName", "vi", e.target.value)}
              className="border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              placeholder="Kamidayhehe (VI)"
            />
            <input
              type="text"
              value={config.artistName?.en ?? ""}
              onChange={(e) => updateLocalized("artistName", "en", e.target.value)}
              className="border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              placeholder="Kamidayhehe (EN)"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Tagline (có thể xuống dòng)</label>
          <div className="grid grid-cols-2 gap-2">
            <textarea
              value={config.tagline?.vi ?? ""}
              onChange={(e) => updateLocalized("tagline", "vi", e.target.value)}
              className="border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200 resize-y"
              rows={3}
              placeholder="Cosplayer • Prop Maker (VI)"
            />
            <textarea
              value={config.tagline?.en ?? ""}
              onChange={(e) => updateLocalized("tagline", "en", e.target.value)}
              className="border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200 resize-y"
              rows={3}
              placeholder="Cosplayer • Prop Maker (EN)"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">About (giới thiệu)</label>
          <div className="grid grid-cols-2 gap-2">
            <textarea
              value={config.about?.vi ?? ""}
              onChange={(e) => updateLocalized("about", "vi", e.target.value)}
              className="border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              rows={4}
              placeholder="Giới thiệu (VI)"
            />
            <textarea
              value={config.about?.en ?? ""}
              onChange={(e) => updateLocalized("about", "en", e.target.value)}
              className="border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              rows={4}
              placeholder="About (EN)"
            />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-cosplay-card border border-gray-200 dark:border-cosplay-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-gray-800 dark:text-slate-200">Hero (page header)</h3>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Ảnh About & logo</label>
          <p className="text-xs text-gray-500 dark:text-slate-500 mb-2">Dùng cho khu About, logo navbar, favicon. Có thể dùng ảnh dọc.</p>
          <div
            {...heroDropzone.getRootProps()}
            className="border-2 border-dashed border-gray-300 dark:border-cosplay-border rounded-lg p-4 sm:p-6 text-center cursor-pointer hover:border-pink-500/50 hover:bg-pink-500/5 min-h-[120px] flex flex-col items-center justify-center"
          >
            <input {...heroDropzone.getInputProps()} />
            {config.heroImageUrl ? (
              <div className="relative">
                <img src={config.heroImageUrl} alt="Hero" className="max-h-32 object-cover rounded-lg mx-auto" />
                <p className="text-xs text-gray-500 dark:text-slate-500 mt-2">Click để thay ảnh</p>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {heroUploading ? "Đang tải..." : "Chưa có ảnh - Click hoặc kéo thả ảnh"}
              </p>
            )}
          </div>
          {config.heroImageUrl && (
            <button
              type="button"
              onClick={() => update("heroImageUrl", "")}
              className="mt-2 text-sm text-red-400 hover:text-red-300"
            >
              Xóa ảnh
            </button>
          )}
          {heroUploadError && <p className="mt-2 text-sm text-red-400">{heroUploadError}</p>}
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Ảnh khu Hero (ảnh ngang)</label>
          <p className="text-xs text-gray-500 dark:text-slate-500 mb-2">Ảnh lớn bên phải trong card Hero. Nên dùng ảnh ngang, khác ảnh About. Cũng dùng khi share link.</p>
          <div
            {...thumbnailDropzone.getRootProps()}
            className="border-2 border-dashed border-gray-300 dark:border-cosplay-border rounded-lg p-4 sm:p-6 text-center cursor-pointer hover:border-pink-500/50 hover:bg-pink-500/5 min-h-[100px] flex flex-col items-center justify-center"
          >
            <input {...thumbnailDropzone.getInputProps()} />
            {config.thumbnailImageUrl ? (
              <div className="relative">
                <img src={config.thumbnailImageUrl} alt="Thumbnail" className="max-h-24 object-cover rounded-lg mx-auto" />
                <p className="text-xs text-gray-500 dark:text-slate-500 mt-2">Click để thay ảnh</p>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {thumbnailUploading ? "Đang tải..." : "Chưa có ảnh - Click hoặc kéo thả (ảnh ngang cho Hero)"}
              </p>
            )}
          </div>
          {config.thumbnailImageUrl && (
            <button
              type="button"
              onClick={() => update("thumbnailImageUrl", "")}
              className="mt-2 text-sm text-red-400 hover:text-red-300"
            >
              Xóa ảnh Hero
            </button>
          )}
          {thumbnailUploadError && <p className="mt-2 text-sm text-red-400">{thumbnailUploadError}</p>}
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Subtitle</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={config.hero?.subtitle?.vi ?? ""}
              onChange={(e) => updateLocalized("hero.subtitle", "vi", e.target.value)}
              className="border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              placeholder="Subtitle (VI)"
            />
            <input
              type="text"
              value={config.hero?.subtitle?.en ?? ""}
              onChange={(e) => updateLocalized("hero.subtitle", "en", e.target.value)}
              className="border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              placeholder="Subtitle (EN)"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Description</label>
          <div className="grid grid-cols-2 gap-2">
            <textarea
              value={config.hero?.description?.vi ?? ""}
              onChange={(e) => updateLocalized("hero.description", "vi", e.target.value)}
              className="border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              rows={2}
              placeholder="Mô tả (VI)"
            />
            <textarea
              value={config.hero?.description?.en ?? ""}
              onChange={(e) => updateLocalized("hero.description", "en", e.target.value)}
              className="border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              rows={2}
              placeholder="Description (EN)"
            />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-cosplay-card border border-gray-200 dark:border-cosplay-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-gray-800 dark:text-slate-200">Sự kiện sắp tới</h3>
        <p className="text-xs text-gray-500 dark:text-slate-500">Mỗi sự kiện: tên (vi/en), ngày, link (tùy chọn). Tick 1 sự kiện để hiện popup thông báo khi mở trang.</p>
        {(config.upcomingEvents || []).map((ev, i) => (
          <div key={i} className="flex flex-col gap-2 p-2 border border-gray-200 dark:border-cosplay-border rounded-md">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!ev.showPopup}
                  onChange={(e) => {
                    setConfig((prev) => {
                      const next = JSON.parse(JSON.stringify(prev))
                      const arr = (next.upcomingEvents || []).map((evt, j) => ({
                        ...evt,
                        showPopup: j === i ? e.target.checked : false,
                      }))
                      next.upcomingEvents = arr
                      return next
                    })
                  }}
                  className="rounded border-gray-300 dark:border-cosplay-border text-pink-500"
                />
                Hiển thị popup khi mở trang
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={ev.title?.vi ?? ""}
                onChange={(e) => updateItem("upcomingEvents", i, "title", { ...toLocalizedObj(ev.title), vi: e.target.value })}
                className="border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
                placeholder="Tên sự kiện (VI)"
              />
              <input
                type="text"
                value={ev.title?.en ?? ""}
                onChange={(e) => updateItem("upcomingEvents", i, "title", { ...toLocalizedObj(ev.title), en: e.target.value })}
                className="border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
                placeholder="Event title (EN)"
              />
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={ev.date || ""}
                onChange={(e) => updateItem("upcomingEvents", i, "date", e.target.value)}
                className="w-32 border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
                placeholder="Ngày (15/03)"
              />
              <input
                type="url"
                value={ev.url || ""}
                onChange={(e) => updateItem("upcomingEvents", i, "url", e.target.value)}
                className="flex-1 border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
                placeholder="Link (optional)"
              />
              <button type="button" onClick={() => removeItem("upcomingEvents", i)} className="text-red-400 hover:text-red-300">×</button>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-slate-500 mb-1">Ảnh sự kiện (1 ảnh, hiện trong popup)</label>
              <EventImageUpload
                imageUrl={ev.imageUrl ?? ""}
                onUpload={(url) => updateItem("upcomingEvents", i, "imageUrl", url)}
                onRemove={() => updateItem("upcomingEvents", i, "imageUrl", "")}
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => addItem("upcomingEvents", { title: { vi: "", en: "" }, date: "", url: "", showPopup: false, imageUrl: "" })}
          className="text-sm text-pink-500 dark:text-pink-400 hover:text-pink-600 dark:hover:text-pink-300"
        >
          + Add event
        </button>
      </div>

      <div className="bg-white dark:bg-cosplay-card border border-gray-200 dark:border-cosplay-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-gray-800 dark:text-slate-200">Contact</h3>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Số điện thoại</label>
          <input
            type="tel"
            value={config.contact?.phone ?? ""}
            onChange={(e) => update("contact", { ...config.contact, phone: e.target.value })}
            className="w-full border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
            placeholder="0901234567"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Email</label>
          <input
            type="email"
            value={config.contact?.email ?? ""}
            onChange={(e) => update("contact", { ...config.contact, email: e.target.value })}
            className="w-full border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
            placeholder="email@example.com"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Thông tin liên hệ (Zalo, WhatsApp, Gmail)</label>
          <p className="text-xs text-gray-500 dark:text-slate-500 mb-2">Mỗi mục: chọn loại và nhập SĐT (Zalo/WhatsApp) hoặc email (Gmail). Click sẽ mở Zalo/WhatsApp hoặc Gmail.</p>
          {(config.contact?.contactLinks || []).map((item, i) => (
            <div key={i} className="flex gap-2 items-center mb-2 flex-wrap">
              <select
                value={item?.type ?? "zalo"}
                onChange={(e) => updateItem("contact.contactLinks", i, "type", e.target.value)}
                className="w-28 border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              >
                <option value="zalo">Zalo</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="gmail">Gmail</option>
              </select>
              <input
                type={item?.type === "gmail" ? "email" : "tel"}
                value={item?.value ?? ""}
                onChange={(e) => updateItem("contact.contactLinks", i, "value", e.target.value)}
                className="flex-1 min-w-[140px] border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
                placeholder={item?.type === "gmail" ? "email@gmail.com" : "0901234567"}
              />
              <button type="button" onClick={() => removeItem("contact.contactLinks", i)} className="text-red-400 hover:text-red-300 shrink-0">×</button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => addItem("contact.contactLinks", { type: "zalo", value: "" })}
            className="text-sm text-pink-500 dark:text-pink-400 hover:text-pink-600 dark:hover:text-pink-300"
          >
            + Thêm liên hệ
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-cosplay-card border border-gray-200 dark:border-cosplay-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-gray-800 dark:text-slate-200">Social links</h3>
        <p className="text-xs text-gray-500 dark:text-slate-500">Instagram, Facebook, X, TikTok, Gank, Gumroad, PayPal.</p>
        {(config.contact?.social || []).map((s, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select
              value={s.label || ""}
              onChange={(e) => updateItem("contact.social", i, "label", e.target.value)}
              className="w-32 border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
            >
              <option value="">Chọn nền tảng</option>
              <option value="Instagram">Instagram</option>
              <option value="Facebook">Facebook</option>
              <option value="X">X</option>
              <option value="TikTok">TikTok</option>
              <option value="Gank">Gank</option>
              <option value="Gumroad">Gumroad</option>
              <option value="PayPal">PayPal</option>
            </select>
            <input
              type="url"
              value={s.url || ""}
              onChange={(e) => updateItem("contact.social", i, "url", e.target.value)}
              className="flex-1 border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              placeholder="https://..."
            />
            <button
              type="button"
              onClick={() => removeItem("contact.social", i)}
              className="text-red-400 hover:text-red-300"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => addItem("contact.social", { label: "", url: "" })}
          className="text-sm text-pink-500 dark:text-pink-400 hover:text-pink-600 dark:hover:text-pink-300"
        >
          + Thêm social
        </button>
      </div>

      <div className="bg-white dark:bg-cosplay-card border border-gray-200 dark:border-cosplay-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-gray-800 dark:text-slate-200">Supports (Gumroad, Gank, PayPal)</h3>
        <p className="text-xs text-gray-500 dark:text-slate-500">Điền URL cho từng kênh. Để trống để ẩn.</p>
        {["gumroad", "gank", "paypal"].map((key) => (
          <div key={key} className="flex gap-2 items-center">
            <label className="w-24 text-sm text-gray-600 dark:text-slate-400 capitalize">{key}</label>
            <input
              type="url"
              value={(typeof config.contact?.supports === "object" ? config.contact.supports[key] : "") || ""}
              onChange={(e) =>
                update("contact", {
                  ...config.contact,
                  supports: {
                    gumroad: config.contact?.supports?.gumroad ?? "",
                    gank: config.contact?.supports?.gank ?? "",
                    paypal: config.contact?.supports?.paypal ?? "",
                    [key]: e.target.value,
                  },
                })
              }
              className="flex-1 border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              placeholder={`https://${key}.com/...`}
            />
          </div>
        ))}
      </div>
    </form>
  )
}
