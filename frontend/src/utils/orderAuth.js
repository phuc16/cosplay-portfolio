import axios from "axios"

const SESSION_KEY_PREFIX = "order_access:"

// Storing this against admin_token (rather than an ADMIN_TOKEN_KEY constant
// imported from Admin.jsx) would create a circular import between the admin
// panel and the public order page — axios.defaults.headers.common is the
// same shared state Admin.jsx already writes on login, so reading it here
// gets the same answer without the import.
export function hasAdminSession() {
  return Boolean(axios.defaults.headers.common["Authorization"])
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
 * Auth header for a gated /api/orders/:token/* call. An admin logged into
 * this same browser already gets their token attached automatically (the
 * shared axios instance's request interceptor re-reads
 * axios.defaults.headers.common on every call — see api/api.js), so this
 * only needs to supply the PIN-verified session token, and only when no
 * admin session would otherwise take priority.
 */
export function orderAuthHeaders(token) {
  if (hasAdminSession()) return {}
  const sessionToken = getOrderSessionToken(token)
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}
}
