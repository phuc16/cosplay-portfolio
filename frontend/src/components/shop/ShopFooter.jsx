import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { useLanguage } from "../../contexts/LanguageContext"
import { getLocalized } from "../../utils/localize"

/**
 * Copyright/license notice shown on every shop-facing page (/shop,
 * /shop/:slug, /cart, /checkout, /order/:token) — same page list ShopHeader
 * covers. Fetches its own artistName rather than taking it as a prop, since
 * the shop is a separate page tree with no shared layout to hoist it into.
 */
export default function ShopFooter() {
  const { lang } = useLanguage()
  const navigate = useNavigate()
  const [artistName, setArtistName] = useState("")

  useEffect(() => {
    axios.get("/api/settings")
      .then((r) => setArtistName(getLocalized(r.data?.artistName, lang)))
      .catch(() => {})
  }, [lang])

  return (
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
  )
}
