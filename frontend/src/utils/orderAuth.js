import axios from "axios"

const SESSION_KEY_PREFIX = "order_access:"

// Must match pages/Admin.jsx's own TOKEN_KEY — duplicated to avoid a circular import.
const ADMIN_TOKEN_KEY = "admin_token"
// Must match pages/Admin.jsx's own REFRESH_KEY, same reason.
const ADMIN_REFRESH_KEY = "admin_refresh_token"

/**
 * Redeem a stale admin_token via admin_refresh_token, mirroring Admin.jsx's
 * own refresh interceptor (which only runs while Admin.jsx is mounted).
 * Returns true if a fresh admin_token was obtained and stored.
 */
export async function refreshAdminSession() {
  const refreshToken = localStorage.getItem(ADMIN_REFRESH_KEY)
  if (!refreshToken) return false
  try {
    const { data } = await axios.post("/api/refresh", { refresh_token: refreshToken })
    localStorage.setItem(ADMIN_TOKEN_KEY, data.token)
    if (data.refresh_token) localStorage.setItem(ADMIN_REFRESH_KEY, data.refresh_token)
    return true
  } catch {
    localStorage.removeItem(ADMIN_REFRESH_KEY)
    return false
  }
}

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
