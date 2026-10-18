const full = (it) => it.fullSrc || it.src

function buildSub(s) {
  const items = s.items || []
  return {
    id: s.id,
    title: s.title,
    count: items.length,
    cover: s.cover || items[0]?.src || "",
    items: items.map(full),
    thumbs: items.map((it) => it.src),
  }
}

export function buildAlbums(gallery) {
  return (gallery || []).map((g) => {
    const items = g.items || []
    const subAlbums = (g.subAlbums || []).map(buildSub)
    const subCount = subAlbums.reduce((n, s) => n + s.count, 0)
    return {
      id: g.id,
      title: g.group,
      count: items.length + subCount,
      cover: items[0]?.src || subAlbums.find((s) => s.cover)?.cover || "",
      items: items.map(full),
      thumbs: items.map((it) => it.src),
      subAlbums,
    }
  })
}

export function allPhotoThumbs(gallery) {
  return (gallery || []).flatMap((g) => [
    ...(g.items || []),
    ...(g.subAlbums || []).flatMap((s) => s.items || []),
  ]).map((it) => it.src)
}

const LATEST_COUNT = 4

export function defaultLatestPhotos(gallery) {
  const first = (gallery || [])[0]
  if (!first) return []
  const subs = (first.subAlbums || []).filter((s) => (s.items || []).length > 0)
  if (subs.length === 0) return allPhotoThumbs(gallery)

  const picked = subs.slice(0, LATEST_COUNT).map((s) => s.items[0].src)
  if (picked.length >= LATEST_COUNT) return picked

  const pool = [...subs.flatMap((s) => s.items), ...(first.items || [])].map((it) => it.src)
  for (const src of pool) {
    if (picked.length >= LATEST_COUNT) break
    if (!picked.includes(src)) picked.push(src)
  }
  return picked
}
