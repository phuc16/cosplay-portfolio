# Tech Stack

## Frontend (`frontend/`)
- React 19 + Vite 7, React Router 7, Axios, react-dropzone
- Tailwind CSS 3 (`darkMode: "class"`) + PostCSS + autoprefixer; ESLint 9 (flat config)
- Design tokens live in `src/index.css` as CSS variables (light `:root` + `.dark` overrides). The public site (`src/pages/Portfolio.jsx`) is **inline-style + CSS-var driven** (faithful reproduction of the design standalone).
- Commands (run in `frontend/`): `npm run dev` (Vite :5173), `npm run build` (→ `dist/`), `npm run preview`, `npm run lint`.
- `public/refassets/` holds placeholder + brand assets (hero placeholders, `gank.png`) served at `/refassets/*`.

## Backend (`backend/`)
- Node/Express 5, all routes in `server.js`. Background thumbnail worker in `worker.js`.
- MySQL via `mysql2` (raw `db.query` with `?` placeholders — NOT knex query builder at runtime; knex only for migrations). Redis via `ioredis`. MinIO/S3 via `@aws-sdk/client-s3` (`storage.js`).
- Image processing: `sharp` (resize ≤1920px; PNG when `meta.hasAlpha` else JPEG q85 — preserves transparency).
- Auth: JWT (`jsonwebtoken`), `auth.js` middleware. Rate limiting: `express-rate-limit` + `rate-limit-redis`.
- Commands (run in `backend/`): `npm run migrate` (knex migrate:latest), `npm run seed`, `npm run rollback`, `node server.js` (:5000), `node worker.js`.

## Data model
- `site_settings.config` — single JSON blob holding ALL site content (colorScheme, artistName/tagline/about `{vi,en}`, heroImages[], heroAccents[]`{mode,color}`, heroCover, footerChar, achievements[]`{title,description}` (bilingual), upcomingEvents[]`{title,date,url,showPopup,imageUrl}` (bilingual), contact{phone,email,social[],supports{gumroad,gank,paypal}}). New fields = new JSON keys, no migration.
- `albums`, `images` tables (id, url, thumb_url, width, height, sort_order). Migrations in `backend/migrations/`.

## API (prefix `/api`)
- `GET /api/settings` → `{...config}` (Redis-cached key `settings`, 1h). `PUT /api/settings` (auth) → `sanitizeSettings` allowlist.
- `GET /api/gallery` → `[{id, group, description, items:[{id, src, fullSrc, width, height}]}]` (Redis-cached key `gallery`).
- `POST /api/login` → JWT. Album/image CRUD + reorder (auth).
- Uploads (auth, base64 body, ≤50mb): `/api/upload/hero`, `/api/upload/thumbnail` (both return `{url, accentColor}`), `/api/upload/event-image`, `/api/image`. Storage proxy: `GET /api/storage/:path` (sets `Access-Control-Allow-Origin: *`).

## Local dev / deploy (Docker)
- `docker compose up -d --build` — full stack. Services: mysql:8, redis:7-alpine, minio, backend (`phuc16/cosplay-backend`), worker (same image), frontend (`phuc16/cosplay-frontend`).
- Frontend published on host **:5173** (nginx serves SPA, proxies `/api` → backend). Redeploy one service: `docker compose up -d --build frontend`.
- `docker exec cosplay-portfolio-redis-1 redis-cli del settings gallery` — clear caches after direct DB edits.
- Headless screenshot for verification: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --screenshot=... --window-size=W,H http://localhost:5173/`.

## Env vars
`DB_HOST/DB_USER/DB_PASS/DB_NAME`, `REDIS_HOST`, `MINIO_ENDPOINT/MINIO_PORT/MINIO_ACCESS_KEY/MINIO_SECRET_KEY/MINIO_BUCKET`, `JWT_SECRET`, `ADMIN_USERNAME/ADMIN_PASSWORD`. Defaults in `docker-compose.yml` (admin/admin, cosplay DB, minioadmin).
