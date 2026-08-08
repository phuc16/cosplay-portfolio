import { useState } from "react"
import StatsDrop from "./stats/StatsDrop"
import StatsRestock from "./stats/StatsRestock"
import StatsBookkeeping from "./stats/StatsBookkeeping"

const VIEWS = [
  { key: "drop", label: "Theo đợt bán" },
  { key: "restock", label: "Restock" },
  { key: "bookkeeping", label: "Sổ quỹ" },
]

export default function AdminStats() {
  const [view, setView] = useState("drop")

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

      {view === "drop" && <StatsDrop />}
      {view === "restock" && <StatsRestock />}
      {view === "bookkeeping" && <StatsBookkeeping />}
    </div>
  )
}
