/* eslint-disable react-refresh/only-export-components -- buildTimelineSteps
   is exported alongside the component so its pure null-handling logic is
   directly unit-testable, same pattern as AdminQrScanner's extractOrderToken. */

// Pure step derivation, kept separate from rendering so the null-handling
// logic (what counts as "reached", when shipped is skipped, cancelled vs
// completed as the terminal step) is directly unit-testable.
export function buildTimelineSteps(order) {
  const steps = [
    { key: "created", label: "Tạo đơn", at: order.created_at },
    { key: "confirmed", label: "Đã xác nhận", at: order.confirmed_at },
  ]

  // Pickup orders never touch "shipped" at all (spec: they go straight from
  // confirmed to completed) — that is a correct skip, not a missing step, so
  // it is left out of the timeline entirely rather than shown as unreached.
  if (order.fulfillment_method !== "pickup") {
    steps.push({ key: "shipped", label: "Đã giao vận", at: order.shipped_at })
  }

  // Cancelled is a distinct terminal branch from completed, not an extra
  // step after it — an order shows exactly one of the two, whichever
  // actually applies (or completed-not-reached-yet, while still open).
  steps.push(
    order.status === "cancelled"
      ? { key: "cancelled", label: "Đã hủy", at: order.cancelled_at }
      : { key: "completed", label: "Hoàn tất", at: order.completed_at }
  )

  return steps.map((s) => ({ ...s, reached: Boolean(s.at) }))
}

export default function OrderTimeline({ order }) {
  const steps = buildTimelineSteps(order)
  return (
    <ol className="flex flex-wrap gap-2 text-xs" aria-label="Trạng thái đơn hàng">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={
              "px-2 py-1 rounded-lg border " +
              (s.reached
                ? "border-[var(--brand)] text-[var(--brand)]"
                : "border-[var(--border-brand)] opacity-50")
            }
          >
            {s.label}
            {s.at && <> · {new Date(s.at).toLocaleString("vi-VN")}</>}
          </span>
          {i < steps.length - 1 && <span className="opacity-40">→</span>}
        </li>
      ))}
    </ol>
  )
}
