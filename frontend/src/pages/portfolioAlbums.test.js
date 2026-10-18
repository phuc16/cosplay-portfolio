import { describe, it, expect } from "vitest"
import { buildAlbums, allPhotoThumbs } from "./portfolioAlbums"

const item = (id, src, fullSrc) => ({ id, src, fullSrc: fullSrc || src, width: 1, height: 1 })

describe("buildAlbums", () => {
  it("handles a legacy album without subAlbums", () => {
    const [a] = buildAlbums([{ id: 1, group: "Event", items: [item(1, "/t1", "/f1"), item(2, "/t2", "/f2")] }])
    expect(a).toMatchObject({ id: 1, title: "Event", count: 2, cover: "/t1", items: ["/f1", "/f2"], thumbs: ["/t1", "/t2"], subAlbums: [] })
  })

  it("counts sub-album photos in the album total and maps sub-albums", () => {
    const [a] = buildAlbums([{
      id: 2, group: "Cosplay", items: [item(1, "/d")],
      subAlbums: [
        { id: 21, title: "Nino", cover: "/n1", count: 2, items: [item(2, "/n1", "/n1f"), item(3, "/n2", "/n2f")] },
        { id: 22, title: "Empty", cover: null, count: 0, items: [] },
      ],
    }])
    expect(a.count).toBe(3)
    expect(a.subAlbums[0]).toMatchObject({ id: 21, title: "Nino", count: 2, cover: "/n1", items: ["/n1f", "/n2f"], thumbs: ["/n1", "/n2"] })
    expect(a.subAlbums[1]).toMatchObject({ count: 0, cover: "", items: [], thumbs: [] })
  })

  it("falls back to the first sub-album cover when the album has no direct photos", () => {
    const [a] = buildAlbums([{ id: 3, group: "Only subs", items: [], subAlbums: [{ id: 31, title: "S", cover: "/s", items: [item(1, "/s")] }] }])
    expect(a.cover).toBe("/s")
  })

  it("tolerates null/undefined gallery", () => {
    expect(buildAlbums(undefined)).toEqual([])
    expect(buildAlbums(null)).toEqual([])
  })
})

describe("allPhotoThumbs", () => {
  it("includes direct and sub-album photos", () => {
    expect(allPhotoThumbs([{ id: 1, group: "A", items: [item(1, "/a")], subAlbums: [{ id: 2, title: "S", items: [item(2, "/s")] }] }])).toEqual(["/a", "/s"])
  })
})
