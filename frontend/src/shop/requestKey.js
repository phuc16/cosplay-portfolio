// crypto.randomUUID() only exists in secure contexts (HTTPS or localhost). Over
// plain HTTP on a LAN IP - a realistic device-testing setup during development -
// it's undefined, and calling it would throw during render since this feeds a
// useState initializer, blanking the whole page. Production is HTTPS so this
// isn't a live production risk, just a confusing dev-mode failure. The fallback
// is NOT cryptographically secure, but request_key only needs uniqueness for
// idempotency within a single checkout session, not unguessability like
// order_token, so a weaker fallback is acceptable specifically for this value.
export function generateRequestKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
}
