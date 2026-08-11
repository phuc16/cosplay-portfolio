import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { readCart, updateQty, removeFromCart, cartTotal } from "../shop/cart"
import { useLanguage } from "../contexts/LanguageContext"
import { formatVnd } from "../utils/money"
import ShopHeader from "../components/shop/ShopHeader"

export default function Cart() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [cart, setCart] = useState(readCart())

  const change = (variantId, qty) => setCart(updateQty(variantId, qty))
  const drop = (variantId) => setCart(removeFromCart(variantId))

  if (!cart.length) {
    return (
      <>
        <ShopHeader />
        <main className="max-w-3xl mx-auto px-4 py-10">
          <h1 className="text-2xl font-bold mb-4">{t("cart")}</h1>
          <p className="opacity-70 mb-4">{t("cartEmpty")}</p>
          <Link to="/merchandise" className="text-[var(--text-link)]">{t("shopBack")}</Link>
        </main>
      </>
    )
  }

  return (
    <>
      <ShopHeader />
      <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-6">{t("cart")}</h1>

      {cart.map((c) => (
        <div key={c.variant_id} className="flex gap-3 items-center py-3 border-b border-[var(--border-brand)]">
          {c.collection_slug ? (
            <Link to={`/merchandise/${c.collection_slug}`} className="flex gap-3 items-center flex-1 min-w-0">
              {c.image_url && <img src={c.image_url} alt="" className="w-16 h-16 object-cover rounded-lg" />}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{c.product_name}</p>
                <p className="text-sm opacity-70">{c.variant_label} · {formatVnd(c.price)}</p>
              </div>
            </Link>
          ) : (
            <>
              {c.image_url && <img src={c.image_url} alt="" className="w-16 h-16 object-cover rounded-lg" />}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{c.product_name}</p>
                <p className="text-sm opacity-70">{c.variant_label} · {formatVnd(c.price)}</p>
              </div>
            </>
          )}
          <input
            type="number" min="1" value={c.qty}
            onChange={(e) => change(c.variant_id, Number(e.target.value))}
            className="w-16 px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
          <button type="button" onClick={() => drop(c.variant_id)} className="px-2 opacity-70">✕</button>
        </div>
      ))}

      <div className="mt-6 flex justify-between items-center">
        <div>
          <p className="text-sm opacity-70">{t("cartTotal")}</p>
          <p className="text-xl font-bold text-[var(--brand)]">{formatVnd(cartTotal(cart))}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/checkout")}
          className="px-5 py-2 rounded-xl bg-[var(--brand)] text-white"
        >
          {t("cartCheckout")}
        </button>
      </div>
      </main>
    </>
  )
}
