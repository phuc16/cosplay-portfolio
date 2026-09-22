import { useEffect, useState } from "react"
import { useLanguage } from "../../contexts/LanguageContext"
import { renderMarkdown } from "../../utils/markdown"
import { formatVnd } from "../../utils/money"
import { addToCart } from "../../shop/cart"
import { readWishlist, subscribeWishlist, toggleWishlist, isWishlisted } from "../../shop/wishlist"

/** stock_qty null = unlimited, 0 = sold out, n = n remaining. */
function stockLabel(variant, t) {
  if (variant.stock_qty === null || variant.stock_qty === undefined) return t("shopUnlimited")
  if (variant.stock_qty <= 0) return t("shopSoldOut")
  return t("shopInStock", { n: variant.stock_qty })
}

export const isSoldOut = (v) => v.stock_qty !== null && v.stock_qty !== undefined && v.stock_qty <= 0

/** A product with no variants isn't a purchasable stock item, so it's never "sold out".
 *  A digital product has no variant list - its stock lives on the flattened product.stock_qty instead. */
export const isProductSoldOut = (p) => {
  if (p.type === "digital") return p.stock_qty !== null && p.stock_qty !== undefined && p.stock_qty <= 0
  return p.variants?.length > 0 && p.variants.every(isSoldOut)
}

/** Most variants carry a single photo (image_url); a few carry a gallery (images). */
function variantImages(v) {
  if (v.images?.length) return v.images
  return v.image_url ? [v.image_url] : []
}

/** A variant's own thumbnail_image wins as its grid cover - it's never part of variantImages() above (the detail carousel). */
function variantCover(v) {
  return v.thumbnail_image || variantImages(v)[0]
}

/** null/undefined stock_qty means unlimited - clamp only when a real ceiling exists. */
const clampQty = (n, v) => {
  const max = v.stock_qty === null || v.stock_qty === undefined ? Infinity : v.stock_qty
  return Math.min(Math.max(1, n), max)
}

/**
 * Column count scales with how many variants there are to show - a 2-code
 * product stretched across 8 columns leaves the thumbnails huge and the
 * layout mostly empty, while a 40+ code photocard sheet needs every column
 * it can get. A real grid (not CSS columns) so cells fill left-to-right
 * then top-to-bottom and every cell is the same size. Every class here
 * must appear literally (not built from a template string) so Tailwind's
 * content scanner generates it.
 */
function galleryGridClasses(count) {
  if (count <= 2) return "grid-cols-2"
  if (count <= 4) return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
  if (count <= 8) return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
  if (count <= 16) return "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
  return "grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8"
}

const heartIcon = (filled) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-6.716-4.35-9.428-8.06C.78 10.42 1.05 6.9 3.6 5.06 5.9 3.4 8.9 3.9 10.6 6.1L12 7.8l1.4-1.7c1.7-2.2 4.7-2.7 7-1.04 2.55 1.84 2.82 5.36 1.03 7.88C18.716 16.65 12 21 12 21z" />
  </svg>
)

/**
 * Heart/bookmark toggle for a single variant. Deliberately never disabled by
 * stock/orderable state (unlike "Add to cart") - a wishlisted item is
 * exactly the kind of thing someone wants to track *because* it's sold out
 * or they're not ready to buy yet.
 */
function WishlistToggle({ variant, wishlisted, onToggle, className, idleColorClass = "text-[var(--text-body)]" }) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(variant) }}
      aria-label={wishlisted ? t("wishlistRemove") : t("wishlistAdd")}
      aria-pressed={wishlisted}
      title={wishlisted ? t("wishlistRemove") : t("wishlistAdd")}
      className={"flex items-center justify-center " + (className || "") + (wishlisted ? " text-[var(--brand)]" : " " + idleColorClass)}
    >
      {heartIcon(wishlisted)}
    </button>
  )
}

export default function ProductCard({ product, collectionSlug, orderable, unavailableLabel, onAdded }) {
  const { t } = useLanguage()
  const isDigital = product.type === "digital"
  // A digital product is treated exactly like a product with one variant -
  // the same single-variant code path below (no picker, straight to detail)
  // already does the right thing; this just supplies that one "variant".
  // A digital product should always have a variant_id (createProduct always
  // creates the hidden variant) - but if one somehow doesn't, treat it as
  // having no variants at all, same as a physical product with zero
  // variants, rather than letting it submit variant_id: null to the cart.
  const variants = isDigital
    ? (product.variant_id != null
      ? [{ id: product.variant_id, label: "", stock_qty: product.stock_qty, images: product.images, thumbnail_image: product.thumbnail_image }]
      : [])
    : (product.variants || [])
  const cover = product.thumbnail_image || product.images?.[0] || variantCover(variants.find((v) => variantCover(v)) || {})
  const hasVariants = variants.length > 0
  // null = closed, "grid" = full variant gallery, an object = single-variant detail.
  const [view, setView] = useState(null)
  const [qty, setQty] = useState(1)
  const [activeImage, setActiveImage] = useState(0)
  const [wishlist, setWishlist] = useState(() => readWishlist())
  const detail = view && typeof view === "object" ? view : null
  const detailImages = detail ? variantImages(detail) : []

  // Kept live the same way ShopHeader keeps its cart-count badge live - a
  // mount-only read would go stale the moment the same variant is toggled
  // from elsewhere (e.g. the header's own wishlist page).
  useEffect(() => {
    const sync = () => setWishlist(readWishlist())
    sync()
    return subscribeWishlist(sync)
  }, [])

  const handleToggleWishlist = (v) => {
    toggleWishlist({
      variant_id: v.id,
      product_id: product.id,
      collection_slug: collectionSlug,
      product_name: product.name,
      variant_label: v.label,
      price: product.price,
      image_url: variantCover(v) || product.images?.[0] || null,
      is_digital: isDigital,
    })
  }

  // Every path to a variant's detail goes through this, so qty/photo never carry over stale from a prior variant.
  const openDetail = (v) => {
    setQty(1)
    setActiveImage(0)
    setView(v)
  }

  const commitAdd = (v) => {
    addToCart({
      variant_id: v.id,
      qty,
      product_name: product.name,
      variant_label: v.label,
      price: product.price,
      image_url: variantCover(v) || product.images?.[0] || null,
      collection_slug: collectionSlug,
      is_digital: isDigital,
    })
    onAdded?.(v.label)
    // A multi-variant product's buyer is often picking up several codes in
    // one visit - dropping them back into the picker grid lets them add the
    // next one immediately, instead of re-opening the whole product from
    // the collection page for every single code.
    setView(variants.length > 1 ? "grid" : null)
  }

  const openPicker = () => {
    if (!hasVariants) return
    // A closed collection still lets a buyer browse what was in it - only
    // adding to cart is blocked (see the "Add to cart" button below).
    // A single-variant product has nothing to "browse" - go straight to its detail.
    if (variants.length === 1) openDetail(variants[0])
    else setView("grid")
  }

  return (
    <article className="rounded-2xl border border-[var(--border-brand)] bg-[var(--surface-card)] overflow-hidden flex flex-col">
      <div
        role={hasVariants ? "button" : undefined}
        tabIndex={hasVariants ? 0 : undefined}
        onClick={openPicker}
        onKeyDown={(e) => { if (hasVariants && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openPicker() } }}
        className={"flex flex-col flex-1" + (hasVariants ? " cursor-pointer" : "")}
      >
        {cover && (
          <div className="relative">
            <img
              src={cover}
              alt={product.name}
              loading="lazy"
              className="w-full aspect-square object-cover"
            />
            {isProductSoldOut(product) && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-white font-semibold">
                {t("shopSoldOut")}
              </span>
            )}
          </div>
        )}

        <div className="p-4 flex flex-col gap-2 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-lg">{product.name}</h3>
            {isDigital && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--brand-soft)]">
                {t("shopDigitalBadge")}
              </span>
            )}
          </div>
          <p className="text-[var(--brand)] font-bold">{formatVnd(product.price)}</p>

          {product.description && (
            <div
              className="prose prose-sm max-w-none opacity-80"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(product.description) }}
            />
          )}
        </div>
      </div>

      {view === "grid" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={product.name}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setView(null)}
        >
          <div
            className="w-full max-w-4xl max-h-[85vh] rounded-2xl border border-[var(--border-brand)] bg-[var(--surface-card)] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 sm:p-5 pb-3 border-b border-[var(--border-brand)] shrink-0">
              <h3 className="font-semibold text-lg">{product.name}</h3>
              <button
                type="button"
                onClick={() => setView(null)}
                className="px-2 py-1 rounded-lg border border-[var(--border-brand)] text-xs shrink-0"
              >
                {t("shopVariantClose")}
              </button>
            </div>

            <div className="overflow-y-auto p-4 sm:p-5 pt-3">
              <div className={"grid " + galleryGridClasses(variants.length) + " gap-3"}>
                {/* Stable sort: sold-out variants sink after in-stock ones,
                    without disturbing relative order within each group. */}
                {[...variants].sort((a, b) => Number(isSoldOut(a)) - Number(isSoldOut(b))).map((v) => {
                  const img = variantCover(v) || cover
                  return (
                    <div key={v.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => openDetail(v)}
                        title={stockLabel(v, t)}
                        className="block w-full rounded-xl overflow-hidden border border-[var(--border-brand)] transition hover:border-[var(--brand)] hover:shadow-lg"
                      >
                        {img && <img src={img} alt={v.label} className="w-full aspect-square object-cover block" />}
                        <div className="absolute inset-x-0 bottom-0 pt-4 pb-1.5 px-1.5 bg-gradient-to-t from-black/80 to-transparent">
                          <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide bg-[var(--brand)] text-white shadow-sm">
                            {v.label}
                          </span>
                        </div>
                        {isSoldOut(v) && (
                          <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] text-white">
                            {t("shopSoldOut")}
                          </span>
                        )}
                      </button>
                      <WishlistToggle
                        variant={v}
                        wishlisted={isWishlisted(v.id, wishlist)}
                        onToggle={handleToggleWishlist}
                        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/40 hover:bg-black/60"
                        idleColorClass="text-white"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setView(null)}
        >
          <div
            className="w-full max-w-sm max-h-[85vh] overflow-x-hidden overflow-y-auto rounded-2xl border border-[var(--border-brand)] bg-[var(--surface-card)]"
            onClick={(e) => e.stopPropagation()}
          >
            {(detailImages[activeImage] || cover) && (
              <img
                src={detailImages[activeImage] || cover}
                alt={`${product.name} - ${detail.label}`}
                className="w-full h-auto block"
              />
            )}
            {detailImages.length > 1 && (
              <div className="flex gap-2 px-4 pt-3 overflow-x-auto">
                {detailImages.map((url, idx) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setActiveImage(idx)}
                    aria-label={`Ảnh ${idx + 1}`}
                    className={
                      "shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition " +
                      (idx === activeImage ? "border-[var(--brand)]" : "border-transparent opacity-70 hover:opacity-100")
                    }
                  >
                    <img src={url} alt="" className="w-full h-full object-cover block" />
                  </button>
                ))}
              </div>
            )}
            <div className="p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-lg">{product.name}{detail.label ? ` · ${detail.label}` : ""}</h3>
                  {isDigital && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--brand-soft)]">
                      {t("shopDigitalBadge")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {variants.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setView("grid")}
                      className="text-xs text-[var(--text-link)]"
                    >
                      {t("shopViewAll")}
                    </button>
                  )}
                  <WishlistToggle
                    variant={detail}
                    wishlisted={isWishlisted(detail.id, wishlist)}
                    onToggle={handleToggleWishlist}
                    className="w-8 h-8 rounded-lg border border-[var(--border-brand)]"
                  />
                </div>
              </div>
              <p className="text-[var(--brand)] font-bold">{formatVnd(product.price)}</p>
              <p className="text-sm opacity-70">{orderable ? stockLabel(detail, t) : (unavailableLabel || t("shopClosed"))}</p>

              {detail.description && (
                <div
                  className="prose prose-sm max-w-none opacity-80"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.description) }}
                />
              )}

              {!isSoldOut(detail) && orderable && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQty((q) => clampQty(q - 1, detail))}
                    disabled={qty <= 1}
                    aria-label={t("shopQtyDecrease")}
                    className="w-8 h-8 rounded-lg border border-[var(--border-brand)] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={detail.stock_qty ?? undefined}
                    value={qty}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (Number.isInteger(n)) setQty(clampQty(n, detail))
                    }}
                    aria-label={t("cartQty")}
                    className="w-14 text-center px-1 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setQty((q) => clampQty(q + 1, detail))}
                    disabled={detail.stock_qty !== null && detail.stock_qty !== undefined && qty >= detail.stock_qty}
                    aria-label={t("shopQtyIncrease")}
                    className="w-8 h-8 rounded-lg border border-[var(--border-brand)] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    +
                  </button>
                </div>
              )}

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  disabled={isSoldOut(detail) || !orderable}
                  onClick={() => commitAdd(detail)}
                  className="flex-1 px-3 py-2 rounded-xl bg-[var(--brand)] text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t("addToCart")}
                </button>
                <button
                  type="button"
                  onClick={() => setView(null)}
                  className="px-3 py-2 rounded-xl border border-[var(--border-brand)] text-sm"
                >
                  {t("shopVariantClose")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </article>
  )
}
