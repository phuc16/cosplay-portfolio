import { describe, it, expect } from "vitest"
import { buildAlbumTree, sameParent, findGalleryAlbum } from "./albumTree"

const rows = [
  { id: 1, title: "A", parent_id: null },
  { id: 3, title: "A-2", parent_id: 1 },
  { id: 2, title: "B" },
  { id: 4, title: "A-1", parent_id: 1 },
  { id: 9, title: "orphan", parent_id: 777 },
]

describe("buildAlbumTree", () => {
  it("nests children under parents preserving input order", () => {
    const tree = buildAlbumTree(rows)
    expect(tree.map((t) => t.id)).toEqual([1, 2])
    expect(tree[0].children.map((c) => c.id)).toEqual([3, 4])
    expect(tree[1].children).toEqual([])
  })
  it("treats undefined parent_id as top-level and drops orphans", () => {
    expect(buildAlbumTree(rows).flatMap((t) => [t.id, ...t.children.map((c) => c.id)])).not.toContain(9)
  })
})

describe("sameParent", () => {
  it("is null-safe", () => {
    expect(sameParent({ parent_id: null }, { })).toBe(true)
    expect(sameParent({ parent_id: 1 }, { parent_id: 1 })).toBe(true)
    expect(sameParent({ parent_id: 1 }, { parent_id: null })).toBe(false)
  })
})

describe("findGalleryAlbum", () => {
  const gallery = [{ id: 1, items: [], subAlbums: [{ id: 5, items: [{ id: 50 }] }] }, { id: 2, items: [] }]
  it("finds top-level albums, sub-albums, and tolerates missing subAlbums", () => {
    expect(findGalleryAlbum(gallery, 2).id).toBe(2)
    expect(findGalleryAlbum(gallery, 5).items).toEqual([{ id: 50 }])
    expect(findGalleryAlbum(gallery, 99)).toBeUndefined()
  })
})
