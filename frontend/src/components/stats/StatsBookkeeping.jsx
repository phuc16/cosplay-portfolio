import { useRef, useState } from "react"
import { adminGetBookkeepingStats, adminDownloadBookkeepingCsv } from "../../api/shop"
import { formatVnd } from "../../utils/money"

/** "Today" in Asia/Ho_Chi_Minh (fixed UTC+7), not the browser's local
 * timezone — the bookkeeping range is interpreted server-side in
 * Asia/Ho_Chi_Minh, so a UTC-derived default could hand the seller the
 * wrong day near midnight. */
function todayInHoChiMinh() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" })
}

/** Blob.text() is standard in browsers but jsdom's Blob (used under test)
 * doesn't implement it, so fall back to FileReader — both environments end
 * up going through this one path. */
function readBlobAsText(blob) {
  if (typeof blob.text === "function") return blob.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

/** The CSV client call uses responseType: "blob", so a 400 error body
 * arrives as an opaque Blob rather than parsed JSON — err.response.data is
 * a Blob, not { message }. Read it back as text and parse it to recover
 * the server's actual Vietnamese message. */
async function extractErrorMessage(err, fallback) {
  const data = err?.response?.data
  if (data instanceof Blob) {
    try {
      const text = await readBlobAsText(data)
      const parsed = JSON.parse(text)
      return parsed?.message || fallback
    } catch {
      return fallback
    }
  }
  return err?.response?.data?.message || fallback
}

export default function StatsBookkeeping() {
  const [dateFrom, setDateFrom] = useState(todayInHoChiMinh())
  const [dateTo, setDateTo] = useState(todayInHoChiMinh())
  const [stats, setStats] = useState(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const requestIdRef = useRef(0)

  const load = async () => {
    const requestId = ++requestIdRef.current
    setError("")
    setBusy(true)
    try {
      const data = await adminGetBookkeepingStats({ date_from: dateFrom, date_to: dateTo })
      if (requestIdRef.current !== requestId) return
      setStats(data)
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      setStats(null)
      setError(await extractErrorMessage(err, "Không tải được sổ quỹ"))
    } finally {
      if (requestIdRef.current === requestId) setBusy(false)
    }
  }

  /** Exports the range that produced the currently-displayed `stats`, not
   * the live date-input values — the inputs can be edited after "Xem" is
   * clicked without clearing `stats` (the button is gated only on `stats &&`),
   * so using them here could silently download a different range than the
   * one on screen. The backend echoes `date_from`/`date_to` back in its
   * response precisely so the displayed range is always available here. */
  const downloadCsv = async () => {
    if (!stats) return
    const { date_from: statsDateFrom, date_to: statsDateTo } = stats
    setError("")
    setExporting(true)
    try {
      const blob = await adminDownloadBookkeepingCsv({ date_from: statsDateFrom, date_to: statsDateTo })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `so-quy-${statsDateFrom}-${statsDateTo}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(await extractErrorMessage(err, "Không xuất được CSV"))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <label className="flex flex-col text-xs gap-1">
          Từ ngày
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
        </label>
        <label className="flex flex-col text-xs gap-1">
          Đến ngày
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          />
        </label>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] disabled:opacity-50"
        >
          {busy ? "Đang tải..." : "Xem"}
        </button>
        {stats && (
          <button
            type="button"
            onClick={downloadCsv}
            disabled={exporting}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] disabled:opacity-50"
          >
            {exporting ? "Đang xuất..." : "Xuất CSV"}
          </button>
        )}
      </div>

      {error && <p className="text-red-500 mb-3">{error}</p>}

      {stats && (
        stats.by_collection.length === 0 ? (
          <p className="opacity-60">Không có đơn hàng nào trong khoảng ngày này.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Đã nhận</p>
                <p className="text-lg font-semibold">{formatVnd(stats.received_total)}</p>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Chờ thanh toán</p>
                <p className="text-lg font-semibold">{formatVnd(stats.awaiting_payment)}</p>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Thu khi giao</p>
                <p className="text-lg font-semibold">{formatVnd(stats.to_collect)}</p>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Đã mất (đơn hủy)</p>
                <p className="text-lg font-semibold">{formatVnd(stats.lost)}</p>
              </div>
              <div className="p-3 rounded-xl border border-[var(--border-brand)]">
                <p className="text-xs opacity-70">Đơn COD chưa xác nhận</p>
                <p className="text-lg font-semibold">{formatVnd(stats.pending_cod)}</p>
              </div>
            </div>

            <p className="mb-2 text-sm">
              Đã nhận theo phương thức: Ngân hàng {formatVnd(stats.received.bank)} · Momo{" "}
              {formatVnd(stats.received.momo)} · PayPal {formatVnd(stats.received.paypal)} · COD{" "}
              {formatVnd(stats.received.cod)}
            </p>
            <p className="mb-4 text-sm opacity-70">
              Chi phí ship đã ghi nhận (chi phí, không phải doanh thu): {formatVnd(stats.shipping_cost)}
            </p>

            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left opacity-70">
                    <th className="pr-2">Bộ sưu tập</th>
                    <th className="pr-2">Đã nhận</th>
                    <th className="pr-2">Chờ thanh toán</th>
                    <th className="pr-2">Thu khi giao</th>
                    <th className="pr-2">Đã mất</th>
                    <th>Đơn COD chưa xác nhận</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.by_collection.map((c) => (
                    <tr key={c.collection_id ?? "none"} className="border-t border-[var(--border-brand)]">
                      <td className="pr-2 py-1">{c.collection_title}</td>
                      <td className="pr-2 py-1">{formatVnd(c.received_total)}</td>
                      <td className="pr-2 py-1">{formatVnd(c.awaiting_payment)}</td>
                      <td className="pr-2 py-1">{formatVnd(c.to_collect)}</td>
                      <td className="pr-2 py-1">{formatVnd(c.lost)}</td>
                      <td className="py-1">{formatVnd(c.pending_cod)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </div>
  )
}
