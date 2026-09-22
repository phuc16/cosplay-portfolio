import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { fetchCollection } from "../api/shop"
import { readWishlist, removeFromWishlist, subscribeWishlist } from "../shop/wishlist"
import { addToCart } from "../shop/cart"
import { isSoldOut, isProductSoldOut } from "../components/shop/ProductCard"
import { useLanguage } from "../contexts/LanguageContext"
import { formatVnd } from "../utils/money"
import ShopHeader from "../components/shop/ShopHeader"
import ShopFooter from "../components/shop/ShopFooter"

/** Finds this wishlist entry's product/variant within a fetched collection - same shape cartAvailability.js's findProduct uses. Digital products are flattened (variant_id lives on the product), physical products carry a real variants array. */
function resolveEntry(entry, collection) {
  if (!collection) return { entry, collection: null, product: null, variant: null }

  const product = collection.products.find((p) => p.id === entry.product_id)
  if (!product) return { entry, collection, product: null, variant: null }

  if (product.type === "digital") {
    if (product.variant_id !== entry.variant_id) return { entry, collection, product: null, variant: null }
    return { entry, collection, product, variant: { id: product.variant_id, label: "", stock_qty: product.stock_qty } }
  }

  const variant = product.variants?.find((v) => v.id === entry.variant_id)
  if (!variant) return { entry, collection, product, variant: null }
  return { entry, collection, product, variant }
}

function rowImage(product, variant) {
  return variant?.thumbnail_image || variant?.image_url || product?.thumbnail_image || product?.images?.[0] || null
}

/**
 * Unlike the cart, a wishlist entry is deliberately NOT a price/availability
 * snapshot (see the wishlist design doc) - it's just "I'm interested in
 * this." So this page always re-fetches each entry's collection and reads
 * live price/stock/status from it, the same "fetch by collection_slug,
 * tolerate a per-collection failure" pattern cartAvailability.js already
 * uses for the cart's own availability check. A collection that 404s or a
 * product/variant that's since been deleted just renders as "no longer
 * available" for its own row - it never breaks the rest of the list.
 */
export default function Wishlist() {
  const { t } = useLanguage()
  const [wishlist, setWishlist] = useState(() => readWishlist())
  const [collections, setCollections] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [addedId, setAddedId] = useState(null)

  useEffect(() => {
    const sync = () => setWishlist(readWishlist())
    sync()
    return subscribeWishlist(sync)
  }, [])

  useEffect(() => {
    let ignore = false
    const slugs = [...new Set(wishlist.map((w) => w.collection_slug).filter(Boolean))]
    if (slugs.length === 0) {
      setCollections(new Map())
      setLoading(false)
      return
    }
    setLoading(true)
    Promise.all(
      slugs.map((slug) => fetchCollection(slug).then((data) => [slug, data]).catch(() => [slug, null]))
    ).then((entries) => {
      if (!ignore) {
        setCollections(new Map(entries))
        setLoading(false)
      }
    })
    return () => { ignore = true }
    // Only re-fetch when the set of slugs actually changes, not on every wishlist reference change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wishlist.map((w) => w.collection_slug).join(",")])

  const handleRemove = (variantId) => setWishlist(removeFromWishlist(variantId))

  const handleAddToCart = (row) => {
    const { entry, product, variant } = row
    addToCart({
      variant_id: variant.id,
      qty: 1,
      product_name: product.name,
      variant_label: variant.label,
      price: product.price,
      image_url: rowImage(product, variant),
      collection_slug: entry.collection_slug,
      is_digital: product.type === "digital",
    })
    setAddedId(variant.id)
    setTimeout(() => setAddedId(null), 2000)
  }

  const rows = wishlist.map((entry) => resolveEntry(entry, collections.get(entry.collection_slug)))

  return (
    <>
      <ShopHeader />
      <main className="max-w-3xl mx-auto px-4 py-10">
        <Link to="/merchandise" className="inline-block mb-4 text-sm text-[var(--text-link)]">← {t("shopBack")}</Link>
        <h1 className="text-2xl font-bold mb-2">{t("wishlistTitle")}</h1>
        <p className="opacity-70 mb-6">{t("wishlistDesc")}</p>

        {loading ? (
          <p className="opacity-60">{t("shopLoading")}</p>
        ) : rows.length === 0 ? (
          <p className="opacity-70">{t("wishlistEmpty")}</p>
        ) : (
          rows.map((row) => {
            const { entry, collection, product, variant } = row
            const available = Boolean(collection) && Boolean(product) && Boolean(variant)
            const closed = collection?.status === "closed"
            const notStartedYet = !closed && collection?.not_started_yet
            const orderable = available && !closed && !notStartedYet
            const soldOut = available && (product.type === "digital" ? isProductSoldOut(product) : isSoldOut(variant))

            return (
              <div key={entry.variant_id} className="flex gap-3 items-center py-3 border-b border-[var(--border-brand)]">
                {available ? (
                  <Link to={`/merchandise/${entry.collection_slug}`} className="flex gap-3 items-center flex-1 min-w-0">
                    {rowImage(product, variant) && (
                      <img src={rowImage(product, variant)} alt="" className="w-16 h-16 object-cover rounded-lg" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {product.name}{variant.label ? ` · ${variant.label}` : ""}
                      </p>
                      <p className="text-sm opacity-70">{formatVnd(product.price)}</p>
                      {soldOut && <p className="text-xs text-[var(--text-error)] mt-0.5">{t("shopSoldOut")}</p>}
                      {!soldOut && closed && <p className="text-xs text-[var(--text-error)] mt-0.5">{t("cartItemEnded")}</p>}
                      {!soldOut && notStartedYet && <p className="text-xs text-[var(--text-error)] mt-0.5">{t("cartItemNotStarted")}</p>}
                    </div>
                  </Link>
                ) : (
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate opacity-60">{t("wishlistUnavailable")}</p>
                  </div>
                )}

                <div className="flex items-center gap-2 shrink-0">
                  {available && (
                    <button
                      type="button"
                      onClick={() => handleAddToCart(row)}
                      disabled={soldOut || !orderable}
                      className="px-3 py-2 rounded-xl bg-[var(--brand)] text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {addedId === variant.id ? t("wishlistAddedToCart") : t("addToCart")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemove(entry.variant_id)}
                    className="px-3 py-2 rounded-xl border border-[var(--border-brand)] text-sm"
                  >
                    {t("wishlistRemoveItem")}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </main>
      <ShopFooter />
    </>
  )
}
