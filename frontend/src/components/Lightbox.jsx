import { useState, useEffect, useCallback, useRef } from "react"

export default function Lightbox({ src, caption = "", images = [], currentIndex = 0, onClose }) {
  const hasMultiple = images?.length > 1
  const list = hasMultiple ? images : src ? [{ src, caption }] : []
  const [index, setIndex] = useState(hasMultiple ? Math.min(currentIndex, images.length - 1) : 0)
  const [centerPanel, setCenterPanel] = useState(0) // 0 or 1 - which panel is at center
  const [otherSide, setOtherSide] = useState("right") // "left" | "right" - where the other panel is
  const [isAnimating, setIsAnimating] = useState(false)
  const [animatingFrom, setAnimatingFrom] = useState(null) // "left" | "right" during animation
  const panel0Ref = useRef(null)
  const panel1Ref = useRef(null)
  const transitionHandledRef = useRef(false)

  const prevItem = hasMultiple ? list[(index - 1 + list.length) % list.length] : null
  const nextItem = hasMultiple ? list[(index + 1) % list.length] : null
  const current = list[index]

  useEffect(() => {
    if (!hasMultiple) return
    const next = Math.min(currentIndex, images.length - 1)
    const id = requestAnimationFrame(() => {
      setIndex(next)
      setCenterPanel(0)
      setOtherSide("right")
    })
    return () => cancelAnimationFrame(id)
  }, [hasMultiple, currentIndex, images?.length])

  const getPanelContent = useCallback(
    (panel) => {
      if (!hasMultiple) return current
      if (panel === centerPanel) return list[index]
      if (otherSide === "right") return list[(index + 1) % list.length]
      return list[(index - 1 + list.length) % list.length]
    },
    [hasMultiple, list, index, centerPanel, otherSide, current]
  )

  const getPanelTransform = useCallback(
    (panel) => {
      if (!hasMultiple) return "translate3d(0,0,0)"
      if (isAnimating) {
        if (animatingFrom === "right") {
          return panel === centerPanel ? "translate3d(-100%,0,0)" : "translate3d(0,0,0)"
        }
        if (animatingFrom === "left") {
          return panel === centerPanel ? "translate3d(100%,0,0)" : "translate3d(0,0,0)"
        }
      }
      if (panel === centerPanel) return "translate3d(0,0,0)"
      return otherSide === "right" ? "translate3d(100%,0,0)" : "translate3d(-100%,0,0)"
    },
    [hasMultiple, isAnimating, animatingFrom, centerPanel, otherSide]
  )

  const goPrev = useCallback(() => {
    if (!hasMultiple || isAnimating) return
    if (otherSide !== "left") {
      if (panel0Ref.current) panel0Ref.current.style.transition = "none"
      if (panel1Ref.current) panel1Ref.current.style.transition = "none"
      setOtherSide("left")
      requestAnimationFrame(() => {
        if (panel0Ref.current) panel0Ref.current.style.transition = ""
        if (panel1Ref.current) panel1Ref.current.style.transition = ""
        setIsAnimating(true)
        setAnimatingFrom("left")
      })
    } else {
      setIsAnimating(true)
      setAnimatingFrom("left")
    }
  }, [hasMultiple, isAnimating, otherSide])

  const goNext = useCallback(() => {
    if (!hasMultiple || isAnimating) return
    setIsAnimating(true)
    setAnimatingFrom("right")
  }, [hasMultiple, isAnimating])

  const handleTransitionEnd = useCallback(
    (e) => {
      if (e.propertyName !== "transform" || (e.target !== panel0Ref.current && e.target !== panel1Ref.current)) return
      if (!isAnimating || transitionHandledRef.current) return
      transitionHandledRef.current = true
      if (animatingFrom === "right") {
        const newIndex = (index + 1) % list.length
        if (panel0Ref.current) panel0Ref.current.style.transition = "none"
        if (panel1Ref.current) panel1Ref.current.style.transition = "none"
        setIndex(newIndex)
        setCenterPanel((c) => (c === 0 ? 1 : 0))
        setOtherSide("right")
        requestAnimationFrame(() => {
          if (panel0Ref.current) panel0Ref.current.style.transition = ""
          if (panel1Ref.current) panel1Ref.current.style.transition = ""
          setIsAnimating(false)
          setAnimatingFrom(null)
          transitionHandledRef.current = false
        })
      } else if (animatingFrom === "left") {
        const newIndex = (index - 1 + list.length) % list.length
        if (panel0Ref.current) panel0Ref.current.style.transition = "none"
        if (panel1Ref.current) panel1Ref.current.style.transition = "none"
        setIndex(newIndex)
        setCenterPanel((c) => (c === 0 ? 1 : 0))
        setOtherSide("right")
        requestAnimationFrame(() => {
          if (panel0Ref.current) panel0Ref.current.style.transition = ""
          if (panel1Ref.current) panel1Ref.current.style.transition = ""
          setIsAnimating(false)
          setAnimatingFrom(null)
          transitionHandledRef.current = false
        })
      } else {
        transitionHandledRef.current = false
      }
    },
    [isAnimating, animatingFrom, index, list.length]
  )

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowLeft") goPrev()
      else if (e.key === "ArrowRight") goNext()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [onClose, goPrev, goNext])

  if (!current?.src) return null

  const item0 = getPanelContent(0)
  const item1 = getPanelContent(1)
  const transform0 = getPanelTransform(0)
  const transform1 = getPanelTransform(1)

  const panelClass = "absolute inset-0 flex flex-col items-center justify-center shrink-0"
  const imgClass = "w-full h-auto max-h-[65vh] sm:max-h-[80vh] md:max-h-[85vh] object-contain rounded-lg shadow-pink-glow"
  const transitionStyle = isAnimating ? "transform 0.4s ease-in-out" : "none"

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-hidden"
      onClick={onClose}
    >
      {hasMultiple && prevItem && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); goPrev() }}
          className="hidden sm:block absolute left-4 top-1/2 -translate-y-1/2 z-20 w-20 h-20 md:w-28 md:h-28 rounded-lg overflow-hidden border-2 border-white/25 shadow-xl shrink-0 hover:border-pink-400/60 hover:scale-105 transition-all"
        >
          <img src={prevItem.src} alt="" className="w-full h-full object-cover" />
        </button>
      )}

      {hasMultiple && nextItem && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); goNext() }}
          className="hidden sm:block absolute right-4 top-1/2 -translate-y-1/2 z-20 w-20 h-20 md:w-28 md:h-28 rounded-lg overflow-hidden border-2 border-white/25 shadow-xl shrink-0 hover:border-pink-400/60 hover:scale-105 transition-all"
        >
          <img src={nextItem.src} alt="" className="w-full h-full object-cover" />
        </button>
      )}

      <div className="relative z-10 w-full max-w-5xl h-[70vh] sm:h-[85vh] md:h-[90vh] flex items-center justify-center px-8 sm:px-12 md:px-16 overflow-hidden sm:ml-[6.5rem] md:ml-[7.5rem] sm:mr-[6.5rem] md:mr-[7.5rem]">
        {hasMultiple && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goPrev() }}
            className="absolute left-0 top-1/2 -translate-y-1/2 w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-full bg-pink-500 hover:bg-pink-400 text-white flex items-center justify-center shadow-lg shrink-0 disabled:opacity-50 z-20"
            aria-label="Ảnh trước"
            disabled={isAnimating}
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        <div className="relative flex-1 min-w-0 h-full overflow-hidden p-4 sm:p-5" onClick={(e) => e.stopPropagation()}>
          {hasMultiple ? (
            <>
              <div
                ref={panel0Ref}
                className={panelClass}
                style={{ transform: transform0, transition: transitionStyle }}
                onTransitionEnd={handleTransitionEnd}
              >
                {item0?.src && (
                  <>
                    <img src={item0.src} alt={item0.caption} className={imgClass} />
                    {item0.caption && (
                      <div className="mt-2 sm:mt-3 text-pink-400 dark:text-pink-300 text-xs sm:text-sm text-center">
                        {item0.caption}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div
                ref={panel1Ref}
                className={panelClass}
                style={{ transform: transform1, transition: transitionStyle }}
                onTransitionEnd={handleTransitionEnd}
              >
                {item1?.src && (
                  <>
                    <img src={item1.src} alt={item1.caption} className={imgClass} />
                    {item1.caption && (
                      <div className="mt-2 sm:mt-3 text-pink-400 dark:text-pink-300 text-xs sm:text-sm text-center">
                        {item1.caption}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className={panelClass}>
              <img src={current.src} alt={current.caption} className={imgClass} />
              {current.caption && (
                <div className="mt-2 sm:mt-3 text-pink-400 dark:text-pink-300 text-xs sm:text-sm text-center">
                  {current.caption}
                </div>
              )}
            </div>
          )}
        </div>

        {hasMultiple && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goNext() }}
            className="absolute right-0 top-1/2 -translate-y-1/2 w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-full bg-pink-500 hover:bg-pink-400 text-white flex items-center justify-center shadow-lg shrink-0 disabled:opacity-50 z-20"
            aria-label="Ảnh sau"
            disabled={isAnimating}
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
