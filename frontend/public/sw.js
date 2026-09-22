// Minimal, hand-written service worker for installability + a faster
// repeat-visit shell. No build plugin, no offline-first ambitions - see
// docs/superpowers/specs/2026-09-22-pwa-installability-design.md.
//
// IMPORTANT: never cache anything under /api/ - admin auth, buyer order
// status, live stock levels, and the whole order lifecycle flow through
// /api/*, and serving a stale cached response here would be a real
// correctness bug (see docs/EDGE_CASE_CHECKLIST.md's Redis-cache-
// invalidation entries for the general shape of this danger class).
// /api/ requests always pass straight through to the network.

const CACHE_VERSION = "v1"
const CACHE_NAME = `app-shell-${CACHE_VERSION}`

// Mirrored in frontend/src/pwa/swUrlMatch.js, which is what's actually
// unit-tested (this file has no test runner access to self/caches/fetch).
// Keep both copies in sync if this rule ever changes.
function isApiRequest(url) {
  return new URL(url).pathname.startsWith("/api/")
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add("/"))
      .catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return
  if (isApiRequest(request.url)) return // never intercept /api/ - always network, no cache

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => cached)
    })
  )
})
