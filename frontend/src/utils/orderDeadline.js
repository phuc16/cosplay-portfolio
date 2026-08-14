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
/**
 * "HH:mm dd/MM" in Asia/Ho_Chi_Minh, the shared display format for any
 * order-related timestamp on the buyer's order page (deadline, and the
 * per-status timestamp — see Order.jsx's statusTimestamp). Returns null
 * for a missing/unparsable input, same contract as formatDeadline, so a
 * call site never has to special-case "Invalid Date" itself.
 *
 * Reads the individual fields out of formatToParts rather than the
 * formatted string: which order ICU prints date vs. time in, and which
 * separator (ASCII space, comma, U+202F narrow no-break space, ...) it
 * uses between them, is runtime/browser-dependent. Indexing parts by
 * `type` sidesteps that entirely — the values are correct regardless of
 * how this environment's ICU data would have rendered the string.
 */
export function formatVnDateTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit", minute: "2-digit",
    day: "2-digit", month: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const part = (type) => parts.find((p) => p.type === type)?.value
  return `${part("hour")}:${part("minute")} ${part("day")}/${part("month")}`
}

export function formatDeadline(expiresAt, now = new Date()) {
  if (!expiresAt) return null

  const deadline = new Date(expiresAt)
  if (Number.isNaN(deadline.getTime())) return null

  const passed = deadline.getTime() <= now.getTime()
  const absolute = formatVnDateTime(expiresAt)

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
