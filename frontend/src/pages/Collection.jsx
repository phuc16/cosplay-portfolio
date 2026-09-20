import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import axios from "axios"
import { fetchCollection } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import { renderMarkdown } from "../utils/markdown"
import ProductCard, { isProductSoldOut } from "../components/shop/ProductCard"
import ShopHeader from "../components/shop/ShopHeader"
import ShopFooter from "../components/shop/ShopFooter"
import FitTitle from "../components/shop/FitTitle"
import SearchableSelect from "../components/SearchableSelect"
import { formatVnDateTime } from "../utils/orderDeadline"
import { useSeoMeta } from "../hooks/useSeoMeta"
import { getLocalized } from "../utils/localize"
import { stripMarkdownToText, truncateText, toAbsoluteUrl, productSeoImage } from "../utils/seoContent"

const SCHEMA_IN_STOCK = "https://schema.org/InStock"
const SCHEMA_OUT_OF_STOCK = "https://schema.org/OutOfStock"

/**
 * ItemList/Product JSON-LD for the collection's actual catalog content -
 * deliberately built from `collection.products` (every product this page
 * ever renders), not the search/sort-filtered `visibleProducts` view, since
 * a crawler never types into the search box and structured data should
 * describe the page's real content, not one buyer's transient UI state.
 * Availability follows the same "can this actually be bought right now"
 * rule the visible page already enforces (`orderable`) layered under each
 * product's own stock - a sold-out variant or an unstarted/closed
 * collection never gets to claim InStock, per the design doc.
 */
function buildCollectionJsonLd(collection, orderable, pageUrl) {
  const products = collection.products || []
  if (products.length === 0) return null
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: collection.title,
    numberOfItems: products.length,
    itemListElement: products.map((p, idx) => {
      const image = toAbsoluteUrl(productSeoImage(p))
      const item = {
        "@type": "Product",
        name: p.name,
        offers: {
          "@type": "Offer",
          priceCurrency: "VND",
          price: String(p.price),
          availability: orderable && !isProductSoldOut(p) ? SCHEMA_IN_STOCK : SCHEMA_OUT_OF_STOCK,
          url: pageUrl,
        },
      }
      if (image) item.image = image
      return { "@type": "ListItem", position: idx + 1, item }
    }),
  }
}

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
  const { t, lang } = useLanguage()
  const [result, setResult] = useState({ slug: null, collection: undefined })
  const [addedMsg, setAddedMsg] = useState(null)
  const [search, setSearch] = useState("")
  const [stockFilter, setStockFilter] = useState("")
  const [sortBy, setSortBy] = useState("default")
  // Fetches its own copy rather than taking it as a prop, same as ShopFooter
  // (see its own comment) - the shop page tree has no shared layout to hoist
  // this into.
  const [brandName, setBrandName] = useState("")

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

  useEffect(() => {
    axios.get("/api/settings")
      .then((r) => setBrandName(getLocalized(r.data?.artistName, lang)))
      .catch(() => {})
  }, [lang])

  // Until the fetch for the current slug resolves, treat it as loading rather
  // than showing a stale result from a previous slug.
  const collection = result.slug === slug ? result.collection : undefined

  // SEO/social-preview metadata is only ever emitted once the collection has
  // actually loaded (never during the loading state, and never for a
  // not-found slug) - there is nothing truthful to describe until then, and
  // the not-found page in particular has no reason to be indexable/shareable.
  // Deliberately derived from `collection.products` (the full catalog this
  // page renders), not the search/sort-filtered `visibleProducts` below -
  // see buildCollectionJsonLd's own comment.
  const seoOrderable = Boolean(collection) && collection.status !== "closed" && !collection.not_started_yet
  const seoRawDescription = collection?.description ? stripMarkdownToText(collection.description) : ""
  const seoDescription = collection ? truncateText(seoRawDescription || t("shopDesc"), 160) : undefined
  const seoTitle = collection ? (brandName ? `${collection.title} - ${brandName}` : collection.title) : undefined
  const seoImage = collection
    ? toAbsoluteUrl(collection.cover_image || (collection.products || []).map(productSeoImage).find(Boolean))
    : undefined
  const seoUrl = typeof window !== "undefined" ? window.location.href : undefined
  const seoJsonLd = collection ? buildCollectionJsonLd(collection, seoOrderable, seoUrl) : undefined

  useSeoMeta(
    {
      title: seoTitle,
      meta: [
        { name: "description", content: seoDescription },
        { property: "og:title", content: seoTitle },
        { property: "og:description", content: seoDescription },
        // "website", not "product": this page lists a whole collection's
        // products (their per-item price/availability already live in the
        // JSON-LD Offers below), not a single product committing to the OG
        // product namespace's own required properties.
        { property: "og:type", content: "website" },
        { property: "og:url", content: seoUrl },
        { property: "og:site_name", content: brandName },
        { property: "og:image", content: seoImage },
        { name: "twitter:card", content: seoImage ? "summary_large_image" : "summary" },
        { name: "twitter:title", content: seoTitle },
        { name: "twitter:description", content: seoDescription },
        { name: "twitter:image", content: seoImage },
      ],
      jsonLd: seoJsonLd,
    },
    [collection, seoOrderable, brandName]
  )

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
            <div className="flex flex-col sm:flex-row sm:items-start gap-2 mb-5">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("shopSearchProducts")}
                className="w-full sm:flex-1 min-w-0 h-[38px] px-2 py-1.5 rounded-lg border border-[var(--border-brand)] bg-transparent"
              />
              <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                <SearchableSelect padding="px-2 py-1.5" height="h-[38px]"
                  value={stockFilter}
                  onChange={setStockFilter}
                  options={[
                    { code: "", name: t("shopFilterAllStock") },
                    { code: "in_stock", name: t("shopFilterInStock") },
                    { code: "sold_out", name: t("shopFilterSoldOut") },
                  ]}
                  placeholder={t("shopFilterAllStock")}
                />
                <SearchableSelect padding="px-2 py-1.5" height="h-[38px]"
                  value={sortBy}
                  onChange={setSortBy}
                  options={[
                    { code: "default", name: t("shopSortDefault") },
                    { code: "name_asc", name: t("shopSortNameAsc") },
                    { code: "name_desc", name: t("shopSortNameDesc") },
                    { code: "price_asc", name: t("shopSortPriceAsc") },
                    { code: "price_desc", name: t("shopSortPriceDesc") },
                  ]}
                  placeholder={t("shopSortDefault")}
                />
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
