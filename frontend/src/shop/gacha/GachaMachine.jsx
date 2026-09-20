import { useEffect, useMemo, useRef, useState } from "react"
import { generateRequestKey } from "../requestKey"
import { cardWidthFor, spinProfile, stopFraction, spinProgress } from "./reelMechanics"
import { formatVnd } from "../../utils/money"
import { TIER_ORDER, formatRate, tierColor, tierLabel, tierOdds } from "./tiers"
import { gachaAudio, useGachaSound } from "./gachaAudio"

const CARD_GAP = 14
const CARD_HEIGHT = 180
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
  // The booth kiosk carries the toggle in its own header bar, where the
  // mockup puts it; the order and practice pages have no such chrome, so the
  // machine renders its own.
  showSoundToggle = true,
}) {
  const [turnsUsed, setTurnsUsed] = useState(initialTurnsUsed)
  const [spinning, setSpinning] = useState(false)
  const [spunReel, setSpunReel] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [flash, setFlash] = useState(false)
  const [peek, setPeek] = useState(null)
  const [soundOn, toggleSound] = useGachaSound()
  const flashTimer = useRef(null)
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

  // Which reel card last crossed the centre indicator. Ported from the
  // mockup's lastTickIndex: one tick per card boundary is what makes the
  // scroll read as a continuous ratchet instead of a fixed-rate beep.
  const lastTickIndex = useRef(null)

  useEffect(() => {
    gachaAudio.preload()
    return () => clearTimeout(flashTimer.current)
  }, [])

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

  const odds = useMemo(() => tierOdds(prizes), [prizes])
  const legend = useMemo(
    () => TIER_ORDER.filter((tier) => prizes.some((p) => p.tier === tier)),
    [prizes],
  )
  const resultColor = result ? tierColor(result.tier) : tierColor("common")
  const resultStock = result
    ? prizes.find((p) => p.id === result.id)?.quantity_remaining ?? result.quantity_remaining
    : null

  function runReel(response) {
    const winner = response.prize
    const profile = spinProfile()
    const winIndex = profile.tiles
    setSpunReel(buildReel(prizes, winner, winIndex + TAIL_CELLS))
    lastTickIndex.current = null
    gachaAudio.crateOpen()

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
        const idx = Math.floor((x - width / 2) / stepPx)
        if (lastTickIndex.current == null) lastTickIndex.current = idx
        else if (idx !== lastTickIndex.current) {
          lastTickIndex.current = idx
          gachaAudio.tick()
        }
        if (p < 1) {
          requestAnimationFrame(step)
          return
        }
        inFlight.current = false
        gachaAudio.chime(winner.tier)
        setSpinning(false)
        setResult(winner)
        setFlash(true)
        flashTimer.current = setTimeout(() => setFlash(false), 600)
        setTurnsUsed(response.turns_used)
        if (onDrawResult) onDrawResult(response)
        if (response.session_completed && onSessionComplete) onSessionComplete()
      }
      requestAnimationFrame(step)
    })
  }

  async function handleSpin() {
    if (inFlight.current || turnsLeft <= 0) return
    gachaAudio.click()
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

  function handleContinue() {
    gachaAudio.click()
    if (trackRef.current) trackRef.current.style.transform = "translate3d(0,0,0)"
    setSpunReel(null)
    setResult(null)
  }

  function openPeek(prize) {
    gachaAudio.click()
    setPeek(prize)
  }

  return (
    <div
      className="gacha-machine"
      style={{
        position: "relative",
        borderRadius: 16,
        overflow: "hidden",
        background:
          "radial-gradient(90% 70% at 50% -10%, #2A1147 0%, #130B21 55%, #0E0818 100%)",
        color: "#F2ECFA",
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,.03) 0 1px, transparent 1px 3px)",
          pointerEvents: "none",
        }}
      />

      <section
        style={{
          position: "relative",
          padding: "clamp(14px, 3vw, 20px) clamp(12px, 3vw, 22px) 22px",
          display: "flex",
          flexDirection: "column",
          gap: "clamp(12px, 2vw, 18px)",
          minWidth: 0,
        }}
      >
        <div style={{ position: "relative", textAlign: "center" }}>
          <div
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 11,
              letterSpacing: ".3em",
              color: "#FF2E88",
              textTransform: "uppercase",
            }}
          >
            {spinning
              ? "Đang quay…"
              : turnsLeft <= 0
                ? "Hết lượt"
                : `Chạm để mở · còn ${turnsLeft} lượt`}
          </div>
          <div
            style={{
              fontFamily: "'Bungee', cursive",
              fontSize: "clamp(22px, 5vw, 32px)",
              marginTop: 8,
              textTransform: "uppercase",
            }}
          >
            Mở hộp quà
          </div>
          {showSoundToggle && (
            <button
              type="button"
              className="gacha-ghost"
              onClick={toggleSound}
              aria-pressed={soundOn}
              aria-label={soundOn ? "Tắt âm thanh" : "Bật âm thanh"}
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                cursor: "pointer",
                background: "transparent",
                border: "1px solid rgba(242,236,250,.25)",
                color: "#C9B8E4",
                fontFamily: "'Space Mono', monospace",
                fontSize: 10,
                letterSpacing: ".18em",
                padding: "9px 13px",
                borderRadius: 8,
              }}
            >
              {soundOn ? "🔊" : "🔇"}
            </button>
          )}
        </div>

        <div
          style={{
            position: "relative",
            border: "1px solid rgba(255,46,136,.3)",
            background: "rgba(9,5,16,.75)",
            borderRadius: 14,
            overflow: "hidden",
            padding: "18px 0",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              bottom: 0,
              width: 3,
              marginLeft: -1.5,
              background:
                "linear-gradient(to bottom, transparent, #FF2E88 18%, #FF2E88 82%, transparent)",
              boxShadow: "0 0 20px 3px rgba(255,46,136,.7)",
              zIndex: 3,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 100,
              background: "linear-gradient(to right, #0B0614, transparent)",
              zIndex: 2,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: 100,
              background: "linear-gradient(to left, #0B0614, transparent)",
              zIndex: 2,
              pointerEvents: "none",
            }}
          />
          <div
            ref={viewRef}
            style={{ position: "relative", height: CARD_HEIGHT, overflow: "hidden", contain: "layout paint" }}
          >
            <div
              ref={trackRef}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                height: "100%",
                width: "100%",
                willChange: "transform",
                transform: "translate3d(0,0,0)",
                backfaceVisibility: "hidden",
                pointerEvents: "none",
              }}
            >
              {reel.map((cell, i) => (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    top: 0,
                    height: CARD_HEIGHT,
                    width: cardWidth,
                    left: i * (cardWidth + CARD_GAP),
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      boxSizing: "border-box",
                      height: "100%",
                      borderBottom: `7px solid ${tierColor(cell.tier)}`,
                      background:
                        "linear-gradient(0deg, rgba(0,0,0,.55), rgba(255,255,255,.05)), #16101F",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        backgroundImage: cell.image_url ? `url('${cell.image_url}')` : "none",
                        backgroundSize: "cover",
                        backgroundPosition: "center 20%",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: 12,
                        left: 13,
                        padding: "4px 9px",
                        whiteSpace: "nowrap",
                        border: `1px solid ${tierColor(cell.tier)}`,
                        background: "rgba(9,5,16,.72)",
                        fontFamily: "'Space Mono', monospace",
                        fontSize: 10,
                        letterSpacing: ".13em",
                        color: tierColor(cell.tier),
                      }}
                    >
                      {tierLabel(cell.tier)}
                    </div>
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        minHeight: 38,
                        display: "flex",
                        alignItems: "flex-end",
                        padding: "8px 12px",
                        background: "linear-gradient(transparent, rgba(9,5,16,.88) 42%)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 600,
                          textShadow: "0 1px 3px #000",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {cell.name}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          {/* Stable id so a host page (the booth kiosk) can trigger a spin from
              a physical USB button wired as a keyboard emulator, without this
              component needing to expose an imperative API. */}
          <button
            id="gacha-machine-spin-button"
            type="button"
            className="gacha-bright"
            onClick={handleSpin}
            disabled={disabled}
            style={{
              width: "100%",
              maxWidth: 460,
              minHeight: 78,
              border: "none",
              borderRadius: 14,
              fontFamily: "'Bungee', cursive",
              fontSize: 24,
              letterSpacing: ".05em",
              textTransform: "uppercase",
              transition: "filter .15s ease, transform .1s ease",
              ...(disabled
                ? { cursor: "not-allowed", background: "#2A1B3D", color: "#6B5A85" }
                : {
                    cursor: "pointer",
                    background: "linear-gradient(135deg, #FF2E88, #FF7A3D)",
                    color: "#150A1F",
                    boxShadow: "0 10px 40px -12px rgba(255,46,136,.9)",
                  }),
            }}
          >
            {spinning ? "Đang mở…" : turnsLeft <= 0 ? "Hết lượt" : "Mở hộp"}
          </button>
          <div
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 10,
              letterSpacing: ".2em",
              color: "#7C6B96",
              textAlign: "center",
              textTransform: "uppercase",
            }}
          >
            Lượt: {turnsUsed}/{turnsTotal} · mỗi lượt 1 món
          </div>
          {error && (
            <div role="alert" style={{ color: "#FF6B8A", fontSize: 14, textAlign: "center" }}>
              {error}
            </div>
          )}
        </div>
      </section>

      <aside
        style={{
          position: "relative",
          borderTop: "1px solid rgba(255,46,136,.22)",
          background: "rgba(8,5,14,.65)",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <div style={{ padding: "14px 20px 10px", borderBottom: "1px solid rgba(242,236,250,.08)" }}>
          <div
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 10,
              letterSpacing: ".3em",
              color: "#9A86B8",
              textTransform: "uppercase",
            }}
          >
            Quà trong hộp
          </div>
          <div
            style={{
              fontFamily: "'Bungee', cursive",
              fontSize: 20,
              marginTop: 6,
              textTransform: "uppercase",
            }}
          >
            {prizes.length} món
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px 14px",
              marginTop: 12,
              fontFamily: "'Space Mono', monospace",
              fontSize: 10,
              letterSpacing: ".1em",
              color: "#9A86B8",
            }}
          >
            {legend.map((tier) => (
              <span
                key={tier}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
              >
                <i
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 2,
                    background: tierColor(tier),
                    display: "inline-block",
                  }}
                />
                {tierLabel(tier)} {formatRate(odds[tier])}
              </span>
            ))}
          </div>
        </div>
        <div
          className="gacha-scroll"
          style={{
            maxHeight: "clamp(280px, 46vh, 460px)",
            overflowY: "auto",
            overflowX: "hidden",
            padding: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(212px, 1fr))",
            gridAutoRows: "max-content",
            gap: 12,
            alignContent: "start",
          }}
        >
          {prizes.map((prize) => (
            <button
              key={prize.id}
              type="button"
              className="gacha-item"
              onClick={() => openPeek(prize)}
              style={{
                textAlign: "left",
                cursor: "pointer",
                padding: 0,
                borderTop: `3px solid ${tierColor(prize.tier)}`,
                borderRight: "1px solid rgba(242,236,250,.1)",
                borderBottom: "1px solid rgba(242,236,250,.1)",
                borderLeft: "1px solid rgba(242,236,250,.1)",
                overflow: "hidden",
                background: "#16101F",
                color: "#F2ECFA",
                display: "flex",
                flexDirection: "column",
                transition: "transform .15s ease",
              }}
            >
              <div
                style={{
                  aspectRatio: "1.15",
                  width: "100%",
                  backgroundColor: "#0E0A16",
                  backgroundImage: prize.image_url ? `url('${prize.image_url}')` : "none",
                  backgroundSize: "contain",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                }}
              />
              <div
                style={{
                  padding: "14px 15px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  width: "100%",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, minHeight: 38 }}>
                  {prize.name}
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#FFF" }}>
                    {formatVnd(prize.display_price)}
                  </span>
                  <span
                    style={{
                      flex: "none",
                      whiteSpace: "nowrap",
                      fontFamily: "'Space Mono', monospace",
                      fontSize: 10,
                      letterSpacing: ".12em",
                      color: tierColor(prize.tier),
                    }}
                  >
                    {tierLabel(prize.tier)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {flash && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 70,
            background: resultColor,
            animation: "b-flash .5s ease-out both",
          }}
        />
      )}

      {result && (
        <div
          role="dialog"
          aria-label="Kết quả"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(6,3,12,.93)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            style={{
              position: "absolute",
              width: 900,
              height: 900,
              borderRadius: "50%",
              background: `conic-gradient(from 0deg, transparent 0 10deg, ${resultColor} 10deg 14deg, transparent 14deg 60deg, ${resultColor} 60deg 64deg, transparent 64deg 120deg, ${resultColor} 120deg 124deg, transparent 124deg 180deg, ${resultColor} 180deg 184deg, transparent 184deg 240deg, ${resultColor} 240deg 244deg, transparent 244deg 300deg, ${resultColor} 300deg 304deg, transparent 304deg)`,
              opacity: 0.16,
              animation: "b-rays 22s linear infinite",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 860,
              animation: "b-card .55s cubic-bezier(.2,.8,.25,1) both",
            }}
          >
            <div
              style={{
                border: `2px solid ${resultColor}`,
                borderRadius: 18,
                overflow: "hidden",
                background: "#100A1C",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              }}
            >
              <div
                style={{
                  position: "relative",
                  minHeight: "clamp(200px, 32vh, 380px)",
                  backgroundImage: result.image_url ? `url('${result.image_url}')` : "none",
                  backgroundSize: "cover",
                  backgroundPosition: "center 15%",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "linear-gradient(90deg, transparent 55%, #100A1C 100%)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    width: "30%",
                    background:
                      "linear-gradient(90deg, transparent, rgba(255,255,255,.22), transparent)",
                    animation: "b-sweep 1.2s ease-out .3s both",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 16,
                    top: 16,
                    padding: "7px 12px",
                    borderRadius: 7,
                    background: resultColor,
                    color: "#0E0818",
                    fontFamily: "'Space Mono', monospace",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".2em",
                  }}
                >
                  {tierLabel(result.tier)}
                </div>
              </div>
              <div
                style={{
                  padding: "clamp(18px, 3vw, 30px) clamp(16px, 3vw, 28px)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "clamp(10px, 2vw, 16px)",
                }}
              >
                <div
                  style={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: 11,
                    letterSpacing: ".3em",
                    color: "#9A86B8",
                    textTransform: "uppercase",
                    animation: "b-rise .35s ease .15s both",
                  }}
                >
                  Bạn nhận được
                </div>
                <div
                  style={{
                    fontFamily: "'Bungee', cursive",
                    fontSize: "clamp(22px, 4vw, 34px)",
                    lineHeight: 1.05,
                    animation: "b-rise .35s ease .25s both",
                  }}
                >
                  {result.name}
                </div>
                {result.description && (
                  <div
                    style={{
                      fontSize: 15,
                      lineHeight: 1.55,
                      color: "#C9B8E4",
                      animation: "b-rise .35s ease .34s both",
                    }}
                  >
                    {result.description}
                  </div>
                )}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
                    gap: 10,
                    animation: "b-rise .35s ease .42s both",
                  }}
                >
                  <Stat label="Tỷ lệ" value={formatRate(odds[result.tier])} color={resultColor} />
                  <Stat label="Giá trị" value={formatVnd(result.display_price)} />
                  <Stat
                    label="Còn lại"
                    value={resultStock == null ? "—" : `×${resultStock}`}
                  />
                </div>
                <button
                  type="button"
                  className="gacha-bright"
                  onClick={handleContinue}
                  style={{
                    marginTop: "auto",
                    minHeight: 66,
                    border: "none",
                    borderRadius: 12,
                    cursor: "pointer",
                    background: resultColor,
                    color: "#0E0818",
                    fontFamily: "'Bungee', cursive",
                    fontSize: 19,
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                  }}
                >
                  {turnsLeft <= 0 ? "Xong" : `Lượt tiếp (còn ${turnsLeft})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {peek && (
        <div
          role="dialog"
          aria-label="Chi tiết phần thưởng"
          onClick={() => setPeek(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 52,
            background: "rgba(6,3,12,.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 26,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              border: `2px solid ${tierColor(peek.tier)}`,
              borderRadius: 16,
              overflow: "hidden",
              background: "#100A1C",
              animation: "b-card .4s cubic-bezier(.2,.8,.25,1) both",
            }}
          >
            <div
              style={{
                height: 260,
                backgroundImage: peek.image_url ? `url('${peek.image_url}')` : "none",
                backgroundSize: "cover",
                backgroundPosition: "center 15%",
                backgroundColor: "#0E0A16",
              }}
            />
            <div style={{ padding: "22px 24px" }}>
              <div
                style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 10,
                  letterSpacing: ".2em",
                  color: tierColor(peek.tier),
                }}
              >
                {tierLabel(peek.tier)} · {formatRate(odds[peek.tier])}
              </div>
              <div style={{ fontFamily: "'Bungee', cursive", fontSize: 24, marginTop: 10 }}>
                {peek.name}
              </div>
              {peek.description && (
                <div
                  style={{ fontSize: 14, color: "#C9B8E4", lineHeight: 1.55, marginTop: 10 }}
                >
                  {peek.description}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  gap: 22,
                  marginTop: 16,
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 12,
                  color: "#9A86B8",
                  textTransform: "uppercase",
                }}
              >
                <span>Giá trị {formatVnd(peek.display_price)}</span>
                <span>Kho ×{peek.quantity_remaining ?? 0}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ border: "1px solid rgba(242,236,250,.14)", borderRadius: 10, padding: "11px 12px" }}>
      <div
        style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: 9,
          letterSpacing: ".18em",
          color: "#7C6B96",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: color || undefined }}>
        {value}
      </div>
    </div>
  )
}
