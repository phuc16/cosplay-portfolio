import { useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { fetchPracticePrizes, practiceDraw } from "../api/shop"
import GachaMachine from "../shop/gacha/GachaMachine"

// GachaMachine's turnsLeft math (turnsTotal - turnsUsed) needs a real number,
// so "unlimited" is spelled as a ceiling nobody reaches by hand. Practice draws
// never touch real stock, so the number is a UI conceit, not a limit.
const UNLIMITED_TURNS = 1_000_000

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
    <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-2">Thử miễn phí</h1>
      <p className="text-sm opacity-70 mb-6">
        Quay thử không giới hạn theo đúng tỉ lệ thật. Kết quả ở đây chỉ để xem trước, không tính là phần thưởng.
      </p>

      {loadingPrizes && (
        <div role="status" className="text-sm opacity-70">
          Đang tải phần thưởng…
        </div>
      )}

      {prizesFailed && (
        <div role="alert" className="text-sm text-red-500">
          {error}
          <button type="button" className="ml-2 underline font-semibold" onClick={handleRetry}>
            Thử lại
          </button>
        </div>
      )}

      {!loadingPrizes && !prizesFailed && prizes.length === 0 && (
        <div role="status" className="text-sm text-amber-600">
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
    </main>
  )
}
