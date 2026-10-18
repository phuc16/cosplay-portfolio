import { useRef, useState } from "react"

const COLS = "repeat(auto-fill, minmax(min(190px, calc(50% - 6px)), 1fr))"
const ARROW_THRESHOLD = 6

const s = {
  back: { background: "none", border: "none", color: "var(--text-link)", cursor: "pointer", fontSize: "var(--text-sm)", padding: 0, marginBottom: 12 },
  title: { margin: "0 0 16px", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-link)" },
  rowWrap: { position: "relative" },
  row: { display: "flex", flexWrap: "nowrap", gap: 12, overflowX: "auto", scrollSnapType: "x proximity", scrollbarWidth: "thin", paddingBottom: 6 },
  arrow: { position: "absolute", top: "40%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: "var(--radius-full)", border: "none", background: "rgba(0,0,0,.6)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, lineHeight: 1, zIndex: 2 },
  card: { flex: "1 0 130px", scrollSnapAlign: "start", borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border-default)", background: "var(--bg-sunken)", position: "relative", transition: "transform .25s,box-shadow .25s" },
  img: { width: "100%", aspectRatio: "4/5", objectFit: "cover", display: "block" },
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0, padding: "28px 10px 10px", background: "linear-gradient(to top, rgba(0,0,0,.75), transparent)", pointerEvents: "none" },
  name: { fontSize: "var(--text-xs)", fontWeight: 600, color: "#fff", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  count: { fontSize: "var(--text-xs)", color: "rgba(255,255,255,.8)", marginTop: 2 },
  muted: { color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: 0 },
  photoGrid: { display: "grid", gridTemplateColumns: COLS, gap: 12, marginTop: 8 },
  photo: { width: "100%", aspectRatio: "4/5", objectFit: "cover", display: "block", borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", cursor: "pointer" },
  sub: { margin: "24px 0 12px", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-muted)" },
}

export default function SubAlbumGrid({ album, lang, onBack, onOpenPhotos }) {
  const vi = lang === "vi"
  const unit = vi ? "ảnh" : "photos"
  const [hov, setHov] = useState(null)
  const rowRef = useRef(null)
  const visible = album.subAlbums.filter((sub) => sub.items.length > 0)
  const scroll = (dir) => rowRef.current?.scrollBy?.({ left: dir * rowRef.current.clientWidth * 0.8, behavior: "smooth" })
  const hasDirect = album.items.length > 0

  return (
    <div>
      <button type="button" data-testid="sub-back" onClick={onBack} style={s.back}>← {vi ? "Quay lại" : "Back"}</button>
      <h3 style={s.title}>{album.title}</h3>
      {visible.length === 0 && !hasDirect && <p data-testid="sub-empty" style={s.muted}>{vi ? "Chưa có ảnh" : "No photos yet"}</p>}
      {visible.length > 0 && (
        <div style={s.rowWrap}>
          {visible.length > ARROW_THRESHOLD && (
            <button type="button" data-testid="sub-prev" aria-label={vi ? "Trước" : "Previous"} onClick={() => scroll(-1)} style={{ ...s.arrow, left: 4 }}>‹</button>
          )}
          <div ref={rowRef} style={s.row}>
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
          {visible.length > ARROW_THRESHOLD && (
            <button type="button" data-testid="sub-next" aria-label={vi ? "Sau" : "Next"} onClick={() => scroll(1)} style={{ ...s.arrow, right: 4 }}>›</button>
          )}
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
    </div>
  )
}
