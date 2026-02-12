import { useEffect, useState } from "react"
import axios from "axios"
import Navbar from "../components/Navbar"
import Gallery from "../components/Gallery"
import Lightbox from "../components/Lightbox"
import SmallStat from "../components/SmallStat"
import ScrollReveal from "../components/ScrollReveal"
import UpcomingEvents from "../components/UpcomingEvents"
import Supports from "../components/Supports"
import { SITE_CONFIG } from "../config"
import { useLanguage } from "../contexts/LanguageContext"
import { getLocalized } from "../utils/localize"
import { contactPlatforms, getSocialIcon } from "../utils/platformIcons"

export default function Portfolio() {
  const { t, lang } = useLanguage()
  const [gallery, setGallery] = useState([])
  const [settings, setSettings] = useState(null)
  const [active, setActive] = useState({ open: false, src: "", caption: "" })
  const [loading, setLoading] = useState(true)
  const [eventPopup, setEventPopup] = useState(null)

  useEffect(() => {
    Promise.all([
      axios.get("/api/gallery").then((r) => r.data).catch(() => []),
      axios.get("/api/settings").then((r) => r.data).catch(() => null),
    ]).then(([g, s]) => {
      setGallery(g)
      setSettings(s)
    }).finally(() => setLoading(false))
  }, [])

  const cfg = settings || SITE_CONFIG

  useEffect(() => {
    document.title = getLocalized(cfg.artistName, lang) || "Cosplay Portfolio"
  }, [cfg.artistName, lang])

  const totalPhotos = gallery.reduce((s, g) => s + (g.items?.length || 0), 0)
  const galleryHero = (() => {
    const all = gallery.flatMap((g) => g.items || [])
    const landscape = all.find((img) => img.width != null && img.height != null && img.width > img.height)
    return landscape || all[0] || null
  })()
  const heroImage = cfg.heroImageUrl
    ? { src: cfg.heroImageUrl, url: cfg.heroImageUrl }
    : galleryHero
  const heroSectionImage = cfg.thumbnailImageUrl
    ? { src: cfg.thumbnailImageUrl, url: cfg.thumbnailImageUrl }
    : heroImage || galleryHero
  const profileImage = heroImage

  useEffect(() => {
    const href = heroImage?.src || heroImage?.url
    if (href) {
      let link = document.querySelector('link[rel="icon"]')
      if (!link) {
        link = document.createElement("link")
        link.rel = "icon"
        document.head.appendChild(link)
      }
      link.href = href
    }
  }, [heroImage?.src, heroImage?.url])

  const previewImageUrl = cfg.thumbnailImageUrl || heroImage?.src || heroImage?.url
  useEffect(() => {
    if (!previewImageUrl) return
    const absolute = previewImageUrl.startsWith("http") ? previewImageUrl : `${window.location.origin}${previewImageUrl.startsWith("/") ? "" : "/"}${previewImageUrl}`
    for (const { selector, key, val } of [
      { selector: 'meta[property="og:image"]', key: "property", val: "og:image" },
      { selector: 'meta[name="twitter:image"]', key: "name", val: "twitter:image" },
    ]) {
      let el = document.querySelector(selector)
      if (!el) {
        el = document.createElement("meta")
        el.setAttribute(key, val)
        document.head.appendChild(el)
      }
      el.setAttribute("content", absolute)
    }
  }, [previewImageUrl])

  useEffect(() => {
    if (!settings) return
    const events = settings.upcomingEvents || []
    const idx = events.findIndex((ev) => ev.showPopup)
    if (idx === -1) return
    const key = `eventPopup_${idx}`
    if (sessionStorage.getItem(key)) return
    const payload = { event: events[idx], key }
    const id = setTimeout(() => setEventPopup(payload), 0)
    return () => clearTimeout(id)
  }, [settings])

  const closeEventPopup = () => {
    if (eventPopup) {
      sessionStorage.setItem(eventPopup.key, "1")
      setEventPopup(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-cosplay-dark text-gray-900 dark:text-slate-200">
      {eventPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={closeEventPopup} aria-modal="true" role="dialog" aria-label={t("eventPopupTitle")}>
          <div
            className="bg-white dark:bg-cosplay-card rounded-xl shadow-xl border border-gray-200 dark:border-cosplay-border max-w-md w-full p-5 sm:p-6 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">{t("eventPopupTitle")}</h3>
            {eventPopup.event.imageUrl && (
              <img src={eventPopup.event.imageUrl} alt="" className="mt-2 w-full aspect-video object-cover rounded-lg" />
            )}
            <p className="mt-2 text-base font-medium text-pink-500 dark:text-pink-400">{getLocalized(eventPopup.event.title, lang)}</p>
            {eventPopup.event.date && (
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-500">{eventPopup.event.date}</p>
            )}
            <div className="mt-4 flex gap-2 flex-wrap">
              {eventPopup.event.url && (
                <a
                  href={eventPopup.event.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block px-4 py-2 rounded-md font-medium text-white bg-pink-500 hover:bg-pink-400"
                >
                  {t("eventPopupViewLink")}
                </a>
              )}
              <button
                type="button"
                onClick={closeEventPopup}
                className="inline-block px-4 py-2 rounded-md border border-gray-300 dark:border-cosplay-border text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-cosplay-darker"
              >
                {t("eventPopupClose")}
              </button>
            </div>
          </div>
        </div>
      )}

      <Navbar artistName={getLocalized(cfg.artistName, lang)} tagline={getLocalized(cfg.tagline, lang)} heroImageUrl={heroImage?.src || heroImage?.url} />

      {/* Hero */}
      <section id="home" className="relative">
        <ScrollReveal>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8">
          <div className="mt-4 sm:mt-6 md:mt-8 rounded-lg sm:rounded-xl overflow-hidden shadow-pink-glow border border-gray-200 dark:border-cosplay-border grid grid-cols-1 md:grid-cols-2 gap-0 bg-white dark:bg-cosplay-card">
            <div className="p-4 sm:p-6 md:p-12 order-2 md:order-1">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold leading-tight">
                <span className="bg-gradient-to-r from-pink-400 to-rose-400 bg-clip-text text-transparent">
                  {getLocalized(cfg.artistName, lang)}
                </span>
                <span className="block text-gray-600 dark:text-slate-400 mt-1 sm:mt-2 text-lg sm:text-xl md:text-2xl">
                  {getLocalized(cfg.hero?.subtitle, lang) || "Cosplay portfolio & highlights"}
                </span>
              </h1>
              <p className="mt-3 sm:mt-4 text-sm sm:text-base text-gray-600 dark:text-slate-400 line-clamp-3 sm:line-clamp-none whitespace-pre-line">
                {getLocalized(cfg.hero?.description, lang) || "Portfolio for cosplay photos, props, and booking info. Optimized for mobile and photo gallery."}
              </p>
              <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row gap-2 sm:gap-3">
                <a
                  href="#gallery"
                  className="inline-block px-4 py-2.5 sm:py-2 rounded-md font-medium text-white bg-pink-500 hover:bg-pink-400 shadow-pink-soft transition-colors text-center"
                >
                  {t("btnViewGallery")}
                </a>
                <a
                  href="#about"
                  className="inline-block px-4 py-2.5 sm:py-2 rounded-md border border-gray-300 dark:border-cosplay-border text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-cosplay-card hover:border-pink-500/50 transition-colors text-center"
                >
                  {t("btnAboutMe")}
                </a>
              </div>
              <div className="mt-6 sm:mt-8 grid grid-cols-3 gap-2 sm:gap-3">
                <SmallStat number={totalPhotos > 0 ? `${totalPhotos}+` : "0"} label={t("photos")} />
                <SmallStat number={gallery.length || "0"} label={t("albums")} />
                <SmallStat number={(cfg.upcomingEvents || []).length} label={t("upcomingEvents")} />
              </div>
            </div>
            <div className="h-56 sm:h-72 md:h-96 bg-gray-100 dark:bg-cosplay-darker flex items-center justify-center overflow-hidden md:border-l border-gray-200 dark:border-cosplay-border order-1 md:order-2">
              {heroSectionImage ? (
                <img
                  src={heroSectionImage.src || heroSectionImage.url}
                  alt="hero cosplay"
                  className="object-cover w-full h-full"
                />
              ) : (
                <div className="text-gray-500 dark:text-slate-500 text-center p-4">{t("noImages")}</div>
              )}
            </div>
          </div>
        </div>
        </ScrollReveal>
      </section>

      {/* About */}
      <section id="about" className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 mt-8 sm:mt-12 pb-8 sm:pb-12">
        <ScrollReveal delay={100}>
        <div className="bg-white dark:bg-cosplay-card rounded-lg sm:rounded-xl border border-gray-200 dark:border-cosplay-border p-4 sm:p-6 md:p-10 shadow-pink-soft">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 items-center">
            <div className="flex justify-center md:justify-start">
              {profileImage ? (
                <img
                  src={profileImage.src || profileImage.url}
                  alt="profile"
                  className="w-36 h-36 sm:w-48 sm:h-48 object-cover rounded-lg shadow-pink-glow border border-pink-500/30"
                />
              ) : (
                <div className="w-36 h-36 sm:w-48 sm:h-48 bg-gray-100 dark:bg-cosplay-darker rounded-lg flex items-center justify-center text-gray-500 dark:text-slate-500 border border-gray-200 dark:border-cosplay-border text-sm">
                  {t("noImages")}
                </div>
              )}
            </div>
            <div className="md:col-span-2">
              <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-slate-100">{t("aboutMe")}</h3>
              <p className="mt-2 sm:mt-3 text-sm sm:text-base text-gray-600 dark:text-slate-400 whitespace-pre-line">{getLocalized(cfg.about, lang)}</p>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {(cfg.contact?.social || []).filter((s) => s?.url).map((s) => {
                  const meta = getSocialIcon(s.label)
                  const style = meta ? meta.borderClass : "border-gray-300 dark:border-cosplay-border hover:border-pink-500 dark:hover:border-pink-400"
                  return (
                    <a
                      key={s.label + s.url}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border text-sm font-medium transition-colors ${style}`}
                      style={meta?.color ? { color: meta.color } : {}}
                    >
                      {meta?.Icon ? <meta.Icon /> : null}
                      {s.label}
                    </a>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
        </ScrollReveal>
      </section>

      {/* Events */}
      <UpcomingEvents events={cfg.upcomingEvents} />

      {/* Gallery */}
      <section id="gallery" className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 mt-8 sm:mt-10">
        <ScrollReveal delay={100}>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-slate-100">{t("gallery")}</h2>
        <p className="text-sm sm:text-base text-gray-600 dark:text-slate-400 mt-1 sm:mt-2">{t("galleryDesc")}</p>
        {loading ? (
          <div className="mt-6 text-gray-500 dark:text-slate-500">{t("loading")}</div>
        ) : (
          <Gallery gallery={gallery} onOpenLightbox={setActive} />
        )}
        </ScrollReveal>
      </section>

      {/* Supports */}
      <ScrollReveal delay={100}>
        <Supports supports={cfg.contact?.supports} />
      </ScrollReveal>

      {/* Contact */}
      <section id="contact" className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 mt-6 sm:mt-8 pb-12 sm:pb-20">
        <ScrollReveal delay={100}>
        <div className="bg-white dark:bg-cosplay-card rounded-lg sm:rounded-xl border border-gray-200 dark:border-cosplay-border p-4 sm:p-6 md:p-10 shadow-pink-soft">
          <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-slate-100">{t("contactBooking")}</h3>
          <p className="text-sm sm:text-base text-gray-600 dark:text-slate-400 mt-1 sm:mt-2">{t("contactDesc")}</p>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-slate-400">{t("phone")}</label>
                {cfg.contact?.phone ? (
                  <a
                    href={`https://zalo.me/${(v => {
                      const r = String(v).replace(/\D/g, "")
                      return r.startsWith("0") ? "84" + r.slice(1) : r.startsWith("84") ? r : "84" + r
                    })(cfg.contact.phone)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block text-gray-900 dark:text-slate-200 font-medium text-sm sm:text-base break-all hover:text-pink-500 dark:hover:text-pink-400"
                  >
                    {cfg.contact.phone}
                  </a>
                ) : (
                  <span className="mt-1 block text-gray-500 dark:text-slate-500 text-sm">—</span>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-slate-400">{t("email")}</label>
                {cfg.contact?.email ? (
                  <a href={`mailto:${cfg.contact.email}`} className="mt-1 block text-gray-900 dark:text-slate-200 font-medium text-sm sm:text-base break-all hover:text-pink-500 dark:hover:text-pink-400">
                    {cfg.contact.email}
                  </a>
                ) : (
                  <span className="mt-1 block text-gray-500 dark:text-slate-500 text-sm">—</span>
                )}
              </div>
            </div>
            <div>
              <h4 className="font-medium text-base sm:text-lg text-gray-900 dark:text-slate-200">{t("contactLinks")}</h4>
              <div className="mt-2 sm:mt-3 flex flex-wrap gap-2">
                {(cfg.contact?.contactLinks || []).filter((c) => c?.value?.trim()).map((c, i) => {
                  const type = (c.type || "zalo").toLowerCase()
                  const value = String(c.value || "").trim()
                  const meta = contactPlatforms[type]
                  let href = "#"
                  let label = type
                  if (type === "zalo") {
                    const raw = value.replace(/\D/g, "")
                    const num = raw.startsWith("0") ? "84" + raw.slice(1) : raw.startsWith("84") ? raw : "84" + raw
                    href = `https://zalo.me/${num}`
                    label = "Zalo"
                  } else if (type === "whatsapp") {
                    const raw = value.replace(/\D/g, "")
                    const num = raw.startsWith("0") ? "84" + raw.slice(1) : raw.startsWith("84") ? raw : "84" + raw
                    href = `https://wa.me/${num}`
                    label = "WhatsApp"
                  } else if (type === "gmail") {
                    href = value ? `mailto:${value}` : "#"
                    label = "Gmail"
                  }
                  const borderClass = meta?.borderClass ?? "border-gray-300 dark:border-cosplay-border hover:border-pink-500"
                  return (
                    <a
                      key={i}
                      href={href}
                      target={type === "gmail" ? "_self" : "_blank"}
                      rel={type === "gmail" ? undefined : "noreferrer"}
                      onClick={type === "gmail" && value ? (e) => { e.preventDefault(); window.location.href = `mailto:${value}` } : undefined}
                      className={`inline-flex items-center gap-1.5 px-4 py-2.5 sm:py-2 rounded-md font-medium text-sm sm:text-base border transition-colors ${borderClass}`}
                      style={meta?.color ? { color: meta.color } : {}}
                    >
                      {meta?.Icon ? <meta.Icon /> : null}
                      {label}
                    </a>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
        </ScrollReveal>
      </section>

      <footer className="mt-8 sm:mt-12 border-t border-gray-200 dark:border-cosplay-border bg-gray-100 dark:bg-cosplay-darker">
        <ScrollReveal>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 py-4 sm:py-6 text-xs sm:text-sm text-gray-500 dark:text-slate-500 flex flex-col md:flex-row justify-between items-center gap-2 text-center md:text-left">
          <div>© {new Date().getFullYear()} {getLocalized(cfg.artistName, lang)}. All rights reserved.</div>
          <div className="flex gap-3 sm:gap-4 items-center flex-wrap justify-center">
            <span>{t("builtWith")}</span>
            <a
              href="/admin"
              className="text-gray-500 dark:text-slate-500 hover:text-pink-500 dark:hover:text-pink-400 transition-colors"
            >
              {t("admin")}
            </a>
          </div>
        </div>
        </ScrollReveal>
      </footer>

      {active.open && (
        <Lightbox
          src={active.src}
          caption={active.caption}
          images={active.images}
          currentIndex={active.currentIndex ?? 0}
          onClose={() => setActive({ open: false, src: "", caption: "", images: [], currentIndex: 0 })}
        />
      )}
    </div>
  )
}
