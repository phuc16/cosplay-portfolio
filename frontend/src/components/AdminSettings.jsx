import { useState, useEffect, useRef, useCallback } from "react"
import { api } from "../api/api"
import { useDropzone } from "react-dropzone"
import { toLocalizedObj } from "../utils/localize"
import { COLOR_SCHEMES, applyColorScheme } from "../config"

/* ── Drag-drop image uploader ─────────────────────────────────────────────── */
function ImageUpload({ endpoint, imageUrl, onUpload, onRemove, label = "Kéo thả hoặc click để chọn ảnh", previewClass = "max-h-24" }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const onDrop = (files) => {
    if (!files[0]) return
    setError("")
    setUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(",")[1]
      api
        .post(endpoint, { base64 })
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
        className="border-2 border-dashed border-gray-300 dark:border-cosplay-border rounded-lg p-3 text-center cursor-pointer hover:border-pink-500/50 hover:bg-pink-500/5 min-h-[80px] flex flex-col items-center justify-center"
      >
        <input {...getInputProps()} />
        {imageUrl ? (
          <div className="flex flex-col items-center gap-1">
            <img src={imageUrl} alt="" className={`${previewClass} object-cover rounded`} />
            <p className="text-xs text-gray-500 dark:text-slate-500">Đổi ảnh</p>
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-slate-400">{uploading ? "Đang tải..." : label}</p>
        )}
      </div>
      {imageUrl && <button type="button" onClick={onRemove} className="mt-1 text-xs text-red-400 hover:text-red-300">Bỏ ảnh</button>}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}

/* ── Click-to-upload (no drag zone, render-prop) ─────────────────────────── */
function ClickUpload({ endpoint, onUrl, children }) {
  const ref = useRef(null)
  const [uploading, setUploading] = useState(false)
  const trigger = useCallback(() => { ref.current?.click() }, [])
  const handleChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(",")[1]
      api
        .post(endpoint, { base64 })
        .then((r) => onUrl(r.data.url))
        .catch(() => {})
        .finally(() => setUploading(false))
    }
    reader.readAsDataURL(file)
  }
  return (
    <>
      <input type="file" ref={ref} accept="image/*" style={{ display: "none" }} onChange={handleChange} />
      {
        // eslint-disable-next-line react-hooks/refs
        children(trigger, uploading)
      }
    </>
  )
}

/* ── Hero cover preview: drag to pan, wheel/buttons to zoom ──────────────── */
/* zoom = image height as a multiple of the card height; x/y = offsets in % of
   the preview box (the public hero uses the same formula, so WYSIWYG).
   One preview per breakpoint — box ratios mirror the real hero card:
   desktop 1216×500, tablet ~756×500, mobile ~358×300. cutTop = how far the
   cutout container rises above the card (-84px desktop/tablet, -18px mobile). */
const DEFAULT_COVER = { zoom: 4.5, x: 0, y: -30 }
const COVER_BREAKPOINTS = [
  { key: "desktop", label: "Desktop", w: 219, h: 90, cutTop: -16.8 },
  { key: "tablet",  label: "Tablet",  w: 136, h: 90, cutTop: -16.8 },
  { key: "mobile",  label: "Mobile",  w: 107, h: 90, cutTop: -6 },
]

function CoverPreview({ url, cover, onChange, box }) {
  const boxRef = useRef(null)
  const dragRef = useRef(null)
  const c = { ...DEFAULT_COVER, ...cover }
  const clampZoom = (z) => Math.min(8, Math.max(1, Math.round(z * 20) / 20))

  const onPointerDown = (e) => {
    e.preventDefault()
    const box = boxRef.current?.getBoundingClientRect()
    if (!box) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, x: c.x, y: c.y, w: box.width, h: box.height }
    const move = (ev) => {
      const d = dragRef.current
      if (!d) return
      onChange({
        x: Math.round((d.x + ((ev.clientX - d.sx) / d.w) * 100) * 10) / 10,
        y: Math.round((d.y + ((ev.clientY - d.sy) / d.h) * 100) * 10) / 10,
      })
    }
    const up = () => {
      dragRef.current = null
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  return (
    <div className="shrink-0 flex flex-col gap-1">
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onWheel={(e) => { e.preventDefault(); onChange({ zoom: clampZoom(c.zoom + (e.deltaY < 0 ? 0.2 : -0.2)) }) }}
        className="relative overflow-hidden rounded border border-gray-300 dark:border-cosplay-border cursor-grab active:cursor-grabbing select-none"
        style={{ width: box.w, height: box.h, background: "#080810", touchAction: "none" }}
        title="Kéo để dịch — lăn chuột hoặc dùng nút +/− để zoom"
      >
        <img
          src={url} alt="" draggable={false}
          className="absolute pointer-events-none max-w-none"
          style={{ height: `${c.zoom * 100}%`, width: "auto", top: `${c.y}%`, left: `${50 + c.x}%`, transform: "translateX(-50%)" }}
        />
        {/* The slideshow cutout, rendered where it really sits — anything under it is hidden on the live site */}
        <div className="absolute pointer-events-none overflow-hidden" style={{ right: 0, top: `${box.cutTop}%`, bottom: 0, width: "55%" }}>
          <img src={url} alt="" draggable={false} className="max-w-none pointer-events-none"
            style={{ width: "100%", height: "auto", maskImage: "linear-gradient(to bottom, black 65%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, black 65%, transparent 100%)" }} />
        </div>
        <span className="absolute bottom-0.5 left-1 text-[10px] text-white/70 bg-black/50 rounded px-1 pointer-events-none">{box.label}</span>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onChange({ zoom: clampZoom(c.zoom - 0.25) })}
          className="w-6 h-6 rounded border border-gray-300 dark:border-cosplay-border text-sm leading-none text-gray-600 dark:text-slate-300">−</button>
        <button type="button" onClick={() => onChange({ zoom: clampZoom(c.zoom + 0.25) })}
          className="w-6 h-6 rounded border border-gray-300 dark:border-cosplay-border text-sm leading-none text-gray-600 dark:text-slate-300">+</button>
        <code className="text-[10px] text-gray-500 dark:text-slate-500 ml-auto">×{c.zoom.toFixed(2)}</code>
        <button type="button" onClick={() => onChange({ ...DEFAULT_COVER })}
          className="text-[10px] text-gray-500 dark:text-slate-500 underline">reset</button>
      </div>
    </div>
  )
}

const FIXED_SOCIAL_PLATFORMS = [
  { key: "facebook",  label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "page",      label: "Page" },
  { key: "x",        label: "X" },
  { key: "tiktok",   label: "TikTok" },
  { key: "discord",  label: "Discord" },
]

/* heroCovers slot = { desktop?, tablet?, mobile? } each {zoom,x,y}.
   Legacy flat {zoom,x,y} (pre-breakpoint) is treated as desktop. */
function normalizeCoverVariant(c) {
  if (!c || typeof c !== "object") return null
  return {
    zoom: Number.isFinite(Number(c.zoom)) ? Number(c.zoom) : DEFAULT_COVER.zoom,
    x: Number.isFinite(Number(c.x)) ? Number(c.x) : DEFAULT_COVER.x,
    y: Number.isFinite(Number(c.y)) ? Number(c.y) : DEFAULT_COVER.y,
  }
}
function normalizeCoverSlot(c) {
  if (!c || typeof c !== "object") return {}
  if ("zoom" in c || "x" in c || "y" in c) return { desktop: normalizeCoverVariant(c) }
  const out = {}
  for (const k of ["desktop", "tablet", "mobile"]) {
    const v = normalizeCoverVariant(c[k])
    if (v) out[k] = v
  }
  return out
}

const DEFAULT = {
  colorScheme: "green",
  heroImageUrl: "",
  thumbnailImageUrl: "",
  heroImages: [],
  heroAccents: [],
  heroCovers: [],
  heroCover: "",
  latestPhotos: [],
  logoUrl: "",
  footerChar: "",
  artistName: { vi: "", en: "" },
  tagline: { vi: "", en: "" },
  about: { vi: "", en: "" },
  hero: { subtitle: { vi: "", en: "" }, description: { vi: "", en: "" } },
  achievements: [],
  upcomingEvents: [],
  contact: {
    phone: "",
    email: "",
    contactLinks: [],
    social: [],
    supports: { gumroad: "", gank: "", paypal: "" },
  },
}

function normalizeConfig(raw) {
  if (!raw) return DEFAULT
  return {
    ...DEFAULT,
    ...raw,
    colorScheme: raw.colorScheme || "green",
    heroImageUrl: raw.heroImageUrl ?? "",
    thumbnailImageUrl: raw.thumbnailImageUrl ?? "",
    heroImages: Array.isArray(raw.heroImages) ? raw.heroImages : [],
    heroAccents: Array.isArray(raw.heroAccents)
      ? raw.heroAccents.map((a) => ({ mode: a?.mode === "manual" ? "manual" : "auto", color: typeof a?.color === "string" ? a.color : "" }))
      : [],
    heroCovers: Array.isArray(raw.heroCovers) ? raw.heroCovers.map(normalizeCoverSlot) : [],
    heroCover: raw.heroCover ?? "",
    latestPhotos: Array.isArray(raw.latestPhotos) ? raw.latestPhotos : [],
    logoUrl: raw.logoUrl ?? "",
    footerChar: raw.footerChar ?? "",
    artistName: toLocalizedObj(raw.artistName),
    tagline: toLocalizedObj(raw.tagline),
    about: toLocalizedObj(raw.about),
    hero: {
      subtitle: toLocalizedObj(raw.hero?.subtitle),
      description: toLocalizedObj(raw.hero?.description),
    },
    achievements: (Array.isArray(raw.achievements) ? raw.achievements : []).map((a) => ({
      title: toLocalizedObj(a.title),
      description: toLocalizedObj(a.description),
    })),
    upcomingEvents: (raw.upcomingEvents || []).map((ev) => ({
      ...ev,
      title: toLocalizedObj(ev.title),
      date: toLocalizedObj(ev.date),
      showPopup: !!ev.showPopup,
      imageUrl: ev.imageUrl ?? "",
    })),
    contact: {
      ...raw.contact,
      phone: raw.contact?.phone ?? "",
      email: raw.contact?.email ?? "",
      contactLinks: Array.isArray(raw.contact?.contactLinks)
        ? raw.contact.contactLinks.map((item) => ({ type: item.type || "zalo", value: item.value || "" }))
        : [],
      social: (raw.contact?.social ?? []).map((s) => ({
        platform: s.platform || (s.label || "").toLowerCase(),
        label: s.label || "",
        url: s.url || "",
      })),
      supports: raw.contact?.supports ?? { gumroad: "", gank: "", paypal: "" },
    },
  }
}

export default function AdminSettings() {
  const [config, setConfig] = useState(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState("")
  const [dirty, setDirty] = useState(false)
  const [draggedEventIdx, setDraggedEventIdx] = useState(null)

  useEffect(() => {
    api
      .get("/api/settings")
      .then((r) => {
        const normalized = normalizeConfig(r.data)
        setConfig(normalized)
        if (normalized.colorScheme) applyColorScheme(normalized.colorScheme)
      })
      .catch(() => setConfig(DEFAULT))
      .finally(() => setLoading(false))
  }, [])

  const save = async (e) => {
    e?.preventDefault()
    setSaving(true)
    setMsg("")
    try {
      await api.put("/api/settings", config)
      setMsg("Đã lưu!")
      setDirty(false)
    } catch (err) {
      setMsg(err.response?.data?.message || "Lỗi khi lưu")
    } finally {
      setSaving(false)
    }
  }

  const update = (path, value) => {
    setDirty(true)
    setConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev))
      if (path.includes(".")) {
        const parts = path.split(".")
        let cur = next
        for (let i = 0; i < parts.length - 1; i++) {
          if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") cur[parts[i]] = {}
          cur = cur[parts[i]]
        }
        cur[parts[parts.length - 1]] = value
      } else {
        next[path] = value
      }
      return next
    })
  }

  const updateLocalized = (path, lang, value) => {
    setDirty(true)
    setConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev))
      const parts = path.split(".")
      let target = next
      for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]] || typeof target[parts[i]] !== "object") target[parts[i]] = {}
        target = target[parts[i]]
      }
      const key = parts[parts.length - 1]
      target[key] = toLocalizedObj(target[key])
      target[key][lang] = value
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
    setDirty(true)
    setConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev))
      const arr = getArr(next, arrKey) || []
      setArr(next, arrKey, [...arr, item])
      return next
    })
  }

  const updateItem = (arrKey, idx, field, value) => {
    setDirty(true)
    setConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev))
      const arr = getArr(next, arrKey) || []
      arr[idx] = { ...arr[idx], [field]: value }
      setArr(next, arrKey, arr)
      return next
    })
  }

  const removeItem = (arrKey, idx) => {
    setDirty(true)
    setConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev))
      const arr = (getArr(next, arrKey) || []).filter((_, i) => i !== idx)
      setArr(next, arrKey, arr)
      return next
    })
  }

  /* ── Event drag-reorder ── */
  const reorderEvents = (fromIdx, toIdx) => {
    const events = config.upcomingEvents || []
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= events.length || toIdx >= events.length) return
    const next = [...events]
    const [removed] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, removed)
    const nextConfig = { ...config, upcomingEvents: next }
    setConfig(nextConfig)
    if (dirty) {
      setMsg("Thứ tự đã cập nhật. Nhấn Lưu để lưu tất cả thay đổi.")
      return
    }
    setSaving(true)
    api.put("/api/settings", nextConfig)
      .then(() => setMsg("Đã lưu thứ tự."))
      .catch(() => setMsg("Lỗi lưu thứ tự."))
      .finally(() => setSaving(false))
  }

  const onEventDragStart = (e, idx) => {
    setDraggedEventIdx(idx)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", String(idx))
    e.currentTarget.closest("[data-event-row]")?.classList.add("opacity-50", "ring-2", "ring-pink-500")
  }
  const onEventDragEnd = (e) => {
    e.currentTarget.closest("[data-event-row]")?.classList.remove("opacity-50", "ring-2", "ring-pink-500")
    setDraggedEventIdx(null)
  }
  const onEventDragOver = (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move" }
  const onEventDrop = (e, toIdx) => {
    e.preventDefault(); e.stopPropagation()
    e.currentTarget.closest("[data-event-row]")?.classList.remove("ring-2", "ring-pink-400")
    const fromIdx = draggedEventIdx
    if (fromIdx == null || fromIdx === toIdx) return
    reorderEvents(fromIdx, toIdx)
    setDraggedEventIdx(null)
  }
  const onEventDragEnter = (e, idx) => {
    if (draggedEventIdx != null && idx !== draggedEventIdx)
      e.currentTarget.closest("[data-event-row]")?.classList.add("ring-2", "ring-pink-400")
  }
  const onEventDragLeave = (e) => {
    e.currentTarget.closest("[data-event-row]")?.classList.remove("ring-2", "ring-pink-400")
  }

  /* ── Hero slideshow multi-upload ── */
  const [heroImagesUploading, setHeroImagesUploading] = useState(false)
  const [heroImagesUploadError, setHeroImagesUploadError] = useState("")

  const addHeroImage = (url, accentColor) => {
    setDirty(true)
    setConfig((prev) => ({
      ...prev,
      heroImages: [...(prev.heroImages || []), url],
      // accent color is computed once server-side at upload; stored here, no client canvas
      heroAccents: [...(prev.heroAccents || []), { mode: "auto", color: accentColor || "" }],
      heroCovers: [...(prev.heroCovers || []), {}],
    }))
  }
  const removeHeroImage = (idx) => {
    setDirty(true)
    setConfig((prev) => ({
      ...prev,
      heroImages: (prev.heroImages || []).filter((_, i) => i !== idx),
      heroAccents: (prev.heroAccents || []).filter((_, i) => i !== idx),
      heroCovers: (prev.heroCovers || []).filter((_, i) => i !== idx),
    }))
  }

  // Effective variant for editing: explicit value → desktop fallback → default
  const getHeroCover = (idx, bp) => {
    const slot = (config.heroCovers || [])[idx] || {}
    return { ...DEFAULT_COVER, ...(slot.desktop || {}), ...(slot[bp] || {}) }
  }
  const setHeroCover = (idx, bp, patch) => {
    setDirty(true)
    setConfig((prev) => {
      const len = (prev.heroImages || []).length
      const covers = Array.from({ length: len }, (_, i) => {
        const slot = (prev.heroCovers || [])[i] || {}
        if (i !== idx) return slot
        const cur = { ...DEFAULT_COVER, ...(slot.desktop || {}), ...(slot[bp] || {}) }
        return { ...slot, [bp]: { ...cur, ...patch } }
      })
      return { ...prev, heroCovers: covers }
    })
  }

  const setHeroAccentMode = (idx, mode) => {
    setDirty(true)
    setConfig((prev) => {
      const len = (prev.heroImages || []).length
      const accents = Array.from({ length: len }, (_, i) => ({
        mode: i === idx ? mode : ((prev.heroAccents || [])[i]?.mode || "auto"),
        color: (prev.heroAccents || [])[i]?.color || "",
      }))
      return { ...prev, heroAccents: accents }
    })
  }

  const setHeroAccentColor = (idx, color) => {
    setDirty(true)
    setConfig((prev) => {
      const len = (prev.heroImages || []).length
      const accents = Array.from({ length: len }, (_, i) => ({
        mode: (prev.heroAccents || [])[i]?.mode || "auto",
        color: i === idx ? color : ((prev.heroAccents || [])[i]?.color || ""),
      }))
      return { ...prev, heroAccents: accents }
    })
  }

  const onHeroImagesDrop = (files) => {
    if (!files.length) return
    setHeroImagesUploadError("")
    setHeroImagesUploading(true)
    const uploadOne = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = reader.result.split(",")[1]
          api.post("/api/upload/thumbnail", { base64 })
            .then((r) => { addHeroImage(r.data.url, r.data.accentColor); resolve() })
            .catch(reject)
        }
        reader.readAsDataURL(file)
      })
    Promise.all(files.map(uploadOne))
      .catch((err) => setHeroImagesUploadError(err.response?.data?.message || err.message || "Upload thất bại"))
      .finally(() => setHeroImagesUploading(false))
  }
  const heroImagesDropzone = useDropzone({ onDrop: onHeroImagesDrop, accept: { "image/*": [] }, disabled: heroImagesUploading })

  /* ── Latest photos (Info dashboard 2×2 grid) multi-upload ── */
  const [latestUploading, setLatestUploading] = useState(false)
  const [latestUploadError, setLatestUploadError] = useState("")
  const removeLatestPhoto = (idx) => {
    setDirty(true)
    setConfig((prev) => ({ ...prev, latestPhotos: (prev.latestPhotos || []).filter((_, i) => i !== idx) }))
  }
  const onLatestDrop = (files) => {
    if (!files.length) return
    setLatestUploadError("")
    setLatestUploading(true)
    const uploadOne = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          api.post("/api/upload/thumbnail", { base64: reader.result.split(",")[1] })
            .then((r) => { setDirty(true); setConfig((prev) => ({ ...prev, latestPhotos: [...(prev.latestPhotos || []), r.data.url] })); resolve() })
            .catch(reject)
        }
        reader.readAsDataURL(file)
      })
    Promise.all(files.map(uploadOne))
      .catch((err) => setLatestUploadError(err.response?.data?.message || err.message || "Upload thất bại"))
      .finally(() => setLatestUploading(false))
  }
  const latestDropzone = useDropzone({ onDrop: onLatestDrop, accept: { "image/*": [] }, disabled: latestUploading })
  const latestDragIdx = useRef(null)
  const moveLatestPhoto = (from, to) => {
    if (from === to || from == null) return
    setDirty(true)
    setConfig((prev) => {
      const arr = [...(prev.latestPhotos || [])]
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      return { ...prev, latestPhotos: arr }
    })
  }

  /* ── Social fixed-platform URL update ── */
  const setSocialUrl = (platformKey, label, url) => {
    setDirty(true)
    setConfig((prev) => {
      const existing = [...(prev.contact?.social || [])]
      const idx = existing.findIndex((s) => (s.platform || "").toLowerCase() === platformKey)
      if (url.trim()) {
        if (idx >= 0) existing[idx] = { ...existing[idx], url }
        else existing.push({ platform: platformKey, label, url })
      } else {
        if (idx >= 0) existing.splice(idx, 1)
      }
      return { ...prev, contact: { ...prev.contact, social: existing } }
    })
  }

  if (loading) return <p className="text-gray-500 dark:text-slate-500 p-4">Đang tải...</p>

  const cardCls = "bg-white dark:bg-cosplay-card border border-gray-200 dark:border-cosplay-border rounded-lg p-4 space-y-4"
  const inputCls = "border border-gray-300 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker rounded-md p-2 text-gray-900 dark:text-slate-200 w-full"
  const labelCls = "block text-sm text-gray-600 dark:text-slate-400 mb-1"
  const btnSecCls = "px-3.5 py-1.5 text-sm rounded border border-gray-300 dark:border-cosplay-border bg-transparent text-gray-700 dark:text-slate-300 hover:border-pink-500/50 hover:text-pink-500 dark:hover:text-pink-400 transition-colors disabled:opacity-50"
  const btnDangerCls = "text-sm bg-transparent border-none text-red-400 hover:text-red-300 cursor-pointer"

  return (
    <form onSubmit={save} className="max-w-2xl space-y-4 sm:space-y-5 p-3 sm:p-4 md:p-8">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Cài đặt trang</h2>
        <button type="submit" disabled={saving}
          className="px-4 py-2 rounded-md bg-pink-500 text-white text-sm font-medium hover:bg-pink-400 disabled:opacity-50">
          {saving ? "Đang lưu..." : "Lưu"}
        </button>
      </div>
      {msg && <p className="text-sm text-pink-500 dark:text-pink-400">{msg}</p>}

      {/* ── Color Scheme ── */}
      <div className={cardCls}>
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-slate-200 text-base">Bảng màu (Color Scheme)</h3>
          <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5 mb-3.5">Chọn tông màu — áp dụng trực tiếp bên dưới.</p>
        </div>
        <div className="flex gap-2.5 flex-wrap">
          {Object.entries(COLOR_SCHEMES).map(([key, sc]) => {
            const active = config.colorScheme === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => { update("colorScheme", key); applyColorScheme(key) }}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded border-2 transition-all"
                style={{
                  borderColor: active ? sc.brand : "var(--border-default, #2a2a3a)",
                  background: "transparent",
                }}
              >
                <span className="w-[18px] h-[18px] rounded-full shrink-0" style={{ background: sc.brand }} />
                <span className="text-sm font-semibold text-gray-700 dark:text-slate-300 capitalize">{key}</span>
                {active && <span className="text-[10px] leading-none" style={{ color: sc.brand }}>✓</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Main info (bilingual) + Logo ── */}
      <div className={cardCls}>
        <h3 className="font-semibold text-gray-800 dark:text-slate-200 text-base">Thông tin chính (vi / en)</h3>
        <div>
          <label className={labelCls}>Tên hiển thị</label>
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={config.artistName?.vi ?? ""} onChange={(e) => updateLocalized("artistName", "vi", e.target.value)} className={inputCls} placeholder="Kamidayhehe (VI)" />
            <input type="text" value={config.artistName?.en ?? ""} onChange={(e) => updateLocalized("artistName", "en", e.target.value)} className={inputCls} placeholder="Kamidayhehe (EN)" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Logo (mark trên navbar &amp; favicon)</label>
          <p className="text-xs text-gray-500 dark:text-slate-500 -mt-0.5 mb-2">Để trống sẽ dùng chữ cái đầu của tên. Khuyến nghị ảnh vuông.</p>
          <ClickUpload endpoint="/api/upload/hero" onUrl={(url) => update("logoUrl", url)}>
            {(trigger, uploading) => (
              <div className="flex items-center gap-3.5">
                <div
                  onClick={trigger}
                  className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-300 dark:border-cosplay-border cursor-pointer overflow-hidden shrink-0 flex items-center justify-center bg-gray-50 dark:bg-cosplay-darker hover:border-pink-500/50 hover:bg-pink-500/5 transition-colors"
                >
                  {config.logoUrl ? (
                    <img src={config.logoUrl} alt="logo" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs text-gray-500 dark:text-slate-500 text-center leading-tight">+ Ảnh</span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <button type="button" onClick={trigger} disabled={uploading} className={btnSecCls}>
                    {uploading ? "Đang tải..." : "Chọn ảnh"}
                  </button>
                  {config.logoUrl && (
                    <button type="button" onClick={() => update("logoUrl", "")} className={btnDangerCls}>Xóa ảnh</button>
                  )}
                </div>
              </div>
            )}
          </ClickUpload>
        </div>
        <div>
          <label className={labelCls}>Tagline</label>
          <div className="grid grid-cols-2 gap-2">
            <textarea value={config.tagline?.vi ?? ""} onChange={(e) => updateLocalized("tagline", "vi", e.target.value)} className={inputCls} rows={2} placeholder="Cosplayer • Prop Maker (VI)" />
            <textarea value={config.tagline?.en ?? ""} onChange={(e) => updateLocalized("tagline", "en", e.target.value)} className={inputCls} rows={2} placeholder="Cosplayer • Prop Maker (EN)" />
          </div>
        </div>
        <div>
          <label className={labelCls}>About (giới thiệu)</label>
          <div className="grid grid-cols-2 gap-2">
            <textarea value={config.about?.vi ?? ""} onChange={(e) => updateLocalized("about", "vi", e.target.value)} className={inputCls} rows={4} placeholder="Giới thiệu (VI)" />
            <textarea value={config.about?.en ?? ""} onChange={(e) => updateLocalized("about", "en", e.target.value)} className={inputCls} rows={4} placeholder="About (EN)" />
          </div>
        </div>
      </div>

      {/* ── Hero Slideshow ── */}
      <div className={cardCls}>
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-slate-200 text-base">Hero Slideshow</h3>
          <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5 mb-3.5">Mỗi ảnh có một màu accent dùng cho nền gradient (Auto lấy từ ảnh — Manual chọn tay). Khung <b>cover</b> là ảnh nền mờ phía sau hero: kéo để dịch vị trí, lăn chuột / nút +− để zoom.</p>
        </div>

        {/* Per-slot rows */}
        {(config.heroImages || []).length > 0 && (
          <div className="flex flex-col gap-3">
            {(config.heroImages || []).map((url, i) => {
              const slot = (config.heroAccents || [])[i] || { mode: "auto", color: "" }
              const filename = url.split("/").pop().split("?")[0] || `Image ${i + 1}`
              const dispColor = slot.color || "#555555"
              return (
                <div key={i} className="flex items-center gap-3 px-3.5 py-3 rounded border border-gray-200 dark:border-cosplay-border bg-gray-50 dark:bg-cosplay-darker flex-wrap">
                  <div className="w-[52px] h-[52px] rounded overflow-hidden shrink-0 border border-gray-200 dark:border-cosplay-border">
                    <img src={url} alt="" className="w-full h-full object-cover object-top" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-slate-200 truncate">{filename}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-500 mt-0.5">
                      {slot.mode === "auto" ? "Auto (extracted)" : "Manual"}
                    </div>
                  </div>
                  <div className="flex rounded overflow-hidden border border-gray-200 dark:border-cosplay-border shrink-0">
                    <button type="button" onClick={() => setHeroAccentMode(i, "auto")}
                      className="px-3 py-1.5 text-xs font-semibold transition-colors"
                      style={{
                        background: slot.mode === "auto" ? "var(--brand, #ec4899)" : "transparent",
                        color: slot.mode === "auto" ? "#fff" : "var(--text-muted, #94a3b8)",
                      }}>
                      Auto
                    </button>
                    <button type="button" onClick={() => setHeroAccentMode(i, "manual")}
                      className="px-3 py-1.5 text-xs font-semibold transition-colors border-l border-gray-200 dark:border-cosplay-border"
                      style={{
                        background: slot.mode === "manual" ? "var(--brand, #ec4899)" : "transparent",
                        color: slot.mode === "manual" ? "#fff" : "var(--text-muted, #94a3b8)",
                      }}>
                      Manual
                    </button>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div
                      className="w-[34px] h-[34px] rounded shrink-0 border-2 border-gray-300 dark:border-cosplay-border relative overflow-hidden"
                      style={{ background: dispColor }}
                    >
                      <input
                        type="color"
                        value={slot.color || "#555555"}
                        disabled={slot.mode === "auto"}
                        onChange={(e) => setHeroAccentColor(i, e.target.value)}
                        className="absolute inset-0 opacity-0 w-full h-full disabled:cursor-default"
                        style={{ padding: 0, cursor: slot.mode === "manual" ? "pointer" : "default" }}
                      />
                    </div>
                    <code className="text-[11px] text-gray-500 dark:text-slate-500 tracking-wider min-w-[58px]">
                      {slot.color || "auto"}
                    </code>
                  </div>
                  <div className="w-10 h-[34px] rounded shrink-0 border border-gray-200 dark:border-cosplay-border"
                    style={{ background: `linear-gradient(to right, #080810, ${dispColor})` }}
                  />
                  <div className="w-full flex flex-wrap gap-3 pt-1">
                    {COVER_BREAKPOINTS.map((bp) => (
                      <CoverPreview key={bp.key} url={url} box={bp}
                        cover={getHeroCover(i, bp.key)}
                        onChange={(patch) => setHeroCover(i, bp.key, patch)} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Thumbnail strip + dropzone */}
        <div>
          <label className={labelCls}>Ảnh Hero (tự chuyển đổi mỗi 4s)</label>
          {(config.heroImages || []).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {(config.heroImages || []).map((url, i) => (
                <div key={i} className="relative group">
                  <img src={url} alt="" className="h-[70px] w-[112px] object-cover rounded-lg border border-gray-200 dark:border-cosplay-border" />
                  <button
                    type="button"
                    onClick={() => removeHeroImage(i)}
                    className="absolute top-[5px] right-[5px] w-[22px] h-[22px] rounded-full bg-black/60 text-white text-[13px] flex items-center justify-center border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                  >×</button>
                </div>
              ))}
            </div>
          )}
          <div
            {...heroImagesDropzone.getRootProps()}
            className="border-2 border-dashed border-gray-300 dark:border-cosplay-border rounded-lg p-4 text-center cursor-pointer hover:border-pink-500/50 hover:bg-pink-500/5 min-h-[60px] flex items-center justify-center"
          >
            <input {...heroImagesDropzone.getInputProps()} />
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {heroImagesUploading ? "Đang tải..." : "+ Kéo thả / thêm ảnh Hero"}
            </p>
          </div>
          {heroImagesUploadError && <p className="mt-2 text-sm text-red-400">{heroImagesUploadError}</p>}
        </div>

        {/* Cover is derived automatically from the current hero slide — no upload needed */}
        <p className="text-xs text-gray-500 dark:text-slate-500 border-t border-dashed border-gray-200 dark:border-cosplay-border pt-3">
          Ảnh nền mờ phía sau tự lấy theo slide đang hiển thị — không cần upload riêng.
        </p>
      </div>

      {/* ── Latest photos (Info dashboard grid) ── */}
      <div className={cardCls}>
        <h3 className="font-semibold text-gray-800 dark:text-slate-200 text-base">Ảnh mới nhất (Latest photos)</h3>
        <p className="text-xs text-gray-500 dark:text-slate-500">Lưới 2×2 ở cột 1 Info Dashboard. Để trống sẽ tự lấy ảnh từ album/gallery. Kéo thả để sắp xếp — 4 ảnh đầu được hiển thị.</p>
        {(config.latestPhotos || []).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(config.latestPhotos || []).map((url, i) => (
              <div key={url} draggable className="relative group cursor-grab active:cursor-grabbing"
                onDragStart={(e) => { latestDragIdx.current = i; e.dataTransfer.effectAllowed = "move" }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move" }}
                onDrop={(e) => { e.preventDefault(); moveLatestPhoto(latestDragIdx.current, i); latestDragIdx.current = null }}
                onDragEnd={() => { latestDragIdx.current = null }}>
                <img src={url} alt="" draggable={false} className="h-[84px] w-[84px] object-cover rounded-lg border border-gray-200 dark:border-cosplay-border pointer-events-none" />
                <span className="absolute bottom-[5px] left-[5px] px-1.5 rounded bg-black/60 text-white text-[11px]">{i + 1}</span>
                <button type="button" onClick={() => removeLatestPhoto(i)}
                  className="absolute top-[5px] right-[5px] w-[22px] h-[22px] rounded-full bg-black/60 text-white text-[13px] flex items-center justify-center border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">×</button>
              </div>
            ))}
          </div>
        )}
        <div {...latestDropzone.getRootProps()}
          className="border-2 border-dashed border-gray-300 dark:border-cosplay-border rounded-lg p-4 text-center cursor-pointer hover:border-pink-500/50 hover:bg-pink-500/5 min-h-[60px] flex items-center justify-center">
          <input {...latestDropzone.getInputProps()} />
          <p className="text-sm text-gray-500 dark:text-slate-400">{latestUploading ? "Đang tải..." : "+ Kéo thả / thêm ảnh"}</p>
        </div>
        {latestUploadError && <p className="mt-2 text-sm text-red-400">{latestUploadError}</p>}
      </div>

      {/* ── Achievements ── */}
      <div className={cardCls}>
        <h3 className="font-semibold text-gray-800 dark:text-slate-200 text-base">Thành tựu (Achievements)</h3>
        <p className="text-xs text-gray-500 dark:text-slate-500">Hiển thị cột 3 trong Info Dashboard. Mỗi mục: tiêu đề + mô tả ngắn.</p>
        {(config.achievements || []).map((a, i) => (
          <div key={i} className="flex gap-2 items-start border border-gray-200 dark:border-cosplay-border rounded-md p-2">
            <div className="flex-1 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={a.title?.vi ?? ""} onChange={(e) => updateItem("achievements", i, "title", { ...toLocalizedObj(a.title), vi: e.target.value })} className={inputCls} placeholder="Tiêu đề (VI) — 100+ Cosplay" />
                <input type="text" value={a.title?.en ?? ""} onChange={(e) => updateItem("achievements", i, "title", { ...toLocalizedObj(a.title), en: e.target.value })} className={inputCls} placeholder="Title (EN) — 100+ Cosplays" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={a.description?.vi ?? ""} onChange={(e) => updateItem("achievements", i, "description", { ...toLocalizedObj(a.description), vi: e.target.value })} className={inputCls} placeholder="Mô tả (VI)" />
                <input type="text" value={a.description?.en ?? ""} onChange={(e) => updateItem("achievements", i, "description", { ...toLocalizedObj(a.description), en: e.target.value })} className={inputCls} placeholder="Description (EN)" />
              </div>
            </div>
            <button type="button" onClick={() => removeItem("achievements", i)} className="text-red-400 hover:text-red-300 mt-1 shrink-0">×</button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => addItem("achievements", { title: { vi: "", en: "" }, description: { vi: "", en: "" } })}
          className="text-sm text-pink-500 dark:text-pink-400 hover:text-pink-600 dark:hover:text-pink-300"
        >
          + Thêm thành tựu
        </button>
      </div>

      {/* ── Footer character ── */}
      <div className={cardCls}>
        <h3 className="font-semibold text-gray-800 dark:text-slate-200 text-base">Nhân vật footer (Footer Character)</h3>
        <p className="text-xs text-gray-500 dark:text-slate-500">Ảnh PNG trong suốt, dọc — hiện ở góc dưới phải trang. Để trống để ẩn.</p>
        <ImageUpload
          endpoint="/api/upload/hero"
          imageUrl={config.footerChar}
          onUpload={(url) => update("footerChar", url)}
          onRemove={() => update("footerChar", "")}
          label="Chọn ảnh nhân vật (PNG trong suốt)"
          previewClass="max-h-32 object-contain"
        />
      </div>

      {/* ── Events ── */}
      <div className={cardCls}>
        <h3 className="font-semibold text-gray-800 dark:text-slate-200 text-base">Sự kiện sắp tới</h3>
        <p className="text-xs text-gray-500 dark:text-slate-500">Kéo thả để đổi thứ tự. Tick 1 sự kiện để hiện popup thông báo khi mở trang.</p>
        {(config.upcomingEvents || []).map((ev, i) => (
          <div
            key={i}
            data-event-row
            onDragOver={onEventDragOver}
            onDrop={(e) => onEventDrop(e, i)}
            onDragEnter={(e) => onEventDragEnter(e, i)}
            onDragLeave={onEventDragLeave}
            className="flex flex-col gap-2 p-2 border border-gray-200 dark:border-cosplay-border rounded-md"
          >
            <div
              draggable
              onDragStart={(e) => onEventDragStart(e, i)}
              onDragEnd={onEventDragEnd}
              className="flex items-center gap-2 flex-wrap cursor-grab active:cursor-grabbing"
            >
              <span className="text-gray-400 dark:text-slate-500 select-none" aria-hidden="true">⋮⋮</span>
              <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!ev.showPopup}
                  onChange={(e) => {
                    setDirty(true)
                    setConfig((prev) => {
                      const next = JSON.parse(JSON.stringify(prev))
                      next.upcomingEvents = (next.upcomingEvents || []).map((evt, j) => ({
                        ...evt, showPopup: j === i ? e.target.checked : false,
                      }))
                      return next
                    })
                  }}
                  className="rounded border-gray-300 dark:border-cosplay-border text-pink-500"
                />
                Hiển thị popup khi mở trang
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={ev.title?.vi ?? ""} onChange={(e) => updateItem("upcomingEvents", i, "title", { ...toLocalizedObj(ev.title), vi: e.target.value })} className={inputCls} placeholder="Tên sự kiện (VI)" />
              <input type="text" value={ev.title?.en ?? ""} onChange={(e) => updateItem("upcomingEvents", i, "title", { ...toLocalizedObj(ev.title), en: e.target.value })} className={inputCls} placeholder="Event title (EN)" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={ev.date?.vi ?? ""} onChange={(e) => updateItem("upcomingEvents", i, "date", { ...toLocalizedObj(ev.date), vi: e.target.value })} className={inputCls} placeholder="Ngày (VI) — 15 Th8, 2026" />
              <input type="text" value={ev.date?.en ?? ""} onChange={(e) => updateItem("upcomingEvents", i, "date", { ...toLocalizedObj(ev.date), en: e.target.value })} className={inputCls} placeholder="Date (EN) — Aug 15, 2026" />
            </div>
            <div className="flex gap-2 items-center">
              <input type="text" value={ev.url || ""} onChange={(e) => updateItem("upcomingEvents", i, "url", e.target.value)} className={`${inputCls} flex-1`} placeholder="Link sự kiện (tùy chọn) — để trống nếu không có" />
              <button type="button" onClick={() => removeItem("upcomingEvents", i)} className="text-red-400 hover:text-red-300 shrink-0">×</button>
            </div>
            {ev.showPopup && (
              <div className="border-t border-dashed border-gray-200 dark:border-cosplay-border pt-2.5">
                <label className="block text-xs text-gray-500 dark:text-slate-500 mb-1">Ảnh popup (chỉ hiện trong popup, không hiện ở danh sách lịch)</label>
                <ClickUpload
                  endpoint="/api/upload/event-image"
                  onUrl={(url) => updateItem("upcomingEvents", i, "imageUrl", url)}
                >
                  {(trigger, uploading) => (
                    <div className="flex items-center gap-3.5">
                      <div
                        onClick={trigger}
                        className="border-2 border-dashed border-gray-300 dark:border-cosplay-border rounded-lg cursor-pointer overflow-hidden shrink-0 flex items-center justify-center bg-gray-50 dark:bg-cosplay-darker hover:border-pink-500/50 hover:bg-pink-500/5 transition-colors"
                        style={{ width: 132, height: 74 }}
                      >
                        {ev.imageUrl ? (
                          <img src={ev.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs text-gray-500 dark:text-slate-500">+ Thêm ảnh</span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <button type="button" onClick={trigger} disabled={uploading} className={btnSecCls}>
                          {uploading ? "Đang tải..." : "Chọn ảnh"}
                        </button>
                        {ev.imageUrl && (
                          <button type="button" onClick={() => updateItem("upcomingEvents", i, "imageUrl", "")} className={btnDangerCls}>Xóa ảnh</button>
                        )}
                      </div>
                    </div>
                  )}
                </ClickUpload>
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => addItem("upcomingEvents", { title: { vi: "", en: "" }, date: "", url: "", showPopup: false, imageUrl: "" })}
          className="text-sm text-pink-500 dark:text-pink-400 hover:text-pink-600 dark:hover:text-pink-300"
        >
          + Thêm sự kiện
        </button>
      </div>

      {/* ── Contact ── */}
      <div className={cardCls}>
        <h3 className="font-semibold text-gray-800 dark:text-slate-200 text-base">Liên hệ</h3>
        <div>
          <label className={labelCls}>Email (hiện công khai + nút Gmail)</label>
          <input type="email" value={config.contact?.email ?? ""} onChange={(e) => update("contact", { ...config.contact, email: e.target.value })} className={inputCls} placeholder="email@gmail.com" />
        </div>
        <div>
          <label className={labelCls}>Liên hệ nhanh (Zalo / WhatsApp / Messenger)</label>
          <p className="text-xs text-gray-500 dark:text-slate-500 mb-2">Nhập số điện thoại hoặc dán link. Số điện thoại KHÔNG hiển thị công khai — chỉ dùng để tạo nút bấm.</p>
          {(config.contact?.contactLinks || []).map((item, i) => (
            <div key={i} className="flex gap-2 items-center mb-2 flex-wrap">
              <select value={item?.type ?? "zalo"} onChange={(e) => updateItem("contact.contactLinks", i, "type", e.target.value)} className={`${inputCls} w-32`}>
                <option value="zalo">Zalo</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="messenger">Messenger</option>
              </select>
              <input type="text" value={item?.value ?? ""} onChange={(e) => updateItem("contact.contactLinks", i, "value", e.target.value)} className={`${inputCls} flex-1 min-w-[120px]`}
                placeholder={item?.type === "messenger" ? "username hoặc https://m.me/…" : "SĐT hoặc link (vd 0868835072)"} />
              <button type="button" onClick={() => removeItem("contact.contactLinks", i)} className="text-red-400 hover:text-red-300 shrink-0">×</button>
            </div>
          ))}
          <button type="button" onClick={() => addItem("contact.contactLinks", { type: "zalo", value: "" })} className="text-sm text-pink-500 dark:text-pink-400">+ Thêm liên hệ</button>
        </div>
      </div>

      {/* ── Social links (fixed platform list) ── */}
      <div className={cardCls}>
        <h3 className="font-semibold text-gray-800 dark:text-slate-200 text-base">Social links</h3>
        <p className="text-xs text-gray-500 dark:text-slate-500">Danh sách nền tảng cố định — chỉ điền URL. Để trống để ẩn nút đó.</p>
        {FIXED_SOCIAL_PLATFORMS.map(({ key, label }) => {
          const stored = (config.contact?.social || []).find(
            (s) => (s.platform || "").toLowerCase() === key
          )
          return (
            <div key={key} className="flex gap-2.5 items-center">
              <label className="w-24 text-sm text-gray-600 dark:text-slate-400 shrink-0">{label}</label>
              <input
                type="url"
                value={stored?.url || ""}
                onChange={(e) => setSocialUrl(key, label, e.target.value)}
                className={`${inputCls} flex-1`}
                placeholder="https://..."
              />
            </div>
          )
        })}
      </div>

      {/* ── Supports ── */}
      <div className={cardCls}>
        <h3 className="font-semibold text-gray-800 dark:text-slate-200 text-base">Supports (Gumroad · Gank · PayPal)</h3>
        <p className="text-xs text-gray-500 dark:text-slate-500">Điền URL. Để trống để ẩn.</p>
        {["gumroad", "gank", "paypal"].map((key) => (
          <div key={key} className="flex gap-2.5 items-center">
            <label className="w-24 text-sm text-gray-600 dark:text-slate-400 capitalize shrink-0">{key}</label>
            <input
              type="url"
              value={(typeof config.contact?.supports === "object" ? config.contact.supports[key] : "") || ""}
              onChange={(e) => update("contact", {
                ...config.contact,
                supports: { gumroad: "", gank: "", paypal: "", ...config.contact?.supports, [key]: e.target.value },
              })}
              className={`${inputCls} flex-1`}
              placeholder={`https://${key}.com/...`}
            />
          </div>
        ))}
      </div>
    </form>
  )
}
