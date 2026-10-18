import { useLayoutEffect, useRef, useState } from "react"

const COLS = "repeat(auto-fill, minmax(min(190px, calc(50% - 6px)), 1fr))"
const MIN_COLLAPSED = 260
const FADE_HEIGHT = 48
const SHOW_MORE_BLOCK_HEIGHT = 56

const s = {
  back: { background: "none", border: "none", color: "var(--text-link)", cursor: "pointer", fontSize: "var(--text-sm)", padding: 0, marginBottom: 12 },
  title: { margin: "0 0 16px", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-link)" },
  grid: { display: "grid", gridTemplateColumns: COLS, gap: 12 },
  region: { position: "relative", overflow: "hidden" },
  fade: { position: "absolute", left: 0, right: 0, bottom: 0, height: FADE_HEIGHT, background: "linear-gradient(to top, var(--surface-card), transparent)", pointerEvents: "none" },
  more: { display: "flex", alignItems: "center", justifyContent: "center", height: SHOW_MORE_BLOCK_HEIGHT },
  moreBtn: { background: "none", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", color: "var(--text-link)", cursor: "pointer", fontSize: "var(--text-sm)", fontWeight: 600, padding: "8px 20px" },
  card: { borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border-default)", background: "var(--bg-sunken)", position: "relative", transition: "transform .25s,box-shadow .25s" },
  img: { width: "100%", aspectRatio: "4/5", objectFit: "cover", display: "block" },
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0, padding: "28px 10px 10px", background: "linear-gradient(to top, rgba(0,0,0,.75), transparent)", pointerEvents: "none" },
  name: { fontSize: "var(--text-xs)", fontWeight: 600, color: "#fff", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  count: { fontSize: "var(--text-xs)", color: "rgba(255,255,255,.8)", marginTop: 2 },
  muted: { color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: 0 },
  photoGrid: { display: "grid", gridTemplateColumns: COLS, gap: 12, marginTop: 8 },
  photo: { width: "100%", aspectRatio: "4/5", objectFit: "cover", display: "block", borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", cursor: "pointer" },
  sub: { margin: "24px 0 12px", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-muted)" },
}

export default function SubAlbumGrid({ album, lang, maxHeight, onBack, onOpenPhotos }) {
  const vi = lang === "vi"
  const unit = vi ? "ảnh" : "photos"
  const [hov, setHov] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const [regionTop, setRegionTop] = useState(0)
  const rootRef = useRef(null)
  const regionRef = useRef(null)
  const visible = album.subAlbums.filter((sub) => sub.items.length > 0)
  const hasDirect = album.items.length > 0
  const capped = Boolean(maxHeight) && !expanded
  const collapsedMax = Math.max((maxHeight || 0) - regionTop - SHOW_MORE_BLOCK_HEIGHT, MIN_COLLAPSED)

  useLayoutEffect(() => {
    if (!maxHeight) return undefined
    const measure = () => {
      const region = regionRef.current
      const top = region && rootRef.current ? region.getBoundingClientRect().top - rootRef.current.getBoundingClientRect().top || 0 : 0
      setRegionTop(top)
      const limit = Math.max(maxHeight - top - SHOW_MORE_BLOCK_HEIGHT, MIN_COLLAPSED)
      setOverflowing(Boolean(regionRef.current) && regionRef.current.scrollHeight > limit + 1)
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [maxHeight, album, visible.length])

  const showFade = capped && overflowing

  return (
    <div data-testid="sub-root" ref={rootRef}>
      <div>
        <button type="button" data-testid="sub-back" onClick={onBack} style={s.back}>← {vi ? "Quay lại" : "Back"}</button>
        <h3 style={s.title}>{album.title}</h3>
      </div>
      {visible.length === 0 && !hasDirect && <p data-testid="sub-empty" style={s.muted}>{vi ? "Chưa có ảnh" : "No photos yet"}</p>}
      <div data-testid="sub-region" ref={regionRef} style={{ ...s.region, ...(capped ? { maxHeight: collapsedMax } : null) }}>
        {visible.length > 0 && (
          <div style={s.grid}>
            {visible.map((sub, i) => {
              const open = () => onOpenPhotos(sub.items, 0)
              return (
                <div
                  key={sub.id}
                  data-testid="sub-album-card"
                  role="button"
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open() } }}
                  onMouseEnter={() => setHov(i)}
                  onMouseLeave={() => setHov(null)}
                  style={{ ...s.card, cursor: "pointer", transform: hov === i ? "scale(1.02)" : "none", boxShadow: hov === i ? "var(--shadow-pink-hover)" : "none" }}
                >
                  <img src={sub.cover} alt={sub.title} loading="lazy" decoding="async" style={s.img} />
                  <div style={s.overlay}>
                    <div style={s.name}>{sub.title}</div>
                    <div style={s.count}>{sub.count} {unit}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {hasDirect && (
          <>
            {visible.length > 0 && <h4 data-testid="direct-photos-title" style={s.sub}>{vi ? "Ảnh khác" : "More photos"}</h4>}
            <div style={s.photoGrid}>
              {album.thumbs.map((src, i) => (
                <img key={`${src}-${i}`} data-testid="direct-photo" src={src} alt={`${album.title} ${i + 1}`} loading="lazy" decoding="async" role="button" tabIndex={0} style={s.photo} onClick={() => onOpenPhotos(album.items, i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenPhotos(album.items, i) } }} />
              ))}
            </div>
          </>
        )}
        {showFade && <div data-testid="sub-fade" style={s.fade} />}
      </div>
      {showFade && (
        <div style={s.more}>
          <button type="button" data-testid="sub-show-more" style={s.moreBtn} onClick={() => setExpanded(true)}>
            {vi ? "Xem thêm" : "Show all"}
          </button>
        </div>
      )}
    </div>
  )
}
