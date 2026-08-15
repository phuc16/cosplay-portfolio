import axios from "axios"

const SESSION_KEY_PREFIX = "order_access:"

// Must match pages/Admin.jsx's own TOKEN_KEY constant — duplicated rather
// than imported to avoid a circular import between the admin panel and the
// public order page.
//
// axios.defaults.headers.common["Authorization"] alone is NOT enough to
// detect an admin session: it's in-memory state Admin.jsx only sets when it
// actually mounts and reads localStorage. A buyer's order link opened
// directly (never having visited /admin in that tab/page-load) has an
// admin_token sitting in localStorage but no in-memory header at all — this
// was caught live: devtools showed admin_token present, PIN gate still
// showed. Reading localStorage directly here fixes that.
const ADMIN_TOKEN_KEY = "admin_token"

export function hasAdminSession() {
  return Boolean(axios.defaults.headers.common["Authorization"]) || Boolean(localStorage.getItem(ADMIN_TOKEN_KEY))
}

export function getOrderSessionToken(token) {
  return sessionStorage.getItem(SESSION_KEY_PREFIX + token)
}

export function setOrderSessionToken(token, sessionToken) {
  sessionStorage.setItem(SESSION_KEY_PREFIX + token, sessionToken)
}

export function clearOrderSessionToken(token) {
  sessionStorage.removeItem(SESSION_KEY_PREFIX + token)
}

/**
 * Auth header for a gated /api/orders/:token/* call.
 *
 * Priority: (1) an admin session already active THIS tab — the shared axios
 * instance's request interceptor re-reads axios.defaults.headers.common on
 * every call (see api/api.js), so nothing needs attaching explicitly; (2) an
 * admin_token persisted in localStorage from a previous /admin visit, even
 * if Admin.jsx never mounted this page load — attached explicitly, since
 * nothing else would; (3) a PIN-verified session token for this order.
 */
export function orderAuthHeaders(token) {
  if (axios.defaults.headers.common["Authorization"]) return {}
  const adminToken = localStorage.getItem(ADMIN_TOKEN_KEY)
  if (adminToken) return { Authorization: `Bearer ${adminToken}` }
  const sessionToken = getOrderSessionToken(token)
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}
}
