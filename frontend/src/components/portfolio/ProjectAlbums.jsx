import { useRef, useState } from "react"
import SubAlbumGrid from "./SubAlbumGrid"

const s = {
  grid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 },
  card: { borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border-default)", cursor: "pointer", background: "var(--bg-sunken)", position: "relative", transition: "transform .25s,box-shadow .25s" },
  img: { width: "100%", aspectRatio: "4/5", objectFit: "cover", display: "block" },
  placeholder: { width: "100%", aspectRatio: "4/5", background: "var(--bg-sunken)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "var(--text-sm)" },
  foot: { padding: "10px 14px", borderTop: "1px solid var(--border-default)" },
  title: { fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)" },
  count: { fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 },
  plus: { position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: "var(--radius-full)", background: "rgba(236,72,153,.25)", border: "1px solid rgba(236,72,153,.5)", color: "var(--pink-400)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, lineHeight: 1 },
}

export default function ProjectAlbums({ albums, lang, onOpenAlbum, onOpenPhotos }) {
  const vi = lang === "vi"
  const [hov, setHov] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [listHeight, setListHeight] = useState(0)
  const listRef = useRef(null)
  const open = albums.find((a) => a.id === openId)

  if (open) {
    return <SubAlbumGrid album={open} lang={lang} maxHeight={listHeight} onBack={() => setOpenId(null)} onOpenPhotos={onOpenPhotos} />
  }

  const activate = (alb) => {
    if (alb.subAlbums.length === 0) return onOpenAlbum(alb)
    setListHeight(listRef.current ? listRef.current.getBoundingClientRect().height : 0)
    setOpenId(alb.id)
  }

  return (
    <div ref={listRef} className="album-grid" style={s.grid}>
      {albums.map((alb, i) => (
        <div
          key={alb.id}
          data-testid="album-card"
          role="button"
          tabIndex={0}
          style={{ ...s.card, transform: hov === i ? "scale(1.02)" : "none", boxShadow: hov === i ? "var(--shadow-pink-hover)" : "none" }}
          onMouseEnter={() => setHov(i)}
          onMouseLeave={() => setHov(null)}
          onClick={() => activate(alb)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(alb) } }}
        >
          {alb.cover
            ? <img src={alb.cover} alt={alb.title} loading="lazy" decoding="async" style={s.img} />
            : <div data-testid="album-placeholder" style={s.placeholder}>{vi ? "Chưa có ảnh" : "No photos yet"}</div>}
          <div style={s.plus}>+</div>
          <div style={s.foot}>
            <div style={s.title}>{alb.title}</div>
            <div style={s.count}>{alb.count} {vi ? "ảnh" : "photos"}</div>
          </div>
        </div>
      ))}
      {albums.length === 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: 0 }}>{vi ? "Chưa có album." : "No albums yet."}</p>
      )}
    </div>
  )
}
