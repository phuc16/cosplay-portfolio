import { useState } from "react"
import { useLanguage } from "../../contexts/LanguageContext"
import { renderMarkdown } from "../../utils/markdown"
import { formatVnd } from "../../utils/money"
import { addToCart } from "../../shop/cart"

/** stock_qty null = unlimited, 0 = sold out, n = n remaining. */
function stockLabel(variant, t) {
  if (variant.stock_qty === null || variant.stock_qty === undefined) return t("shopUnlimited")
  if (variant.stock_qty <= 0) return t("shopSoldOut")
  return t("shopInStock", { n: variant.stock_qty })
}

const isSoldOut = (v) => v.stock_qty !== null && v.stock_qty !== undefined && v.stock_qty <= 0

export default function ProductCard({ product, collectionSlug, orderable, onAdded }) {
  const { t } = useLanguage()
  const cover = product.images?.[0] || product.variants?.find((v) => v.image_url)?.image_url
  const hasVariants = product.variants?.length > 0
  // null = closed, "grid" = full variant gallery, an object = single-variant detail.
  const [view, setView] = useState(null)
  const detail = view && typeof view === "object" ? view : null

  const commitAdd = (v) => {
    addToCart({
      variant_id: v.id,
      qty: 1,
      product_name: product.name,
      variant_label: v.label,
      price: product.price,
      image_url: v.image_url || product.images?.[0] || null,
      collection_slug: collectionSlug,
    })
    onAdded?.(v.label)
    setView(null)
  }

  const openPicker = () => {
    if (!orderable || !hasVariants) return
    // A single-variant product has nothing to "browse" — go straight to its detail.
    setView(product.variants.length === 1 ? product.variants[0] : "grid")
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
          <img
            src={cover}
            alt={product.name}
            loading="lazy"
            className="w-full aspect-square object-cover"
          />
        )}

        <div className="p-4 flex flex-col gap-2 flex-1">
          <h3 className="font-semibold text-lg">{product.name}</h3>
          <p className="text-[var(--brand)] font-bold">{formatVnd(product.price)}</p>

          {product.description && (
            <div
              className="prose prose-sm max-w-none opacity-80"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(product.description) }}
            />
          )}
        </div>
      </div>

      {hasVariants && (
        <ul className="px-4 pb-4 -mt-2 flex flex-wrap gap-2">
          {product.variants.map((v) => (
            <li key={v.id} title={stockLabel(v, t)}>
              <button
                type="button"
                disabled={!orderable}
                onClick={() => setView(v)}
                className={
                  "px-2 py-1 rounded-lg text-xs border transition " +
                  (isSoldOut(v) ? "opacity-40 line-through border-current cursor-not-allowed"
                                : "border-[var(--border-brand)] hover:bg-[var(--brand-soft)]")
                }
              >
                {v.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {view === "grid" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={product.name}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setView(null)}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl border border-[var(--border-brand)] bg-[var(--surface-card)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-lg">{product.name}</h3>
              <button
                type="button"
                onClick={() => setView(null)}
                className="px-2 py-1 rounded-lg border border-[var(--border-brand)] text-xs"
              >
                {t("shopVariantClose")}
              </button>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {product.variants.map((v) => {
                const img = v.image_url || cover
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setView(v)}
                    title={stockLabel(v, t)}
                    className="relative aspect-square rounded-lg overflow-hidden border border-[var(--border-brand)]"
                  >
                    {img && <img src={img} alt={v.label} className="w-full h-full object-cover" />}
                    <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-black/70 text-white">
                      {v.label}
                    </span>
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
      )}

      {detail && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setView(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[var(--border-brand)] bg-[var(--surface-card)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {(detail.image_url || cover) && (
              <img
                src={detail.image_url || cover}
                alt={`${product.name} — ${detail.label}`}
                className="w-full aspect-square object-cover"
              />
            )}
            <div className="p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">{product.name} · {detail.label}</h3>
                {product.variants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setView("grid")}
                    className="text-xs text-[var(--text-link)] shrink-0"
                  >
                    {t("shopViewAll")}
                  </button>
                )}
              </div>
              <p className="text-[var(--brand)] font-bold">{formatVnd(product.price)}</p>
              <p className="text-sm opacity-70">{stockLabel(detail, t)}</p>

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  disabled={isSoldOut(detail)}
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
