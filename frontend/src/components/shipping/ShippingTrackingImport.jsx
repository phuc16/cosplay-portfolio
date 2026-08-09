import { useRef, useState } from "react"
import { adminPreviewTrackingImport, adminConfirmTrackingImport } from "../../api/shop"

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || "")
      resolve(result.slice(result.indexOf(",") + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// Fallback labels for the reasons the server can send back in `skipped`.
// The server always supplies a Vietnamese `message` per entry and that is
// preferred, but if one ever arrives blank a seller must still see a
// readable Vietnamese reason rather than the raw snake_case token.
const SKIPPED_REASON_LABELS = {
  invalid_code: "Mã không hợp lệ",
  missing_tracking_code: "Thiếu mã vận đơn",
  duplicate_tracking_code: "Mã vận đơn bị trùng lặp",
  duplicate_order_code: "Mã đơn hàng bị trùng lặp",
  not_found: "Không tìm thấy đơn hàng",
  already_shipped: "Đơn hàng đã được giao trước đó",
  not_confirmed: "Đơn hàng chưa được xác nhận",
  not_shippable: "Đơn nhận tại chỗ (pickup), không áp dụng mã vận đơn",
}

function skippedReasonText(s) {
  return s.message || SKIPPED_REASON_LABELS[s.reason] || "Không rõ lý do"
}

export default function ShippingTrackingImport() {
  const [rowsText, setRowsText] = useState("")
  const [file, setFile] = useState(null)
  const fileInputRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const [results, setResults] = useState(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  // Exactly one of rows_text/file_base64 may be sent per preview (the
  // backend 400s otherwise), so picking either input clears the other.
  const onTextChange = (e) => {
    setRowsText(e.target.value)
    if (file) {
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const onFileChange = (e) => {
    const picked = e.target.files?.[0] || null
    setFile(picked)
    if (picked) setRowsText("")
  }

  const loadPreview = async () => {
    setError("")
    setResults(null)
    setBusy(true)
    try {
      const payload = file ? { file_base64: await readFileAsBase64(file) } : { rows_text: rowsText }
      const data = await adminPreviewTrackingImport(payload)
      setPreview(data)
    } catch (e) {
      setPreview(null)
      setError(e.response?.data?.message || "Không xem trước được")
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!preview || preview.toApply.length === 0) return
    setError("")
    setBusy(true)
    try {
      const res = await adminConfirmTrackingImport(preview.toApply)
      setResults(res.results)
    } catch (e) {
      setError(e.response?.data?.message || "Không xác nhận được")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-sm opacity-70 mb-2">
        Tải lên file kết quả ViettelPost, hoặc dán các dòng "Mã đơn hàng &lt;tab hoặc phẩy&gt; Mã vận đơn".
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={onFileChange}
        className="block w-full text-sm mb-3"
      />
      <textarea
        rows={6}
        value={rowsText}
        onChange={onTextChange}
        disabled={!!file}
        placeholder={file ? `Đã chọn file: ${file.name}` : ""}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent mb-3 disabled:opacity-50"
      />
      <button type="button" onClick={loadPreview} disabled={busy || (!file && !rowsText.trim())}
        className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] disabled:opacity-50 mr-2">
        {busy ? "Đang xử lý..." : "Xem trước"}
      </button>

      {error && <p className="text-red-500 mt-3">{error}</p>}

      {preview && (
        <div className="mt-4 text-sm">
          {preview.toApply.length === 0
            ? <p className="opacity-60">Không có đơn nào để áp dụng.</p>
            : (
              <>
                <p className="mb-2">Sẽ cập nhật {preview.toApply.length} đơn:</p>
                <div className="overflow-x-auto -mx-1 px-1 mb-3">
                  <table className="w-full min-w-[320px]">
                    <thead>
                      <tr className="text-left opacity-70"><th className="pr-2">Mã đơn</th><th>Mã vận đơn</th></tr>
                    </thead>
                    <tbody>
                      {preview.toApply.map((r) => (
                        <tr key={r.order_id} className="border-t border-[var(--border-brand)]">
                          <td className="pr-2 py-1">{r.order_code}</td>
                          <td className="py-1">{r.tracking_code}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" onClick={confirm} disabled={busy}
                  className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] disabled:opacity-50">
                  {busy ? "Đang xác nhận..." : "Xác nhận"}
                </button>
              </>
            )}

          {preview.skipped.length > 0 && (
            <div className="mt-3">
              <p className="text-red-500">Bỏ qua {preview.skipped.length} dòng:</p>
              <ul className="list-disc pl-5">
                {preview.skipped.map((s, i) => <li key={`${s.order_code}-${i}`}>{skippedReasonText(s)}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {results && (
        <div className="mt-4 text-sm">
          <p className="mb-2">Kết quả:</p>
          <ul className="list-disc pl-5">
            {results.map((r) => (
              <li key={r.order_id} className={r.ok ? "" : "text-red-500"}>{r.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
