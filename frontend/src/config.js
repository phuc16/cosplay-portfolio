export const COLOR_SCHEMES = {
  pink:   { brand:"#ec4899", hover:"#f472b6", strong:"#db2777", glow:"rgba(236,72,153,.30)", soft:"rgba(236,72,153,.15)", grad1:"#f472b6", grad2:"#fb7185" },
  blue:   { brand:"#3b82f6", hover:"#60a5fa", strong:"#2563eb", glow:"rgba(59,130,246,.30)",  soft:"rgba(59,130,246,.15)",  grad1:"#60a5fa", grad2:"#818cf8" },
  purple: { brand:"#8b5cf6", hover:"#a78bfa", strong:"#7c3aed", glow:"rgba(139,92,246,.30)", soft:"rgba(139,92,246,.15)", grad1:"#a78bfa", grad2:"#c084fc" },
  amber:  { brand:"#f59e0b", hover:"#fbbf24", strong:"#d97706", glow:"rgba(245,158,11,.30)",  soft:"rgba(245,158,11,.15)",  grad1:"#fbbf24", grad2:"#fb923c" },
  rose:   { brand:"#f43f5e", hover:"#fb7185", strong:"#e11d48", glow:"rgba(244,63,94,.30)",   soft:"rgba(244,63,94,.15)",   grad1:"#fb7185", grad2:"#fda4af" },
}

export function applyColorScheme(name) {
  const sc = COLOR_SCHEMES[name] || COLOR_SCHEMES.pink
  const r = document.documentElement
  r.style.setProperty("--brand",             sc.brand)
  r.style.setProperty("--brand-hover",       sc.hover)
  r.style.setProperty("--brand-strong",      sc.strong)
  r.style.setProperty("--brand-soft",        sc.soft)
  r.style.setProperty("--border-brand",      sc.soft.replace(".15)", ".50)").replace(".30)", ".50)").replace(".10)", ".50)"))
  r.style.setProperty("--text-link",         sc.brand)
  r.style.setProperty("--shadow-pink-glow",  "0 0 20px " + sc.glow)
  r.style.setProperty("--shadow-pink-soft",  "0 4px 14px " + sc.soft)
  r.style.setProperty("--shadow-pink-hover", "0 20px 25px -5px " + sc.glow + ", 0 8px 10px -6px " + sc.glow)
  r.style.setProperty("--grad1",             sc.grad1)
  r.style.setProperty("--grad2",             sc.grad2)
  // Recolor the pink/rose token aliases so hero gradient text + dots follow the scheme
  r.style.setProperty("--pink-400",          sc.grad1)
  r.style.setProperty("--rose-400",          sc.grad2)
  r.style.setProperty("--pink-500",          sc.brand)
}

// Empty skeleton only — ALL content comes from the backend (/api/settings).
// Used solely as a shape-safe fallback while loading or if the API is down.
export const SITE_CONFIG = {
  colorScheme: "pink",
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
  achievements: [],
  upcomingEvents: [],
  contact: { phone: "", email: "", contactLinks: [], social: [], supports: { gumroad: "", gank: "", paypal: "" } },
}
