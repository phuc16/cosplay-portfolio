import { useEffect, useRef, useState } from "react"

// Reference size the hidden measuring span renders at — font metrics scale
// linearly with font-size for the same text/font, so measuring once at this
// size and scaling proportionally is enough; no need to re-measure per size.
const BASE_PX = 16
// Only mobile gets the fill-the-line treatment (this is the actual
// complaint: a short title leaves blank space on a narrow phone screen).
// Desktop keeps the original fixed heading size, which already looked fine.
const MOBILE_BREAKPOINT = 640

/**
 * A heading that scales its own font-size so a single-line title fills the
 * width of its container on mobile, instead of sitting at a fixed size that
 * leaves blank space for a short title (or would wrap for a long one).
 * Bounded to [minPx, maxPx] so a one-word title doesn't become absurdly
 * huge and a very long one doesn't shrink past readable.
 */
export default function FitTitle({ text, as: Tag = "h1", minPx = 20, maxPx = 40, fixedPx = 30, className = "" }) {
  const containerRef = useRef(null)
  const measureRef = useRef(null)
  const [fontPx, setFontPx] = useState(fixedPx)

  useEffect(() => {
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure) return

    const recompute = () => {
      const containerWidth = container.clientWidth
      if (!containerWidth) return
      if (containerWidth >= MOBILE_BREAKPOINT) {
        setFontPx(fixedPx)
        return
      }
      const naturalWidth = measure.scrollWidth
      if (!naturalWidth) return
      const scale = containerWidth / naturalWidth
      setFontPx(Math.min(maxPx, Math.max(minPx, BASE_PX * scale)))
    }

    recompute()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(recompute)
    ro.observe(container)
    return () => ro.disconnect()
  }, [text, minPx, maxPx, fixedPx])

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden">
      {/* overflow/textOverflow is a safety net for a title so long even
          minPx can't fit it on one line — truncates with "…" rather than
          silently clipping mid-character. */}
      <Tag
        className={className}
        style={{ fontSize: fontPx, whiteSpace: "nowrap", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {text}
      </Tag>
      <span
        ref={measureRef}
        aria-hidden="true"
        className={className}
        style={{ position: "absolute", top: 0, left: 0, visibility: "hidden", whiteSpace: "nowrap", fontSize: BASE_PX }}
      >
        {text}
      </span>
    </div>
  )
}
