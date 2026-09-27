import { describe, it, expect } from "vitest"

const { buildAlbumSlides } = await import("./albumSlides")

describe("buildAlbumSlides", () => {
  it("passes plain, unpaired items through as bare src strings", () => {
    const slides = buildAlbumSlides([
      { id: 1, src: "https://x/a-thumb.jpg", fullSrc: "https://x/a.jpg" },
      { id: 2, src: "https://x/b-thumb.jpg", fullSrc: "https://x/b.jpg" },
    ])
    expect(slides).toEqual(["https://x/a.jpg", "https://x/b.jpg"])
  })

  it("collapses a before/after pair into a single { src, pairedSrc } slide", () => {
    const slides = buildAlbumSlides([
      { id: 1, src: "https://x/before.jpg", fullSrc: "https://x/before.jpg", pairRole: "before", pairImageId: 2 },
      { id: 2, src: "https://x/after.jpg", fullSrc: "https://x/after.jpg", pairRole: "after", pairImageId: 1 },
    ])
    expect(slides).toEqual([{ src: "https://x/before.jpg", pairedSrc: "https://x/after.jpg" }])
  })

  it("is order-independent - the pair collapses to one slide even when the 'after' image sorts before the 'before' image", () => {
    const slides = buildAlbumSlides([
      { id: 2, src: "https://x/after.jpg", fullSrc: "https://x/after.jpg", pairRole: "after", pairImageId: 1 },
      { id: 1, src: "https://x/before.jpg", fullSrc: "https://x/before.jpg", pairRole: "before", pairImageId: 2 },
    ])
    expect(slides).toEqual([{ src: "https://x/before.jpg", pairedSrc: "https://x/after.jpg" }])
  })

  it("keeps a pair alongside ordinary photos in the same album, in list order", () => {
    const slides = buildAlbumSlides([
      { id: 1, src: "https://x/plain1.jpg", fullSrc: "https://x/plain1.jpg" },
      { id: 2, src: "https://x/before.jpg", fullSrc: "https://x/before.jpg", pairRole: "before", pairImageId: 3 },
      { id: 3, src: "https://x/after.jpg", fullSrc: "https://x/after.jpg", pairRole: "after", pairImageId: 2 },
      { id: 4, src: "https://x/plain2.jpg", fullSrc: "https://x/plain2.jpg" },
    ])
    expect(slides).toEqual([
      "https://x/plain1.jpg",
      { src: "https://x/before.jpg", pairedSrc: "https://x/after.jpg" },
      "https://x/plain2.jpg",
    ])
  })

  it("falls back to a plain slide when the paired image id no longer resolves (deleted partner)", () => {
    const slides = buildAlbumSlides([
      { id: 1, src: "https://x/before.jpg", fullSrc: "https://x/before.jpg", pairRole: "before", pairImageId: 999 },
    ])
    expect(slides).toEqual(["https://x/before.jpg"])
  })

  it("returns an empty array for an empty/missing item list", () => {
    expect(buildAlbumSlides([])).toEqual([])
    expect(buildAlbumSlides(undefined)).toEqual([])
  })
})
