import { Link } from "react-router-dom"
import MobileMenu from "./MobileMenu"
import { useTheme } from "../contexts/ThemeContext"
import { useLanguage } from "../contexts/LanguageContext"

export default function Navbar({ artistName = "Kamidayhehe", tagline = "Cosplayer • Prop Maker", heroImageUrl }) {
  const { theme, toggleTheme } = useTheme()
  const { lang, setLang, t } = useLanguage()

  return (
    <header className="sticky top-0 z-30 bg-white/90 dark:bg-cosplay-dark/90 backdrop-blur-md border-b border-gray-200 dark:border-cosplay-border">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16 min-h-[3.5rem]">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
            <Link to="/" className="flex items-center gap-2 sm:gap-4 min-w-0">
              {heroImageUrl ? (
                <img src={heroImageUrl} alt="" className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-md object-cover shadow-pink-glow" />
              ) : (
                <div className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-md bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center text-white font-bold shadow-pink-glow text-sm sm:text-base">
                  C
                </div>
              )}
              <div className="min-w-0">
                <span className="font-semibold text-base sm:text-lg text-gray-900 dark:text-slate-100 truncate block">{artistName}</span>
                <div className="text-xs text-gray-500 dark:text-slate-500 sm:block whitespace-pre-line">{tagline}</div>
              </div>
            </Link>
          </div>

          <nav className="hidden md:flex items-center gap-4 lg:gap-6 text-sm font-medium text-gray-600 dark:text-slate-400 shrink-0">
            <a href="#home" className="hover:text-pink-500 dark:hover:text-pink-400 transition-colors">
              {t("home")}
            </a>
            <a href="#about" className="hover:text-pink-500 dark:hover:text-pink-400 transition-colors">
              {t("about")}
            </a>
            <a href="#events" className="hover:text-pink-500 dark:hover:text-pink-400 transition-colors">
              {t("events")}
            </a>
            <a href="#gallery" className="hover:text-pink-500 dark:hover:text-pink-400 transition-colors">
              {t("gallery")}
            </a>
            <a href="#supports" className="hover:text-pink-500 dark:hover:text-pink-400 transition-colors">
              {t("supports")}
            </a>
            <a
              href="#contact"
              className="px-3 py-1 rounded-md text-white bg-pink-500 hover:bg-pink-400 transition-colors"
            >
              {t("contact")}
            </a>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setLang("vi")}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${lang === "vi" ? "bg-pink-500 text-white" : "text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-cosplay-card"}`}
                title="Tiếng Việt"
              >
                VI
              </button>
              <button
                onClick={() => setLang("en")}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${lang === "en" ? "bg-pink-500 text-white" : "text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-cosplay-card"}`}
                title="English"
              >
                EN
              </button>
            </div>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-cosplay-card transition-colors"
              title={theme === "dark" ? t("themeLight") : t("themeDark")}
            >
              {theme === "dark" ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
          </nav>

          <div className="md:hidden flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setLang("vi")}
                className={`px-2 py-1 rounded text-xs font-medium ${lang === "vi" ? "bg-pink-500 text-white" : "text-gray-500 dark:text-slate-400"}`}
              >
                VI
              </button>
              <button
                onClick={() => setLang("en")}
                className={`px-2 py-1 rounded text-xs font-medium ${lang === "en" ? "bg-pink-500 text-white" : "text-gray-500 dark:text-slate-400"}`}
              >
                EN
              </button>
            </div>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md text-gray-600 dark:text-slate-400"
              title={theme === "dark" ? t("themeLight") : t("themeDark")}
            >
              {theme === "dark" ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            <MobileMenu />
          </div>
        </div>
      </div>
    </header>
  )
}
