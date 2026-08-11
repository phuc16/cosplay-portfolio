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

export default function ProductCard({ product, collectionSlug, orderable, onAdded }) {
  const { t } = useLanguage()
  const cover = product.images?.[0] || product.variants?.find((v) => v.image_url)?.image_url
  const [preview, setPreview] = useState(null)

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
    setPreview(null)
  }

  return (
    <article className="rounded-2xl border border-[var(--border-brand)] bg-[var(--surface-card)] overflow-hidden flex flex-col">
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

        {product.variants?.length > 0 && (
          <ul className="mt-auto pt-3 flex flex-wrap gap-2">
            {product.variants.map((v) => {
              const soldOut = v.stock_qty !== null && v.stock_qty !== undefined && v.stock_qty <= 0
              return (
                <li key={v.id} title={stockLabel(v, t)}>
                  <button
                    type="button"
                    disabled={!orderable}
                    onClick={() => setPreview(v)}
                    className={
                      "px-2 py-1 rounded-lg text-xs border transition " +
                      (soldOut ? "opacity-40 line-through border-current cursor-not-allowed"
                               : "border-[var(--border-brand)] hover:bg-[var(--brand-soft)]")
                    }
                  >
                    {v.label}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[var(--border-brand)] bg-[var(--surface-card)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {(preview.image_url || cover) && (
              <img
                src={preview.image_url || cover}
                alt={`${product.name} — ${preview.label}`}
                className="w-full aspect-square object-cover"
              />
            )}
            <div className="p-4 flex flex-col gap-2">
              <h3 className="font-semibold text-lg">{product.name} · {preview.label}</h3>
              <p className="text-[var(--brand)] font-bold">{formatVnd(product.price)}</p>
              <p className="text-sm opacity-70">{stockLabel(preview, t)}</p>

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  disabled={preview.stock_qty !== null && preview.stock_qty !== undefined && preview.stock_qty <= 0}
                  onClick={() => commitAdd(preview)}
                  className="flex-1 px-3 py-2 rounded-xl bg-[var(--brand)] text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t("addToCart")}
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
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
