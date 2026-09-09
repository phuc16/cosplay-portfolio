import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { fetchCollection } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import { renderMarkdown } from "../utils/markdown"
import ProductCard, { isProductSoldOut } from "../components/shop/ProductCard"
import ShopHeader from "../components/shop/ShopHeader"
import ShopFooter from "../components/shop/ShopFooter"
import FitTitle from "../components/shop/FitTitle"
import { formatVnDateTime } from "../utils/orderDeadline"

// Sold-out products always sink to the end, under every sort mode - not
// just the default - so switching to "Price: low to high" etc. never mixes
// an unbuyable item back in among available ones.
function sortProducts(list, sortBy) {
  const sorted = [...list]
  if (sortBy === "name_asc") sorted.sort((a, b) => a.name.localeCompare(b.name, "vi"))
  else if (sortBy === "name_desc") sorted.sort((a, b) => b.name.localeCompare(a.name, "vi"))
  else if (sortBy === "price_asc") sorted.sort((a, b) => a.price - b.price)
  else if (sortBy === "price_desc") sorted.sort((a, b) => b.price - a.price)
  sorted.sort((a, b) => Number(isProductSoldOut(a)) - Number(isProductSoldOut(b)))
  return sorted
}

export default function Collection() {
  const { slug } = useParams()
  const { t } = useLanguage()
  const [result, setResult] = useState({ slug: null, collection: undefined })
  const [addedMsg, setAddedMsg] = useState(null)
  const [search, setSearch] = useState("")
  const [stockFilter, setStockFilter] = useState("")
  const [sortBy, setSortBy] = useState("default")

  // Brief inline confirmation, matching this codebase's no-toast-library style -
  // cleared automatically a couple seconds after each add.
  const handleAdded = (label) => {
    setAddedMsg(t("shopAddedToCart", { item: label }))
    setTimeout(() => setAddedMsg(null), 2000)
  }

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
    return (
      <>
        <ShopHeader />
        <main className="max-w-5xl mx-auto px-4 py-10 opacity-60">{t("shopLoading")}</main>
        <ShopFooter />
      </>
    )
  }

  if (collection === null) {
    return (
      <>
        <ShopHeader />
        <main className="max-w-5xl mx-auto px-4 py-10">
          <p className="opacity-70 mb-4">{t("shopNotFound")}</p>
          <Link to="/merchandise" className="text-[var(--text-link)]">{t("shopBack")}</Link>
        </main>
        <ShopFooter />
      </>
    )
  }

  const closed = collection.status === "closed"
  const notStartedYet = !closed && collection.not_started_yet
  const unavailableLabel = closed ? t("shopClosed") : notStartedYet ? t("shopNotStarted") : null
  const visibleProducts = sortProducts(
    collection.products.filter((p) => {
      if (search.trim() && !p.name.toLowerCase().includes(search.trim().toLowerCase())) return false
      if (stockFilter === "in_stock" && isProductSoldOut(p)) return false
      if (stockFilter === "sold_out" && !isProductSoldOut(p)) return false
      return true
    }),
    sortBy
  )

  return (
    <>
      <ShopHeader />
      <main className="max-w-5xl mx-auto px-4 py-10">
      <Link to="/merchandise" className="text-sm text-[var(--text-link)]">← {t("shopBack")}</Link>

      {collection.cover_image && (
        <img
          src={collection.cover_image}
          alt={collection.title}
          className="w-full rounded-2xl mt-4 mb-6"
        />
      )}

      <FitTitle text={collection.title} className="font-bold mb-2" />

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
        <div className="mb-6 p-4 rounded-xl border border-red-500/50 bg-red-500/10">
          <p className="font-semibold text-red-500">{t("shopClosed")}</p>
          <p className="text-sm text-red-500/80">{t("shopClosedNote")}</p>
        </div>
      )}

      {notStartedYet && (
        <div className="mb-6 p-4 rounded-xl border border-[var(--border-brand)] bg-[var(--brand-soft)]">
          <p className="font-semibold text-[var(--brand)]">{t("shopNotStarted")}</p>
          {collection.start_at && (
            <p className="text-sm text-[var(--brand)] opacity-80">{t("shopOpensAt", { date: formatVnDateTime(collection.start_at, { withYear: true }) })}</p>
          )}
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
        <>
          {collection.products.length > 1 && (
            <div className="flex flex-col sm:flex-row gap-2 mb-5">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("shopSearchProducts")}
                className="w-full sm:flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-[var(--border-brand)] bg-transparent"
              />
              <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                <select
                  value={stockFilter}
                  onChange={(e) => setStockFilter(e.target.value)}
                  className="px-2 py-1.5 rounded-lg border border-[var(--border-brand)] bg-transparent"
                >
                  <option value="">{t("shopFilterAllStock")}</option>
                  <option value="in_stock">{t("shopFilterInStock")}</option>
                  <option value="sold_out">{t("shopFilterSoldOut")}</option>
                </select>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-2 py-1.5 rounded-lg border border-[var(--border-brand)] bg-transparent"
                >
                  <option value="default">{t("shopSortDefault")}</option>
                  <option value="name_asc">{t("shopSortNameAsc")}</option>
                  <option value="name_desc">{t("shopSortNameDesc")}</option>
                  <option value="price_asc">{t("shopSortPriceAsc")}</option>
                  <option value="price_desc">{t("shopSortPriceDesc")}</option>
                </select>
              </div>
            </div>
          )}

          {visibleProducts.length === 0 ? (
            <p className="opacity-60">{t("shopNoProductsMatch")}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
              {visibleProducts.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  collectionSlug={collection.slug}
                  orderable={!closed && !notStartedYet}
                  unavailableLabel={unavailableLabel}
                  onAdded={handleAdded}
                />
              ))}
            </div>
          )}
        </>
      )}

      {addedMsg && (
        <Link
          to="/cart"
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--brand)] text-white text-sm shadow-lg hover:opacity-90"
        >
          {addedMsg}
          <span className="underline">{t("cart")}</span>
        </Link>
      )}
      </main>
      <ShopFooter />
    </>
  )
}
