import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import axios from "axios"
import { fetchCollections } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import ShopHeader from "../components/shop/ShopHeader"
import ShopFooter from "../components/shop/ShopFooter"
import SearchableSelect from "../components/SearchableSelect"
import { formatVnDateTime } from "../utils/orderDeadline"
import { useSeoMeta } from "../hooks/useSeoMeta"
import { getLocalized } from "../utils/localize"

// Live/orderable first, then a not-yet-started preview, then closed (ended)
// last - an upcoming drop is still worth surfacing prominently (that's the
// whole point of previewing it), so it must not sink to the same tier as
// something that's already over.
function collectionTier(c) {
  if (c.status === "closed") return 2
  if (c.not_started_yet) return 1
  return 0
}

function sortCollections(list, sortBy) {
  const sorted = [...list]
  if (sortBy === "name_asc") sorted.sort((a, b) => a.title.localeCompare(b.title, "vi"))
  else if (sortBy === "name_desc") sorted.sort((a, b) => b.title.localeCompare(a.title, "vi"))
  else if (sortBy === "newest") sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  else if (sortBy === "oldest") sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  sorted.sort((a, b) => collectionTier(a) - collectionTier(b))
  return sorted
}

// A collection can mix digital and physical products, but has_digital_item
// (already computed server-side - see catalogRepo.listPublicCollections)
// is the same "at least one digital item" signal the card's own badge
// already uses, so grouping by it here stays consistent with what a buyer
// sees on each card.
function groupCollectionsByType(list) {
  const digital = list.filter((c) => c.has_digital_item)
  const physical = list.filter((c) => !c.has_digital_item)
  return { digital, physical }
}

function CollectionCard({ c, t }) {
  return (
    <Link
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
          {c.status !== "closed" && c.not_started_yet && (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 text-white font-semibold text-center px-2">
              <span>{t("shopNotStarted")}</span>
              {c.start_at && (
                <span className="text-xs font-normal">{t("shopOpensAt", { date: formatVnDateTime(c.start_at, { withYear: true }) })}</span>
              )}
            </span>
          )}
        </div>
      )}
      <div className="p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold">{c.title}</h3>
          {c.has_digital_item && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--brand-soft)]">
              {t("shopDigitalBadge")}
            </span>
          )}
        </div>
        <p className="text-sm opacity-70">{t("productsCount", { n: c.product_count })}</p>
        {c.status === "closed" && (
          <p className="mt-2 text-xs uppercase tracking-wide opacity-60">{t("shopClosed")}</p>
        )}
        {c.status !== "closed" && c.not_started_yet && (
          <p className="mt-2 text-xs uppercase tracking-wide opacity-60">{t("shopNotStarted")}</p>
        )}
      </div>
    </Link>
  )
}

function CollectionGroup({ title, list, t }) {
  if (list.length === 0) return null
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold mb-3" data-testid="collection-group-title">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
        {list.map((c) => <CollectionCard key={c.id} c={c} t={t} />)}
      </div>
    </div>
  )
}

export default function Shop() {
  const { t, lang } = useLanguage()
  const [collections, setCollections] = useState(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [sortBy, setSortBy] = useState("default")
  // Fetches its own copy rather than taking it as a prop, same as ShopFooter
  // (see its own comment) - the shop page tree has no shared layout to hoist
  // this into.
  const [brandName, setBrandName] = useState("")

  useEffect(() => {
    fetchCollections()
      .then(setCollections)
      .catch(() => setCollections([]))
  }, [])

  useEffect(() => {
    axios.get("/api/settings")
      .then((r) => setBrandName(getLocalized(r.data?.artistName, lang)))
      .catch(() => {})
  }, [lang])

  const pageTitle = brandName ? `${t("shopTitle")} - ${brandName}` : t("shopTitle")
  useSeoMeta(
    {
      title: pageTitle,
      meta: [{ name: "description", content: t("shopDesc") }],
    },
    [pageTitle, t]
  )

  const visibleCollections = sortCollections(
    (collections || []).filter((c) => {
      if (search.trim() && !c.title.toLowerCase().includes(search.trim().toLowerCase())) return false
      if (statusFilter && c.status !== statusFilter) return false
      if (typeFilter === "digital" && !c.has_digital_item) return false
      if (typeFilter === "physical" && c.has_digital_item) return false
      return true
    }),
    sortBy
  )
  const { digital, physical } = groupCollectionsByType(visibleCollections)

  return (
    <>
      <ShopHeader />
      <main className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-1">{t("shopTitle")}</h1>
      <p className="opacity-70 mb-8">{t("shopDesc")}</p>

      {collections === null && <p className="opacity-60">{t("shopLoading")}</p>}
      {collections?.length === 0 && <p className="opacity-60">{t("shopEmpty")}</p>}

      {collections?.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-start gap-2 mb-6">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("shopSearchCollections")}
            className="w-full sm:flex-1 min-w-0 h-[38px] px-2 py-1.5 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:shrink-0">
            <SearchableSelect padding="px-2 py-1.5" height="h-[38px]"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { code: "", name: t("shopFilterAllStatus") },
                { code: "active", name: t("shopFilterActive") },
                { code: "closed", name: t("shopFilterEnded") },
              ]}
              placeholder={t("shopFilterAllStatus")}
            />
            <SearchableSelect padding="px-2 py-1.5" height="h-[38px]"
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { code: "", name: t("shopFilterAllTypes") },
                { code: "digital", name: t("shopGroupDigital") },
                { code: "physical", name: t("shopGroupPhysical") },
              ]}
              placeholder={t("shopFilterAllTypes")}
            />
            <SearchableSelect padding="px-2 py-1.5" height="h-[38px]"
              value={sortBy}
              onChange={setSortBy}
              options={[
                { code: "default", name: t("shopSortDefault") },
                { code: "name_asc", name: t("shopSortNameAsc") },
                { code: "name_desc", name: t("shopSortNameDesc") },
                { code: "newest", name: t("shopSortNewest") },
                { code: "oldest", name: t("shopSortOldest") },
              ]}
              placeholder={t("shopSortDefault")}
            />
          </div>
        </div>
      )}

      {collections?.length > 0 && visibleCollections.length === 0 && (
        <p className="opacity-60 mb-6">{t("shopNoCollectionsMatch")}</p>
      )}

      <CollectionGroup title={t("shopGroupDigital")} list={digital} t={t} />
      <CollectionGroup title={t("shopGroupPhysical")} list={physical} t={t} />
      </main>

      <ShopFooter />
    </>
  )
}
