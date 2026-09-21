import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { adminStartBoothSession, adminDrawSession, adminFetchPrizes } from "../api/shop"
import { hasAdminSession } from "../utils/orderAuth"
import GachaMachine from "../shop/gacha/GachaMachine"
import { useGachaSound } from "../shop/gacha/gachaAudio"

const DEFAULT_TURNS = 5
const TURN_PRESETS = [5, 10, 20, 50]
const MAX_TURNS = 200

const MONO = "'Space Mono', monospace"
const DISPLAY = "'Bungee', cursive"

const ghostButton = {
  cursor: "pointer",
  background: "transparent",
  border: "1px solid rgba(242,236,250,.25)",
  color: "#C9B8E4",
  fontFamily: MONO,
  fontSize: 10,
  letterSpacing: ".18em",
  padding: "9px 13px",
  borderRadius: 8,
}

/**
 * Staff logs into /admin once at the start of the festival day; this page
 * reuses that same admin session for the whole kiosk flow (no separate
 * scoped device token - see the design's Anti-cheat section for why that
 * tradeoff was made deliberately). The buyer only ever touches the "Start
 * session" screen and the machine below it, never anything else in /admin.
 */
export default function GachaKiosk() {
  const { productId } = useParams()
  const numericProductId = Number(productId)
  const navigate = useNavigate()
  const authorized = hasAdminSession()

  const [buyerName, setBuyerName] = useState("")
  const [turnsTotal, setTurnsTotal] = useState(DEFAULT_TURNS)
  const [prizes, setPrizes] = useState([])
  const [loadingPrizes, setLoadingPrizes] = useState(true)
  const [prizesFailed, setPrizesFailed] = useState(false)
  const [session, setSession] = useState(null)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)
  const [soundOn, toggleSound] = useGachaSound()

  useEffect(() => {
    if (!authorized) navigate("/admin")
  }, [authorized, navigate])

  // A failed fetch and a product with zero prizes both used to collapse into
  // an empty array, leaving staff with an inert disabled button. Track the
  // fetch lifecycle explicitly so each case gets its own message, and so a
  // flaky-wifi failure is recoverable without reloading the kiosk.
  const loadPrizes = useCallback(() => {
    if (!authorized || !numericProductId) return
    setLoadingPrizes(true)
    setPrizesFailed(false)
    setError(null)
    // The admin (ungated) prize read, not the public practice one: a booth
    // product is routinely sold before its online collection is published,
    // and this page already requires an admin session anyway.
    adminFetchPrizes(numericProductId)
      .then((data) => {
        setPrizes(Array.isArray(data) ? data : [])
        setLoadingPrizes(false)
      })
      .catch((err) => {
        setPrizes([])
        setPrizesFailed(true)
        setLoadingPrizes(false)
        setError(
          err?.response?.data?.message ||
            "Không tải được danh sách phần thưởng. Kiểm tra kết nối rồi thử lại."
        )
      })
  }, [authorized, numericProductId])

  useEffect(() => {
    loadPrizes()
  }, [loadPrizes])

  // A physical USB "smash button" at the booth is just a keyboard emulator
  // wired to send Space - this is the entire integration surface for it.
  // GachaMachine owns the real click handler (and its own disabled/in-flight
  // guards), so this only ever forwards a synthetic click to the same button
  // a buyer's finger would press; it can never trigger a draw on its own.
  useEffect(() => {
    if (!session) return
    function onKeyDown(e) {
      if (e.code !== "Space" && e.key !== " ") return
      const target = e.target
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return
      e.preventDefault()
      document.getElementById("gacha-machine-spin-button")?.click()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [session])

  if (!authorized) return null

  async function handleStart() {
    setStarting(true)
    setError(null)
    try {
      const result = await adminStartBoothSession(numericProductId, { buyerName, turnsTotal })
      setSessionComplete(false)
      setSession({ id: result.session_id, turnsTotal, turnsUsed: 0 })
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Không bắt đầu được phiên")
    } finally {
      setStarting(false)
    }
  }

  function handleNextBuyer() {
    setSession(null)
    setSessionComplete(false)
    setBuyerName("")
    setTurnsTotal(DEFAULT_TURNS)
  }

  const turnsLeft = session ? session.turnsTotal - session.turnsUsed : 0

  // The tablet is in the BUYER's hands for the whole session, and this button
  // sits in the persistent header right next to the sound toggle, so a stray
  // tap would silently bin turns the buyer already paid for. The deliberate
  // "Khách tiếp theo" button at the bottom of the reel is staff-driven and
  // stays unguarded.
  function handleHeaderStaffExit() {
    if (turnsLeft > 0 && !confirm("Khách vẫn còn lượt quay. Chắc chắn muốn quay lại bảng nhân viên?")) return
    handleNextBuyer()
  }

  const header = (
    <header
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px 18px",
        flexWrap: "wrap",
        padding: "12px clamp(14px, 3vw, 24px)",
        borderBottom: "1px solid rgba(255,46,136,.25)",
        background: "rgba(14,8,24,.72)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "linear-gradient(135deg, #FF2E88, #21E6FF)",
            display: "grid",
            placeItems: "center",
            fontFamily: DISPLAY,
            fontSize: 18,
            color: "#120A1F",
          }}
        >
          G
        </div>
        <div>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: "clamp(15px, 2.4vw, 19px)",
              letterSpacing: ".03em",
              lineHeight: 1,
              textTransform: "uppercase",
            }}
          >
            Hộp quà cosplay
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: ".2em",
              color: "#9A86B8",
              marginTop: 5,
              textTransform: "uppercase",
            }}
          >
            Gacha tại gian hàng
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px 16px",
          lineHeight: 1,
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: ".16em",
          color: "#9A86B8",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", height: 32, gap: 8, whiteSpace: "nowrap" }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#21E6FF",
              animation: "b-blink 1.6s steps(1,end) infinite",
            }}
          />
          TRỰC TIẾP
        </div>
        <div style={{ display: "flex", alignItems: "center", height: 32, gap: 6, whiteSpace: "nowrap" }}>
          <span>LƯỢT CÒN</span>
          <span style={{ color: "#FFF", fontSize: 17, fontWeight: 700, lineHeight: 1 }}>
            {String(turnsLeft).padStart(2, "0")}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: 32,
            gap: 6,
            whiteSpace: "nowrap",
            maxWidth: 220,
            overflow: "hidden",
          }}
        >
          <span>TÊN KHÁCH</span>
          <span
            style={{ color: "#FFF", fontSize: 15, lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {buyerName.trim() || "CHƯA ĐẶT"}
          </span>
        </div>
        <button
          type="button"
          className="gacha-ghost"
          onClick={toggleSound}
          aria-pressed={soundOn}
          aria-label={soundOn ? "Tắt âm thanh" : "Bật âm thanh"}
          style={ghostButton}
        >
          {soundOn ? "BẬT NHẠC" : "TẮT NHẠC"}
        </button>
        {session && (
          <button
            type="button"
            className="gacha-ghost-pink"
            onClick={handleHeaderStaffExit}
            style={ghostButton}
          >
            NHÂN VIÊN
          </button>
        )}
      </div>
    </header>
  )

  return (
    <main
      className="gacha-machine"
      style={{
        minHeight: "100vh",
        background: "radial-gradient(90% 70% at 50% -10%, #2A1147 0%, #130B21 55%, #0E0818 100%)",
        color: "#F2ECFA",
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      {header}

      {!session ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 26 }}>
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              border: "1px solid rgba(33,230,255,.45)",
              borderRadius: 18,
              background: "#0D0A16",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(242,236,250,.1)" }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: ".3em", color: "#21E6FF" }}>
                BẢNG NHÂN VIÊN
              </div>
              <h1
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 24,
                  marginTop: 8,
                  textTransform: "uppercase",
                }}
              >
                Nhập số lượt quay
              </h1>
              <div style={{ fontSize: 14, color: "#9A86B8", marginTop: 8 }}>
                Nhập số lượt quay khách đã thanh toán. Máy sẽ khoá sau lượt cuối.
              </div>
            </div>

            <div style={{ padding: 24 }}>
              <label
                htmlFor="kiosk-buyer-name"
                style={{
                  display: "block",
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: ".2em",
                  color: "#9A86B8",
                  marginBottom: 8,
                }}
              >
                TÊN KHÁCH (TÙY CHỌN)
              </label>
              <input
                id="kiosk-buyer-name"
                type="text"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder="vd: Phúc"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  minHeight: 54,
                  padding: "0 16px",
                  borderRadius: 12,
                  border: "1px solid rgba(242,236,250,.25)",
                  background: "#150E22",
                  color: "#F2ECFA",
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 16,
                  marginBottom: 20,
                }}
              />

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexWrap: "wrap",
                  gap: "12px 16px",
                }}
              >
                <button
                  type="button"
                  className="gacha-ghost"
                  onClick={() => setTurnsTotal((n) => Math.max(1, n - 1))}
                  aria-label="Giảm lượt"
                  style={{
                    width: 62,
                    height: 62,
                    borderRadius: 14,
                    cursor: "pointer",
                    background: "transparent",
                    border: "1px solid rgba(242,236,250,.25)",
                    color: "#F2ECFA",
                    fontSize: 30,
                    lineHeight: 1,
                  }}
                >
                  −
                </button>
                <input
                  id="kiosk-turns"
                  type="number"
                  min={1}
                  aria-label="Số lượt"
                  value={turnsTotal}
                  onChange={(e) =>
                    setTurnsTotal(Math.max(1, Math.floor(Number(e.target.value)) || 1))
                  }
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: "clamp(44px, 9vw, 72px)",
                    width: 160,
                    textAlign: "center",
                    color: "#21E6FF",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  className="gacha-ghost"
                  onClick={() => setTurnsTotal((n) => Math.min(MAX_TURNS, n + 1))}
                  aria-label="Tăng lượt"
                  style={{
                    width: 62,
                    height: 62,
                    borderRadius: 14,
                    cursor: "pointer",
                    background: "transparent",
                    border: "1px solid rgba(242,236,250,.25)",
                    color: "#F2ECFA",
                    fontSize: 30,
                    lineHeight: 1,
                  }}
                >
                  +
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))",
                  gap: 10,
                  marginTop: 22,
                }}
              >
                {TURN_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="gacha-ghost"
                    onClick={() => setTurnsTotal((t) => Math.min(MAX_TURNS, t + n))}
                    style={{
                      minHeight: 56,
                      borderRadius: 12,
                      cursor: "pointer",
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: 17,
                      fontWeight: 600,
                      background: "transparent",
                      color: "#C9B8E4",
                      border: "1px solid rgba(242,236,250,.2)",
                    }}
                  >
                    +{n}
                  </button>
                ))}
              </div>

              {error && (
                <div role="alert" style={{ marginTop: 18, fontSize: 14, color: "#FF6B8A" }}>
                  {error}
                  {prizesFailed && (
                    <button
                      type="button"
                      onClick={loadPrizes}
                      style={{
                        marginLeft: 8,
                        textDecoration: "underline",
                        fontWeight: 600,
                        background: "transparent",
                        border: "none",
                        color: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      Thử lại
                    </button>
                  )}
                </div>
              )}

              {!loadingPrizes && !prizesFailed && prizes.length === 0 && (
                <div role="status" style={{ marginTop: 18, fontSize: 14, color: "#E8B62C" }}>
                  Sản phẩm này chưa được cấu hình phần thưởng nào. Thêm phần thưởng trong trang quản trị trước khi mở phiên.
                </div>
              )}

              <button
                type="button"
                className="gacha-bright"
                onClick={handleStart}
                disabled={starting || loadingPrizes || prizes.length === 0}
                style={{
                  width: "100%",
                  minHeight: 72,
                  marginTop: 20,
                  border: "none",
                  borderRadius: 14,
                  cursor: starting || loadingPrizes || prizes.length === 0 ? "not-allowed" : "pointer",
                  background:
                    starting || loadingPrizes || prizes.length === 0
                      ? "#2A1B3D"
                      : "linear-gradient(135deg, #FF2E88, #21E6FF)",
                  color: starting || loadingPrizes || prizes.length === 0 ? "#6B5A85" : "#0E0818",
                  fontFamily: DISPLAY,
                  fontSize: 22,
                  letterSpacing: ".04em",
                  textTransform: "uppercase",
                }}
              >
                {starting ? "Đang bắt đầu…" : loadingPrizes ? "Đang tải phần thưởng…" : "Bắt đầu phiên"}
              </button>

              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: ".16em",
                  color: "#7C6B96",
                  textAlign: "center",
                  marginTop: 14,
                }}
              >
                ĐƯA MÁY TÍNH BẢNG CHO KHÁCH SAU KHI BẮT ĐẦU
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(12px, 3vw, 24px)" }}>
          <GachaMachine
            key={session.id}
            prizes={prizes}
            turnsTotal={session.turnsTotal}
            turnsUsed={session.turnsUsed}
            drawFn={(drawKey) => adminDrawSession(session.id, drawKey)}
            onDrawResult={(response) => setSession((s) => (s ? { ...s, turnsUsed: response.turns_used } : s))}
            // Only flags the session as finished. Unmounting the machine here
            // would yank the last prize reveal off-screen in the same commit that
            // renders it - staff moves on by tapping "Khách tiếp theo" instead.
            onSessionComplete={() => setSessionComplete(true)}
            showSoundToggle={false}
          />

          <button
            type="button"
            className="gacha-bright"
            onClick={handleNextBuyer}
            style={{
              marginTop: 24,
              width: "100%",
              minHeight: 62,
              borderRadius: 12,
              cursor: "pointer",
              fontFamily: DISPLAY,
              fontSize: 18,
              letterSpacing: ".04em",
              textTransform: "uppercase",
              ...(sessionComplete
                ? { border: "none", background: "#FF2E88", color: "#0E0818" }
                : {
                    border: "1px solid rgba(242,236,250,.2)",
                    background: "transparent",
                    color: "#C9B8E4",
                  }),
            }}
          >
            Khách tiếp theo
          </button>
        </div>
      )}
    </main>
  )
}
