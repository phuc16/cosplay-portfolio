/**
 * "HH:mm dd/MM" in Asia/Ho_Chi_Minh, the shared display format for any
 * order-related timestamp on the buyer's order page (deadline, and the
 * per-status timestamp - see Order.jsx's statusTimestamp). Returns null
 * for a missing/unparsable input, same contract as formatDeadline, so a
 * call site never has to special-case "Invalid Date" itself.
 *
 * Reads the individual fields out of formatToParts rather than the
 * formatted string: which order ICU prints date vs. time in, and which
 * separator (ASCII space, comma, U+202F narrow no-break space, ...) it
 * uses between them, is runtime/browser-dependent. Indexing parts by
 * `type` sidesteps that entirely - the values are correct regardless of
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

/**
 * Formats orders.expires_at for the buyer-facing order page.
 *
 * The single place the Asia/Ho_Chi_Minh timezone rule (matching the
 * convention Plan 4's bookkeeping cutoff established) and the sweep-window
 * edge case are applied - see the spec's Deadline Display and Error
 * Handling sections. Every call site renders nothing when this returns
 * null: a missing or unparsable deadline must never be mistakable for an
 * urgent one, and must never render as the literal string "Invalid Date".
 */
export function formatDeadline(expiresAt, now = new Date()) {
  if (!expiresAt) return null

  const deadline = new Date(expiresAt)
  if (Number.isNaN(deadline.getTime())) return null

  const passed = deadline.getTime() <= now.getTime()
  const absolute = formatVnDateTime(expiresAt)

  // A few seconds' buffer absorbs sub-second rounding noise from DB storage:
  // orders.expires_at is a DATETIME with no fractional-second precision, so
  // the stored value can land up to ~1s after the exact "created_at + N
  // hours" mark. Without this buffer, viewing an order in the first second
  // or two after creation could show one hour more than what was actually
  // configured (48h set → "còn 49 giờ" shown) before it self-corrects to 48
  // moments later - confusing on the very first load, which is the one
  // moment a buyer is most likely to be looking. This buffer is on the
  // opposite side from - and doesn't fight with - the "never show 0
  // prematurely" rounding-up behavior for a deadline actually close to
  // expiring: at the low end a few seconds of buffer is negligible, since
  // Math.max(1, ...) already floors the display at 1 regardless.
  const BUFFER_MS = 5000
  const remainingHours = passed
    ? 0
    : Math.max(1, Math.ceil((deadline.getTime() - now.getTime() - BUFFER_MS) / (60 * 60 * 1000)))

  return { absolute, remainingHours, passed }
}
