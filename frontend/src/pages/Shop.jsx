import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { fetchCollections } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import ShopHeader from "../components/shop/ShopHeader"
import ShopFooter from "../components/shop/ShopFooter"

function sortCollections(list, sortBy) {
  const sorted = [...list]
  if (sortBy === "name_asc") sorted.sort((a, b) => a.title.localeCompare(b.title, "vi"))
  else if (sortBy === "name_desc") sorted.sort((a, b) => b.title.localeCompare(a.title, "vi"))
  else if (sortBy === "newest") sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  else if (sortBy === "oldest") sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  // Default: stable sort, closed (ended) drops sink after active ones,
  // without disturbing relative order within each group.
  else sorted.sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed"))
  return sorted
}

export default function Shop() {
  const { t } = useLanguage()
  const [collections, setCollections] = useState(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [sortBy, setSortBy] = useState("default")

  useEffect(() => {
    fetchCollections()
      .then(setCollections)
      .catch(() => setCollections([]))
  }, [])

  const visibleCollections = sortCollections(
    (collections || []).filter((c) => {
      if (search.trim() && !c.title.toLowerCase().includes(search.trim().toLowerCase())) return false
      if (statusFilter && c.status !== statusFilter) return false
      return true
    }),
    sortBy
  )

  return (
    <>
      <ShopHeader />
      <main className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-1">{t("shopTitle")}</h1>
      <p className="opacity-70 mb-8">{t("shopDesc")}</p>

      {collections === null && <p className="opacity-60">{t("shopLoading")}</p>}
      {collections?.length === 0 && <p className="opacity-60">{t("shopEmpty")}</p>}

      {collections?.length > 0 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("shopSearchCollections")}
            className="flex-1 min-w-[180px] px-2 py-1.5 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-[var(--border-brand)] bg-transparent"
          >
            <option value="">{t("shopFilterAllStatus")}</option>
            <option value="active">{t("shopFilterActive")}</option>
            <option value="closed">{t("shopFilterEnded")}</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-[var(--border-brand)] bg-transparent"
          >
            <option value="default">{t("shopSortDefault")}</option>
            <option value="name_asc">{t("shopSortNameAsc")}</option>
            <option value="name_desc">{t("shopSortNameDesc")}</option>
            <option value="newest">{t("shopSortNewest")}</option>
            <option value="oldest">{t("shopSortOldest")}</option>
          </select>
        </div>
      )}

      {collections?.length > 0 && visibleCollections.length === 0 && (
        <p className="opacity-60 mb-6">{t("shopNoCollectionsMatch")}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
        {visibleCollections.map((c) => (
          <Link
            key={c.id}
            to={`/merchandise/${c.slug}`}
            className="rounded-2xl border border-[var(--border-brand)] overflow-hidden hover:shadow-[var(--shadow-pink-hover)] transition"
          >
            {(c.thumbnail_image || c.cover_image) && (
              <div className="relative">
                <img
                  src={c.thumbnail_image || c.cover_image}
                  alt={c.title}
                  loading="lazy"
                  className="w-full aspect-[4/3] object-cover"
                />
                {c.status === "closed" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-white font-semibold">
                    {t("shopClosed")}
                  </span>
                )}
              </div>
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

      <ShopFooter />
    </>
  )
}
