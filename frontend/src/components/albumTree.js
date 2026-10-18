export const sameParent = (a, b) => (a.parent_id ?? null) === (b.parent_id ?? null)

export function buildAlbumTree(rows) {
  return rows
    .filter((r) => r.parent_id == null)
    .map((p) => ({ ...p, children: rows.filter((c) => c.parent_id === p.id) }))
}

export function findGalleryAlbum(gallery, id) {
  for (const album of gallery) {
    if (album.id === id) return album
    const sub = (album.subAlbums || []).find((s) => s.id === id)
    if (sub) return sub
  }
  return undefined
}
