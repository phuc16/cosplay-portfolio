import { useState, useEffect, useCallback, useRef } from "react"
import axios from "axios"
import { useNavigate, Link } from "react-router-dom"
import { SITE_CONFIG, applyColorScheme } from "../config"
import { useTheme } from "../contexts/ThemeContext"
import { useLanguage } from "../contexts/LanguageContext"
import { getLocalized } from "../utils/localize"
import { buildAlbumSlides, slideSrc, slidePairedSrc } from "../utils/albumSlides"

/* ── SVG ICONS ───────────────────────────────────────────────────────────── */
const icons = {
  moon: <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>,
  sun: <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
  chevL: <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>,
  chevR: <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>,
  cal: <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" strokeWidth="2" /><path strokeLinecap="round" strokeWidth="2" d="M16 2v4M8 2v4M3 10h18" /></svg>,
  star: <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>,
  ext: <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>,
  bag: <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4M3 6h18M16 10a4 4 0 01-8 0" /></svg>,
}
const socialIcons = {
  gumroad: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1C5.92 1 1 5.92 1 12s4.92 11 11 11 11-4.92 11-11S18.08 1 12 1zm.78 15.6c-2.86 0-4.62-2.06-4.62-4.86 0-2.92 1.94-4.92 4.74-4.92 2.5 0 3.94 1.46 4.16 3.34h-2.4c-.16-.86-.74-1.42-1.74-1.42-1.4 0-2.26 1.1-2.26 2.96 0 1.84.84 2.94 2.3 2.94 1.04 0 1.78-.56 2.02-1.62h-2.02v-1.7h4.32V16.4h-1.78l-.18-1.06c-.5.78-1.36 1.26-2.56 1.26z" /></svg>,
  paypal: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7.076 21.337H2.47a.641.641 0 01-.633-.74L4.944 3.72a.77.77 0 01.758-.633h5.165c2.35 0 4.128.633 5.33 1.898 1.205 1.264 1.794 2.995 1.77 5.193-.048 3.19-.882 5.358-2.505 6.506-1.623 1.148-3.735 1.707-6.337 1.676H9.38l-.598 3.48a.641.641 0 01-.633.548z" /></svg>,
  discord: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026c.462-.62.874-1.275 1.226-1.963.021-.04.001-.088-.041-.104a13.201 13.201 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028zM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.956 2.38-2.157 2.38zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.946 2.38-2.157 2.38z" /></svg>,
  facebook: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>,
  instagram: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" /></svg>,
  page: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>,
  x: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>,
  tiktok: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" /></svg>,
}
// X and TikTok are neutral brands → a mid slate grey (visible on both themes; a hex so the
// button border/bg tints `${col}60`/`${col}10` resolve, unlike a CSS var)
const socialColors = { facebook: "#1877F2", instagram: "#E4405F", page: "#1877F2", x: "#94a3b8", tiktok: "#94a3b8", discord: "#5865F2" }
// Matches --brand in index.css - a hex so the same button tint math ($col + alpha suffix) works.
const BRAND_HEX = "#6BBF59"
const SUPPORT_META = {
  gumroad: { label: "Gumroad", color: "#FF90E8" },
  gank: { label: "Gank", color: "#E84C3D", icon: "/refassets/gank.png" },
  paypal: { label: "PayPal", color: "#a2cffe" },
}

// Quick-contact channels (Zalo / WhatsApp / Messenger / Gmail) - icon + brand color.
const CONTACT_ICONS = {
  whatsapp: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.892 6.994c-.003 5.45-4.437 9.884-9.885 9.884M20.463 3.488A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413" /></svg>,
  messenger: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.654V24l4.088-2.242c1.092.301 2.246.464 3.443.464 6.627 0 12-4.975 12-11.111C24 4.974 18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.13 3.26L19.752 8l-6.561 6.963z" /></svg>,
  gmail: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" /></svg>,
}
const CONTACT_META = {
  zalo: { label: "Zalo", color: "#0068FF", icon: "/refassets/zalo.png" },
  whatsapp: { label: "WhatsApp", color: "#25D366" },
  messenger: { label: "Messenger", color: "#0084FF" },
  gmail: { label: "Gmail", color: "#EA4335" },
}
function contactHref(type, value) {
  const v = (value || "").trim()
  if (!v) return "#"
  if (/^https?:\/\//i.test(v)) return v
  const digits = v.replace(/[^0-9]/g, "")
  if (type === "zalo") return `https://zalo.me/${digits}`
  if (type === "whatsapp") return `https://wa.me/${digits}`
  if (type === "messenger") return `https://m.me/${v.replace(/^@/, "")}`
  if (type === "gmail") return `mailto:${v}`
  return v
}

/* ── NAVBAR ─────────────────────────────────────────────────────────────── */
function Navbar({ theme, onToggleTheme, lang, onSetLang, artistName, tagline, logoUrl }) {
  const navLinks = [
    { label: lang === "vi" ? "Thông tin" : "Info", href: "#info" },
    { label: lang === "vi" ? "Dự án" : "Project", href: "#project" },
    { label: lang === "vi" ? "Liên hệ" : "Contact", href: "#contact" },
    { label: lang === "vi" ? "Cửa hàng" : "Merchandise", href: "/merchandise" },
  ]
  const s = {
    header: { position: "sticky", top: 0, zIndex: 30, background: "color-mix(in srgb, var(--bg-page) 55%, transparent)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderBottom: "1px solid color-mix(in srgb, var(--border-default) 40%, transparent)" },
    inner: { maxWidth: 1280, margin: "0 auto", padding: "0 32px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" },
    logo: { display: "flex", alignItems: "center", gap: 10 },
    mark: { width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg,var(--pink-500),var(--rose-600))", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 16, boxShadow: "var(--shadow-pink-glow)", flexShrink: 0, overflow: "hidden" },
    name: { fontWeight: 600, fontSize: "var(--text-base)", color: "var(--text-strong)" },
    tag: { fontSize: "var(--text-xs)", color: "var(--text-muted)" },
    nav: { display: "flex", alignItems: "center", gap: 28 },
    link: { fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-body)", transition: "color .15s", padding: "4px 0", borderBottom: "2px solid transparent" },
    right: { display: "flex", alignItems: "center", gap: 10 },
    langBtn: (active) => ({ padding: "3px 8px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 500, background: active ? "var(--brand)" : "transparent", color: active ? "#fff" : "var(--text-muted)" }),
    iconBtn: { width: 32, height: 32, borderRadius: 8, border: "none", background: "transparent", color: "var(--text-body)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative" },
  }
  return (
    <header style={s.header}>
      <div className="nav-inner" style={s.inner}>
        <div style={s.logo}>
          {logoUrl && <div style={s.mark}><img src={logoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>}
          <div>
            <div style={s.name}>{artistName}</div>
            <div style={s.tag}>{tagline}</div>
          </div>
        </div>
        <nav className="nav-links" style={s.nav}>
          {navLinks.map((l) => l.href.startsWith("/") ? (
            <Link key={l.label} to={l.href} style={s.link}
              onMouseEnter={(e) => (e.target.style.color = "var(--text-link)")}
              onMouseLeave={(e) => (e.target.style.color = "var(--text-body)")}>{l.label}</Link>
          ) : (
            <a key={l.label} href={l.href} style={s.link}
              onMouseEnter={(e) => (e.target.style.color = "var(--text-link)")}
              onMouseLeave={(e) => (e.target.style.color = "var(--text-body)")}>{l.label}</a>
          ))}
        </nav>
        <div style={s.right}>
          <div style={{ display: "flex", gap: 2 }}>
            {["vi", "en"].map((l) => <button key={l} style={s.langBtn(lang === l)} onClick={() => onSetLang(l)}>{l.toUpperCase()}</button>)}
          </div>
          <button style={s.iconBtn} onClick={onToggleTheme}>{theme === "dark" ? icons.moon : icons.sun}</button>
        </div>
      </div>
    </header>
  )
}

/* ── Hero accent ────────────────────────────────────────────────────────────
   The accent color is computed ONCE server-side at upload (see backend
   extractAccentHex) and stored in config.heroAccents[i]. The client just reads
   it - no canvas. This only derives the glow rgba from that stored hex. ─────── */
function hexToRgba(hex, a) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || "")
  if (!m) return `rgba(236,72,153,${a})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/* ── SCROLL REVEAL ───────────────────────────────────────────────────────── */
/* Subtle fade + rise-in, once per element, honouring prefers-reduced-motion. */
function Reveal({ children, delay = 0 }) {
  const ref = useRef(null)
  // Show immediately (no animation) when IO is unavailable or motion is reduced.
  const [shown, setShown] = useState(() =>
    typeof IntersectionObserver === "undefined" ||
    (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  )
  useEffect(() => {
    const el = ref.current
    if (!el || shown) return
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.unobserve(el) } },
      { threshold: 0.08, rootMargin: "0px 0px -10% 0px" }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} className={`reveal${shown ? " in" : ""}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

/* Breakpoints mirror index.css: ≤760 mobile, ≤980 tablet */
function useBreakpoint() {
  const get = () => (window.innerWidth <= 760 ? "mobile" : window.innerWidth <= 980 ? "tablet" : "desktop")
  const [bp, setBp] = useState(get)
  useEffect(() => {
    const h = () => setBp(get())
    window.addEventListener("resize", h)
    return () => window.removeEventListener("resize", h)
  }, [])
  return bp
}

/* ── HERO BANNER ─────────────────────────────────────────────────────────── */
function HeroBanner({ data, theme, lang }) {
  const imgs = data.heroImages
  const [idx, setIdx] = useState(0)
  const [dir, setDir] = useState(1)   // 1 = next (slide in from right), -1 = prev (from left)
  const [aspects, setAspects] = useState({})

  // Only measure aspect ratio (portrait vs landscape) - a plain image load, no canvas.
  useEffect(() => {
    imgs.forEach((src, i) => {
      const probe = new Image()
      probe.onload = () => setAspects((prev) => ({ ...prev, [i]: probe.naturalWidth / probe.naturalHeight }))
      probe.src = src
    })
  }, [imgs])

  const bpKey = useBreakpoint()
  const isLandscape = (aspects[idx] || 1) > 1.2
  const isDark = theme !== "light"
  const accentColor = data.heroAccents?.[idx]      // hex computed server-side at upload
  const accent = accentColor || "var(--brand)"
  const glowColor = hexToRgba(accentColor, 0.45)
  const baseBg = isDark ? "#080810" : "#ffffff"

  const advance = useCallback((d) => { setDir(d); setIdx((i) => (i + d + imgs.length) % imgs.length) }, [imgs.length])

  useEffect(() => {
    if (imgs.length < 2) return
    const t = setInterval(() => advance(1), 4000)
    return () => clearInterval(t)
  }, [advance, imgs.length])

  const s = {
    wrap: { maxWidth: 1280, margin: "0 auto", padding: "20px 32px 0", position: "relative" },
    cardBg: { position: "relative", height: 500, borderRadius: "var(--radius-lg)", overflow: "visible", border: "none", boxShadow: `0 0 40px ${glowColor}`, background: `linear-gradient(to right, ${baseBg} 0%, ${accent} 65%)`, transition: "background 0.8s ease, box-shadow 0.8s ease" },
    grad: { position: "absolute", inset: 0, zIndex: 3, background: "linear-gradient(90deg, rgba(13,13,20,.72) 0%, rgba(13,13,20,.38) 42%, rgba(13,13,20,0) 70%)" },
    left: { position: "absolute", inset: 0, padding: "0 48px 36px", display: "flex", flexDirection: "column", justifyContent: "flex-end", maxWidth: 520, zIndex: 4 },
    title: { margin: 0, fontSize: 48, fontWeight: 800, letterSpacing: -0.02, background: "linear-gradient(90deg,var(--pink-400),var(--rose-400))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" },
    desc: { color: "var(--slate-300)", fontSize: "var(--text-base)", lineHeight: 1.6, marginTop: 10, marginBottom: 24 },
    btn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 22px", borderRadius: "var(--radius-sm)", background: "var(--brand)", color: "#fff", fontWeight: 500, fontSize: "var(--text-sm)", border: "none", cursor: "pointer", boxShadow: "var(--shadow-pink-soft)" },
    arrow: (right) => ({ position: "absolute", [right ? "right" : "left"]: 16, top: "50%", zIndex: 5, transform: "translateY(-50%)", width: 40, height: 40, borderRadius: "var(--radius-full)", background: "rgba(236,72,153,.25)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", cursor: "pointer", border: "none" }),
    dots: { position: "absolute", bottom: 16, left: "50%", zIndex: 5, transform: "translateX(-50%)", display: "flex", gap: 6 },
    dot: (a) => ({ width: a ? 20 : 6, height: 6, borderRadius: 3, background: a ? "var(--pink-400)" : "rgba(255,255,255,.3)", transition: "width .3s, background .3s" }),
  }
  const slideAnim = `${dir === 1 ? "hero-slide-r" : "hero-slide-l"} .55s cubic-bezier(.22,.61,.36,1)`
  const slideAnimC = `${dir === 1 ? "hero-slide-cr" : "hero-slide-cl"} .55s cubic-bezier(.22,.61,.36,1)`
  // No drop-shadow here: tightly-cropped cutouts (opaque pixels at the image edge)
  // turn it into a visible rectangle. The soft aura comes from a radial layer behind.
  const cutout = { position: "relative", zIndex: 1, height: "auto", width: "100%", animation: slideAnim, maskImage: "linear-gradient(to bottom, black 65%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, black 65%, transparent 100%)" }
  // Lives inside the card (inset 0 + radius) - NOT inside the pop-out container,
  // whose clipped overflow would show the glow as a hard-edged band above the card.
  const aura = { position: "absolute", inset: 0, zIndex: 2, borderRadius: "var(--radius-lg)", background: `radial-gradient(ellipse 55% 65% at 70% 45%, ${glowColor} 0%, transparent 70%)`, pointerEvents: "none", transition: "background 0.8s ease" }
  return (
    <div className="sec-wrap" style={s.wrap}>
      <div className="hero-card" style={s.cardBg}>
        {/* Backdrop derived from the CURRENT slide (no separate cover upload) -
            rendered exactly like the old heroCover: sharp, the muted look comes
            from the scrim/wash layers above it. */}
        {imgs[idx] && (() => {
          // Per-slide, per-breakpoint framing set in admin (drag/zoom preview) -
          // same formula as the preview box. Legacy flat slots act as desktop.
          const slot = data.heroCovers?.[idx] || {}
          const flat = "zoom" in slot || "x" in slot || "y" in slot ? slot : null
          const cov = { zoom: 4.5, x: 0, y: -30, ...(flat || slot.desktop || {}), ...(!flat && slot[bpKey]) || {} }
          return (
            <div style={{ position: "absolute", inset: 0, borderRadius: "var(--radius-lg)", overflow: "hidden", zIndex: 1 }}>
              <img key={"c" + idx} src={imgs[idx]} alt="" style={{ position: "absolute", top: `${cov.y}%`, left: `${50 + cov.x}%`, transform: "translateX(-50%)", height: `${cov.zoom * 100}%`, width: "auto", maxWidth: "none", animation: "hero-fade-in .8s ease" }} />
            </div>
          )
        })()}
        {/* Accent wash - cover/scrim shows on the left, soft pale accent fills the right (design look) */}
        <div style={{ position: "absolute", inset: 0, zIndex: 2, borderRadius: "var(--radius-lg)", background: `linear-gradient(to right, transparent 0%, transparent 28%, ${accent} 100%)`, transition: "background 0.8s ease" }} />
        {/* Soft glow behind the character, clipped to the card */}
        <div style={aura} />
        <div style={s.grad} />
        {/* Faint accent tint so the dark left band carries a hint of the slide color */}
        <div style={{ position: "absolute", inset: 0, zIndex: 4, borderRadius: "var(--radius-lg)", background: accent, opacity: 0.16, mixBlendMode: "soft-light", pointerEvents: "none", transition: "background 0.8s ease" }} />
        {/* Character cutout (transparent PNG) pops out over the top of the card */}
        {imgs[idx] && (!isLandscape ? (
          <div className="hero-cutout" style={{ position: "absolute", right: 0, top: "-84px", bottom: 0, width: "55%", zIndex: 35, pointerEvents: "none", overflow: "hidden" }}>
            <img key={"p" + idx} src={imgs[idx]} alt="" style={cutout} />
          </div>
        ) : (
          <div className="hero-cutout hero-cutout-c" style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: "-84px", bottom: 0, width: "80%", zIndex: 35, pointerEvents: "none", overflow: "hidden" }}>
            <img key={"p" + idx} src={imgs[idx]} alt="" style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", height: "100%", width: "auto", zIndex: 1, animation: slideAnimC, maskImage: "linear-gradient(to bottom, black 65%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, black 65%, transparent 100%)" }} />
          </div>
        ))}
        <div className="hero-left" style={s.left}>
          <h1 className="hero-title" style={s.title}>{data.artistName}</h1>
          <p style={s.desc}>{data.about}</p>
          <button style={s.btn} onClick={() => document.getElementById("project")?.scrollIntoView({ behavior: "smooth" })}>
            {lang === "vi" ? "Xem dự án" : "View Projects"} {icons.chevR}
          </button>
        </div>
        {imgs.length > 1 && <button style={s.arrow(false)} onClick={() => advance(-1)}>{icons.chevL}</button>}
        {imgs.length > 1 && <button style={s.arrow(true)} onClick={() => advance(1)}>{icons.chevR}</button>}
        {imgs.length > 1 && <div style={s.dots}>{imgs.map((_, i) => <div key={i} style={s.dot(i === idx)} />)}</div>}
      </div>
    </div>
  )
}

/* ── INFO DASHBOARD (3-column) ─────────────────────────────────────────── */
function InfoSection({ data, onOpenPhoto, lang }) {
  const vi = lang === "vi"
  const L = { info: vi ? "Thông tin" : "Info", support: vi ? "Hỗ trợ" : "Support", achievements: vi ? "Sự kiện đã tham gia" : "Event Appearances" }
  const s = {
    wrap: { maxWidth: 1280, margin: "0 auto", padding: "80px 32px 0", position: "relative", zIndex: 1, scrollMarginTop: 80 },
    grid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 },
    card: { background: "var(--surface-card)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", padding: 20, boxShadow: "var(--shadow-pink-soft)" },
    secHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
    secTitle: { margin: 0, fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-link)" },
    socialRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
    sRow: (col) => ({ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)", color: col, cursor: "pointer", transition: "background .15s,border-color .15s" }),
    sLabel: { fontSize: "var(--text-sm)", fontWeight: 500 },
    achList: { display: "flex", flexDirection: "column", gap: 8 },
    achRow: { display: "flex", gap: 10, alignItems: "flex-start" },
    achDot: { width: 28, height: 28, borderRadius: "var(--radius-full)", background: "var(--brand-soft)", border: "1px solid var(--border-brand)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--brand)", flexShrink: 0, marginTop: 2 },
    achTitle: { fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)" },
    achDesc: { fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 },
  }
  return (
    <div id="info" className="sec-wrap" style={s.wrap}>
      <div className="info-grid" style={s.grid}>
        {/* Col 1: Latest photos */}
        <div style={s.card}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {data.latestPhotos.slice(0, 4).map((src, i) => (
              <div key={i} style={{ aspectRatio: "1", borderRadius: "var(--radius-md)", overflow: "hidden", cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.querySelector("img").style.transform = "scale(1.05)" }}
                onMouseLeave={(e) => { e.currentTarget.querySelector("img").style.transform = "scale(1)" }}
                onClick={() => onOpenPhoto(src)}>
                <img src={src} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", transition: "transform .3s" }} />
              </div>
            ))}
          </div>
          <button
            style={{ marginTop: 12, width: "100%", padding: "8px", borderRadius: "var(--radius-sm)", background: "transparent", border: "1px solid var(--border-default)", color: "var(--text-body)", fontWeight: 500, fontSize: "var(--text-sm)", cursor: "pointer" }}
            onMouseEnter={(e) => { e.target.style.borderColor = "var(--border-brand)"; e.target.style.color = "var(--text-link)" }}
            onMouseLeave={(e) => { e.target.style.borderColor = "var(--border-default)"; e.target.style.color = "var(--text-body)" }}
            onClick={() => data.latestPhotos[0] && onOpenPhoto(data.latestPhotos[0])}>
            {vi ? "Xem thêm" : "View More"}
          </button>
        </div>

        {/* Col 2: Info / Socials + Support */}
        <div style={s.card}>
          <div style={s.secHead}><h3 style={s.secTitle}>{L.info}</h3></div>
          <div style={s.socialRow}>
            {data.socials.map((soc) => {
              const col = socialColors[soc.platform] || "var(--text-body)"
              return (
                <a key={soc.platform + soc.url} href={soc.url} target="_blank" rel="noreferrer" style={s.sRow(col)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = `${col}15`; e.currentTarget.style.borderColor = `${col}60` }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "var(--border-default)" }}>
                  {socialIcons[soc.platform] || null}
                  <span style={s.sLabel}>{soc.label}</span>
                  <span style={{ marginLeft: "auto" }}>{icons.ext}</span>
                </a>
              )
            })}
          </div>
          <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: 14, marginTop: 14 }}>
            <h4 style={{ margin: "0 0 10px", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-link)" }}>{L.support}</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Link to="/merchandise"
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)", color: "var(--brand)", background: "transparent", textDecoration: "none", fontWeight: 600, transition: "background .15s,border-color .15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = BRAND_HEX + "18"; e.currentTarget.style.borderColor = BRAND_HEX + "70" }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "var(--border-default)" }}>
                <span style={{ display: "flex", flexShrink: 0 }}>{icons.bag}</span>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{vi ? "Cửa hàng" : "Merchandise"}</span>
              </Link>
              {data.supports.map((sp) => (
                <a key={sp.platform} href={sp.url} target="_blank" rel="noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)", color: sp.color, textDecoration: "none", transition: "background .15s,border-color .15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = sp.color + "18"; e.currentTarget.style.borderColor = sp.color + "70" }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "var(--border-default)" }}>
                  {sp.icon
                    ? <img src={sp.icon} alt="" style={{ width: 18, height: 18, objectFit: "contain", flexShrink: 0, borderRadius: 4 }} />
                    : socialIcons[sp.platform]
                      ? <span style={{ color: sp.color, display: "flex", flexShrink: 0 }}>{socialIcons[sp.platform]}</span>
                      : <span style={{ width: 10, height: 10, borderRadius: "50%", background: sp.color, flexShrink: 0, display: "inline-block" }} />}
                  <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{sp.label}</span>
                  <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>{icons.ext}</span>
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Col 3: Achievements */}
        <div style={s.card}>
          <div style={s.secHead}><h3 style={s.secTitle}>{L.achievements}</h3></div>
          <div style={s.achList}>
            {data.achievements.map((a, i) => (
              <div key={i} style={s.achRow}>
                <div style={s.achDot}>{icons.star}</div>
                <div>
                  <div style={s.achTitle}>{a.title}</div>
                  <div style={s.achDesc}>{a.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── PROJECT + SCHEDULE ─────────────────────────────────────────────────── */
function ProjectSection({ data, onOpenAlbum, lang }) {
  const vi = lang === "vi"
  const LP = { project: vi ? "Dự án" : "Project", schedule: vi ? "Lịch" : "Schedule" }
  const [hov, setHov] = useState(null)
  const s = {
    wrap: { maxWidth: 1280, margin: "0 auto", padding: "28px 32px 0", scrollMarginTop: 80 },
    outerGrid: { display: "grid", gridTemplateColumns: "1fr 300px", gap: 20 },
    card: { background: "var(--surface-card)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", padding: 20, boxShadow: "var(--shadow-pink-soft)" },
    secTitle: { margin: "0 0 16px", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-link)" },
    albumGrid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 },
    albumCard: { borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border-default)", cursor: "pointer", background: "var(--bg-sunken)", position: "relative", transition: "transform .25s,box-shadow .25s" },
    albumImg: { width: "100%", aspectRatio: "4/5", objectFit: "cover", display: "block" },
    albumFoot: { padding: "10px 14px", borderTop: "1px solid var(--border-default)" },
    albumTitle: { fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)" },
    albumCount: { fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 },
    plusBtn: { position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: "var(--radius-full)", background: "rgba(236,72,153,.25)", border: "1px solid rgba(236,72,153,.5)", color: "var(--pink-400)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, lineHeight: 1 },
    evList: { display: "flex", flexDirection: "column", gap: 10 },
    evRow: { display: "flex", gap: 12, padding: "10px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)", alignItems: "flex-start", cursor: "pointer", transition: "border-color .15s,background .15s" },
    evDot: { width: 8, height: 8, borderRadius: "var(--radius-full)", background: "var(--brand)", flexShrink: 0, marginTop: 5 },
    evTitle: { fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)", lineHeight: 1.3 },
    evDate: { fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 3, display: "flex", alignItems: "center", gap: 4 },
  }
  return (
    <div id="project" className="sec-wrap" style={s.wrap}>
      <div className="proj-grid" style={s.outerGrid}>
        <div style={s.card}>
          <h3 style={s.secTitle}>{LP.project}</h3>
          <div className="album-grid" style={s.albumGrid}>
            {data.albums.map((alb, i) => (
              <div key={alb.id} style={{ ...s.albumCard, transform: hov === i ? "scale(1.02)" : "none", boxShadow: hov === i ? "var(--shadow-pink-hover)" : "none" }}
                onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} onClick={() => onOpenAlbum(alb)}>
                <img src={alb.cover} alt={alb.title} loading="lazy" decoding="async" style={s.albumImg} />
                <div style={s.plusBtn}>+</div>
                <div style={s.albumFoot}>
                  <div style={s.albumTitle}>{alb.title}</div>
                  <div style={s.albumCount}>{alb.count} {vi ? "ảnh" : "photos"}</div>
                </div>
              </div>
            ))}
            {data.albums.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: 0 }}>{vi ? "Chưa có album." : "No albums yet."}</p>
            )}
          </div>
        </div>
        <div style={s.card}>
          <h3 style={s.secTitle}>{LP.schedule}</h3>
          <div style={s.evList}>
            {data.upcomingEvents.map((ev, i) => {
              const hasUrl = ev.url && ev.url !== "#"
              const Row = hasUrl ? "a" : "div"
              return (
                <Row key={i}
                  {...(hasUrl ? { href: ev.url, target: "_blank", rel: "noreferrer" } : {})}
                  style={{ ...s.evRow, cursor: hasUrl ? "pointer" : "default" }}
                  onMouseEnter={(e) => { if (!hasUrl) return; e.currentTarget.style.borderColor = "var(--border-brand)"; e.currentTarget.style.background = "var(--brand-soft)" }}
                  onMouseLeave={(e) => { if (!hasUrl) return; e.currentTarget.style.borderColor = "var(--border-default)"; e.currentTarget.style.background = "transparent" }}>
                  <div style={s.evDot} />
                  <div>
                    <div style={s.evTitle}>{ev.title}</div>
                    <div style={s.evDate}>{icons.cal} {ev.date}</div>
                  </div>
                </Row>
              )
            })}
            {data.upcomingEvents.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: 0 }}>{vi ? "Chưa có sự kiện." : "No upcoming events."}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── CONTACT & SUPPORT ───────────────────────────────────────────────────── */
function ContactSection({ data, lang }) {
  const vi = lang === "vi"
  const LC = { contact: vi ? "Liên hệ" : "Contact", support: vi ? "Hỗ trợ" : "Support" }
  const BTN_W = 130
  const s = {
    wrap: { maxWidth: 1280, margin: "0 auto", padding: "28px 32px 48px", scrollMarginTop: 80, position: "relative", overflow: "visible" },
    card: { background: "var(--surface-card)", border: "1px solid var(--border-default)", borderBottom: "none", borderRadius: "var(--radius-lg)", padding: "28px 32px 28px", boxShadow: "var(--shadow-pink-soft)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, position: "relative", overflow: "visible" },
    title: { margin: "0 0 14px", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-link)" },
    label: { fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".06em" },
    linkVal: { fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-link)", marginTop: 4, textDecoration: "none", display: "block" },
    // Neutral border/background by default - color only fills in on hover
    // (matches InfoSection's support list, e.g. "Gank" in a screenshot review).
    btn: (col) => ({ display: "inline-flex", alignItems: "center", justifyContent: "flex-start", gap: 6, width: BTN_W, padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)", color: col, fontSize: "var(--text-sm)", fontWeight: 500, cursor: "pointer", background: "transparent", textDecoration: "none", boxSizing: "border-box", transition: "background .15s,border-color .15s" }),
  }
  const hoverProps = (col) => ({
    onMouseEnter: (e) => { e.currentTarget.style.background = col + "18"; e.currentTarget.style.borderColor = col + "70" },
    onMouseLeave: (e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "var(--border-default)" },
  })
  return (
    <div id="contact" className="sec-wrap" style={s.wrap}>
      <div className="contact-card" style={s.card}>
        <div>
          <h3 style={s.title}>{LC.contact}</h3>
          <p style={{ color: "var(--text-body)", fontSize: "var(--text-sm)", margin: "0 0 14px", lineHeight: 1.6 }}>
            {vi ? "Muốn đặt lịch hoặc hợp tác? Liên hệ để bắt đầu nhé!" : "Want to book or collaborate? Contact to get started."}
          </p>
          {data.contact.email && (
            <div style={{ marginBottom: 12 }}>
              <div style={s.label}>Email</div>
              <a href={`mailto:${data.contact.email}`} style={s.linkVal}>{data.contact.email}</a>
            </div>
          )}
          {data.contact.quick.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {data.contact.quick.map((c) => {
                const meta = CONTACT_META[c.type] || {}
                const col = meta.color || BRAND_HEX
                return (
                  <a key={c.type} href={contactHref(c.type, c.value)} target="_blank" rel="noreferrer" style={s.btn(col)}
                    {...hoverProps(col)}>
                    {meta.icon
                      ? <img src={meta.icon} alt="" style={{ width: 18, height: 18, objectFit: "contain", flexShrink: 0, borderRadius: 3 }} />
                      : CONTACT_ICONS[c.type] ? <span style={{ display: "flex", flexShrink: 0, color: col }}>{CONTACT_ICONS[c.type]}</span> : null}
                    {meta.label || c.type}
                  </a>
                )
              })}
            </div>
          )}
        </div>
        <div>
          <h3 style={s.title}>{LC.support}</h3>
          <p style={{ color: "var(--text-body)", fontSize: "var(--text-sm)", margin: "0 0 14px", lineHeight: 1.6 }}>
            {vi ? "Ủng hộ mình qua" : "Support my work via"}
          </p>
          <div className="support-row" style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
            <Link to="/merchandise" style={s.btn(BRAND_HEX)} {...hoverProps(BRAND_HEX)}>
              <span style={{ display: "flex", flexShrink: 0 }}>{icons.bag}</span>
              {vi ? "Cửa hàng" : "Merchandise"}
            </Link>
            {data.supports.filter((sp) => sp.platform !== "gank").map((sp) => (
              <a key={sp.platform} href={sp.url} target="_blank" rel="noreferrer" style={s.btn(sp.color)}
                {...hoverProps(sp.color)}>
                {sp.icon
                  ? <img src={sp.icon} alt="" width={16} height={16} style={{ objectFit: "contain", flexShrink: 0, borderRadius: 3 }} />
                  : socialIcons[sp.platform] ? <span style={{ display: "flex", flexShrink: 0, color: sp.color }}>{socialIcons[sp.platform]}</span> : null}
                {sp.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── EVENT POPUP (shows on every page load) ──────────────────────────────── */
function EventPopup({ event, lang, onClose }) {
  const vi = lang === "vi"
  return (
    <div onClick={onClose} role="dialog" aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--surface-card)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-pink-glow)", maxWidth: 420, width: "100%", padding: "20px 24px", overflow: "hidden" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-strong)" }}>{vi ? "Thông báo" : "Announcement"}</h3>
        {event.imageUrl && (
          <img src={event.imageUrl} alt="" style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: "var(--radius-md)", marginTop: 8 }} />
        )}
        <p style={{ margin: "10px 0 2px", fontSize: "var(--text-base)", fontWeight: 500, color: "var(--text-link)" }}>{event.title}</p>
        {event.date && <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{event.date}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          {event.url && event.url !== "#" && (
            <a href={event.url} target="_blank" rel="noreferrer"
              style={{ padding: "8px 16px", borderRadius: "var(--radius-sm)", background: "var(--brand)", color: "#fff", fontWeight: 500, fontSize: "var(--text-sm)", textDecoration: "none" }}>
              {vi ? "Xem chi tiết" : "View details"}
            </a>
          )}
          <button onClick={onClose}
            style={{ padding: "8px 16px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-body)", fontWeight: 500, fontSize: "var(--text-sm)", cursor: "pointer" }}>
            {vi ? "Đóng" : "Close"}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── LIGHTBOX ────────────────────────────────────────────────────────────── */
function Lightbox({ photos, startIdx, onClose, vi }) {
  const [idx, setIdx] = useState(startIdx || 0)
  const [imgLoaded, setImgLoaded] = useState(false)
  const total = photos.length
  const current = photos[idx]
  const pairedSrc = slidePairedSrc(current)
  const prev = useCallback(() => setIdx((i) => (i - 1 + total) % total), [total])
  const next = useCallback(() => setIdx((i) => (i + 1) % total), [total])

  // Spinner while the current photo downloads
  useEffect(() => { setImgLoaded(false) }, [idx])

  // Circular preload: warm the browser cache for the neighbours of the current
  // photo (wrapping around), so prev/next swaps are instant. A before/after
  // slide preloads both halves.
  useEffect(() => {
    if (total < 2) return
    for (const n of [(idx + 1) % total, (idx - 1 + total) % total]) {
      const im = new Image()
      im.src = slideSrc(photos[n])
      const paired = slidePairedSrc(photos[n])
      if (paired) { const im2 = new Image(); im2.src = paired }
    }
  }, [idx, photos, total])
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") onClose()
      if (e.key === "ArrowLeft") prev()
      if (e.key === "ArrowRight") next()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [prev, next, onClose])
  const navBtn = (onClick, d, right) => (
    <button onClick={(e) => { e.stopPropagation(); onClick() }} style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", [right ? "right" : "left"]: 16, width: 44, height: 44, borderRadius: "var(--radius-full)", background: "rgba(0,0,0,.6)", border: "1px solid rgba(255,255,255,.2)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55, backdropFilter: "blur(4px)" }}>{d}</button>
  )
  const photoStyle = { maxHeight: "88vh", maxWidth: pairedSrc ? "44vw" : "88vw", objectFit: "contain", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pink-glow)", animation: "hero-fade-in .25s ease", visibility: imgLoaded ? "visible" : "hidden" }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.92)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      {!imgLoaded && <div className="lightbox-spinner" onClick={(e) => e.stopPropagation()} />}
      {pairedSrc ? (
        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ position: "relative" }}>
            <img key={`${idx}-before`} src={slideSrc(current)} alt="" onLoad={() => setImgLoaded(true)} style={photoStyle} />
            <span style={{ position: "absolute", top: 8, left: 8, padding: "2px 10px", borderRadius: "var(--radius-full)", background: "rgba(0,0,0,.65)", color: "#fff", fontSize: 12, fontWeight: 600 }}>{vi ? "Trước" : "Before"}</span>
          </div>
          <div style={{ position: "relative" }}>
            <img key={`${idx}-after`} src={pairedSrc} alt="" style={photoStyle} />
            <span style={{ position: "absolute", top: 8, left: 8, padding: "2px 10px", borderRadius: "var(--radius-full)", background: "rgba(0,0,0,.65)", color: "#fff", fontSize: 12, fontWeight: 600 }}>{vi ? "Sau" : "After"}</span>
          </div>
        </div>
      ) : (
        <img key={idx} src={slideSrc(current)} alt="" onClick={(e) => e.stopPropagation()} onLoad={() => setImgLoaded(true)} style={photoStyle} />
      )}
      {total > 1 && navBtn(prev, icons.chevL, false)}
      {total > 1 && navBtn(next, icons.chevR, true)}
      {total > 1 && <div style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6 }}>{photos.map((_, i) => <div key={i} onClick={(e) => { e.stopPropagation(); setIdx(i) }} style={{ width: i === idx ? 20 : 6, height: 6, borderRadius: 3, background: i === idx ? "var(--brand)" : "rgba(255,255,255,.35)", cursor: "pointer", transition: "all .2s" }} />)}</div>}
      <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, width: 36, height: 36, borderRadius: "var(--radius-full)", background: "var(--brand)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55 }}>
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  )
}

/* ── DATA ADAPTER (cfg + gallery → reference DATA shape) ─────────────────── */
function buildData(cfg, gallery, lang) {
  const heroImages = cfg.heroImages?.length ? cfg.heroImages : cfg.heroImageUrl ? [cfg.heroImageUrl] : []
  const albums = (gallery || []).map((g) => ({
    id: g.id,
    title: g.group,
    count: g.items?.length || 0,
    cover: g.items?.[0]?.src || "",
    items: buildAlbumSlides(g.items),
  }))
  const galleryPhotos = (gallery || []).flatMap((g) => g.items || []).map((it) => it.src)
  // Latest photos: admin-uploaded (config.latestPhotos) → gallery items → hero images
  const latestPhotos = cfg.latestPhotos?.length ? cfg.latestPhotos : galleryPhotos.length ? galleryPhotos : heroImages
  const supportsCfg = cfg.contact?.supports || {}
  const supports = Object.keys(SUPPORT_META)
    .filter((k) => supportsCfg[k])
    .map((k) => ({ platform: k, label: SUPPORT_META[k].label, color: SUPPORT_META[k].color, icon: SUPPORT_META[k].icon, url: supportsCfg[k] }))
  // Quick contact buttons: Zalo/WhatsApp/Messenger (contactLinks) + Gmail (email). No raw phone shown.
  const email = cfg.contact?.email || ""
  let links = (cfg.contact?.contactLinks || []).filter((c) => c && c.value && ["zalo", "whatsapp", "messenger"].includes(c.type))
  if (!links.length && cfg.contact?.phone) links = [{ type: "zalo", value: cfg.contact.phone }] // legacy phone → Zalo
  const quick = [...links.map((c) => ({ type: c.type, value: c.value })), ...(email ? [{ type: "gmail", value: email }] : [])]
  return {
    artistName: getLocalized(cfg.artistName, lang),
    about: getLocalized(cfg.about, lang),
    heroImages,
    // heroAccents persisted as [{mode,color}] (color computed server-side at upload) or plain strings → color string | null
    heroAccents: (cfg.heroAccents || []).map((a) =>
      typeof a === "string" ? a : a?.color || null
    ),
    heroCovers: Array.isArray(cfg.heroCovers) ? cfg.heroCovers : [],
    latestPhotos,
    albums,
    socials: cfg.contact?.social || [],
    supports,
    achievements: (cfg.achievements || []).map((a) => ({
      title: getLocalized(a.title, lang),
      description: getLocalized(a.description, lang),
    })),
    upcomingEvents: (cfg.upcomingEvents || []).map((ev) => ({
      ...ev,
      title: getLocalized(ev.title, lang),
      date: getLocalized(ev.date, lang),
    })),
    contact: { email, quick },
    footerChar: cfg.footerChar || "",
  }
}

/* ── APP / PAGE ──────────────────────────────────────────────────────────── */
export default function Portfolio() {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const { lang, setLang } = useLanguage()
  const [gallery, setGallery] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState(null)
  const [eventPopup, setEventPopup] = useState(null)
  const [showFooterChar, setShowFooterChar] = useState(true)
  const [footerCharLoaded, setFooterCharLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      axios.get("/api/gallery").then((r) => r.data).catch(() => []),
      axios.get("/api/settings").then((r) => r.data).catch(() => null),
    ]).then(([g, s]) => {
      setGallery(Array.isArray(g) ? g : [])
      setSettings(s)
      applyColorScheme(s?.colorScheme || "green")
    }).finally(() => setLoading(false))
  }, [])

  const cfg = settings || SITE_CONFIG
  const data = buildData(cfg, gallery, lang)

  useEffect(() => { document.title = data.artistName || "Kamidayhehe" }, [data.artistName])

  // Favicon comes from <link rel="icon" href="/api/favicon.png"> in index.html -
  // a server-generated 64px PNG. Don't swap it to the full-size logo here:
  // browsers cache that huge image as the site icon and show a placeholder
  // block while decoding it on the next load.

  // Popup shows on every page load (F5 included) - closing only hides it until the next load
  useEffect(() => {
    if (!settings) return
    const events = settings.upcomingEvents || []
    const idx = events.findIndex((ev) => ev.showPopup)
    if (idx === -1) return
    const id = setTimeout(() => setEventPopup({ event: events[idx] }), 600)
    return () => clearTimeout(id)
  }, [settings])

  const closeEventPopup = () => setEventPopup(null)

  const openPhoto = (photos, idx = 0) => setLightbox({ photos: Array.isArray(photos) ? photos : [photos], idx })
  const logoUrl = cfg.logoUrl || ""

  const popupEvent = eventPopup && {
    ...eventPopup.event,
    title: getLocalized(eventPopup.event.title, lang),
    date: getLocalized(eventPopup.event.date, lang),
  }

  return (
    <div
      className="portfolio-root"
      style={{ minHeight: "100vh", background: "var(--bg-page)", color: "var(--text-strong)" }}
      onContextMenu={(e) => { if (e.target.tagName === "IMG") e.preventDefault() }}>
      <Navbar theme={theme} onToggleTheme={toggleTheme} lang={lang} onSetLang={setLang}
        artistName={data.artistName} tagline={getLocalized(cfg.tagline, lang)} logoUrl={logoUrl} />

      {/* Full-page spinner while settings load from the backend */}
      {loading && (
        <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="lightbox-spinner" style={{ position: "static" }} />
        </div>
      )}

      {!loading && <HeroBanner data={data} theme={theme} lang={lang} />}
      {!loading && <Reveal><InfoSection data={data} lang={lang} onOpenPhoto={(src) => openPhoto(data.latestPhotos, Math.max(0, data.latestPhotos.indexOf(src)))} /></Reveal>}
      {!loading && <Reveal><ProjectSection data={data} lang={lang} onOpenAlbum={(alb) => openPhoto(alb.items?.length ? alb.items : [alb.cover], 0)} /></Reveal>}

      <div style={{ position: "relative", isolation: "isolate" }}>
        {!loading && <Reveal><ContactSection data={data} lang={lang} /></Reveal>}
        <footer style={{ borderTop: "1px solid var(--border-default)", background: "var(--bg-sunken)", marginTop: 8, position: "relative", zIndex: 1 }}>
          <div className="footer-bar" style={{ maxWidth: 1280, margin: "0 auto", padding: "16px 32px", display: "flex", justifyContent: "space-between", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
            <span>© {new Date().getFullYear()} {data.artistName}. {lang === "vi" ? "Bảo lưu mọi quyền." : "All rights reserved."}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ whiteSpace: "nowrap" }}>Made with ♥</span>
              <span className="footer-admin" aria-hidden="true">·</span>
              <button className="footer-admin" onClick={() => navigate("/admin")} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "var(--text-sm)", padding: 0 }}>Admin</button>
            </span>
          </div>
        </footer>
        {!loading && data.footerChar && showFooterChar && (
          <div className="footer-char" style={{ position: "absolute", bottom: 0, right: 32, height: "calc(100% + 260px)", width: "auto", zIndex: 40, pointerEvents: "none", visibility: footerCharLoaded ? "visible" : "hidden" }}>
            {/* Soft radial aura BEHIND the character - no straight edges, so a tightly-cropped
                cutout never turns the glow into a rectangular frame (unlike a drop-shadow).
                The whole block stays hidden until the image loads - otherwise the aura
                shows up alone as a floating purple blob during page load. */}
            <div style={{ position: "absolute", inset: "-40px -30px 40px", background: "radial-gradient(ellipse at 50% 55%, rgba(180,120,255,0.40) 0%, rgba(180,120,255,0.16) 45%, transparent 72%)", filter: "blur(30px)", zIndex: 0, pointerEvents: "none" }} />
            <img src={data.footerChar} alt="" loading="lazy" decoding="async" onLoad={() => setFooterCharLoaded(true)} style={{ position: "relative", zIndex: 1, height: "100%", width: "auto", objectFit: "contain", objectPosition: "bottom right", display: "block" }} />
            <button onClick={() => setShowFooterChar(false)} title={lang === "vi" ? "Ẩn nhân vật" : "Hide character"} aria-label="Hide character"
              style={{ position: "absolute", top: 280, right: 8, width: 30, height: 30, borderRadius: "var(--radius-full)", background: "color-mix(in srgb, var(--bg-page) 70%, transparent)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", border: "1px solid var(--border-default)", color: "var(--text-body)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "auto", zIndex: 41 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-link)"; e.currentTarget.style.borderColor = "var(--border-brand)" }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-body)"; e.currentTarget.style.borderColor = "var(--border-default)" }}>
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}
      </div>

      {lightbox && <Lightbox photos={lightbox.photos} startIdx={lightbox.idx} onClose={() => setLightbox(null)} vi={lang === "vi"} />}
      {eventPopup && <EventPopup event={popupEvent} lang={lang} onClose={closeEventPopup} />}
    </div>
  )
}
