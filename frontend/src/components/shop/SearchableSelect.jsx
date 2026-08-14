import { useEffect, useRef, useState } from "react"
import { useLanguage } from "../../contexts/LanguageContext"

/**
 * A styled dropdown that replaces a native <select> — browsers render a
 * native select's option list with OS-level UI that ignores almost all app
 * CSS (see the screenshot that prompted this: a plain white list with the
 * browser's own blue highlight, clashing hard with the site's dark theme).
 * Also adds type-to-filter, which a plain <select> has no equivalent for
 * and which matters here specifically — a province can have 100+ wards.
 */
export default function SearchableSelect({ value, onChange, options, placeholder, disabled, label }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef(null)

  useEffect(() => {
    const onClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  const selected = options.find((o) => o.code === value)
  const filtered = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : options

  const pick = (code) => {
    onChange(code)
    setOpen(false)
    setQuery("")
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-label={label || placeholder}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent text-left flex items-center justify-between gap-2 disabled:opacity-50"
      >
        <span className={selected ? "" : "opacity-60"}>{selected ? selected.name : placeholder}</span>
        <span className={`opacity-50 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="absolute z-20 w-full mt-1 rounded-lg border border-[var(--border-brand)] bg-[var(--surface-card)] shadow-lg overflow-hidden">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("checkoutSearchOption")}
            className="w-full px-3 py-2 border-b border-[var(--border-brand)] bg-transparent text-sm outline-none"
          />
          <ul className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && <li className="px-3 py-2 text-sm opacity-60">{t("checkoutNoResults")}</li>}
            {filtered.map((o) => (
              <li key={o.code}>
                <button
                  type="button"
                  onClick={() => pick(o.code)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--brand-soft)] ${o.code === value ? "bg-[var(--brand-soft)] font-medium" : ""}`}
                >
                  {o.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
