import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { readCart, updateQty, removeFromCart, cartTotal } from "../shop/cart"
import { useLanguage } from "../contexts/LanguageContext"
import { formatVnd } from "../utils/money"
import { checkCartAvailability } from "../shop/cartAvailability"
import { fetchGiftSettings } from "../api/shop"
import ShopHeader from "../components/shop/ShopHeader"
import ShopFooter from "../components/shop/ShopFooter"

export default function Cart() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [cart, setCart] = useState(readCart())
  const [pendingRemove, setPendingRemove] = useState(null)
  const [problems, setProblems] = useState(new Map())
  const [checking, setChecking] = useState(true)
  const [giftSettings, setGiftSettings] = useState(null)

  useEffect(() => {
    fetchGiftSettings().then(setGiftSettings).catch(() => setGiftSettings(null))
  }, [])

  useEffect(() => {
    let ignore = false
    checkCartAvailability(cart)
      .then((result) => { if (!ignore) setProblems(result) })
      .finally(() => { if (!ignore) setChecking(false) })
    return () => { ignore = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const change = (variantId, qty) => setCart(updateQty(variantId, qty))
  const confirmRemove = () => {
    setCart(removeFromCart(pendingRemove.variantId))
    setPendingRemove(null)
  }

  // Recomputed from the current cart on every render (not pruned on
  // removal) - removing the one bad line already makes it disappear here
  // for free, no re-fetch needed.
  const activeProblems = cart.filter((c) => problems.has(c.variant_id))
  const hasProblems = checking || activeProblems.length > 0

  const problemLabel = (reason) => ({
    sold_out: t("cartItemSoldOut"),
    ended: t("cartItemEnded"),
    unavailable: t("cartItemUnavailable"),
    not_started: t("cartItemNotStarted"),
  }[reason])

  if (!cart.length) {
    return (
      <>
        <ShopHeader />
        <main className="max-w-3xl mx-auto px-4 py-10">
          <h1 className="text-2xl font-bold mb-4">{t("cart")}</h1>
          <p className="opacity-70 mb-4">{t("cartEmpty")}</p>
          <Link to="/merchandise" className="text-[var(--text-link)]">{t("shopBack")}</Link>
        </main>
        <ShopFooter />
      </>
    )
  }

  return (
    <>
      <ShopHeader />
      <main className="max-w-3xl mx-auto px-4 py-10">
      <Link to="/merchandise" className="inline-block mb-4 text-sm text-[var(--text-link)]">← {t("shopBack")}</Link>
      <h1 className="text-2xl font-bold mb-6">{t("cart")}</h1>

      {cart.map((c) => {
        const reason = problems.get(c.variant_id)
        return (
        <div key={c.variant_id} className="flex gap-3 items-center py-3 border-b border-[var(--border-brand)]">
          {c.collection_slug ? (
            <Link to={`/merchandise/${c.collection_slug}`} className="flex gap-3 items-center flex-1 min-w-0">
              {c.image_url && <img src={c.image_url} alt="" className="w-16 h-16 object-cover rounded-lg" />}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{c.product_name}</p>
                <p className="text-sm opacity-70">{c.variant_label} · {formatVnd(c.price)}</p>
                {reason && <p className="text-xs text-[var(--text-error)] mt-0.5">{problemLabel(reason)}</p>}
              </div>
            </Link>
          ) : (
            <>
              {c.image_url && <img src={c.image_url} alt="" className="w-16 h-16 object-cover rounded-lg" />}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{c.product_name}</p>
                <p className="text-sm opacity-70">{c.variant_label} · {formatVnd(c.price)}</p>
                {reason && <p className="text-xs text-[var(--text-error)] mt-0.5">{problemLabel(reason)}</p>}
              </div>
            </>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => change(c.variant_id, c.qty - 1)}
              disabled={c.qty <= 1 || Boolean(reason)}
              aria-label={t("shopQtyDecrease")}
              className="w-8 h-8 rounded-lg border border-[var(--border-brand)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              −
            </button>
            <input
              type="number" min="1" value={c.qty}
              onChange={(e) => change(c.variant_id, Number(e.target.value))}
              disabled={Boolean(reason)}
              aria-label={t("cartQty")}
              className="w-14 text-center px-1 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent disabled:opacity-40"
            />
            <button
              type="button"
              onClick={() => change(c.variant_id, c.qty + 1)}
              disabled={Boolean(reason)}
              aria-label={t("shopQtyIncrease")}
              className="w-8 h-8 rounded-lg border border-[var(--border-brand)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={() => setPendingRemove({ variantId: c.variant_id, item: `${c.product_name} · ${c.variant_label}` })}
            className="px-2 opacity-70"
          >
            ✕
          </button>
        </div>
        )
      })}

      <div className="mt-6 flex justify-between items-center">
        <div>
          <p className="text-sm opacity-70">{t("cartTotal")}</p>
          <p className="text-xl font-bold text-[var(--brand)]">{formatVnd(cartTotal(cart))}</p>
        </div>
        <div className="text-right">
          <button
            type="button"
            onClick={() => navigate("/checkout")}
            disabled={hasProblems}
            className="px-5 py-2 rounded-xl bg-[var(--brand)] text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("cartCheckout")}
          </button>
          {activeProblems.length > 0 && (
            <p className="text-xs text-[var(--text-error)] mt-1">{t("cartResolveIssues")}</p>
          )}
        </div>
      </div>

      {giftSettings?.enabled && (
        cartTotal(cart) >= giftSettings.min_total ? (
          <div className="mt-3">
            <p className="text-sm text-[var(--brand)]">
              {t("cartGiftQualified", { name: giftSettings.name })}
            </p>
            {giftSettings.note && <p className="text-sm opacity-70">{giftSettings.note}</p>}
          </div>
        ) : (
          <p className="mt-3 text-sm opacity-70">
            {t("cartGiftProgress", { amount: formatVnd(giftSettings.min_total - cartTotal(cart)), name: giftSettings.name })}
          </p>
        )
      )}
      </main>
      <ShopFooter />

      {pendingRemove && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPendingRemove(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[var(--border-brand)] bg-[var(--surface-card)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-4">{t("cartRemoveConfirm", { item: pendingRemove.item })}</p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setPendingRemove(null)}
                className="px-3 py-2 rounded-xl border border-[var(--border-brand)] text-sm"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={confirmRemove}
                className="px-3 py-2 rounded-xl bg-[var(--brand)] text-white text-sm"
              >
                {t("cartRemove")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
