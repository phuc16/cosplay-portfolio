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
  // The *code* (not index) of the keyboard-highlighted option, or null when
  // nothing is highlighted. Storing the code rather than an index means a
  // typed query that reshuffles/shrinks the filtered list can't leave the
  // highlight silently pointing at the wrong option - the index below is
  // re-derived from this code against the current `filtered` array on every
  // render instead. Reset to null everywhere `query`/`open` already get
  // reset, so a stale highlight never silently carries into the next open
  // (same reasoning as the existing query-reset-on-close).
  const [highlightedCode, setHighlightedCode] = useState(null)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const listboxId = useId()
  const showSearch = options.length > SEARCH_THRESHOLD
  const optionId = (code) => `${listboxId}-option-${code}`

  useEffect(() => {
    const onClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
        setQuery("")
        setHighlightedCode(null)
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

  // Re-derived from `highlightedCode` on every render rather than stored as
  // an index directly (see the state comment above) - if the highlighted
  // option's code no longer appears in `filtered` (the query just narrowed
  // it out), this falls back to the first filtered option, or -1 once the
  // list itself is empty.
  let highlightedIndex = highlightedCode == null ? -1 : filtered.findIndex((o) => o.code === highlightedCode)
  if (highlightedCode != null && highlightedIndex === -1) {
    highlightedIndex = filtered.length > 0 ? 0 : -1
  }
  const highlightedOption = highlightedIndex >= 0 ? filtered[highlightedIndex] : null

  const pick = (code) => {
    onChange(code)
    setOpen(false)
    setQuery("")
    setHighlightedCode(null)
  }

  const close = ({ restoreFocus = false } = {}) => {
    setOpen(false)
    setQuery("")
    setHighlightedCode(null)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const moveHighlight = (delta) => {
    if (filtered.length === 0) return
    // No current highlight: ArrowDown lands on the first option, ArrowUp on
    // the last - implemented as picking the base index the wrap-around math
    // below would naturally land on either side of.
    const base = highlightedIndex === -1 ? (delta > 0 ? -1 : 0) : highlightedIndex
    const next = (base + delta + filtered.length) % filtered.length
    setHighlightedCode(filtered[next].code)
  }

  const highlightFirst = () => {
    if (filtered.length > 0) setHighlightedCode(filtered[0].code)
  }

  const highlightLast = () => {
    if (filtered.length > 0) setHighlightedCode(filtered[filtered.length - 1].code)
  }

  // Shared between the trigger button and the search input - once the
  // dropdown is open, both need identical Arrow/Home/End/Enter/Escape
  // handling. Focus moves to the search input the moment it renders
  // (autoFocus below), so keying only the button would silently break
  // keyboard nav for any list long enough to show a search box.
  const handleOpenKeyDown = (e) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        moveHighlight(1)
        break
      case "ArrowUp":
        e.preventDefault()
        moveHighlight(-1)
        break
      case "Home":
        e.preventDefault()
        highlightFirst()
        break
      case "End":
        e.preventDefault()
        highlightLast()
        break
      case "Enter":
        e.preventDefault()
        // No-op when nothing is highlighted (e.g. the filtered list is
        // empty) - Enter must never silently "select" nothing.
        if (highlightedOption) pick(highlightedOption.code)
        break
      case "Escape":
        e.preventDefault()
        // Selection is left exactly as it was before opening - Escape never
        // calls onChange.
        close({ restoreFocus: true })
        break
      default:
        break
    }
  }

  const handleTriggerKeyDown = (e) => {
    if (disabled) return
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
        e.preventDefault()
        setOpen(true)
        setQuery("")
        // Pre-highlight the current selection so opening via keyboard shows
        // where you are immediately, rather than nothing highlighted -
        // falls back to the first option when nothing is selected yet.
        setHighlightedCode(selected ? selected.code : (options[0]?.code ?? null))
      }
      return
    }
    handleOpenKeyDown(e)
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
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (disabled) return
          // Re-clicking the trigger to close must also drop any typed
          // filter - otherwise the next open silently starts pre-filtered
          // by whatever was typed last time, with no visible search box
          // (if showSearch) to explain why options are missing.
          setOpen((o) => !o)
          setQuery("")
          setHighlightedCode(null)
        }}
        onKeyDown={handleTriggerKeyDown}
        disabled={disabled}
        aria-label={label || placeholder}
        data-testid={dataTestId}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && highlightedOption ? optionId(highlightedOption.code) : undefined}
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
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleOpenKeyDown}
              placeholder={t("selectSearchOption")}
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-activedescendant={highlightedOption ? optionId(highlightedOption.code) : undefined}
              className={`w-full ${padding} border-b border-[var(--border-brand)] bg-transparent text-sm outline-none`}
            />
          )}
          <ul id={listboxId} role="listbox" className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && <li className={`${padding} text-sm opacity-60`}>{t("selectNoResults")}</li>}
            {filtered.map((o, i) => (
              <li key={o.code}>
                <button
                  type="button"
                  id={optionId(o.code)}
                  role="option"
                  aria-selected={o.code === value}
                  onClick={() => pick(o.code)}
                  className={`w-full text-left ${padding} text-sm whitespace-nowrap hover:bg-[var(--brand-soft)] ${o.code === value ? "bg-[var(--brand-soft)] font-medium" : ""} ${i === highlightedIndex ? "bg-[var(--brand-soft)]" : ""}`}
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
