import { useState } from "react"

const s = {
  back: { background: "none", border: "none", color: "var(--text-link)", cursor: "pointer", fontSize: "var(--text-sm)", padding: 0, marginBottom: 12 },
  title: { margin: "0 0 16px", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-link)" },
  grid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 },
  card: { borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border-default)", background: "var(--bg-sunken)", position: "relative", transition: "transform .25s,box-shadow .25s" },
  img: { width: "100%", aspectRatio: "4/5", objectFit: "cover", display: "block" },
  placeholder: { width: "100%", aspectRatio: "4/5", background: "var(--bg-sunken)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "var(--text-sm)" },
  foot: { padding: "10px 14px", borderTop: "1px solid var(--border-default)" },
  name: { fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)" },
  count: { fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 },
  photoGrid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 8 },
  photo: { width: "100%", aspectRatio: "4/5", objectFit: "cover", display: "block", borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", cursor: "pointer" },
  sub: { margin: "24px 0 12px", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-muted)" },
}

export default function SubAlbumGrid({ album, lang, onBack, onOpenPhotos }) {
  const vi = lang === "vi"
  const unit = vi ? "ảnh" : "photos"
  const [hov, setHov] = useState(null)

  return (
    <div>
      <button type="button" data-testid="sub-back" onClick={onBack} style={s.back}>← {vi ? "Quay lại" : "Back"}</button>
      <h3 style={s.title}>{album.title}</h3>
      <div className="album-grid" style={s.grid}>
        {album.subAlbums.map((sub, i) => {
          const empty = sub.items.length === 0
          const open = () => { if (!empty) onOpenPhotos(sub.items, 0) }
          return (
            <div
              key={sub.id}
              data-testid="sub-album-card"
              role="button"
              tabIndex={empty ? -1 : 0}
              aria-disabled={empty ? "true" : undefined}
              onClick={open}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open() } }}
              onMouseEnter={() => setHov(i)}
              onMouseLeave={() => setHov(null)}
              style={{ ...s.card, cursor: empty ? "default" : "pointer", transform: !empty && hov === i ? "scale(1.02)" : "none", boxShadow: !empty && hov === i ? "var(--shadow-pink-hover)" : "none" }}
            >
              {empty
                ? <div style={s.placeholder}>{vi ? "Chưa có ảnh" : "No photos yet"}</div>
                : <img src={sub.cover} alt={sub.title} loading="lazy" decoding="async" style={s.img} />}
              <div style={s.foot}>
                <div style={s.name}>{sub.title}</div>
                <div style={s.count}>{sub.count} {unit}</div>
              </div>
            </div>
          )
        })}
      </div>
      {album.items.length > 0 && (
        <>
          <h4 data-testid="direct-photos-title" style={s.sub}>{vi ? "Ảnh khác" : "More photos"}</h4>
          <div className="album-grid" style={s.photoGrid}>
            {album.thumbs.map((src, i) => (
              <img key={`${src}-${i}`} data-testid="direct-photo" src={src} alt={`${album.title} ${i + 1}`} loading="lazy" decoding="async" role="button" tabIndex={0} style={s.photo} onClick={() => onOpenPhotos(album.items, i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenPhotos(album.items, i) } }} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
