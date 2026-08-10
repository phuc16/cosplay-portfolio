/**
 * Maps the order status enum (pending/confirmed/shipped/completed/cancelled)
 * and the transition-target enum used for admin action buttons to a
 * semantic colour variant. Colour only, no copy — shared by the
 * hardcoded-Vietnamese admin (frontend/src/admin/orderLabels.js carries the
 * labels) and the bilingual shop (frontend/src/i18n/translations.js carries
 * the labels there).
 *
 * An unknown status/target falls back to "neutral" rather than throwing or
 * returning undefined — a status this module doesn't recognize must still
 * render with *some* semantic-token class, never an invented one.
 */
const STATUS_VARIANT = {
  pending: "warning",
  confirmed: "success",
  shipped: "success",
  completed: "success",
  cancelled: "danger",
}

const ACTION_VARIANT = {
  confirmed: "success",
  shipped: "success",
  completed: "success",
  cancelled: "danger",
}

export function variantForStatus(status) {
  return STATUS_VARIANT[status] || "neutral"
}

export function variantForAction(toStatus) {
  return ACTION_VARIANT[toStatus] || "neutral"
}
