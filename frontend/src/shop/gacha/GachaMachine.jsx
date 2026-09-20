import { useMemo, useRef, useState } from "react"
import { generateRequestKey } from "../requestKey"
import { cardWidthFor, spinProfile, stopFraction, spinProgress } from "./reelMechanics"

const TIER_COLOR = {
  common: "#E6E6E6",
  rare: "#3E8BFF",
  epic: "#A855F7",
  legendary: "#E4383A",
  ancient: "#E8B62C",
}

const CARD_GAP = 14
// Server-side outcomes that are settled: the turn is decided one way or the
// other, so the next tap is a NEW spin and must not replay this key.
const SETTLED_DRAW_ERRORS = new Set([
  "session_complete",
  "order_cancelled",
  "gacha_sold_out",
  "not_found",
  "invalid_input",
])
const IDLE_REEL_CELLS = 14
const TAIL_CELLS = 4

function randomPrize(prizes) {
  return prizes[Math.floor(Math.random() * prizes.length)]
}

// Fills the strip with arbitrary catalogue entries purely so something scrolls
// past; the single meaningful cell is `winner`, which the caller's drawFn
// already decided. Never used to pick an outcome.
function buildReel(prizes, winner, count) {
  const cells = []
  for (let i = 0; i < count; i++) {
    cells.push(winner && i === count - TAIL_CELLS ? winner : randomPrize(prizes))
  }
  return cells
}

/**
 * Shared reel/reveal UI for the buyer order page, the booth kiosk, and the
 * practice page. Never decides a draw's outcome itself - drawFn (owned by
 * the caller) is the one and only source of the winning prize; this
 * component's entire job is to animate toward whatever drawFn resolves
 * with. See the design's Anti-cheat section for why this split matters.
 *
 * drawFn is called as drawFn(drawKey) - this component owns the key's
 * lifecycle because it, not any caller, knows what counts as a retry of the
 * same spin.
 */
export default function GachaMachine({
  prizes,
  turnsTotal,
  turnsUsed: initialTurnsUsed,
  drawFn,
  onDrawResult,
  onSessionComplete,
}) {
  const [turnsUsed, setTurnsUsed] = useState(initialTurnsUsed)
  const [spinning, setSpinning] = useState(false)
  const [spunReel, setSpunReel] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const viewRef = useRef(null)
  const trackRef = useRef(null)
  const [cardWidth] = useState(() => cardWidthFor(typeof window !== "undefined" ? window.innerWidth : 900))

  // A ref, not the `spinning` state, is what actually guards drawFn: several
  // clicks can land inside a single React batch, so the re-render that
  // disables the button is not guaranteed to happen between them.
  const inFlight = useRef(false)

  // The draw key belongs to the SPIN, not to the attempt: a draw whose
  // response was lost on flaky venue wifi may well have committed
  // server-side, so the user's manual retry has to carry the same key for
  // drawForSession's last_draw_key replay to return the original prize
  // instead of burning a second real turn. Cleared only once the server has
  // actually answered - success, or a settled failure.
  const pendingDrawKey = useRef(null)

  // A draw response advances turnsUsed locally so the counter is right the
  // instant the reel lands, but a caller that refetches its own turn count
  // stays authoritative. React's documented "adjust state on prop change"
  // pattern rather than an effect, so no extra render pass is wasted.
  const [syncedTurnsUsed, setSyncedTurnsUsed] = useState(initialTurnsUsed)
  if (syncedTurnsUsed !== initialTurnsUsed) {
    setSyncedTurnsUsed(initialTurnsUsed)
    setTurnsUsed(initialTurnsUsed)
  }

  const idleReel = useMemo(() => buildReel(prizes, null, IDLE_REEL_CELLS), [prizes])
  const reel = spunReel || idleReel

  const turnsLeft = turnsTotal - turnsUsed
  const disabled = spinning || turnsLeft <= 0

  function runReel(response) {
    const winner = response.prize
    const profile = spinProfile()
    const winIndex = profile.tiles
    setSpunReel(buildReel(prizes, winner, winIndex + TAIL_CELLS))

    requestAnimationFrame(() => {
      const width = viewRef.current ? viewRef.current.clientWidth : 900
      const stepPx = cardWidth + CARD_GAP
      const end = width / 2 - cardWidth * stopFraction() - winIndex * stepPx
      let t0 = 0
      const step = (now) => {
        if (!t0) t0 = now
        const p = Math.min(1, (now - t0) / profile.durationMs)
        const x = end * spinProgress(p, profile.friction)
        if (trackRef.current) trackRef.current.style.transform = `translate3d(${x}px,0,0)`
        if (p < 1) {
          requestAnimationFrame(step)
          return
        }
        inFlight.current = false
        setSpinning(false)
        setResult(winner)
        setTurnsUsed(response.turns_used)
        if (onDrawResult) onDrawResult(response)
        if (response.session_completed && onSessionComplete) onSessionComplete()
      }
      requestAnimationFrame(step)
    })
  }

  async function handleSpin() {
    if (inFlight.current || turnsLeft <= 0) return
    inFlight.current = true
    setSpinning(true)
    setResult(null)
    setError(null)

    if (!pendingDrawKey.current) pendingDrawKey.current = generateRequestKey()

    let response
    try {
      response = await drawFn(pendingDrawKey.current)
    } catch (err) {
      if (SETTLED_DRAW_ERRORS.has(err?.response?.data?.error)) pendingDrawKey.current = null
      inFlight.current = false
      setSpinning(false)
      setError(err?.response?.data?.message || err?.message || "Không mở được hộp")
      return
    }

    pendingDrawKey.current = null
    runReel(response)
  }

  return (
    <div className="gacha-machine">
      <div ref={viewRef} style={{ position: "relative", height: 180, overflow: "hidden" }}>
        <div
          ref={trackRef}
          style={{ position: "absolute", top: 0, left: 0, height: "100%", willChange: "transform" }}
        >
          {reel.map((cell, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                top: 0,
                height: 180,
                width: cardWidth,
                left: i * (cardWidth + CARD_GAP),
              }}
            >
              <div style={{ borderBottom: `7px solid ${TIER_COLOR[cell.tier] || TIER_COLOR.common}` }}>
                {cell.image_url && <img src={cell.image_url} alt="" style={{ maxWidth: "100%" }} />}
                {cell.name}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stable id so a host page (the booth kiosk) can trigger a spin from
          a physical USB button wired as a keyboard emulator, without this
          component needing to expose an imperative API. */}
      <button id="gacha-machine-spin-button" type="button" onClick={handleSpin} disabled={disabled}>
        {spinning ? "Đang mở…" : turnsLeft <= 0 ? "Hết lượt" : "Mở hộp"}
      </button>

      <div>
        Lượt: {turnsUsed}/{turnsTotal}
      </div>

      {error && <div role="alert">{error}</div>}

      {result && (
        <div role="dialog" aria-label="Kết quả">
          <div style={{ color: TIER_COLOR[result.tier] || TIER_COLOR.common }}>{result.tier}</div>
          <div>{result.name}</div>
          <div>{result.display_price}đ</div>
        </div>
      )}
    </div>
  )
}
