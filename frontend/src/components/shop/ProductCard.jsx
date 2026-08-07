import { useLanguage } from "../../contexts/LanguageContext"
import { renderMarkdown } from "../../utils/markdown"
import { formatVnd } from "../../utils/money"

/** stock_qty null = unlimited, 0 = sold out, n = n remaining. */
function stockLabel(variant, t) {
  if (variant.stock_qty === null || variant.stock_qty === undefined) return t("shopUnlimited")
  if (variant.stock_qty <= 0) return t("shopSoldOut")
  return t("shopInStock", { n: variant.stock_qty })
}

export default function ProductCard({ product }) {
  const { t } = useLanguage()
  const cover = product.images?.[0] || product.variants?.find((v) => v.image_url)?.image_url

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
                <li
                  key={v.id}
                  title={stockLabel(v, t)}
                  className={
                    "px-2 py-1 rounded-lg text-xs border " +
                    (soldOut
                      ? "opacity-40 line-through border-current"
                      : "border-[var(--border-brand)]")
                  }
                >
                  {v.label}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </article>
  )
}
