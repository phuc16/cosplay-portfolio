import { useState } from "react"
import ShippingExport from "./shipping/ShippingExport"
import ShippingTrackingImport from "./shipping/ShippingTrackingImport"
import ShippingRoster from "./shipping/ShippingRoster"

const VIEWS = [
  { key: "export", label: "Xuất đơn ViettelPost" },
  { key: "tracking", label: "Nhập mã vận đơn" },
  { key: "roster", label: "Danh sách nhận hàng" },
]

export default function AdminShipping() {
  const [view, setView] = useState("export")

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={`px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] ${
              view === v.key ? "bg-pink-500 text-white" : ""
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "export" && <ShippingExport />}
      {view === "tracking" && <ShippingTrackingImport />}
      {view === "roster" && <ShippingRoster />}
    </div>
  )
}
