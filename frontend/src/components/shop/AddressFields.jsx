import { useEffect, useState } from "react"
import { useLanguage } from "../../contexts/LanguageContext"

const GOONG_KEY = import.meta.env.VITE_GOONG_API_KEY

/**
 * Goong is Vietnam-specific and handles ward/district/province properly.
 * When no key is configured, or the lookup fails, this degrades to a plain
 * textarea — a buyer must never be blocked from ordering by a third party.
 */
export default function AddressFields({ value, onChange }) {
  const { t } = useLanguage()
  const [query, setQuery] = useState(value.address_raw || "")
  const [suggestions, setSuggestions] = useState([])

  // The effect never sets state synchronously — only from within the fetch's
  // .then()/.catch() — so a short/empty query is handled by gating what's
  // shown below (visibleSuggestions) rather than resetting state here. That
  // avoids a set-state-in-effect trap where a sync reset followed by an async
  // setter in the same effect trips react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!GOONG_KEY || query.trim().length < 4) return

    const timer = setTimeout(() => {
      fetch(
        `https://rsapi.goong.io/Place/AutoComplete?api_key=${GOONG_KEY}&input=${encodeURIComponent(query)}`
      )
        .then((res) => res.json())
        .then((data) => setSuggestions(data.predictions?.slice(0, 5) || []))
        .catch(() => setSuggestions([])) // silent: the manual field below still works
    }, 350)

    return () => clearTimeout(timer)
  }, [query])

  const visibleSuggestions = GOONG_KEY && query.trim().length >= 4 ? suggestions : []

  const pick = (s) => {
    const parts = s.structured_formatting?.secondary_text?.split(",").map((x) => x.trim()) || []
    onChange({
      address_raw: s.description,
      address_street: s.structured_formatting?.main_text || s.description,
      address_ward: parts[0] || null,
      address_district: parts[1] || null,
      address_province: parts[2] || null,
    })
    setQuery(s.description)
    setSuggestions([])
  }

  return (
    <div className="relative">
      <label className="block text-sm mb-1">{t("checkoutAddress")}</label>
      <textarea
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange({ ...value, address_raw: e.target.value })
        }}
        rows={2}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
      />

      {visibleSuggestions.length > 0 && (
        <ul className="absolute z-10 w-full bg-[var(--surface-card)] border border-[var(--border-brand)] rounded-lg mt-1 overflow-hidden">
          {visibleSuggestions.map((s) => (
            <li key={s.place_id}>
              <button type="button" onClick={() => pick(s)} className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--brand-soft)]">
                {s.description}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
