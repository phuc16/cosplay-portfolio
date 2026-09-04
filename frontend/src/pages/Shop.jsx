import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import axios from "axios"
import { fetchCollections } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import { getLocalized } from "../utils/localize"
import ShopHeader from "../components/shop/ShopHeader"

export default function Shop() {
  const { t, lang } = useLanguage()
  const navigate = useNavigate()
  const [collections, setCollections] = useState(null)
  // Same brand name shown in the portfolio page's own footer — fetched
  // here too since the shop is a separate page tree with no shared layout.
  const [artistName, setArtistName] = useState("")

  useEffect(() => {
    fetchCollections()
      .then(setCollections)
      .catch(() => setCollections([]))
  }, [])

  useEffect(() => {
    axios.get("/api/settings")
      .then((r) => setArtistName(getLocalized(r.data?.artistName, lang)))
      .catch(() => {})
  }, [lang])

  return (
    <>
      <ShopHeader />
      <main className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-1">{t("shopTitle")}</h1>
      <p className="opacity-70 mb-8">{t("shopDesc")}</p>

      {collections === null && <p className="opacity-60">{t("shopLoading")}</p>}
      {collections?.length === 0 && <p className="opacity-60">{t("shopEmpty")}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
        {/* Stable sort: closed (ended) drops sink after active ones, without
            disturbing relative order within each group. */}
        {[...(collections || [])].sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed")).map((c) => (
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

      <footer className="border-t border-[var(--border-brand)] mt-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center text-sm opacity-70">
          <span>© {new Date().getFullYear()} {artistName}. {lang === "vi" ? "Bảo lưu mọi quyền." : "All rights reserved."}</span>
          <span className="flex items-center gap-3">
            <span className="whitespace-nowrap">Made with ♥</span>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={() => navigate("/admin")} className="hover:text-[var(--text-link)]">Admin</button>
          </span>
        </div>
      </footer>
    </>
  )
}
