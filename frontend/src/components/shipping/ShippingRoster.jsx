import { useEffect, useRef, useState } from "react"
import { adminListCollections, adminGetPickupRoster } from "../../api/shop"
import { formatVnd } from "../../utils/money"

// Hides a non-matching row on screen (className "hidden") but forces it back
// with "print:table-row" when actually printing — this is a physical
// checklist staff hand out at the event door, so filtering it for a quick
// on-screen lookup must never also silently drop people from the printed
// page.
function matchesSearch(r, term) {
  if (!term) return true
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  return [r.order_code, r.buyer_name, r.phone, r.pickup_code].some((f) => String(f || "").toLowerCase().includes(needle))
}

export default function ShippingRoster() {
  const [collections, setCollections] = useState([])
  const [collectionId, setCollectionId] = useState("")
  const [roster, setRoster] = useState(null)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const requestIdRef = useRef(0)

  useEffect(() => {
    adminListCollections().then(setCollections).catch(() => setCollections([]))
  }, [])

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    if (!collectionId) return
    adminGetPickupRoster(collectionId)
      .then((data) => {
        if (requestIdRef.current !== requestId) return
        setError("")
        setRoster(data)
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return
        setRoster(null)
        setError("Không tải được danh sách nhận hàng")
      })
  }, [collectionId])

  const selectCollection = (value) => {
    setRoster(null)
    setError("")
    setCollectionId(value)
  }

  return (
    <div>
      <div className="flex items-end gap-3 mb-4 flex-wrap print:hidden">
        <label className="flex flex-col text-xs gap-1 max-w-xs">
          Bộ sưu tập
          <select
            value={collectionId}
            onChange={(e) => selectCollection(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          >
            <option value="">— Chọn một bộ sưu tập —</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
        {roster && (
          <label className="flex flex-col text-xs gap-1 max-w-xs">
            Tìm kiếm
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Mã đơn, tên, SĐT, mã nhận..."
              className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
            />
          </label>
        )}
        {roster && (
          <button type="button" onClick={() => window.print()}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)]">
            In
          </button>
        )}
      </div>

      {error && <p className="text-red-500 mb-3">{error}</p>}
      {!collectionId && <p className="opacity-60">Chọn một bộ sưu tập để xem danh sách nhận hàng.</p>}

      {roster && (
        <>
          {roster.excluded.length > 0 && (
            <div className="mb-4 print:hidden">
              <p className="text-red-500">Bỏ qua {roster.excluded.length} đơn:</p>
              <ul className="list-disc pl-5 text-sm">
                {roster.excluded.map((x) => <li key={x.order_id}>{x.message}</li>)}
              </ul>
            </div>
          )}

          {roster.rows.length === 0
            ? <p className="opacity-60">Không có đơn nhận tại chỗ nào đã xác nhận trong bộ sưu tập này.</p>
            : (
              <>
                {search.trim() && roster.rows.every((r) => !matchesSearch(r, search)) && (
                  <p className="opacity-60 mb-3 print:hidden">Không tìm thấy đơn nào khớp.</p>
                )}
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left opacity-70">
                      <th className="pr-2">✓</th>
                      <th className="pr-2">Mã đơn</th>
                      <th className="pr-2">Mã nhận hàng</th>
                      <th className="pr-2">Người nhận</th>
                      <th className="pr-2">SĐT</th>
                      <th className="pr-2">Sản phẩm</th>
                      <th className="pr-2">Thanh toán</th>
                      <th>Số tiền cần thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.rows.map((r) => (
                      <tr
                        key={r.order_id}
                        className={`border-t border-[var(--border-brand)] ${matchesSearch(r, search) ? "" : "hidden print:table-row"}`}
                      >
                        <td className="pr-2 py-1">☐</td>
                        <td className="pr-2 py-1">{r.order_code}</td>
                        <td className="pr-2 py-1">{r.pickup_code}</td>
                        <td className="pr-2 py-1">{r.buyer_name}</td>
                        <td className="pr-2 py-1">{r.phone}</td>
                        <td className="pr-2 py-1">
                          <ul className="list-disc pl-4">
                            {r.items.map((i, idx) => (
                              <li key={idx}>{i.product_name} ({i.variant_label}) x{i.qty}</li>
                            ))}
                          </ul>
                        </td>
                        <td className="pr-2 py-1 font-semibold">
                          {r.paid ? "Đã thanh toán" : "Thu khi giao"}
                        </td>
                        <td className="py-1 font-bold text-base">
                          {r.paid ? "—" : formatVnd(r.amount_due)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            )}
        </>
      )}
    </div>
  )
}
