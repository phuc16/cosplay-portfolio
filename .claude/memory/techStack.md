# Tech Stack

## Frontend (`frontend/`)
- React 19 + Vite 7, React Router 7, Axios, react-dropzone
- Tailwind CSS 3 (`darkMode: "class"`) + PostCSS + autoprefixer; ESLint 9 (flat config)
- Design tokens live in `src/index.css` as CSS variables (light `:root` + `.dark` overrides). The public site (`src/pages/Portfolio.jsx`) is **inline-style + CSS-var driven** (faithful reproduction of the design standalone).
- Commands (run in `frontend/`): `npm run dev` (Vite :5173), `npm run build` (→ `dist/`), `npm run preview`, `npm run lint`.
- `public/refassets/` holds ONLY real brand assets (`gank.png`, `zalo.png`) served at `/refassets/*` - placeholder SVGs deleted; frontend `SITE_CONFIG` is an empty skeleton (all content backend-driven, spinner while loading).

## Backend (`backend/`)
- Node/Express 5, all routes in `server.js`. Background thumbnail worker in `worker.js`.
- MySQL via `mysql2` (raw `db.query` with `?` placeholders - NOT knex query builder at runtime; knex only for migrations). Redis via `ioredis`. MinIO/S3 via `@aws-sdk/client-s3` (`storage.js`).
- Image processing: `sharp` (resize ≤1920px; always WebP q82, thumbnails WebP q80 - preserves transparency, ~10-15× smaller than PNG).
- Request logs: one structured JSON line per request (underscore fields: method, path, status, ip, latency, bytes_in/out, user_agent, referer). Login compare uses sha256 + `crypto.timingSafeEqual`.
- Auth: JWT (`jsonwebtoken`), `auth.js` middleware. Rate limiting: `express-rate-limit` + `rate-limit-redis`.
- Commands (run in `backend/`): `npm run migrate` (knex migrate:latest), `npm run seed`, `npm run rollback`, `node server.js` (:5000), `node worker.js`.

## Data model
- `site_settings.config` - single JSON blob holding ALL site content (colorScheme, artistName/tagline/about `{vi,en}`, heroImages[], heroAccents[]`{mode,color}`, heroCovers[]`{desktop?,tablet?,mobile?}` each `{zoom,x,y}` (backdrop framing; legacy flat = desktop; hero backdrop = current slide image, no separate cover upload), latestPhotos[], footerChar, achievements[] (bilingual), upcomingEvents[]`{title,date,url,showPopup,imageUrl}` (bilingual), contact{phone(hidden, feeds Zalo),email,contactLinks[],social[],supports{gumroad,gank,paypal}}). New fields = new JSON keys, no migration.
- `albums`, `images` tables (id, url, thumb_url, width, height, sort_order). Migrations in `backend/migrations/`.

## API (prefix `/api`)
- `GET /api/settings` → `{...config}` (Redis-cached key `settings`, 1h). `PUT /api/settings` (auth) → `sanitizeSettings` allowlist.
- `GET /api/favicon.png` → 64×64 PNG from logo (sharp; Redis key `favicon_png` 1h; max-age=300; `.png` suffix → Cloudflare edge cache). Declared in index.html `<link rel="icon">`.
- `GET /api/gallery` → `[{id, group, description, items:[{id, src, fullSrc, width, height}]}]` (Redis-cached key `gallery`).
- `POST /api/login` → JWT. Album/image CRUD + reorder (auth).
- Uploads (auth, base64 body, ≤50mb): `/api/upload/hero`, `/api/upload/thumbnail` (both return `{url, accentColor}`), `/api/upload/event-image`, `/api/image`. Storage proxy: `GET /api/storage/:path` (sets `Access-Control-Allow-Origin: *`).

## Local dev / deploy (Docker)
- `docker compose up -d --build` - full stack. Services: mysql:8, redis:7-alpine, minio, backend (`phuc16/cosplay-backend`), worker (same image), frontend (`phuc16/cosplay-frontend`).
- Frontend published on host **:5173** (nginx serves SPA, proxies `/api` → backend; nginx.conf ships security headers incl. CSP/HSTS). Redeploy one service: `docker compose up -d --build frontend`.
- Dev compose binds MySQL/Redis/MinIO/backend to **127.0.0.1** only; all services have log rotation (json-file 10m×3) + `restart: unless-stopped`. NOTE: local `up` may fail binding :6379 (another Docker project holds it) - irrelevant for code changes.
- **Prod = `docker-compose.pull.yml`**: no public ports except frontend `127.0.0.1:5173`; `.env` secrets required (`:?`); `up -d --force-recreate` after compose config changes.
- **Cloudflare (free) fronts kamidayhehe.com**: proxied A records, Full (strict), Always Use HTTPS, CDN caches `/api/storage/*` by extension (verify: `cf-cache-status: HIT`).
- `docker exec cosplay-portfolio-redis-1 redis-cli del settings gallery` - clear caches after direct DB edits.
- Headless screenshot for verification: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --screenshot=... --window-size=W,H http://localhost:5173/`.

## Env vars
`DB_HOST/DB_USER/DB_PASS/DB_NAME`, `REDIS_HOST`, `MINIO_ENDPOINT/MINIO_PORT/MINIO_ACCESS_KEY/MINIO_SECRET_KEY/MINIO_BUCKET`, `JWT_SECRET`, `ADMIN_USERNAME/ADMIN_PASSWORD`. Defaults in `docker-compose.yml` (admin/admin, cosplay DB, minioadmin).
