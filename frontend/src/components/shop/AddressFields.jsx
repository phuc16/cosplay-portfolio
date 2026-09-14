import { useEffect, useState } from "react"
import { useLanguage } from "../../contexts/LanguageContext"
import { fetchProvinces, fetchWards, searchAddress } from "../../api/shop"
import SearchableSelect from "../SearchableSelect"

// Fires this long after the buyer stops typing, not on every keystroke - a
// fast typist still costs one Goong call per pause, not one per character.
const STREET_SEARCH_DEBOUNCE_MS = 400

/**
 * Province (34) + ward picked from reference data (Vietnam's post-2025
 * restructuring: 34 provinces/cities, no district level), fetched through
 * our own backend (backend/shop/vnAddress.js), which caches each response
 * for 30 days.
 *
 * Street/house-number search auto-fires (debounced, see
 * STREET_SEARCH_DEBOUNCE_MS) once BOTH province and ward are picked - the
 * street field itself is disabled until then, keeping every query scoped to
 * one ward and cheap enough to run per typing pause.
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
  // Editing an existing order seeds `street` already filled in (see the
  // resolution effects below) - without this guard, the debounced search
  // effect below would fire immediately on opening the edit form, before
  // the buyer ever touched the field. Sticky once true: sets on the
  // field's first focus, never reset back to false.
  const [streetFocused, setStreetFocused] = useState(false)
  const streetEnabled = Boolean(provinceCode && wardCode)

  useEffect(() => {
    fetchProvinces()
      .then(setProvinces)
      .catch(() => setProvinces([]))
  }, [])

  useEffect(() => {
    // No provinceCode means "reset to no wards", already handled by
    // onProvinceChange (a real event handler, not this effect) clearing
    // wards synchronously - this effect only ever needs to fetch.
    if (!provinceCode) return
    fetchWards(provinceCode)
      .then(setWards)
      .catch(() => setWards([]))
  }, [provinceCode])

  // Editing an EXISTING order's address (AdminOrders.jsx/Order.jsx) passes
  // an already-filled `value` in - unlike checkout, where it always starts
  // blank. The stored columns only ever hold the province/ward's *name*
  // (there's no code column), so on the first province list that arrives,
  // resolve the matching code by name and seed the picker's selection from
  // it. The `provinceCode`/`wardCode` guards make this run at most once per
  // field: once the user (or this same resolution) has set a real code,
  // later re-renders of this effect (e.g. a provinces re-fetch) must not
  // silently override their choice. A pre-restructuring order whose stored
  // name no longer matches any current province/ward just fails to
  // resolve - same as today, the user reselects manually.
  useEffect(() => {
    if (!value.address_province || provinceCode || provinces.length === 0) return
    const match = provinces.find((p) => p.name === value.address_province)
    if (match) setProvinceCode(match.code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provinces])

  useEffect(() => {
    if (!value.address_ward || wardCode || wards.length === 0) return
    const match = wards.find((w) => w.name === value.address_ward)
    if (match) setWardCode(match.code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wards])

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
      // No district level in the current administrative structure - kept
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
    emit({ provinceCode, wardCode, street: text })
  }

  // Debounced auto-search: restarts on every keystroke (street/wardCode/
  // provinceCode all in the dependency array) so only the LAST pause in a
  // burst of typing actually fires a request. Never runs before both
  // province and ward are picked (streetEnabled), keeping each query scoped.
  useEffect(() => {
    if (!streetFocused || !streetEnabled || street.trim().length < 3) {
      setStreetSuggestions([])
      return
    }
    const timer = setTimeout(() => {
      setSearching(true)
      searchAddress(street, wardNameFor(wardCode), provinceNameFor(provinceCode))
        .then((data) => setStreetSuggestions(data.predictions?.slice(0, 5) || []))
        .catch(() => setStreetSuggestions([]))
        .finally(() => setSearching(false))
    }, STREET_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [street, streetFocused, streetEnabled, wardCode, provinceCode])

  const pickStreetSuggestion = (s) => {
    // s.structured_formatting.main_text is too short for anything Goong
    // treats as a named place (e.g. an apartment block: "Sảnh chính S3.01"
    // alone, dropping "CC Vinhomes Grand Park" entirely) - the full
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
          <SearchableSelect
            value={provinceCode}
            onChange={onProvinceChange}
            options={provinces}
            placeholder={t("checkoutSelectProvince")}
            label={t("checkoutProvince")}
          />
        </div>

        <div>
          <label className="block text-sm mb-1">{t("checkoutWard")}</label>
          <SearchableSelect
            value={wardCode}
            onChange={onWardChange}
            options={wards}
            placeholder={t("checkoutSelectWard")}
            label={t("checkoutWard")}
            disabled={!provinceCode}
          />
        </div>

        <div className="sm:col-span-2 relative">
          <label className="block text-sm mb-1">{t("checkoutStreet")}</label>
          <input
            type="text"
            value={street}
            onChange={(e) => onStreetChange(e.target.value)}
            onFocus={() => setStreetFocused(true)}
            onKeyDown={(e) => {
              // This field lives inside the checkout form - without
              // preventDefault, Enter would submit the whole order instead
              // of just continuing to type.
              if (e.key === "Enter") e.preventDefault()
            }}
            disabled={!streetEnabled}
            placeholder={streetEnabled ? t("checkoutStreetPlaceholder") : t("checkoutStreetNeedsProvinceWard")}
            className={selectCls + " disabled:opacity-50"}
          />
          {searching && <p className="text-xs opacity-60 mt-1">{t("checkoutStreetSearching")}</p>}

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
