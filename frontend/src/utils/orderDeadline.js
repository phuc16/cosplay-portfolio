/**
 * Formats orders.expires_at for the buyer-facing order page.
 *
 * The single place the Asia/Ho_Chi_Minh timezone rule (matching the
 * convention Plan 4's bookkeeping cutoff established) and the sweep-window
 * edge case are applied — see the spec's Deadline Display and Error
 * Handling sections. Every call site renders nothing when this returns
 * null: a missing or unparsable deadline must never be mistakable for an
 * urgent one, and must never render as the literal string "Invalid Date".
 */
export function formatDeadline(expiresAt, now = new Date()) {
  if (!expiresAt) return null

  const deadline = new Date(expiresAt)
  if (Number.isNaN(deadline.getTime())) return null

  const passed = deadline.getTime() <= now.getTime()

  const raw = deadline.toLocaleString("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit", minute: "2-digit",
    day: "2-digit", month: "2-digit",
    hour12: false,
  })
  // ICU emits "dd/MM, HH:mm" (or "dd/MM HH:mm" depending on the runtime's
  // ICU data) — normalize to the spec's "HH:mm dd/MM" regardless of which
  // order this environment's en-GB formatter produces.
  const [datePart, timePart] = raw.replace(",", "").split(" ")
  const absolute = `${timePart} ${datePart}`

  // Never a countdown once the deadline has passed — the sweep window (the
  // worker cancels a pending order every ~5s) means expires_at can be in
  // the past while status is still pending. Showing "còn 0 giờ" here would
  // read as "there's still time," which is the one outcome this feature
  // must never produce.
  const remainingHours = passed
    ? 0
    : Math.max(1, Math.ceil((deadline.getTime() - now.getTime()) / (60 * 60 * 1000)))

  return { absolute, remainingHours, passed }
}
