import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useLanguage } from "../../contexts/LanguageContext"
import { readCart, cartCount, subscribeCart } from "../../shop/cart"

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
  const { t } = useLanguage()
  const [count, setCount] = useState(() => cartCount(readCart()))

  useEffect(() => {
    const sync = () => setCount(cartCount(readCart()))
    sync()
    return subscribeCart(sync)
  }, [])

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border-brand)] bg-[var(--bg-page)]/90 backdrop-blur">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/shop" className="font-semibold text-[var(--text-strong)]">
          {t("shopTitle")}
        </Link>
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
    </header>
  )
}
