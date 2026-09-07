# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Two products sharing one backend/frontend/infra: a cosplay portfolio (albums/images gallery) and a merch shop (collections/products/variants → cart → checkout → orders → shipping/pickup → email). React frontend, Node.js/Express backend, background worker, MySQL (Knex migrations, no ORM), Redis, MinIO object storage.

## Commands

### Full stack (Docker)
```bash
docker compose up -d          # Start all services
docker compose up -d --build  # Rebuild and start
docker compose logs -f backend
```
Local dev exposes MySQL on `127.0.0.1:3307` and Redis on `127.0.0.1:6380` (remapped off the standard ports to avoid colliding with other local projects) - use `DB_PORT=3307` / `REDIS_PORT=6380` when running things outside Docker.

### Backend (local)
```bash
cd backend
npm install
npm run migrate               # Run Knex migrations (needed after pulling new migrations)
npm run rollback               # Roll back the last migration batch
node server.js                 # API server on :5000
node worker.js                 # Background worker (separate terminal) - thumbnails, order-expiry sweep, email queue
```

### Backend tests
```bash
cd backend
npm test                       # Full suite (vitest run) against DB_NAME=cosplay_test
npm run test:watch             # Watch mode
npx vitest run tests/orderRepo.test.js              # Single file
npx vitest run tests/orderRepo.test.js -t "keeps"   # Single test by name
```
`npm test`/`test:watch` already set `DB_NAME`, `JWT_SECRET`, `REDIS_DB=15`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`. Running vitest directly (not through those scripts) needs `DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root DB_NAME=cosplay_test JWT_SECRET=test-secret REDIS_DB=15 REDIS_HOST=127.0.0.1 REDIS_PORT=6380 ADMIN_USERNAME=test-admin ADMIN_PASSWORD=test-admin-pass` (or the matching values from your `docker-compose.yml`/env) set explicitly, and the `cosplay_test` database/migrations already in place.

Tests hit a real MySQL + Redis (`tests/globalSetup.js`, `tests/helpers/db.js`'s `resetTables()`), not mocks - don't run the suite with other processes hitting the same `cosplay_test` DB/Redis DB 15 concurrently; concurrent runs produce deadlock-shaped false failures.

### Frontend (local)
```bash
cd frontend
npm install
npm run dev                   # Vite dev server on :5173
npm run build                 # Production build → dist/
npm run lint                  # ESLint
npm test                      # vitest run
npx vitest run src/pages/Faq.test.jsx   # Single file
```

## Architecture

```
Frontend (React/Vite :5173)
    ↓ axios /api/*
Backend (Express :5000)
    ├── MySQL  - portfolio (albums, images, site_settings) + shop (collections, products,
    │            product_variants, orders, order_items, payment_settings, email_templates,
    │            email_queue)
    ├── Redis  - gallery/settings cache (1h TTL), rate-limit counters, login/PIN lockout
    │            counters, worker singleton lease
    └── MinIO  - portfolio images + shop product/variant images, proxied through the backend

Worker (node worker.js)  - single setInterval loop, guarded by an in-process flag against
                            overlap and a Redis-backed lease (workerLease.js) against a second
                            OS process running concurrently. Each tick: generates portfolio
                            thumbnails, sweeps expired unpaid orders (releases their stock),
                            sends queued transactional emails.
```

**Route mounting** (`backend/server.js`): portfolio routes are inline in `server.js`; the shop is split into per-concern router modules mounted at `/api/shop` (public storefront, `publicLimiter`), `/api/orders` (public order creation/lookup, its own per-action rate limiters - creation, proof upload, generic read - since a buyer retrying a proof upload must not burn the order-creation budget or vice versa), and `/api/admin/*` (`adminCatalog`, `adminOrders`, `adminPayments`, `adminEmail`, `adminStats`, `adminShipping`, all behind the `auth` JWT middleware). `backend/shop/` holds the domain logic these routers call into (`catalogRepo.js`, `orders/`, `payments/`, `shipping/`, `stats/`, `email/`) - routers stay thin, business rules live in `shop/`.

**Auth has two independent schemes**, both HS256 JWTs signed with `JWT_SECRET`:
- **Admin**: `POST /api/login` (creds from `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars - the server refuses to boot if either is unset, no default fallback). Access token ~1 day, refresh token 30 days (`POST /api/refresh`). 5 failed logins locks that IP 15 min via Redis.
- **Buyer order access** (`shop/orders/orderAccess.js`): a buyer is auto-verified in the browser tab that just placed the order (seeded via `sessionStorage`); reopening the order link elsewhere requires the 6-digit PIN emailed at checkout (`POST /api/orders/:token/verify-pin`), which issues a JWT scoped to that one `order_token`. 5 wrong PIN attempts locks *that order* (not the IP) for 15 min, keyed by `order_token` in Redis - a deliberately different lockout axis from the admin login lockout.

**Shop order lifecycle**: `pending` → `confirmed` → `shipped`/`completed`, or → `cancelled` at various points. `orders/domain.js` holds the state machine and pure helpers (deadline math, pickup/access-pin/order-code generation); `orders/orderRepo.js` does the DB work, always via `transitionOrder()` for status changes (never a bare `UPDATE orders SET status=`) so every transition can assert its expected `fromStatus` under a row lock - this is what makes the background expiry sweep race-safe against an admin confirming an order in the same instant. `LIVE_ORDER_STATUSES` (`pending`/`confirmed`/`shipped`) gates whether a product/collection/variant can be deleted - live orders block deletion (`VariantInUseError`, 409); `completed`/`cancelled` orders don't.

**Snapshotting**: everything a placed order needs to stay historically accurate - `product_name_snapshot`, `variant_label_snapshot`, `unit_price_snapshot`, `delivery_link_snapshot`, `image_url_snapshot` on `order_items` - is captured once at `createOrder` time and never re-derived from the live catalog. Read paths (`attachItems`, the admin shipping roster) prefer the snapshot and fall back to a live `LEFT JOIN` to the variant/product only for the rare pre-snapshot legacy row.

**Digital products**: `products.type = 'digital'` carries a `delivery_link` on its (single, hidden) variant. COD is rejected for any cart containing a digital item; `fulfillment_method` auto-resolves to `'digital'`. The public collection API strips `delivery_link` unconditionally (only the admin catalog path and a paid order's own snapshot ever expose it), and the link only renders once an order's status is `confirmed`/`completed`.

**Collection scheduling**: `collections.start_at`/`end_at` gate visibility and orderability. Enforcement happens in two places that must stay in sync: catalog read paths lazily flip `status: 'active' → 'closed'` once `end_at` passes (`closeExpiredCollections`, write-through-on-read, no cron), and `createOrder` independently re-checks both `start_at` and `end_at` under the same row lock as the stock check - a stale cart/variant_id must never bypass either boundary. All date math in the DB layer goes through `UTC_TIMESTAMP()`/`.toISOString()`, never `NOW()` or a naive Date string - `db.js` pins the pool's session `timezone: "Z"`, so anything that skips this convention silently drifts against the browser's local time.

**Caching**: `GET /api/gallery` and `GET /api/settings` (portfolio) are Redis-cached, 1h TTL, degrading gracefully to a DB read on a Redis outage. Any write to albums/images/settings calls `redis.del("gallery")`/`redis.del("settings")`. Shop catalog reads are cache-invalidated on stock/catalog changes the same way.

**Image upload flow**: Frontend → base64 POST → `validateImageBuffer` (magic-byte check, rejects non-images before they ever reach sharp) → sharp (resize, re-encode, auto-rotate EXIF) → MinIO → MySQL row → relevant cache invalidated. Portfolio images additionally get a worker-generated 400px WebP thumbnail (`thumb_url IS NULL` polling).

**Storage proxy**: `GET /api/storage/:path` proxies MinIO files through the backend - no direct public MinIO exposure.

**Frontend axios gotcha**: `frontend/src/api/api.js`'s `api` instance is created once via `axios.create()`, which *snapshots* `axios.defaults` at creation time - later mutations to `axios.defaults.headers.common.Authorization` (how `Admin.jsx` sets/clears the admin JWT on login/logout) never reach that snapshot on their own. A request interceptor re-reads the global default per-request to route around this; don't remove it or admin-authenticated calls silently go out unauthenticated.

**i18n**: bilingual copy lives as `{ vi, en }` objects (see `frontend/src/shop/faq.js`, `frontend/src/i18n/translations.js`), read via `LanguageContext`'s `t()` or `utils/localize.js`'s `getLocalized()`. No backend-editable content table for this - editing the source file is the intended workflow.

## Key Files

| File | Purpose |
|---|---|
| `backend/server.js` | Portfolio routes inline; mounts all shop/admin routers; global middleware (helmet, CORS allowlist, rate limiters) |
| `backend/worker.js` | Background loop: portfolio thumbnails, order-expiry sweep, email queue drain |
| `backend/workerLease.js` | Redis-backed singleton lease so only one worker process's ticks run |
| `backend/auth.js` | Admin JWT middleware |
| `backend/shop/orders/orderAccess.js` | Buyer order-page PIN/JWT gate |
| `backend/shop/orders/domain.js` | Order state machine + pure helpers (no DB access) |
| `backend/shop/orders/orderRepo.js` | Order DB layer - `createOrder`, `transitionOrder`, `attachItems` |
| `backend/shop/catalogRepo.js` | Collections/products/variants DB layer, including delete-guard logic |
| `backend/storage.js` | MinIO client wrapper |
| `backend/redis.js` | ioredis client |
| `backend/db.js` | mysql2 pool, pinned to UTC session timezone |
| `backend/migrations/` | Knex migrations, sequential, never edited after landing |
| `frontend/src/api/api.js` | Shared axios instance (admin-authenticated) |
| `frontend/src/shop/cart.js` | localStorage cart state |
| `frontend/src/shop/cartAvailability.js` | Cart/checkout early sold-out/closed/not-started/ended validation |
| `docker-compose.yml` | Local dev with build |
| `docker-compose.pull.yml` | Production (pulls pre-built images) |
| `backend/entrypoint.sh` | Docker entrypoint: waits for MySQL, runs migrations, starts server |
| `docs/EDGE_CASE_CHECKLIST.md` | Coverage record of edge cases already found/fixed - read before assuming something is unhandled |
| `docs/DECISIONS.md` | Product/business decision log |

## Environment Variables

```env
DB_HOST / DB_PORT / DB_USER / DB_PASS / DB_NAME
REDIS_HOST / REDIS_PORT / REDIS_DB
MINIO_ENDPOINT / MINIO_PORT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY / MINIO_BUCKET
JWT_SECRET
ADMIN_USERNAME / ADMIN_PASSWORD   # required - server exits at boot if either is unset
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM
SITE_URL                          # also drives the CORS allowlist
SHOP_NAME
ADMIN_EMAIL
```

## Deployment

Production targets DigitalOcean (Ubuntu 22.04). See `deploy/DEPLOY.md`. Images are pushed to Docker Hub (`phuc16/cosplay-backend`, `phuc16/cosplay-frontend`) via `scripts/build-push.sh <tag>` (uses `docker buildx build --platform linux/amd64` - a plain `docker build` on an Apple Silicon host produces a manifest the DO VPS can't pull) and pulled on the server via `docker-compose.pull.yml`. Host Nginx handles SSL termination and proxies to the frontend container, which in turn proxies `/api` to the backend container.
