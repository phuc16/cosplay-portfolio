import { useState } from "react"
import { Link } from "react-router-dom"
import { useLanguage } from "../../contexts/LanguageContext"
import { renderMarkdown } from "../../utils/markdown"
import { formatVnd } from "../../utils/money"
import { addToCart, gachaCartConflict } from "../../shop/cart"
import { buildShareUrl, buildShareText, copyToClipboard } from "../../shop/share"

/** stock_qty null = unlimited, 0 = sold out, n = n remaining. */
function stockLabel(variant, t) {
  if (variant.stock_qty === null || variant.stock_qty === undefined) return t("shopUnlimited")
  if (variant.stock_qty <= 0) return t("shopSoldOut")
  return t("shopInStock", { n: variant.stock_qty })
}

export const isSoldOut = (v) => v.stock_qty !== null && v.stock_qty !== undefined && v.stock_qty <= 0

/** Digital and gacha products both arrive from the API with an empty variants
 *  array and their one hidden variant flattened onto the product itself
 *  (catalogRepo's nestCollectionDetail) - anything that reads a variant list
 *  or matches a cart line by variant id has to branch on both, not just digital. */
export const hasFlattenedVariant = (type) => type === "digital" || type === "gacha"

/** A product with no variants isn't a purchasable stock item, so it's never "sold out".
 *  A digital product has no variant list - its stock lives on the flattened product.stock_qty instead.
 *  A gacha product's turns are never stock-limited (stock_qty is deliberately
 *  null/unlimited) - its prize pool running dry is what sells it out. A gacha
 *  product with no pool figure at all has no prizes configured yet, which is
 *  "not stocked", not "sold out". */
export const isProductSoldOut = (p) => {
  if (p.type === "gacha") return p.gacha_pool_remaining !== null && p.gacha_pool_remaining !== undefined && p.gacha_pool_remaining <= 0
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

/** null/undefined stock_qty means unlimited - clamp only when a real ceiling exists.
 *  A gacha turn's stock_qty is deliberately null, but its prize pool is a real
 *  ceiling: the backend rejects an order for more turns than the pool holds, so
 *  the stepper has to stop there rather than let the buyer discover it at checkout. */
const maxQtyFor = (product, v) => {
  if (product?.type === "gacha") {
    return product.gacha_pool_remaining === null || product.gacha_pool_remaining === undefined
      ? Infinity
      : product.gacha_pool_remaining
  }
  return v.stock_qty === null || v.stock_qty === undefined ? Infinity : v.stock_qty
}

const clampQty = (n, max) => Math.min(Math.max(1, n), max)

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

export default function ProductCard({ product, collectionSlug, orderable, unavailableLabel, onAdded, deepLinkVariantId }) {
  const { t } = useLanguage()
  const isDigital = product.type === "digital"
  const isGacha = product.type === "gacha"
  const flattened = hasFlattenedVariant(product.type)
  // A digital or gacha product is treated exactly like a product with one
  // variant - the same single-variant code path below (no picker, straight to
  // detail) already does the right thing; this just supplies that one
  // "variant". Either should always have a variant_id (createProduct always
  // creates the hidden variant) - but if one somehow doesn't, treat it as
  // having no variants at all, same as a physical product with zero
  // variants, rather than letting it submit variant_id: null to the cart.
  const variants = flattened
    ? (product.variant_id != null
      ? [{ id: product.variant_id, label: "", stock_qty: product.stock_qty, images: product.images, thumbnail_image: product.thumbnail_image }]
      : [])
    : (product.variants || [])
  const cover = product.thumbnail_image || product.images?.[0] || variantCover(variants.find((v) => variantCover(v)) || {})
  const hasVariants = variants.length > 0
  // null = closed, "grid" = full variant gallery, an object = single-variant detail.
  // deepLinkVariantId seeds this once at mount, from a shared ?product=&variant=
  // URL (see Collection.jsx): undefined means no deep link targets this card
  // (the default - unchanged behavior), null means it targets this product
  // with no specific/valid variant (fall back to the same thing a card click
  // would do), a number means it targets that exact variant - unless that
  // variant no longer exists (deleted since the link was shared), in which
  // case this falls back the same way null would.
  const [view, setView] = useState(() => {
    if (deepLinkVariantId === undefined) return null
    if (deepLinkVariantId !== null) {
      const match = variants.find((v) => v.id === deepLinkVariantId)
      if (match) return match
    }
    if (variants.length === 1) return variants[0]
    if (variants.length > 1) return "grid"
    return null
  })
  const [qty, setQty] = useState(1)
  const [activeImage, setActiveImage] = useState(0)
  const [addError, setAddError] = useState("")
  const [shareCopied, setShareCopied] = useState(false)
  const detail = view && typeof view === "object" ? view : null
  const detailImages = detail ? variantImages(detail) : []
  // A gacha turn's own stock_qty is always null, so only the product-level
  // check (its prize pool) can close the buy button on it.
  const detailSoldOut = detail ? isSoldOut(detail) || isProductSoldOut(product) : false
  const detailMaxQty = detail ? maxQtyFor(product, detail) : Infinity

  // Every path to a variant's detail goes through this, so qty/photo never carry over stale from a prior variant.
  const openDetail = (v) => {
    setQty(1)
    setActiveImage(0)
    setAddError("")
    setShareCopied(false)
    setView(v)
  }

  // Only meaningful once a specific variant is pinned down - the button
  // only ever renders inside the detail modal below. A multi-variant
  // product needs `variant` in the link to disambiguate which code is
  // being shared; a single-variant product's `product` id alone already
  // fully determines the detail view, so the param is omitted there.
  const handleShare = async () => {
    const shareUrl = buildShareUrl(collectionSlug, product.id, variants.length > 1 ? detail.id : null)
    const { title, text } = buildShareText(t, product.name, detail.label, product.price)
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: shareUrl })
      } catch {
        // Buyer dismissed the native share sheet - not an error, nothing to show.
      }
      return
    }
    if (await copyToClipboard(shareUrl)) {
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
      return
    }
    // Neither the Clipboard API nor execCommand("copy") worked (very old
    // or locked-down browser) - last resort so the click isn't a no-op.
    window.prompt(t("shopSharePromptFallback"), shareUrl)
  }

  const commitAdd = (v) => {
    const line = {
      variant_id: v.id,
      qty,
      product_name: product.name,
      variant_label: v.label,
      price: product.price,
      image_url: variantCover(v) || product.images?.[0] || null,
      collection_slug: collectionSlug,
      is_digital: isDigital,
      is_gacha: isGacha,
    }
    const conflict = gachaCartConflict(line)
    if (conflict) {
      setAddError(conflict === "gacha_needs_own_order" ? t("cartGachaOwnOrder") : t("cartGachaBlocksOthers"))
      return
    }
    setAddError("")
    addToCart(line)
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
            {!isProductSoldOut(product) && product.recent_sales_count > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-500/15 text-orange-500">
                {t("shopRecentSales", { n: product.recent_sales_count })}
              </span>
            )}
          </div>
          <p className="text-[var(--brand)] font-bold">{formatVnd(product.price)}</p>
          {isGacha && (
            <Link
              to={`/merchandise/gacha/${product.id}/try`}
              onClick={(e) => e.stopPropagation()}
              className="text-sm text-[var(--text-link)] underline w-fit"
            >
              {t("gachaTryLink")}
            </Link>
          )}

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
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => openDetail(v)}
                      title={stockLabel(v, t)}
                      className="group relative block w-full rounded-xl overflow-hidden border border-[var(--border-brand)] transition hover:border-[var(--brand)] hover:shadow-lg"
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
                  <button
                    type="button"
                    onClick={handleShare}
                    className="text-xs text-[var(--text-link)]"
                  >
                    {t("shopShareButton")}
                  </button>
                  {variants.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setView("grid")}
                      className="text-xs text-[var(--text-link)]"
                    >
                      {t("shopViewAll")}
                    </button>
                  )}
                </div>
              </div>
              {shareCopied && <p className="text-xs opacity-70">{t("shopShareLinkCopied")}</p>}
              <p className="text-[var(--brand)] font-bold">{formatVnd(product.price)}</p>
              <p className="text-sm opacity-70">{orderable ? (detailSoldOut ? t("shopSoldOut") : stockLabel(detail, t)) : (unavailableLabel || t("shopClosed"))}</p>
              {isGacha && (
                <Link
                  to={`/merchandise/gacha/${product.id}/try`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm text-[var(--text-link)] underline w-fit"
                >
                  {t("gachaTryLink")}
                </Link>
              )}

              {detail.description && (
                <div
                  className="prose prose-sm max-w-none opacity-80"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.description) }}
                />
              )}

              {!detailSoldOut && orderable && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQty((q) => clampQty(q - 1, detailMaxQty))}
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
                    max={Number.isFinite(detailMaxQty) ? detailMaxQty : undefined}
                    value={qty}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (Number.isInteger(n)) setQty(clampQty(n, detailMaxQty))
                    }}
                    aria-label={t("cartQty")}
                    className="w-14 text-center px-1 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setQty((q) => clampQty(q + 1, detailMaxQty))}
                    disabled={qty >= detailMaxQty}
                    aria-label={t("shopQtyIncrease")}
                    className="w-8 h-8 rounded-lg border border-[var(--border-brand)] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    +
                  </button>
                </div>
              )}

              {addError && <p role="alert" className="text-sm text-[var(--text-error)]">{addError}</p>}

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  disabled={detailSoldOut || !orderable}
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
