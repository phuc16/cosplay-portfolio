import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
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

export default function Portfolio() {
  const { t } = useLanguage()
  const [gallery, setGallery] = useState([])
  const [settings, setSettings] = useState(null)
  const [active, setActive] = useState({ open: false, src: "", caption: "" })
  const [loading, setLoading] = useState(true)

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

  const totalPhotos = gallery.reduce((s, g) => s + (g.items?.length || 0), 0)
  const heroImage = (() => {
    const all = gallery.flatMap((g) => g.items || [])
    const landscape = all.find((img) => img.width != null && img.height != null && img.width > img.height)
    return landscape || all[0] || null
  })()
  const profileImage = heroImage || null

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-cosplay-dark text-gray-900 dark:text-slate-200">
      <Navbar artistName={cfg.artistName} tagline={cfg.tagline} />

      {/* Hero */}
      <section id="home" className="relative">
        <ScrollReveal>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8">
          <div className="mt-4 sm:mt-6 md:mt-8 rounded-lg sm:rounded-xl overflow-hidden shadow-pink-glow border border-gray-200 dark:border-cosplay-border grid grid-cols-1 md:grid-cols-2 gap-0 bg-white dark:bg-cosplay-card">
            <div className="p-4 sm:p-6 md:p-12 order-2 md:order-1">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold leading-tight">
                <span className="bg-gradient-to-r from-pink-400 to-rose-400 bg-clip-text text-transparent">
                  {cfg.artistName}
                </span>
                <span className="block text-gray-600 dark:text-slate-400 mt-1 sm:mt-2 text-lg sm:text-xl md:text-2xl">
                  {cfg.hero?.subtitle || "Cosplay portfolio & highlights"}
                </span>
              </h1>
              <p className="mt-3 sm:mt-4 text-sm sm:text-base text-gray-600 dark:text-slate-400 line-clamp-3 sm:line-clamp-none">
                {cfg.hero?.description || "Portfolio for cosplay photos, props, and booking info. Optimized for mobile and photo gallery."}
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
              {heroImage ? (
                <img
                  src={heroImage.src || heroImage.url}
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

      {/* Sự kiện sắp tới */}
      <UpcomingEvents events={cfg.upcomingEvents} />

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
              <p className="mt-2 sm:mt-3 text-sm sm:text-base text-gray-600 dark:text-slate-400">{cfg.about}</p>
              <div className="mt-4 flex gap-3 flex-wrap">
                {(cfg.contact?.social || []).map((s) => (
                  <a
                    key={s.label}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-pink-500 dark:text-pink-400 hover:text-pink-600 dark:hover:text-pink-300 hover:underline"
                  >
                    {s.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
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
            <div>
              <label className="block text-sm font-medium text-gray-600 dark:text-slate-400">{t("phone")}</label>
              <div className="mt-1 flex flex-col sm:flex-row sm:flex-wrap gap-2 items-start sm:items-center">
                <span className="text-gray-900 dark:text-slate-200 font-medium text-sm sm:text-base break-all">{cfg.contact?.phone ?? cfg.contact?.email ?? "—"}</span>
                {(cfg.contact?.phone ?? cfg.contact?.email) && (() => {
                    const raw = String(cfg.contact?.phone ?? cfg.contact?.email ?? "").replace(/\D/g, "")
                    const zaloPhone = raw.startsWith("0") ? "84" + raw.slice(1) : raw.startsWith("84") ? raw : "84" + raw
                    return (
                  <a
                    href={`https://zalo.me/${zaloPhone}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block px-4 py-2.5 sm:py-2 rounded-md text-white bg-pink-500 hover:bg-pink-400 transition-colors text-center text-sm sm:text-base"
                  >
                    {t("messageZalo")}
                  </a>
                )})()}
              </div>
            </div>
            <div>
              <h4 className="font-medium text-base sm:text-lg text-gray-900 dark:text-slate-200">{t("quickInfo")}</h4>
              <ul className="mt-2 sm:mt-3 text-sm text-gray-600 dark:text-slate-400 space-y-2">
                {(cfg.contact?.info || []).map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        </ScrollReveal>
      </section>

      <footer className="mt-8 sm:mt-12 border-t border-gray-200 dark:border-cosplay-border bg-gray-100 dark:bg-cosplay-darker">
        <ScrollReveal>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 py-4 sm:py-6 text-xs sm:text-sm text-gray-500 dark:text-slate-500 flex flex-col md:flex-row justify-between items-center gap-2 text-center md:text-left">
          <div>© {new Date().getFullYear()} {cfg.artistName}. All rights reserved.</div>
          <div className="flex gap-3 sm:gap-4 items-center flex-wrap justify-center">
            <span>{t("builtWith")}</span>
            <Link to="/admin" className="text-gray-500 dark:text-slate-500 hover:text-pink-500 dark:hover:text-pink-400 transition-colors">{t("admin")}</Link>
          </div>
        </div>
        </ScrollReveal>
      </footer>

      {active.open && (
        <Lightbox
          src={active.src}
          caption={active.caption}
          onClose={() => setActive({ open: false, src: "", caption: "" })}
        />
      )}
    </div>
  )
}
