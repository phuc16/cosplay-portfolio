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
