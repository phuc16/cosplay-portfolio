import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { fetchCollection } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import { renderMarkdown } from "../utils/markdown"
import ProductCard from "../components/shop/ProductCard"

export default function Collection() {
  const { slug } = useParams()
  const { t } = useLanguage()
  const [result, setResult] = useState({ slug: null, collection: undefined })

  useEffect(() => {
    let ignore = false
    fetchCollection(slug)
      .then((data) => {
        if (!ignore) setResult({ slug, collection: data })
      })
      .catch(() => {
        if (!ignore) setResult({ slug, collection: null })
      })
    return () => {
      ignore = true
    }
  }, [slug])

  // Until the fetch for the current slug resolves, treat it as loading rather
  // than showing a stale result from a previous slug.
  const collection = result.slug === slug ? result.collection : undefined

  if (collection === undefined) {
    return <main className="max-w-5xl mx-auto px-4 py-10 opacity-60">{t("shopLoading")}</main>
  }

  if (collection === null) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-10">
        <p className="opacity-70 mb-4">{t("shopNotFound")}</p>
        <Link to="/shop" className="text-[var(--text-link)]">{t("shopBack")}</Link>
      </main>
    )
  }

  const closed = collection.status === "closed"

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <Link to="/shop" className="text-sm text-[var(--text-link)]">← {t("shopBack")}</Link>

      {collection.cover_image && (
        <img
          src={collection.cover_image}
          alt={collection.title}
          className="w-full rounded-2xl mt-4 mb-6"
        />
      )}

      <h1 className="text-3xl font-bold mb-2">{collection.title}</h1>

      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        {collection.allow_ship && (
          <span className="px-2 py-1 rounded-lg border border-[var(--border-brand)]">{t("shopShip")}</span>
        )}
        {collection.allow_pickup && (
          <span className="px-2 py-1 rounded-lg border border-[var(--border-brand)]">{t("shopPickup")}</span>
        )}
      </div>

      {collection.allow_pickup && (collection.pickup_location || collection.pickup_note) && (
        <div className="mb-6 p-4 rounded-xl border border-[var(--border-brand)] opacity-80">
          {collection.pickup_location && (
            <p className="font-semibold">{t("shopPickupLocation")}: {collection.pickup_location}</p>
          )}
          {collection.pickup_note && (
            <p className="text-sm">{t("shopPickupNote")}: {collection.pickup_note}</p>
          )}
        </div>
      )}

      {closed && (
        <div className="mb-6 p-4 rounded-xl border border-[var(--border-brand)] opacity-80">
          <p className="font-semibold">{t("shopClosed")}</p>
          <p className="text-sm">{t("shopClosedNote")}</p>
        </div>
      )}

      {collection.description && (
        <div
          className="prose max-w-none mb-8"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(collection.description) }}
        />
      )}

      {collection.products.length === 0 ? (
        <p className="opacity-60">{t("shopNoProducts")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {collection.products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </main>
  )
}
