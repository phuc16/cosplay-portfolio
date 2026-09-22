// Pure /api/ matching logic. Mirrored (not imported - public/sw.js is
// served as a static file outside Vite's bundler, so it cannot import from
// src/) inline in frontend/public/sw.js's fetch handler. If this rule ever
// changes, update both copies.
export function isApiRequest(url) {
  return new URL(url).pathname.startsWith("/api/")
}
