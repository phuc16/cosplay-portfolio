# PWA Installability (Web App Manifest + Minimal Service Worker) — Design

## Trend angle

**Tech trend** - installable web apps (Add to Home Screen, standalone
launch, no browser chrome) are now a baseline expectation for a modern
web app, not a novelty. This is a merch shop a buyer plausibly reopens
several times during a drop window (checking stock, checking their order
status) plus a portfolio a returning fan bookmarks - installability and a
faster repeat-visit shell cost little here and are a direct, current
best-practice checkbox (Chrome/Edge/Android's install prompts, iOS Safari's
"Add to Home Screen") this site doesn't yet meet.

## Duplicate-work check performed

Before any design work: checked all 12 open PRs (`#7`-`#21`) via
`list_pull_requests` - none mention manifest/PWA/installability/service
worker. Independently ran `git grep -il "manifest.webmanifest|serviceWorker|
service-worker" origin/main -- frontend` and `git ls-tree -r origin/main
--name-only | grep -iE "manifest|service-?worker|sw\.js"` directly against
the fetched `origin/main` tree - both empty. No existing coverage found.

## Scope (small, no new dependency, hand-written service worker)

1. `frontend/public/manifest.webmanifest` - static JSON, `name`,
   `short_name`, `start_url: "/"`, `display: "standalone"`, `theme_color`,
   `background_color`, `icons` (192x192 + 512x512).
2. `frontend/index.html` gains a `<link rel="manifest">` and a
   `<meta name="theme-color">` - the Vite entry HTML, not a component (a
   manifest `<link>` injected client-side via React would arrive too late
   for a browser's very first installability check on that first paint).
3. `frontend/public/sw.js` - hand-written, no Workbox/PWA build plugin.
   Registered from `frontend/src/main.jsx`, gated on
   `"serviceWorker" in navigator && import.meta.env.PROD` so it can never
   run under `vite dev`/HMR.
4. No offline fallback page, no background sync, no push - explicitly out
   of scope per the brief.

## Icon asset decision

The task brief expected an existing static logo/favicon file under
`frontend/public/` or `frontend/src/assets/` to reuse. Checked both
directories directly rather than assuming:

- `frontend/public/`: `gank.png` (289x216) and `refassets/{gank,zalo}.png`
  are contact-platform badges used by `Portfolio.jsx`'s social-links row
  (Gank, Zalo) - not the site's own brand mark. `vite.svg` is the unused
  default Vite scaffold logo.
- `frontend/src/assets/`: `react.svg` (unused Vite scaffold asset),
  `vietqr-logo.svg` (a payment-provider logo used on the checkout QR
  block) - neither is the site's brand logo either.

There is **no static site-logo file checked into the repo**. The site's
actual logo is entirely admin-configurable at runtime
(`site_settings.config.logoUrl`, uploaded through `AdminSettings.jsx` to
MinIO, default `""`) and is only ever available as a rendered PNG via the
existing `GET /api/favicon.png` route (`backend/server.js`), which is
*already* what `index.html`'s `<link rel="icon">` points at today.

Decision: reuse `/api/favicon.png` as the manifest's icon `src` for both
the 192x192 and 512x512 entries. This satisfies "reuse an existing
favicon asset already in the repo, invent no new artwork" in the most
literal available sense - it's the same asset already wired into the app
shell as the favicon - without inventing a new image-processing/upload
pipeline just for app icons, which is explicitly out of scope.

**Known limitations of this choice** (accepted, not fixed here):
- The route hard-resizes to a single 64x64 PNG regardless of what size is
  requested; both the 192 and 512 manifest entries point at that same
  64x64 image. Per the brief's own allowance, browsers tolerate a
  dimension mismatch between a declared `sizes` value and the actual
  image - the install icon will just look softer/upscaled than a
  purpose-made 512x512 asset would.
- If no admin has ever uploaded a logo (`logoUrl` empty and no hero
  images configured), `/api/favicon.png` returns `204 No Content` and the
  manifest icon fails to load; browsers fall back to a generic
  placeholder icon for the install prompt rather than failing
  installability outright. This resolves itself the moment an admin
  uploads a logo in Settings - no code change needed.
- `theme_color`/`background_color` are a static hardcoded hex in a static
  JSON file (`#6BBF59`, confirmed against `frontend/src/index.css`'s
  current `--brand` value, not assumed from CLAUDE.md's number). Unlike
  `--brand`, which is admin-configurable via site settings, the manifest
  cannot pick up a future brand-color change without a code edit and
  redeploy. Templating the manifest from live settings would need a
  server-rendered route instead of a static `public/` file - explicitly
  out of scope (YAGNI) for this feature.

## Service worker design

Cache-first for static GETs, network passthrough (no caching, no offline
fallback) for anything under `/api/`, versioned cache name cleaned up on
`activate`:

- `install`: opens `app-shell-{VERSION}` and best-effort precaches `/`
  (not the hashed JS/CSS bundle filenames - Vite's hashed output names
  aren't known at write-time for a hand-written `public/sw.js`, and
  enumerating them would mean parsing the build manifest into a
  generated service worker, i.e. reaching for a build plugin, which is
  explicitly out of scope). `.catch(() => {})` - a failed precache must
  not block install.
- `fetch`: for any GET request, `/api/` paths are returned to `return`
  immediately (never intercepted - straight to network, no cache read or
  write, no offline fallback). This is the load-bearing rule: this app's
  entire admin auth flow, buyer order status, live stock levels, and
  order lifecycle all flow through `/api/*`, and this codebase has
  existing hard-won lessons about the danger class of serving stale data
  from a cache instead of the network (`docs/EDGE_CASE_CHECKLIST.md`'s
  Redis-cache-invalidation-on-write entries are the same shape of bug,
  one layer down the stack). For everything else, cache-first with a
  network fallback that opportunistically stores a successful response
  for next time ("runtime cache-as-you-go" rather than enumerating
  hashed build filenames up front).
- `activate`: deletes any cache whose name isn't the current
  `CACHE_NAME`, so a redeploy (which bumps `CACHE_VERSION`) doesn't leave
  a prior deploy's assets served forever; also calls `self.clients.claim()`
  so an already-open tab starts being controlled without a reload.
- `self.skipWaiting()` on install, so a new service worker activates on
  the next load rather than waiting for every open tab to close first -
  acceptable here since there's no offline-critical state to preserve
  across the swap, matching the brief's "favor simplicity" guidance.

The `/api/` matching logic (`isApiRequest(url)` - checks
`new URL(url).pathname.startsWith("/api/")`) is written twice on purpose:
once inline in `frontend/public/sw.js` (a static file served as-is from
`public/`, outside Vite's bundler, so it cannot `import` from `src/`), and
once as a small pure exported function in `frontend/src/pwa/swUrlMatch.js`
that exists solely so this one piece of logic has real automated test
coverage. A comment in each file points at the other; if this rule ever
changes, both copies need the same edit.

## Testing approach and limitations

`jsdom` (this codebase's frontend test environment, `vitest.config.js`) does
not run a real service worker, does not perform a real manifest
fetch/installability audit, and has no `self`/`caches`/`ServiceWorkerRegistration`
globals. What actually gets automated coverage:

- `frontend/src/pwa/manifest.test.js`: reads
  `frontend/public/manifest.webmanifest` off disk (same
  `readFileSync`/`fileURLToPath` pattern as
  `frontend/src/utils/semanticTokens.test.js`, which already reads
  `index.css` the same way), `JSON.parse`s it, and asserts `name`,
  `short_name`, `start_url`, `display: "standalone"`, `theme_color`,
  `background_color`, and an `icons` array containing at least one
  `192x192` and one `512x512` entry.
- `frontend/src/pwa/indexHtml.test.js`: reads `frontend/index.html` off
  disk and asserts it contains a `<link rel="manifest"
  href="/manifest.webmanifest">` tag and a `<meta name="theme-color"
  content="...">` tag.
- `frontend/src/pwa/swUrlMatch.test.js`: unit-tests the standalone
  `isApiRequest()` helper directly (no service-worker globals involved)
  against `/api/...` paths (true), non-`/api/` paths (false), and a
  full absolute URL as `fetch`/`Request.url` would actually pass it.

**Explicitly NOT verified by this automated suite** (needs a real browser,
called out again in the PR's Test plan): an actual Lighthouse PWA/
installability audit, an actual "Add to Home Screen"/install-prompt flow,
whether `sw.js` actually registers and activates in a real browser, and
actual offline/repeat-visit caching behavior. This sandbox has no headless
Chrome/Lighthouse tooling and Docker is unavailable here, so none of that
can be exercised now.

## Out of scope (explicitly deferred)

- Any offline fallback page or "you're offline" UI.
- Background sync, push notifications.
- A build-time PWA plugin (`vite-plugin-pwa` or similar) - hand-written
  per the brief, to avoid a new dependency for a deliberately small
  feature.
- A dedicated app-icon upload/resize pipeline (192/512 purpose-built
  PNGs) - deferred; `/api/favicon.png` is reused as-is, limitations
  documented above.
- Templating `manifest.webmanifest`'s colors from live `site_settings`
  (would require serving it as a dynamic route instead of a static
  file) - YAGNI for now, brand color changes rarely.
