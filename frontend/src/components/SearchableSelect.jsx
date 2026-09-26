import { useCallback, useEffect, useId, useRef, useState } from "react"
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
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const listboxId = useId()
  const showSearch = options.length > SEARCH_THRESHOLD

  // Shared by the click-outside handler below and by Escape (keyboard) -
  // wrapped in useCallback (empty deps: it only calls stable setState
  // setters) so both call sites can list it as a dependency without it
  // triggering a re-subscribe on every render.
  const closeAndClear = useCallback(() => {
    setOpen(false)
    setQuery("")
  }, [])

  useEffect(() => {
    const onClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        closeAndClear()
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [closeAndClear])

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

  const filterOptions = (q) => {
    const trimmed = q.trim()
    return trimmed ? options.filter((o) => o.name.toLowerCase().includes(trimmed.toLowerCase())) : options
  }

  const selected = options.find((o) => o.code === value)
  const filtered = filterOptions(query)

  const pick = (code) => {
    onChange(code)
    setOpen(false)
    setQuery("")
  }

  // Attached to the outermost wrapping div (see the JSX below), not just the
  // trigger button - that div is the one ancestor common to both the trigger
  // button and, when open and showSearch is true, the search <input> inside
  // the popup, so a single handler here reliably captures the keystroke
  // regardless of which of those two elements currently has focus.
  const handleKeyDown = (e) => {
    if (disabled) return

    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        // Stops a real <button>'s native "Enter/Space activates a click"
        // from also firing (which would otherwise toggle straight back
        // closed right after this opens it).
        e.preventDefault()
        setOpen(true)
        setHighlightedIndex(options.length ? 0 : -1)
      }
      return
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setHighlightedIndex((i) => (filtered.length === 0 ? -1 : Math.min(filtered.length - 1, i + 1)))
        break
      case "ArrowUp":
        e.preventDefault()
        setHighlightedIndex((i) => (filtered.length === 0 ? -1 : Math.max(0, i - 1)))
        break
      case "Home":
        e.preventDefault()
        if (filtered.length) setHighlightedIndex(0)
        break
      case "End":
        e.preventDefault()
        if (filtered.length) setHighlightedIndex(filtered.length - 1)
        break
      case "Enter":
        e.preventDefault()
        if (filtered.length && highlightedIndex >= 0 && highlightedIndex < filtered.length) {
          pick(filtered[highlightedIndex].code)
        }
        break
      case "Escape":
        e.preventDefault()
        closeAndClear()
        buttonRef.current?.focus()
        break
      default:
        // Notably Tab: no preventDefault, no state change - let it move
        // focus natively. Also lets ordinary typing reach the search input.
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
    <div className="relative" ref={rootRef} onKeyDown={handleKeyDown}>
      <div className={`invisible pointer-events-none h-0 overflow-hidden ${sizerPadding} whitespace-nowrap`} aria-hidden="true">
        {options.map((o) => <div key={o.code}>{o.name}</div>)}
        {!options.some((o) => o.name === placeholder) && <div>{placeholder}</div>}
      </div>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && highlightedIndex >= 0 && filtered[highlightedIndex]
            ? `${listboxId}-option-${highlightedIndex}`
            : undefined
        }
        onClick={() => {
          if (disabled) return
          // Re-clicking the trigger to close must also drop any typed
          // filter - otherwise the next open silently starts pre-filtered
          // by whatever was typed last time, with no visible search box
          // (if showSearch) to explain why options are missing.
          setOpen((o) => {
            const next = !o
            if (next) setHighlightedIndex(options.length ? 0 : -1)
            return next
          })
          setQuery("")
        }}
        disabled={disabled}
        aria-label={label || placeholder}
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
              onChange={(e) => {
                const next = e.target.value
                setQuery(next)
                const nextFiltered = filterOptions(next)
                setHighlightedIndex(nextFiltered.length ? 0 : -1)
              }}
              placeholder={t("selectSearchOption")}
              className={`w-full ${padding} border-b border-[var(--border-brand)] bg-transparent text-sm outline-none`}
            />
          )}
          <ul role="listbox" id={listboxId} className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && <li className={`${padding} text-sm opacity-60`}>{t("selectNoResults")}</li>}
            {filtered.map((o, index) => (
              <li key={o.code} role="presentation">
                <button
                  type="button"
                  role="option"
                  id={`${listboxId}-option-${index}`}
                  aria-selected={o.code === value}
                  onClick={() => pick(o.code)}
                  className={`w-full text-left ${padding} text-sm whitespace-nowrap hover:bg-[var(--brand-soft)] ${o.code === value ? "bg-[var(--brand-soft)] font-medium" : ""} ${index === highlightedIndex ? "bg-[var(--brand-soft)]" : ""}`}
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
