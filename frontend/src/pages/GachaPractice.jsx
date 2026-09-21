import { useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { fetchPracticePrizes, practiceDraw } from "../api/shop"
import GachaMachine, { UNLIMITED_TURNS_SENTINEL } from "../shop/gacha/GachaMachine"

// Practice draws never touch real stock, so the number is a UI conceit, not a
// limit: GachaMachine recognises the sentinel and hides the count from buyer
// -facing copy.
const UNLIMITED_TURNS = UNLIMITED_TURNS_SENTINEL

/**
 * Public, unauthenticated "try before you buy" page: the same reel the buyer
 * and booth kiosk use, spinning against the practice endpoint, which simulates
 * an outcome against live odds without reserving or consuming any prize.
 */
export default function GachaPractice() {
  const { productId } = useParams()
  const numericProductId = Number(productId)

  const [prizes, setPrizes] = useState([])
  const [loadingPrizes, setLoadingPrizes] = useState(true)
  const [prizesFailed, setPrizesFailed] = useState(false)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  // GachaMachine takes its turn counter from each draw response rather than
  // incrementing its own, so practice has to hand it a running total; a ref
  // keeps that out of the render path, where it would only duplicate state
  // the machine already owns.
  const spins = useRef(0)

  // A failed fetch and a product with zero prizes both collapse into an empty
  // array, which GachaMachine's reel builder cannot render at all. Track the
  // fetch lifecycle explicitly so each case gets its own message, and so a
  // flaky-connection failure is recoverable without a page reload.
  useEffect(() => {
    if (!numericProductId) return
    let cancelled = false
    fetchPracticePrizes(numericProductId)
      .then((data) => {
        if (cancelled) return
        setPrizes(data?.prizes || [])
        setLoadingPrizes(false)
      })
      .catch((err) => {
        if (cancelled) return
        setPrizes([])
        setPrizesFailed(true)
        setLoadingPrizes(false)
        setError(
          err?.response?.data?.message ||
            "Không tải được danh sách phần thưởng. Kiểm tra kết nối rồi thử lại."
        )
      })
    return () => {
      cancelled = true
    }
  }, [numericProductId, reloadKey])

  function handleRetry() {
    setLoadingPrizes(true)
    setPrizesFailed(false)
    setError(null)
    setReloadKey((n) => n + 1)
  }

  async function handleDraw() {
    const result = await practiceDraw(numericProductId)
    spins.current += 1
    return {
      prize: result.prize,
      turns_used: spins.current,
      turns_total: UNLIMITED_TURNS,
      session_completed: false,
    }
  }

  return (
    <main
      className="gacha-machine"
      style={{
        minHeight: "100vh",
        padding: "clamp(16px, 4vw, 40px)",
        background: "radial-gradient(90% 70% at 50% -10%, #2A1147 0%, #130B21 55%, #0E0818 100%)",
        color: "#F2ECFA",
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 11,
            letterSpacing: ".3em",
            color: "#FF2E88",
          }}
        >
          QUAY THỬ
        </div>
        <h1
          style={{
            fontFamily: "'Bungee', cursive",
            fontSize: "clamp(22px, 5vw, 32px)",
            margin: "8px 0 0",
            textTransform: "uppercase",
          }}
        >
          Thử miễn phí
        </h1>
        <p style={{ fontSize: 14, color: "#9A86B8", margin: "10px 0 20px", lineHeight: 1.55 }}>
          Quay thử không giới hạn theo đúng tỉ lệ thật. Kết quả ở đây chỉ để xem trước, không tính là phần thưởng.
        </p>

        {loadingPrizes && (
          <div role="status" style={{ fontSize: 14, color: "#9A86B8" }}>
            Đang tải phần thưởng…
          </div>
        )}

        {prizesFailed && (
          <div role="alert" style={{ fontSize: 14, color: "#FF6B8A" }}>
            {error}
            <button
              type="button"
              onClick={handleRetry}
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
          </div>
        )}

        {!loadingPrizes && !prizesFailed && prizes.length === 0 && (
          <div role="status" style={{ fontSize: 14, color: "#E8B62C" }}>
            Sản phẩm này chưa được cấu hình phần thưởng nào.
          </div>
        )}

        {!loadingPrizes && !prizesFailed && prizes.length > 0 && (
          <GachaMachine
            prizes={prizes}
            turnsTotal={UNLIMITED_TURNS}
            turnsUsed={0}
            drawFn={handleDraw}
          />
        )}
      </div>
    </main>
  )
}
