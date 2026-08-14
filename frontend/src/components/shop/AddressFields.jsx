import { useEffect, useState } from "react"
import { useLanguage } from "../../contexts/LanguageContext"
import { fetchProvinces, fetchWards, searchAddress } from "../../api/shop"

const searchIcon = (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <circle cx="11" cy="11" r="7" strokeWidth="2" />
    <path strokeLinecap="round" strokeWidth="2" d="M21 21l-4.35-4.35" />
  </svg>
)

/**
 * Province (34) + ward picked from reference data, not a live per-keystroke
 * autocomplete — replaces the previous Goong-autocomplete design, which
 * fired a request on nearly every character typed. Data reflects Vietnam's
 * post-2025 restructuring (34 provinces/cities, no district level), fetched
 * through our own backend (backend/shop/vnAddress.js), which caches each
 * response for 30 days — administrative boundaries change rarely, and this
 * keeps us off a third party's free API almost entirely rather than baking
 * a copy of the data into this repo to go stale.
 *
 * Street/house-number is a plain text field with an optional on-demand
 * search: a button, not per-keystroke autocomplete, so a buyer chooses when
 * to spend a lookup rather than firing one on every character typed. The
 * already-picked ward/province scope the search query, which resolves a
 * short, ambiguous street name to the right area instead of a same-named
 * street elsewhere in the country.
 */
export default function AddressFields({ value, onChange }) {
  const { t } = useLanguage()
  const [provinces, setProvinces] = useState([])
  const [wards, setWards] = useState([])
  const [provinceCode, setProvinceCode] = useState("")
  const [wardCode, setWardCode] = useState("")
  const [street, setStreet] = useState(value.address_street || "")
  const [streetSuggestions, setStreetSuggestions] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    fetchProvinces()
      .then(setProvinces)
      .catch(() => setProvinces([]))
  }, [])

  useEffect(() => {
    // No provinceCode means "reset to no wards", already handled by
    // onProvinceChange (a real event handler, not this effect) clearing
    // wards synchronously — this effect only ever needs to fetch.
    if (!provinceCode) return
    fetchWards(provinceCode)
      .then(setWards)
      .catch(() => setWards([]))
  }, [provinceCode])

  const wardNameFor = (code) => wards.find((w) => w.code === code)?.name || ""
  const provinceNameFor = (code) => provinces.find((p) => p.code === code)?.name || ""

  const emit = (next) => {
    const provinceName = provinceNameFor(next.provinceCode)
    const wardName = wardNameFor(next.wardCode)
    const parts = [next.street, wardName, provinceName].filter(Boolean)
    onChange({
      address_raw: parts.join(", "),
      address_street: next.street,
      address_ward: wardName || null,
      // No district level in the current administrative structure — kept
      // in the schema only because existing pre-2025-merger orders have it.
      address_district: null,
      address_province: provinceName || null,
    })
  }

  const onProvinceChange = (code) => {
    setProvinceCode(code)
    setWardCode("")
    setWards([])
    emit({ provinceCode: code, wardCode: "", street })
  }

  const onWardChange = (code) => {
    setWardCode(code)
    emit({ provinceCode, wardCode: code, street })
  }

  const onStreetChange = (text) => {
    setStreet(text)
    setStreetSuggestions([])
    emit({ provinceCode, wardCode, street: text })
  }

  // Explicit click only — never wired to onChange/an effect, so this never
  // fires per keystroke the way the original Goong design did.
  const onSearchStreet = () => {
    if (street.trim().length < 3 || searching) return
    setSearching(true)
    searchAddress(street, wardNameFor(wardCode), provinceNameFor(provinceCode))
      .then((data) => setStreetSuggestions(data.predictions?.slice(0, 5) || []))
      .catch(() => setStreetSuggestions([]))
      .finally(() => setSearching(false))
  }

  const pickStreetSuggestion = (s) => {
    // s.structured_formatting.main_text is too short for anything Goong
    // treats as a named place (e.g. an apartment block: "Sảnh chính S3.01"
    // alone, dropping "CC Vinhomes Grand Park" entirely) — the full
    // description carries the detail. It also repeats the ward/province we
    // already sent it (and already have from our own pickers), so that
    // known suffix is stripped rather than duplicated into address_street.
    let text = s.description || s.structured_formatting?.main_text || ""
    const suffix = [wardNameFor(wardCode), provinceNameFor(provinceCode)].filter(Boolean).join(", ")
    if (suffix && text.endsWith(suffix)) {
      text = text.slice(0, text.length - suffix.length).replace(/,\s*$/, "")
    }
    setStreet(text)
    setStreetSuggestions([])
    emit({ provinceCode, wardCode, street: text })
  }

  const selectCls = "w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"

  return (
    <div>
      <label className="block text-sm mb-1">{t("checkoutAddress")}</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm mb-1">{t("checkoutProvince")}</label>
          <select value={provinceCode} onChange={(e) => onProvinceChange(e.target.value)} className={selectCls}>
            <option value="">{t("checkoutSelectProvince")}</option>
            {provinces.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">{t("checkoutWard")}</label>
          <select
            value={wardCode}
            onChange={(e) => onWardChange(e.target.value)}
            disabled={!provinceCode}
            className={`${selectCls} disabled:opacity-50`}
          >
            <option value="">{t("checkoutSelectWard")}</option>
            {wards.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
          </select>
        </div>

        <div className="sm:col-span-2 relative">
          <label className="block text-sm mb-1">{t("checkoutStreet")}</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={street}
              onChange={(e) => onStreetChange(e.target.value)}
              placeholder={t("checkoutStreetPlaceholder")}
              className={selectCls}
            />
            <button
              type="button"
              onClick={onSearchStreet}
              disabled={street.trim().length < 3 || searching}
              aria-label={t("checkoutStreetSearch")}
              title={t("checkoutStreetSearch")}
              className="shrink-0 px-3 rounded-lg border border-[var(--border-brand)] disabled:opacity-40"
            >
              {searchIcon}
            </button>
          </div>

          {streetSuggestions.length > 0 && (
            <ul className="absolute z-10 w-full bg-[var(--surface-card)] border border-[var(--border-brand)] rounded-lg mt-1 overflow-hidden">
              {streetSuggestions.map((s) => (
                <li key={s.place_id || s.description}>
                  <button
                    type="button"
                    onClick={() => pickStreetSuggestion(s)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--brand-soft)]"
                  >
                    {s.description}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
