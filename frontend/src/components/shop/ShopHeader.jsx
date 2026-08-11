import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useLanguage } from "../../contexts/LanguageContext"
import { useTheme } from "../../contexts/ThemeContext"
import { readCart, cartCount, subscribeCart } from "../../shop/cart"

const sunIcon = (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
)

const moonIcon = (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
  </svg>
)

// Same glyph as the portfolio's shopping icon, but here it only ever points
// at /cart — the shop itself is reached via the text link beside it, so
// there is no second destination for it to be mistaken for.
const cartIcon = (
  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4M3 6h18M16 10a4 4 0 01-8 0" />
  </svg>
)

/**
 * Header shown on every shop-facing page (/shop, /shop/:slug, /cart,
 * /checkout, /order/:token). The cart count is read from localStorage on
 * mount and then kept live by subscribing to cart.js's writer notifications
 * — a mount-only read would go stale the moment an item is added on the
 * collection page without a navigation happening.
 */
export default function ShopHeader() {
  const { t, lang, setLang } = useLanguage()
  const { theme, toggleTheme } = useTheme()
  const [count, setCount] = useState(() => cartCount(readCart()))

  useEffect(() => {
    const sync = () => setCount(cartCount(readCart()))
    sync()
    return subscribeCart(sync)
  }, [])

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border-brand)] bg-[var(--bg-page)]/90 backdrop-blur">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/merchandise" className="font-semibold text-[var(--text-strong)]">
            {t("shopTitle")}
          </Link>
          <Link to="/" className="text-sm text-[var(--text-link)] hover:underline">
            {t("home")}
          </Link>
        </div>
        <div className="flex items-center gap-1">
          {["vi", "en"].map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
                lang === l
                  ? "bg-[var(--brand)] text-white"
                  : "text-[var(--text-body)] hover:text-[var(--text-link)]"
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--text-body)] hover:text-[var(--text-link)]"
          >
            {theme === "dark" ? sunIcon : moonIcon}
          </button>
          <Link
            to="/cart"
            aria-label={t("cart")}
            title={t("cart")}
            className="relative flex items-center justify-center w-9 h-9 rounded-lg text-[var(--text-body)] hover:text-[var(--text-link)]"
          >
            {cartIcon}
            {count > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--brand)] text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {count}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  )
}
