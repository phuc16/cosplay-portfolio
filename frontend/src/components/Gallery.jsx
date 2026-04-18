import { useRef, useState, useEffect } from "react"
import { useLanguage } from "../contexts/LanguageContext"

const INITIAL_ALBUMS = 3
const PREVIEW_COUNT = 4
const INITIAL_IMAGES_PER_ALBUM = 12
const LOAD_MORE_COUNT = 12

function LazyImage({ src, alt, onClick, large = false, noMargin = false }) {
  const [isVisible, setIsVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef(null)

  useEffect(() => {
    const el = imgRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true)
      },
      { rootMargin: "150px" }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const minH = large ? "min-h-[180px]" : "min-h-[140px]"
  const aspect = large ? "aspect-[4/3]" : "aspect-square"
  const marginClass = noMargin ? "" : "mb-3 sm:mb-4"

  return (
    <div ref={imgRef} className={`break-inside-avoid ${marginClass}`}>
      {isVisible ? (
        <button
          onClick={onClick}
          className={`relative block w-full overflow-hidden rounded-lg bg-gray-200 dark:bg-slate-800/50 shadow-lg hover:shadow-pink-500/20 hover:shadow-xl transition-all duration-300 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-pink-500 ${aspect}`}
        >
          {!loaded && (
            <div className={`absolute inset-0 bg-gray-200 dark:bg-slate-800 animate-pulse ${minH}`} />
          )}
          <img
            src={src}
            alt={alt}
            className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
            loading="lazy"
            onLoad={() => setLoaded(true)}
          />
        </button>
      ) : (
        <div className={`w-full ${aspect} ${minH} rounded-lg bg-gray-200 dark:bg-slate-800/30 animate-pulse`} />
      )}
    </div>
  )
}

function getGridClass(itemCount) {
  if (itemCount <= 2) return "grid-cols-1 sm:grid-cols-2"
  if (itemCount <= 6) return "grid-cols-1 sm:grid-cols-2 md:grid-cols-3"
  return "grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4"
}

function AlbumSection({ group, onOpenLightbox, t }) {
  const items = group.items || []
  const count = items.length
  const [expanded, setExpanded] = useState(false)
  const [shown, setShown] = useState(INITIAL_IMAGES_PER_ALBUM)
  const visible = items.slice(0, shown)
  const hasMore = count > shown
  const remainder = count - shown

  const largeThumbs = count <= 3
  const colsClass = getGridClass(count)

  if (count === 0) {
    return (
      <div key={group.id || group.group} className="rounded-lg border border-dashed border-gray-300 dark:border-cosplay-border p-4 sm:p-6 text-center text-sm text-gray-500 dark:text-slate-400">
        <span className="text-sm">{group.group}</span> — {t("noImages")}
      </div>
    )
  }

  const showPreview = !expanded
  const previewItems = count <= PREVIEW_COUNT ? items : items.slice(0, 3)
  const moreCount = count - 3

  return (
    <div key={group.id || group.group} className="scroll-mt-4" id={`album-${group.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2 sm:mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-base sm:text-lg text-pink-500 dark:text-pink-300 truncate">{group.group}</h3>
          {group.description && (
            <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mt-0.5 line-clamp-2">{group.description}</p>
          )}
        </div>
        {count > 1 && (
          <span className="text-xs text-gray-500 dark:text-slate-500">{t("photosCount", { n: count })}</span>
        )}
      </div>

      {showPreview ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {previewItems.map((img, idx) => (
            <LazyImage
              key={img.id || idx}
              src={img.src}
              alt={group.group}
              large={false}
              noMargin
              onClick={() =>
                onOpenLightbox({
                  open: true,
                  src: img.fullSrc,
                  caption: `${group.group} — ${idx + 1}`,
                  images: items.map((i, j) => ({ src: i.fullSrc || i.src, caption: `${group.group} — ${j + 1}` })),
                  currentIndex: idx,
                })
              }
            />
          ))}
          {count > PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="relative aspect-square w-full overflow-hidden rounded-lg bg-gray-200 dark:bg-slate-800/50 shadow-lg hover:shadow-pink-500/20 hover:shadow-xl transition-all duration-300 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-pink-500 flex items-center justify-center"
            >
              {items[3] && (
                <img
                  src={items[3].src}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-black/50" />
              <span className="relative z-10 text-2xl sm:text-3xl font-bold text-white drop-shadow-lg">
                +{moreCount}
              </span>
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={`grid ${colsClass} gap-3 sm:gap-4`}>
            {visible.map((img, idx) => (
              <LazyImage
                key={img.id || idx}
                src={img.src}
                alt={group.group}
                large={largeThumbs}
                noMargin
                onClick={() =>
                  onOpenLightbox({
                    open: true,
                    src: img.fullSrc,
                    caption: `${group.group} — ${idx + 1}`,
                    images: items.map((i, j) => ({ src: i.fullSrc || i.src, caption: `${group.group} — ${j + 1}` })),
                    currentIndex: idx,
                  })
                }
              />
            ))}
          </div>
          <div className="mt-3 sm:mt-4 flex flex-wrap gap-2">
            {hasMore && (
              <button
                type="button"
                onClick={() => setShown((s) => Math.min(s + LOAD_MORE_COUNT, count))}
                className="w-full sm:w-auto px-4 py-2.5 sm:py-2 text-sm rounded-md border border-gray-300 dark:border-cosplay-border text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-cosplay-card hover:border-pink-500/50 transition-colors"
              >
                {t("showMorePhotos", { n: remainder })}
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="w-full sm:w-auto px-4 py-2.5 sm:py-2 text-sm rounded-md border border-gray-300 dark:border-cosplay-border text-gray-500 dark:text-slate-500 hover:bg-gray-100 dark:hover:bg-cosplay-card hover:border-pink-500/50 transition-colors"
            >
              {t("showLess")}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function Gallery({ gallery = [], onOpenLightbox }) {
  const { t } = useLanguage()
  const albumsWithContent = gallery?.filter((g) => g?.items?.length > 0) || []
  const [shownAlbums, setShownAlbums] = useState(INITIAL_ALBUMS)
  const visibleAlbums = albumsWithContent.slice(0, shownAlbums)
  const hasMoreAlbums = albumsWithContent.length > shownAlbums
  const hiddenCount = albumsWithContent.length - shownAlbums
  const hasExpandedAlbums = shownAlbums > INITIAL_ALBUMS

  if (!gallery?.length) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-gray-300 dark:border-cosplay-border p-6 sm:p-8 text-center text-sm sm:text-base text-gray-500 dark:text-slate-400">
        {t("noAlbumsOrImages")}
      </div>
    )
  }

  if (!albumsWithContent.length) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-gray-300 dark:border-cosplay-border p-6 sm:p-8 text-center text-sm sm:text-base text-gray-500 dark:text-slate-400">
        {t("noImagesInAlbum")}
      </div>
    )
  }

  return (
    <div className="mt-6">
      <div className="space-y-8 sm:space-y-10">
        {visibleAlbums.map((group) => (
          <AlbumSection key={group.id || group.group} group={group} onOpenLightbox={onOpenLightbox} t={t} />
        ))}
      </div>
      <div className="mt-6 sm:mt-8 flex flex-wrap gap-2">
        {hasMoreAlbums && (
          <button
            type="button"
            onClick={() => setShownAlbums(albumsWithContent.length)}
            className="w-full sm:w-auto px-4 py-2.5 sm:py-2 text-sm rounded-md border border-gray-300 dark:border-cosplay-border text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-cosplay-card hover:border-pink-500/50 transition-colors"
          >
            {t("showMoreAlbums", { n: hiddenCount })}
          </button>
        )}
        {hasExpandedAlbums && (
          <button
            type="button"
            onClick={() => setShownAlbums(INITIAL_ALBUMS)}
            className="w-full sm:w-auto px-4 py-2.5 sm:py-2 text-sm rounded-md border border-gray-300 dark:border-cosplay-border text-gray-500 dark:text-slate-500 hover:bg-gray-100 dark:hover:bg-cosplay-card hover:border-pink-500/50 transition-colors"
          >
            {t("showLess")}
          </button>
        )}
      </div>
    </div>
  )
}
