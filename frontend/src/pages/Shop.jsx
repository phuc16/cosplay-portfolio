import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { fetchCollections } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import ShopHeader from "../components/shop/ShopHeader"

export default function Shop() {
  const { t } = useLanguage()
  const [collections, setCollections] = useState(null)

  useEffect(() => {
    fetchCollections()
      .then(setCollections)
      .catch(() => setCollections([]))
  }, [])

  return (
    <>
      <ShopHeader />
      <main className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-1">{t("shopTitle")}</h1>
      <p className="opacity-70 mb-8">{t("shopDesc")}</p>

      {collections === null && <p className="opacity-60">{t("shopLoading")}</p>}
      {collections?.length === 0 && <p className="opacity-60">{t("shopEmpty")}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
        {collections?.map((c) => (
          <Link
            key={c.id}
            to={`/merchandise/${c.slug}`}
            className="rounded-2xl border border-[var(--border-brand)] overflow-hidden hover:shadow-[var(--shadow-pink-hover)] transition"
          >
            {(c.thumbnail_image || c.cover_image) && (
              <img
                src={c.thumbnail_image || c.cover_image}
                alt={c.title}
                loading="lazy"
                className="w-full aspect-[4/3] object-cover"
              />
            )}
            <div className="p-4">
              <h2 className="font-semibold">{c.title}</h2>
              <p className="text-sm opacity-70">{t("productsCount", { n: c.product_count })}</p>
              {c.status === "closed" && (
                <p className="mt-2 text-xs uppercase tracking-wide opacity-60">{t("shopClosed")}</p>
              )}
            </div>
          </Link>
        ))}
      </div>
      </main>
    </>
  )
}
