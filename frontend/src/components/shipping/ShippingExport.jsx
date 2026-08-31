import { Fragment, useEffect, useRef, useState } from "react"
import {
  adminListShippingExportOrders, adminSetShippingPayer, adminSetOrderPrepared, adminGenerateShippingExport, adminGetOrder,
} from "../../api/shop"
import { formatVnd } from "../../utils/money"

const LOAI_HANG_HOA_OPTIONS = ["Bưu kiện", "Tài liệu"]

// The exact 11 values from the VTP template's own "Thời gian hẹn lấy"
// reference sheet, transcribed verbatim. VTP validates this server-side on
// import, so a free-text field would let a typo produce a file that is only
// rejected at upload time, after the seller has already booked their day
// around it.
const THOI_GIAN_HEN_LAY_OPTIONS = [
  "Hôm nay - Sáng (7h30 - 12h00)",
  "Hôm nay - Chiều (13h30 - 18h00)",
  "Hôm nay - Tối (18h30 - 21h00)",
  "Ngày mai - Cả ngày",
  "Ngày mai - Sáng (7h30 - 12h00)",
  "Ngày mai - Chiều (13h30 - 18h00)",
  "Ngày mai - Tối (18h30 - 21h00)",
  "Ngày kia - Cả ngày",
  "Ngày kia - Sáng (7h30 - 12h00)",
  "Ngày kia - Chiều (13h30 - 18h00)",
  "Ngày kia - Tối (18h30 - 21h00)",
]

// Fallback labels for the four reasons the server can send back in
// `excluded`. The server always supplies a Vietnamese `message` per entry
// and that is preferred, but if one ever arrives blank a seller must still
// see a readable Vietnamese reason rather than the raw snake_case token.
const EXCLUDED_REASON_LABELS = {
  no_address: "Không có địa chỉ nhận hàng hợp lệ",
  cod_missing_amount: "Thiếu số tiền thu hộ (COD)",
  not_found: "Không tìm thấy đơn hàng",
  not_eligible: "Đơn hàng không đủ điều kiện xuất vận đơn",
}

function excludedReasonText(x) {
  return x.message || EXCLUDED_REASON_LABELS[x.reason] || "Không rõ lý do"
}

function downloadBase64(base64, filename) {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i += 1) arr[i] = bytes.charCodeAt(i)
  const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Client-side, not a backend param: this list is already fetched in full
// (every ship order still awaiting a tracking code — never large enough to
// paginate), so filtering what's already in memory is simpler than adding
// a search param to a route with no other filters today.
function matchesSearch(o, term) {
  if (!term) return true
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  return [String(o.id), o.order_code, o.buyer_name, o.phone]
    .some((f) => String(f || "").toLowerCase().includes(needle))
}

export default function ShippingExport() {
  const [orders, setOrders] = useState([])
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState(new Set())
  const [tenHangHoa, setTenHangHoa] = useState("")
  const [trongLuong, setTrongLuong] = useState("")
  const [loaiHangHoa, setLoaiHangHoa] = useState(LOAI_HANG_HOA_OPTIONS[0])
  const [thoiGianHenLay, setThoiGianHenLay] = useState(THOI_GIAN_HEN_LAY_OPTIONS[0])
  const [result, setResult] = useState(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const requestIdRef = useRef(0)
  const [expandedId, setExpandedId] = useState(null)
  const [itemsByOrderId, setItemsByOrderId] = useState({})

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    adminListShippingExportOrders()
      .then((data) => {
        if (requestIdRef.current !== requestId) return
        setOrders(data)
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return
        setOrders([])
      })
  }, [])

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleFreeship = async (order) => {
    const next = order.shipping_payer === "seller" ? "buyer" : "seller"
    try {
      const res = await adminSetShippingPayer(order.id, next)
      if (res?.ok) {
        setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, shipping_payer: next } : o)))
      }
    } catch {
      setError("Không cập nhật được người trả cước")
    }
  }

  // Purely informational — never gates export/tracking, just lets a seller
  // tick off orders they've already packed while working through the queue.
  const togglePrepared = async (order) => {
    const next = !order.prepared
    try {
      const res = await adminSetOrderPrepared(order.id, next)
      if (res?.ok) {
        setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, prepared: next } : o)))
      }
    } catch {
      setError("Không cập nhật được trạng thái chuẩn bị hàng")
    }
  }

  const toggleExpanded = async (id) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (itemsByOrderId[id]) return
    try {
      const detail = await adminGetOrder(id)
      setItemsByOrderId((prev) => ({ ...prev, [id]: detail.items }))
    } catch {
      setItemsByOrderId((prev) => ({ ...prev, [id]: null }))
    }
  }

  const generate = async () => {
    setError("")
    setResult(null)
    setBusy(true)
    try {
      const batch = {
        ten_hang_hoa: tenHangHoa,
        trong_luong: Number(trongLuong),
        loai_hang_hoa: loaiHangHoa,
        thoi_gian_hen_lay: thoiGianHenLay,
      }
      const res = await adminGenerateShippingExport([...selected], batch)
      setResult(res)
      if (res.exported_count > 0) downloadBase64(res.file_base64, res.filename)
    } catch (e) {
      setError(e.response?.data?.message || "Không xuất được file")
    } finally {
      setBusy(false)
    }
  }

  const visibleOrders = orders.filter((o) => matchesSearch(o, search))

  return (
    <div>
      {orders.length === 0 && <p className="opacity-60">Không có đơn nào cần xuất.</p>}

      {orders.length > 0 && (
        <>
          <label className="flex flex-col text-xs gap-1 mb-3 max-w-xs">
            Tìm kiếm
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Mã đơn, tên, SĐT..."
              className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
            />
          </label>

          {visibleOrders.length === 0 && <p className="opacity-60 mb-4">Không tìm thấy đơn nào khớp.</p>}

          {visibleOrders.length > 0 && (
            <div className="overflow-x-auto -mx-1 px-1 mb-4">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left opacity-70">
                    <th></th>
                    <th className="pr-2">Mã đơn</th>
                    <th className="pr-2">Người nhận</th>
                    <th className="pr-2">SĐT</th>
                    <th className="pr-2">Tỉnh/Thành</th>
                    <th className="pr-2">Giá trị</th>
                    <th className="pr-2">Miễn phí ship</th>
                    <th className="pr-2">Đã chuẩn bị</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOrders.map((o) => (
                    <Fragment key={o.id}>
                      <tr className="border-t border-[var(--border-brand)]">
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(o.id)}
                            onChange={() => toggleSelected(o.id)}
                          />
                        </td>
                        <td className="pr-2 py-1">{o.order_code}</td>
                        <td className="pr-2 py-1">{o.buyer_name}</td>
                        <td className="pr-2 py-1">{o.phone}</td>
                        <td className="pr-2 py-1">{o.address_province || "—"}</td>
                        <td className="pr-2 py-1">{formatVnd(o.total)}</td>
                        <td className="pr-2 py-1">
                          <input
                            type="checkbox"
                            data-testid={`freeship-${o.id}`}
                            checked={o.shipping_payer === "seller"}
                            onChange={() => toggleFreeship(o)}
                          />
                        </td>
                        <td className="pr-2 py-1">
                          <input
                            type="checkbox"
                            data-testid={`prepared-${o.id}`}
                            checked={Boolean(o.prepared)}
                            onChange={() => togglePrepared(o)}
                          />
                        </td>
                        <td className="py-1">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(o.id)}
                            className="px-2 py-0.5 text-xs border rounded-lg border-[var(--border-brand)]"
                          >
                            {expandedId === o.id ? "Ẩn" : "Cần đóng gói"}
                          </button>
                        </td>
                      </tr>
                      {expandedId === o.id && (
                        <tr className="border-t border-[var(--border-brand)]">
                          <td></td>
                          <td colSpan={7} className="py-2 text-sm">
                            {itemsByOrderId[o.id] === undefined && <p className="opacity-60">Đang tải...</p>}
                            {itemsByOrderId[o.id] === null && <p className="text-red-500">Không tải được sản phẩm.</p>}
                            {Array.isArray(itemsByOrderId[o.id]) && (
                              <ul className="list-disc pl-4">
                                {itemsByOrderId[o.id].map((i) => (
                                  <li key={i.id}>
                                    {i.product_name_snapshot} · {i.variant_label_snapshot} × {i.qty}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <label className="flex flex-col text-xs gap-1">
              Tên hàng hóa
              <input data-testid="ten-hang-hoa" value={tenHangHoa} onChange={(e) => setTenHangHoa(e.target.value)}
                className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent" />
            </label>
            <label className="flex flex-col text-xs gap-1">
              Trọng lượng (gram)
              <input data-testid="trong-luong" type="number" value={trongLuong} onChange={(e) => setTrongLuong(e.target.value)}
                className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent" />
            </label>
            <label className="flex flex-col text-xs gap-1">
              Loại hàng hóa
              <select data-testid="loai-hang-hoa" value={loaiHangHoa} onChange={(e) => setLoaiHangHoa(e.target.value)}
                className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent">
                {LOAI_HANG_HOA_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="flex flex-col text-xs gap-1">
              Thời gian hẹn lấy
              <select data-testid="thoi-gian-hen-lay" value={thoiGianHenLay} onChange={(e) => setThoiGianHenLay(e.target.value)}
                className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent">
                {THOI_GIAN_HEN_LAY_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          </div>

          <button type="button" onClick={generate} disabled={busy || selected.size === 0}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] disabled:opacity-50">
            {busy ? "Đang xuất..." : "Xuất file"}
          </button>
        </>
      )}

      {error && <p className="text-red-500 mt-3">{error}</p>}

      {result && (
        <div className="mt-4 text-sm">
          <p>Đã xuất {result.exported_count} đơn.</p>
          {result.excluded.length > 0 && (
            <div className="mt-2">
              <p className="text-red-500">Bỏ qua {result.excluded.length} đơn:</p>
              <ul className="list-disc pl-5">
                {result.excluded.map((x) => (
                  <li key={x.order_id}>{excludedReasonText(x)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
