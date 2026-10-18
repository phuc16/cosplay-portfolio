const db = require("./db")

class AlbumInputError extends Error {
  constructor(message) {
    super(message)
    this.name = "AlbumInputError"
  }
}

function parsePositiveInt(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 && String(value).trim() === String(n) ? n : null
}

async function resolveParentId(raw) {
  if (raw === undefined || raw === null || raw === "") return null
  const id = parsePositiveInt(raw)
  if (id === null) throw new AlbumInputError("parent_id không hợp lệ.")
  const [[parent]] = await db.query("SELECT id, parent_id FROM albums WHERE id=?", [id])
  if (!parent) throw new AlbumInputError("Album cha không tồn tại.")
  if (parent.parent_id !== null) throw new AlbumInputError("Album con không thể chứa album con.")
  return id
}

async function nextSortOrder(parentId) {
  const [[{ nextOrder }]] = await db.query(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM albums WHERE parent_id <=> ?",
    [parentId]
  )
  return nextOrder
}

async function assertSameParent(ids) {
  const [rows] = await db.query(
    `SELECT parent_id FROM albums WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  )
  const unique = new Set(ids.map(Number)).size
  if (unique !== ids.length || rows.length !== unique) {
    throw new AlbumInputError("Album không tồn tại.")
  }
  if (new Set(rows.map((r) => r.parent_id)).size > 1) {
    throw new AlbumInputError("Chỉ đổi thứ tự album cùng cấp.")
  }
}

async function assertAlbumExists(raw) {
  const id = parsePositiveInt(raw)
  if (id === null) throw new AlbumInputError("Album không tồn tại.")
  const [[album]] = await db.query("SELECT id FROM albums WHERE id=?", [id])
  if (!album) throw new AlbumInputError("Album không tồn tại.")
  return id
}

function toItem(img) {
  return { id: img.id, src: img.thumb_url || img.url, fullSrc: img.url, width: img.width, height: img.height }
}

function buildGallery(albums, images) {
  const itemsByAlbum = new Map()
  for (const img of images) {
    if (!img.url) continue
    if (!itemsByAlbum.has(img.album_id)) itemsByAlbum.set(img.album_id, [])
    itemsByAlbum.get(img.album_id).push(toItem(img))
  }
  const itemsOf = (id) => itemsByAlbum.get(id) || []

  return albums
    .filter((a) => a.parent_id == null)
    .map((a) => ({
      id: a.id,
      group: a.title,
      description: a.description,
      items: itemsOf(a.id),
      subAlbums: albums
        .filter((s) => s.parent_id === a.id)
        .map((s) => {
          const items = itemsOf(s.id)
          return { id: s.id, title: s.title, description: s.description, cover: items[0]?.src ?? null, count: items.length, items }
        }),
    }))
}

module.exports = { AlbumInputError, resolveParentId, nextSortOrder, assertSameParent, assertAlbumExists, buildGallery }
