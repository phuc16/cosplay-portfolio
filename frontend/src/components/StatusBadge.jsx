// Every class string here references only tokens asserted to exist by
// frontend/src/utils/semanticTokens.test.js - do not add a variant or
// token name here without adding it there first.
const VARIANT_CLASSES = {
  success: "bg-[var(--surface-success)] border-[var(--border-success)] text-[var(--text-success)]",
  danger: "bg-[var(--surface-danger)] border-[var(--border-danger)] text-[var(--text-danger)]",
  warning: "bg-[var(--surface-warning)] border-[var(--border-warning)] text-[var(--text-warning)]",
  neutral: "bg-[var(--surface-neutral)] border-[var(--border-neutral)] text-[var(--text-neutral)]",
}

/**
 * A small coloured pill for a status/payment/fulfilment label. Carries no
 * language logic - the caller passes the already-resolved label string
 * (Vietnamese in the admin, translated via t() in the shop) and a variant
 * from frontend/src/constants/statusVariant.js. An unrecognized variant
 * renders with the neutral tokens rather than an invented or empty class.
 */
export default function StatusBadge({ label, variant = "neutral" }) {
  const cls = VARIANT_CLASSES[variant] || VARIANT_CLASSES.neutral
  return (
    <span className={`inline-block px-2 py-0.5 text-xs rounded-full border font-medium whitespace-nowrap ${cls}`}>
      {label}
    </span>
  )
}
