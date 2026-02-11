import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { useLanguage } from "../contexts/LanguageContext"

export default function MobileMenu() {
  const [open, setOpen] = useState(false)
  const { t } = useLanguage()

  useEffect(() => {
    const onEscape = (e) => {
      if (e.key === "Escape") setOpen(false)
    }
    if (open) {
      document.body.style.overflow = "hidden"
      document.addEventListener("keydown", onEscape)
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
      document.removeEventListener("keydown", onEscape)
    }
  }, [open])

  const links = [
    { href: "#home", label: t("home") },
    { href: "#about", label: t("about") },
    { href: "#events", label: t("events") },
    { href: "#gallery", label: t("gallery") },
    { href: "#supports", label: t("supports") },
    { href: "#contact", label: t("contact") },
  ]

  const menuContent = open && (
    <>
      <div
        className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div
        className="fixed inset-y-0 left-0 z-[9999] w-[85%] max-w-xs bg-white dark:bg-cosplay-darker border-r border-gray-200 dark:border-cosplay-border text-gray-800 dark:text-slate-300 shadow-xl transform transition-transform duration-300 ease-out"
        style={{ transform: open ? "translateX(0)" : "translateX(-100%)" }}
      >
        <div className="flex flex-col h-full overflow-hidden">
          <div className="p-4 shrink-0">
            <button
              onClick={() => setOpen(false)}
              className="p-2 rounded-md text-gray-600 dark:text-slate-400 hover:text-pink-500 dark:hover:text-pink-400 hover:bg-gray-100 dark:hover:bg-cosplay-card transition-colors"
              aria-label={t("closeMenu")}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="px-6 py-3 bg-gradient-to-r from-pink-600 to-rose-600 text-white font-semibold flex items-center gap-2 shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
            Menu
          </div>
          <nav className="flex-1 overflow-y-auto px-6 py-4 pb-10">
            <div className="space-y-1">
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block py-3 text-gray-600 dark:text-slate-400 hover:text-pink-500 dark:hover:text-pink-400 transition-colors font-medium"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </nav>
        </div>
      </div>
    </>
  )

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-2 rounded-md border border-gray-300 dark:border-cosplay-border text-gray-600 dark:text-slate-400 hover:text-pink-500 dark:hover:text-pink-400 hover:border-pink-500/50 transition-colors"
        aria-label={t("openMenu")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {menuContent && createPortal(menuContent, document.body)}
    </>
  )
}
