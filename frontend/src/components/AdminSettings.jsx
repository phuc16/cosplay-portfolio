import { useState, useEffect } from "react"
import axios from "axios"

const DEFAULT = {
  artistName: "",
  tagline: "",
  about: "",
  hero: {
    subtitle: "",
    description: "",
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

export default function AdminSettings() {
  const [config, setConfig] = useState(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState("")

  useEffect(() => {
    axios
      .get("/api/settings")
      .then((r) => setConfig(r.data))
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

  const removeItem = (arrKey, idx) => {
    setConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev))
      const arr = (getArr(next, arrKey) || []).filter((_, i) => i !== idx)
      setArr(next, arrKey, arr)
      return next
    })
  }

  const setInfoList = (str) => {
    const arr = str.split("\n").filter(Boolean)
    setConfig((prev) => ({
      ...prev,
      contact: { ...prev.contact, info: arr },
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
        <h3 className="font-medium text-gray-800 dark:text-slate-200">Thông tin chính</h3>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Tên hiển thị</label>
          <input
            type="text"
            value={config.artistName || ""}
            onChange={(e) => update("artistName", e.target.value)}
            className="w-full border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
            placeholder="Kamidayhehe Cosplay"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Tagline</label>
          <input
            type="text"
            value={config.tagline || ""}
            onChange={(e) => update("tagline", e.target.value)}
            className="w-full border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
            placeholder="Cosplayer • Prop Maker • Photographer Friend"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">About (giới thiệu)</label>
          <textarea
            value={config.about || ""}
            onChange={(e) => update("about", e.target.value)}
            className="w-full border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
            rows={4}
          />
        </div>
      </div>

      <div className="bg-white dark:bg-cosplay-card border border-gray-200 dark:border-cosplay-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-gray-800 dark:text-slate-200">Hero (page header)</h3>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Subtitle</label>
          <input
            type="text"
            value={config.hero?.subtitle || ""}
            onChange={(e) => update("hero", { ...config.hero, subtitle: e.target.value })}
            className="w-full border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
            placeholder="Cosplay portfolio & highlights"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Description</label>
          <textarea
            value={config.hero?.description || ""}
            onChange={(e) => update("hero", { ...config.hero, description: e.target.value })}
            className="w-full border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
            rows={2}
          />
        </div>
      </div>

      <div className="bg-white dark:bg-cosplay-card border border-gray-200 dark:border-cosplay-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-gray-800 dark:text-slate-200">Sự kiện sắp tới</h3>
        <p className="text-xs text-gray-500 dark:text-slate-500">Hệ thống tự đếm và hiển thị. Mỗi sự kiện: tên, ngày, link (tùy chọn).</p>
        {(config.upcomingEvents || []).map((ev, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              type="text"
              value={ev.title || ""}
              onChange={(e) => updateItem("upcomingEvents", i, "title", e.target.value)}
              className="flex-1 border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              placeholder="Event title"
            />
            <input
              type="text"
              value={ev.date || ""}
              onChange={(e) => updateItem("upcomingEvents", i, "date", e.target.value)}
              className="w-32 border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              placeholder="Date (e.g. 15/03)"
            />
            <input
              type="url"
              value={ev.url || ""}
              onChange={(e) => updateItem("upcomingEvents", i, "url", e.target.value)}
              className="flex-1 border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
              placeholder="Link (optional)"
            />
            <button
              type="button"
              onClick={() => removeItem("upcomingEvents", i)}
              className="text-red-400 hover:text-red-300"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => addItem("upcomingEvents", { title: "", date: "", url: "" })}
          className="text-sm text-pink-500 dark:text-pink-400 hover:text-pink-600 dark:hover:text-pink-300"
        >
          + Add event
        </button>
      </div>

      <div className="bg-white dark:bg-cosplay-card border border-gray-200 dark:border-cosplay-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-gray-800 dark:text-slate-200">Contact</h3>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Phone (for Zalo)</label>
          <input
            type="tel"
            value={config.contact?.phone ?? config.contact?.email ?? ""}
            onChange={(e) => update("contact", { ...config.contact, phone: e.target.value })}
            className="w-full border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
            placeholder="0901234567"
          />
          <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">Enter phone number for Zalo message link (zalo.me/phone)</p>
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-slate-400 mb-1">Quick info (one item per line)</label>
          <textarea
            value={(config.contact?.info || []).join("\n")}
            onChange={(e) => setInfoList(e.target.value)}
            className="w-full border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200"
            rows={3}
            placeholder="Costumes: self-made / commission&#10;Photography: available"
          />
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
