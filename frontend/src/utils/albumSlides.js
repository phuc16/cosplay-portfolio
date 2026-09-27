/**
 * Turns an album's flat item list into lightbox slides, collapsing a
 * before/after pair (admin-set via PUT /api/images/:id/pair) into a single
 * combined slide instead of two separate photos - the "after" half is
 * folded into its "before" partner's slide and never emitted on its own.
 * Order-independent: a "before" is only rendered as a pair once its partner
 * has actually been located, so it doesn't matter which side sort_order
 * puts first. A pairImageId that no longer resolves to a live sibling
 * (deleted, or moved to a different album) falls back to a plain slide -
 * never a broken/blank one.
 */
export function buildAlbumSlides(items) {
  const byId = new Map((items || []).map((it) => [it.id, it]))
  const consumed = new Set()
  for (const it of items || []) {
    if (it.pairRole === "before" && it.pairImageId && byId.has(it.pairImageId)) {
      consumed.add(it.pairImageId)
    }
  }
  const slides = []
  for (const it of items || []) {
    if (consumed.has(it.id)) continue
    const src = it.fullSrc || it.src
    if (it.pairRole === "before" && it.pairImageId && byId.has(it.pairImageId)) {
      const partner = byId.get(it.pairImageId)
      slides.push({ src, pairedSrc: partner.fullSrc || partner.src })
    } else {
      slides.push(src)
    }
  }
  return slides
}

/** A slide is either a plain URL string, or `{ src, pairedSrc }` for a
 * before/after pair collapsed by buildAlbumSlides above. */
export const slideSrc = (slide) => (typeof slide === "string" ? slide : slide.src)
export const slidePairedSrc = (slide) => (typeof slide === "string" ? null : slide.pairedSrc)
