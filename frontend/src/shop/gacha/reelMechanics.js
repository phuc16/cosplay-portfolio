// Timing/geometry ported verbatim from the exported mockup
// (Concept B - Case Reel.dc.html's cardFor/spinProfile/stopFraction/spinProgress) -
// purely cosmetic reel animation, has no bearing on the actual draw result
// (which is decided server-side before the reel even starts spinning; see
// GachaMachine.jsx).
export function cardWidthFor(viewportWidth) {
  return viewportWidth < 640 ? 150 : 240
}

export function spinProfile() {
  return {
    durationMs: 7500 + Math.floor(Math.random() * 2001),
    tiles: 30 + Math.floor(Math.random() * 11),
    friction: 2.7 + Math.random() * 0.6,
  }
}

export function stopFraction() {
  return (Math.floor(Math.random() * 81) + 10) / 100
}

export function spinProgress(p, friction) {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, p)), friction)
}
