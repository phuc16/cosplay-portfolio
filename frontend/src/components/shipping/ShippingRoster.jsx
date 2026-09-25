import { Fragment, useEffect, useRef, useState } from "react"
import { adminListCollections, adminGetPickupRoster, adminSetOrderPrepared } from "../../api/shop"
import { formatVnd } from "../../utils/money"
import { groupOrderItems } from "../../utils/groupOrderItems"
import SearchableSelect from "../SearchableSelect"

// Hides a non-matching row on screen (className "hidden") but forces it back
// with "print:table-row" when actually printing - this is a physical
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
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  const requestIdRef = useRef(0)

  const toggleExpanded = (orderId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId); else next.add(orderId)
      return next
    })
  }

  // Purely informational - never gates handover, just lets a seller tick off
  // orders they've already packed while working through the roster. Same
  // toggle/endpoint as the shipping queue's "Đã chuẩn bị" checkbox.
  const togglePrepared = async (row) => {
    const next = !row.prepared
    try {
      const res = await adminSetOrderPrepared(row.order_id, next)
      if (res?.ok) {
        setRoster((prev) => ({
          ...prev,
          rows: prev.rows.map((r) => (r.order_id === row.order_id ? { ...r, prepared: next } : r)),
        }))
      }
    } catch {
      setError("Không cập nhật được trạng thái chuẩn bị hàng")
    }
  }

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
          <SearchableSelect padding="px-2 py-1" height="h-[38px]"
            value={collectionId}
            onChange={selectCollection}
            options={[{ code: "", name: "- Chọn một bộ sưu tập -" }, ...collections.map((c) => ({ code: String(c.id), name: c.title }))]}
            placeholder="- Chọn một bộ sưu tập -"
          />
        </label>
        {roster && (
          <label className="flex flex-col text-xs gap-1 max-w-xs">
            Tìm kiếm
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Mã đơn, tên, SĐT, mã nhận..."
              className="h-[38px] px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
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
                      <th className="pr-2">Số tiền cần thu</th>
                      <th className="print:hidden">Chuẩn bị</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.rows.map((r) => {
                      const rowVisible = matchesSearch(r, search)
                      const detailVisible = rowVisible && expandedIds.has(r.order_id)
                      return (
                        <Fragment key={r.order_id}>
                          <tr
                            data-testid={`order-row-${r.order_id}`}
                            className={`border-t border-[var(--border-brand)] ${rowVisible ? "" : "hidden print:table-row"}`}
                          >
                            <td className="pr-2 py-1">☐</td>
                            <td className="pr-2 py-1">
                              {r.order_code}
                              {r.has_digital_item && (
                                <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--brand-soft)]">
                                  + Sản phẩm số
                                </span>
                              )}
                            </td>
                            <td className="pr-2 py-1">{r.pickup_code}</td>
                            <td className="pr-2 py-1">{r.buyer_name}</td>
                            <td className="pr-2 py-1">{r.phone}</td>
                            <td className="pr-2 py-1 align-top">
                              <button
                                type="button"
                                onClick={() => toggleExpanded(r.order_id)}
                                className="text-xs underline print:hidden"
                              >
                                {expandedIds.has(r.order_id) ? "Ẩn" : `${r.items.length} sản phẩm`}
                              </button>
                            </td>
                            <td className="pr-2 py-1 font-semibold">
                              {r.paid ? "Đã thanh toán" : "Thu khi giao"}
                            </td>
                            <td className="pr-2 py-1 font-bold text-base">
                              {r.paid ? "-" : formatVnd(r.amount_due)}
                            </td>
                            <td className="py-1 print:hidden">
                              <button
                                type="button"
                                data-testid={`prepared-${r.order_id}`}
                                onClick={() => togglePrepared(r)}
                                className={`px-2.5 py-1 text-xs rounded-full border font-medium whitespace-nowrap ${
                                  r.prepared
                                    ? "bg-[var(--surface-success)] border-[var(--border-success)] text-[var(--text-success)]"
                                    : "bg-[var(--surface-warning)] border-[var(--border-warning)] text-[var(--text-warning)]"
                                }`}
                              >
                                {r.prepared ? "Đã đóng gói" : "Cần đóng gói"}
                              </button>
                            </td>
                          </tr>
                          {/* Own full-width row rather than crammed into the narrow
                              "Sản phẩm" cell - collapsed by default on screen so a long
                              cart doesn't blow out the row, but always shown in full
                              when printed, since this is the physical checklist staff
                              hand items off against at the door. */}
                          <tr
                            data-testid={`order-detail-${r.order_id}`}
                            className={`border-t border-[var(--border-brand)] ${detailVisible ? "" : "hidden"} print:table-row`}
                          >
                            <td></td>
                            <td colSpan={8} className="pb-2">
                              <ul className="pl-0">
                                {groupOrderItems(
                                  r.items,
                                  (i) => `${i.product_name}|${i.variant_label}|${i.is_gift}|${i.image_url || ""}`
                                ).map((i, idx) => (
                                  <li key={idx} className="flex items-center gap-1.5 py-0.5">
                                    {i.image_url
                                      ? <img src={i.image_url} alt="" className="w-6 h-6 object-cover rounded print:hidden" />
                                      : <span className="w-6 h-6 rounded bg-[var(--surface-neutral)] print:hidden" />}
                                    {i.product_name}{i.variant_label ? ` · ${i.variant_label}` : ""} × {i.qty}
                                    {Boolean(i.is_gift) && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--brand-soft)]">
                                        🎁 Quà tặng
                                      </span>
                                    )}
                                    {i.delivery_link && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--brand-soft)]">
                                        Sản phẩm số
                                      </span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                              {r.note && <p className="text-sm italic opacity-80 mt-1">Ghi chú: {r.note}</p>}
                            </td>
                          </tr>
                        </Fragment>
                      )
                    })}
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
