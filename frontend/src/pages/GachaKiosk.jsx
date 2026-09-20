import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { adminStartBoothSession, adminDrawSession, adminFetchPrizes } from "../api/shop"
import { hasAdminSession } from "../utils/orderAuth"
import GachaMachine from "../shop/gacha/GachaMachine"

const DEFAULT_TURNS = 5

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

  if (!session) {
    return (
      <main className="max-w-md mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold mb-6">Bảng nhân viên</h1>

        <label className="block text-sm mb-1" htmlFor="kiosk-buyer-name">Tên khách (tùy chọn)</label>
        <input
          id="kiosk-buyer-name"
          type="text"
          className="w-full mb-4 px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
          value={buyerName}
          onChange={(e) => setBuyerName(e.target.value)}
          placeholder="Tên khách (tùy chọn)"
        />

        <label className="block text-sm mb-1" htmlFor="kiosk-turns">Số lượt</label>
        <div className="flex items-center gap-2 mb-6">
          <button
            type="button"
            className="px-3 py-2 rounded-lg border border-[var(--border-brand)]"
            onClick={() => setTurnsTotal((n) => Math.max(1, n - 1))}
            aria-label="Giảm lượt"
          >
            -
          </button>
          <input
            id="kiosk-turns"
            type="number"
            min={1}
            className="w-20 text-center px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
            value={turnsTotal}
            onChange={(e) => setTurnsTotal(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
          />
          <button
            type="button"
            className="px-3 py-2 rounded-lg border border-[var(--border-brand)]"
            onClick={() => setTurnsTotal((n) => n + 1)}
            aria-label="Tăng lượt"
          >
            +
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-4 text-sm text-red-500">
            {error}
            {prizesFailed && (
              <button
                type="button"
                className="ml-2 underline font-semibold"
                onClick={loadPrizes}
              >
                Thử lại
              </button>
            )}
          </div>
        )}

        {!loadingPrizes && !prizesFailed && prizes.length === 0 && (
          <div role="status" className="mb-4 text-sm text-amber-600">
            Sản phẩm này chưa được cấu hình phần thưởng nào. Thêm phần thưởng trong trang quản trị trước khi mở phiên.
          </div>
        )}

        <button
          type="button"
          className="w-full px-4 py-3 rounded-xl font-semibold bg-[var(--accent-brand)] text-white disabled:opacity-50"
          onClick={handleStart}
          disabled={starting || loadingPrizes || prizes.length === 0}
        >
          {starting ? "Đang bắt đầu…" : loadingPrizes ? "Đang tải phần thưởng…" : "Bắt đầu phiên"}
        </button>
      </main>
    )
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
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
      />

      <button
        type="button"
        className={`mt-6 w-full px-4 py-3 rounded-xl font-semibold border border-[var(--border-brand)] ${sessionComplete ? "bg-[var(--accent-brand)] text-white" : ""}`}
        onClick={handleNextBuyer}
      >
        Khách tiếp theo
      </button>
    </main>
  )
}
