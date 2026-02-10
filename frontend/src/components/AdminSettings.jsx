import { useState, useEffect } from "react"
import axios from "axios"
import { useDropzone } from "react-dropzone"
import { toLocalizedObj } from "../utils/localize"

const DEFAULT = {
  heroImageUrl: "",
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
    info: [],
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
    })),
    contact: {
      ...raw.contact,
      phone: raw.contact?.phone ?? "",
      info: Array.isArray(raw.contact?.info)
        ? raw.contact.info.map((item) => toLocalizedObj(item))
        : [],
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

  const updateInfoItem = (idx, lang, value) => {
    setConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev))
      const info = [...(next.contact?.info || [])]
      while (info.length <= idx) info.push({ vi: "", en: "" })
      info[idx] = toLocalizedObj(info[idx])
      info[idx][lang] = value
      next.contact = { ...next.contact, info }
      return next
    })
  }

  const addInfoItem = () => {
    setConfig((prev) => ({
      ...prev,
      contact: {
        ...prev.contact,
        info: [...(prev.contact?.info || []), { vi: "", en: "" }],
      },
    }))
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

  const removeInfoItem = (idx) => {
    setConfig((prev) => ({
      ...prev,
      contact: {
        ...prev.contact,
        info: (prev.contact?.info || []).filter((_, i) => i !== idx),
      },
    }))
  }

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
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Tagline</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={config.tagline?.vi ?? ""}
              onChange={(e) => updateLocalized("tagline", "vi", e.target.value)}
              className="border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              placeholder="Cosplayer • Prop Maker (VI)"
            />
            <input
              type="text"
              value={config.tagline?.en ?? ""}
              onChange={(e) => updateLocalized("tagline", "en", e.target.value)}
              className="border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
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
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Ảnh hero / profile</label>
          <p className="text-xs text-gray-500 dark:text-slate-500 mb-2">Click hoặc kéo thả ảnh để tải lên. Dùng cho hero và avatar About.</p>
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
        <p className="text-xs text-gray-500 dark:text-slate-500">Mỗi sự kiện: tên (vi/en), ngày, link (tùy chọn).</p>
        {(config.upcomingEvents || []).map((ev, i) => (
          <div key={i} className="flex flex-col gap-2 p-2 border border-gray-200 dark:border-cosplay-border rounded-md">
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
          </div>
        ))}
        <button
          type="button"
          onClick={() => addItem("upcomingEvents", { title: { vi: "", en: "" }, date: "", url: "" })}
          className="text-sm text-pink-500 dark:text-pink-400 hover:text-pink-600 dark:hover:text-pink-300"
        >
          + Add event
        </button>
      </div>

      <div className="bg-white dark:bg-cosplay-card border border-gray-200 dark:border-cosplay-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-gray-800 dark:text-slate-200">Contact</h3>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Số điện thoại (for Zalo)</label>
          <input
            type="tel"
            value={config.contact?.phone ?? ""}
            onChange={(e) => update("contact", { ...config.contact, phone: e.target.value })}
            className="w-full border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
            placeholder="0901234567"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Quick info (vi / en) – mỗi mục 1 dòng</label>
          {(config.contact?.info || []).map((item, i) => (
            <div key={i} className="flex gap-2 items-center mb-2">
              <input
                type="text"
                value={item?.vi ?? ""}
                onChange={(e) => updateInfoItem(i, "vi", e.target.value)}
                className="flex-1 border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
                placeholder="VI"
              />
              <input
                type="text"
                value={item?.en ?? ""}
                onChange={(e) => updateInfoItem(i, "en", e.target.value)}
                className="flex-1 border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
                placeholder="EN"
              />
              <button type="button" onClick={() => removeInfoItem(i)} className="text-red-400 hover:text-red-300 shrink-0">×</button>
            </div>
          ))}
          <button
            type="button"
            onClick={addInfoItem}
            className="text-sm text-pink-500 dark:text-pink-400 hover:text-pink-600 dark:hover:text-pink-300"
          >
            + Thêm mục
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-cosplay-card border border-gray-200 dark:border-cosplay-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-gray-800 dark:text-slate-200">Social links</h3>
        {(config.contact?.social || []).map((s, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              type="text"
              value={s.label || ""}
              onChange={(e) => updateItem("contact.social", i, "label", e.target.value)}
              className="flex-1 border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              placeholder="Instagram"
            />
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
