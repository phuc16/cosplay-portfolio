# Backend & integration notes — `cosplay-portfolio/` (Express + knex + MinIO)

This complements the API contract in `README.md`. It reflects the ACTUAL repo conventions.

## Settings = one JSON blob
- Table `site_settings` has a `config` column (JSON). ALL site content lives here.
- `GET /api/settings` → `{ config: {...} }`. `PUT /api/settings` writes the whole `config`.
- **Adding a field (e.g. `heroCover`) requires NO migration** — just add the key to the JSON and
  render/read it. Only create a knex migration when you need a real new TABLE or COLUMN
  (as `albums`/`images` already are).

## Existing endpoints (reuse — do not recreate)
- `POST /api/upload/hero` — hero slideshow images.
- `POST /api/upload/event-image` — event popup image (`upcomingEvents[].imageUrl`).
- `POST /api/upload/thumbnail` — album/gallery thumbnails.
- Album/image CRUD + reorder (drives the admin Albums tab).
- `GET /api/gallery` — albums + items, Redis-cached. Feeds the public gallery AND the
  "latest photos" grid (flatten items). Invalidate the cache on album/image mutations.
- Auth: JWT (`JWT_SECRET` env). Admin routes are protected; login issues the token.

## Cover image (`config.heroCover`)
- No dedicated endpoint needed: upload via the hero/generic image upload, then store the returned
  URL string in `config.heroCover`. Empty string / null = no cover (hero shows accent gradient only).

## Event popup image (`upcomingEvents[].imageUrl`)
- Already exists in the repo (`AdminSettings.jsx EventImageUpload`, `Portfolio.jsx` renders
  `eventPopup.event.imageUrl`). Keep it; ensure the image renders ONLY in the popup, not the list.

## Hero accent color
- Prototype extracts a dominant color client-side per hero image. **Preferred production path:**
  compute once on upload (or server-side) and store `heroImages[i].accentColor` so the client
  skips canvas work. Fallback color `rgb(100,60,180)`.

## Assets / MinIO
- Uploaded images are served from MinIO. Reference stored URLs in `config` (hero, cover, logo,
  event images, footerChar) and in album/image rows.

## Storage / persistence recap
- Public content + settings: `site_settings.config` (JSON) via `/api/settings`.
- Albums/images: dedicated tables via album/image CRUD.
- Color scheme: `config.colorScheme` (persist on change; apply on load).
- Client-only/session state (do NOT persist server-side): theme toggle, language toggle,
  lightbox open state, footer-character dismiss, event-popup "seen" flag
  (`sessionStorage('eventPopup_<index>')`).
