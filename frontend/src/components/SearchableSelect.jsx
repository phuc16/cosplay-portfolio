import { useEffect, useId, useRef, useState } from "react"
import { useLanguage } from "../contexts/LanguageContext"

// A short list (sort order, a yes/no filter, ~5 status values) doesn't need
// type-to-filter - showing a search box on every dropdown regardless of size
// slows down quick picks on admin pages used constantly during a workday.
const SEARCH_THRESHOLD = 8

/**
 * A styled dropdown that replaces a native <select> - browsers render a
 * native select's option list with OS-level UI that ignores almost all app
 * CSS (see the screenshot that prompted this: a plain white list with the
 * browser's own blue highlight, clashing hard with the site's dark theme).
 * Also adds type-to-filter, which a plain <select> has no equivalent for
 * and which matters here specifically - a province can have 100+ wards.
 */
export default function SearchableSelect({
  value, onChange, options, placeholder, disabled, label, dataTestId, padding = "px-3 py-2", height,
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef(null)
  const showSearch = options.length > SEARCH_THRESHOLD
  const listboxId = useId()
  const optionId = (code) => `${listboxId}-opt-${code}`

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

  // `box-sizing: border-box` only means a declared height already accounts
  // for padding/border - it doesn't let them net negative. `h-0` on the
  // sizer below asks for a 0px content box, but its vertical padding still
  // can't shrink past 0, so the rendered box ends up padding-top +
  // padding-bottom tall regardless of the `h-0`, not truly invisible. That
  // stray height (e.g. `py-1.5`'s 12px) sat in normal flow above the real
  // button, pushing it down inside this wrapper - matching a sibling
  // <input>'s top via a flex `items-start` row lines up this wrapper, but
  // not the button drawn 12px lower inside it. Horizontal padding is kept
  // (it's what makes the sizer's width match the real button's width);
  // only the vertical padding is dropped here.
  const sizerPadding = padding.split(" ").filter((cls) => !cls.startsWith("py-")).join(" ")

  const selected = options.find((o) => o.code === value)
  const filtered = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : options
  // Defensive clamp (not just a reset-on-typing concern) - `options` can
  // change out from under an already-open list (e.g. ward options reloading
  // after a province pick), so a stale index must never point past the end
  // of a shorter `filtered` array.
  const activeOption = filtered.length === 0 ? null : filtered[Math.min(Math.max(activeIndex, 0), filtered.length - 1)]

  const pick = (code) => {
    onChange(code)
    setOpen(false)
    setQuery("")
  }

  // Seeds the highlighted option to whatever is currently selected (falling
  // back to the first option) - mirrors how a native <select> already opens
  // with its current value highlighted.
  const openList = () => {
    const idx = options.findIndex((o) => o.code === value)
    setActiveIndex(idx >= 0 ? idx : options.length > 0 ? 0 : -1)
    setOpen(true)
    setQuery("")
  }

  const closeList = () => {
    setOpen(false)
    setQuery("")
  }

  const updateQuery = (next) => {
    setQuery(next)
    const nextFiltered = next.trim()
      ? options.filter((o) => o.name.toLowerCase().includes(next.trim().toLowerCase()))
      : options
    setActiveIndex(nextFiltered.length > 0 ? 0 : -1)
  }

  const moveActive = (delta) => {
    if (filtered.length === 0) return
    setActiveIndex((idx) => {
      const base = idx < 0 ? (delta > 0 ? -1 : filtered.length) : idx
      return Math.min(Math.max(base + delta, 0), filtered.length - 1)
    })
  }

  const handleKeyDown = (e) => {
    if (disabled) return
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        if (!open) openList()
        else moveActive(1)
        break
      case "ArrowUp":
        e.preventDefault()
        if (!open) openList()
        else moveActive(-1)
        break
      case "Home":
        if (open && filtered.length > 0) {
          e.preventDefault()
          setActiveIndex(0)
        }
        break
      case "End":
        if (open && filtered.length > 0) {
          e.preventDefault()
          setActiveIndex(filtered.length - 1)
        }
        break
      case "Enter":
        e.preventDefault()
        if (!open) openList()
        else if (activeOption) pick(activeOption.code)
        break
      case "Escape":
        if (open) {
          e.preventDefault()
          closeList()
        }
        break
      default:
        break
    }
  }

  return (
    // The box used to be exactly as wide as whichever option is currently
    // selected, so picking a short-labeled option visibly shrank the whole
    // control - and the open dropdown (anchored w-full to that box)
    // inherited the same shrunk width, wrapping every other option's text
    // one word per line. The sizer below - one line per option, at the same
    // horizontal padding/whitespace-nowrap as the real content - sets a
    // stable min-width equal to the widest option, permanently, via the
    // browser's own intrinsic-width calculation. `h-0 overflow-hidden` keeps
    // it out of the visible layout while still counting toward its width -
    // see the `sizerPadding` comment above for why its vertical padding is
    // deliberately dropped instead of reusing `padding` as-is.
    <div className="relative" ref={rootRef}>
      <div className={`invisible pointer-events-none h-0 overflow-hidden ${sizerPadding} whitespace-nowrap`} aria-hidden="true">
        {options.map((o) => <div key={o.code}>{o.name}</div>)}
        {!options.some((o) => o.name === placeholder) && <div>{placeholder}</div>}
      </div>
      <button
        type="button"
        onClick={() => {
          if (disabled) return
          // Re-clicking the trigger to close must also drop any typed
          // filter - otherwise the next open silently starts pre-filtered
          // by whatever was typed last time, with no visible search box
          // (if showSearch) to explain why options are missing.
          if (open) closeList()
          else openList()
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-label={label || placeholder}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        // Only when this button itself holds keyboard focus - once a search
        // box is shown, autoFocus moves real DOM focus there, and that
        // element carries aria-activedescendant instead (see below).
        aria-activedescendant={!showSearch && activeOption ? optionId(activeOption.code) : undefined}
        data-testid={dataTestId}
        // `height` (when given) pins the box to an exact pixel height,
        // matching a sibling <input> in the same row - matching padding
        // alone kept failing in practice (font-size inheritance, form
        // control UA defaults, and glyph-fallback line-height all shift a
        // button's natural height independently of an <input>'s, even with
        // identical padding). An explicit height is immune to all of that.
        className={`w-full ${padding} ${height || ""} rounded-lg border border-[var(--border-brand)] bg-transparent text-left flex items-center justify-between gap-2 disabled:opacity-50`}
      >
        <span className={selected ? "truncate" : "truncate opacity-60"}>{selected ? selected.name : placeholder}</span>
        {/* leading-none here specifically (not on the whole button): "▾" often
            isn't in the primary font, so the browser substitutes a fallback
            symbol font just for this glyph - fallback fonts frequently carry
            much taller line-height metrics than body text, and since these
            two spans are flex items (not inline text), the flex container
            stretches to fit whichever child is tallest. Collapsing this one
            span's own line-height to 1 keeps it from silently growing the
            whole button past its sibling <input>'s height, without touching
            the text span's normal line-height. */}
        <span className={`opacity-50 shrink-0 transition-transform leading-none ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="absolute z-20 top-full w-full mt-1 rounded-lg border border-[var(--border-brand)] bg-[var(--surface-card)] shadow-lg overflow-hidden">
          {showSearch && (
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => updateQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("selectSearchOption")}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={activeOption ? optionId(activeOption.code) : undefined}
              className={`w-full ${padding} border-b border-[var(--border-brand)] bg-transparent text-sm outline-none`}
            />
          )}
          <ul className="max-h-56 overflow-y-auto" role="listbox" id={listboxId}>
            {filtered.length === 0 && <li className={`${padding} text-sm opacity-60`}>{t("selectNoResults")}</li>}
            {filtered.map((o) => (
              <li key={o.code} role="option" id={optionId(o.code)} aria-selected={o.code === value}>
                <button
                  type="button"
                  onClick={() => pick(o.code)}
                  className={`w-full text-left ${padding} text-sm whitespace-nowrap hover:bg-[var(--brand-soft)] ${
                    o.code === value || o.code === activeOption?.code ? "bg-[var(--brand-soft)] font-medium" : ""
                  }`}
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
