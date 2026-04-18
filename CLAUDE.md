# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cosplay portfolio website with a React frontend, Node.js/Express backend, background thumbnail worker, MySQL database, Redis cache, and MinIO object storage.

## Commands

### Full stack (Docker)
```bash
docker compose up -d          # Start all services
docker compose up -d --build  # Rebuild and start
docker compose logs -f backend
```

### Backend (local)
```bash
cd backend
npm install
npm run migrate               # Run Knex DB migrations
node server.js                # API server on :5000
node worker.js                # Thumbnail worker (separate terminal)
```

### Frontend (local)
```bash
cd frontend
npm install
npm run dev                   # Vite dev server on :5173
npm run build                 # Production build → dist/
npm run lint                  # ESLint
```

## Architecture

```
Frontend (React/Vite :5173)
    ↓ axios /api/*
Backend (Express :5000)
    ├── MySQL  — albums, images, site_settings
    ├── Redis  — gallery cache (1h TTL), settings cache (1h TTL), rate-limit counters
    └── MinIO  — original images (images/{album_id}/*.jpg) + thumbnails (thumbs/{album_id}/*.jpg)

Worker (node worker.js)  — polls every 5s for images with thumb_url IS NULL, generates 400px thumbnails
```

**Image upload flow:** Frontend → Base64 POST → Backend sharp (resize ≤1920px, JPEG 85%, auto-rotate EXIF) → MinIO → MySQL row → invalidate Redis "gallery" key → Worker picks up → uploads thumbnail → updates `thumb_url`.

**Gallery cache:** `GET /api/gallery` and `GET /api/settings` are Redis-cached. Any write to albums/images/settings calls `redis.del("gallery")` or `redis.del("settings")`.

**Auth:** JWT signed with `JWT_SECRET`. Login is `POST /api/login` with credentials from env vars. Brute-force: 5 failures → IP locked 15 min via Redis. Rate limiting on public routes via `express-rate-limit` + `rate-limit-redis`.

**Storage proxy:** `GET /api/storage/:path` proxies MinIO files through the backend (no direct public MinIO exposure).

## Key Files

| File | Purpose |
|---|---|
| `backend/server.js` | All API routes + middleware |
| `backend/worker.js` | Thumbnail generation loop |
| `backend/auth.js` | JWT middleware |
| `backend/storage.js` | MinIO client wrapper |
| `backend/redis.js` | ioredis client |
| `backend/migrations/` | Knex SQL migrations |
| `frontend/src/api/api.js` | Axios instance + all API calls |
| `frontend/src/config.js` | API base URL config |
| `docker-compose.yml` | Local dev with build |
| `docker-compose.pull.yml` | Production (pulls pre-built images) |
| `backend/entrypoint.sh` | Docker entrypoint: waits for MySQL, runs migrations, starts server |

## Environment Variables

```env
DB_HOST / DB_USER / DB_PASS / DB_NAME
REDIS_HOST
MINIO_ENDPOINT / MINIO_PORT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY / MINIO_BUCKET
JWT_SECRET
ADMIN_USERNAME / ADMIN_PASSWORD
```

## Database Schema

- `albums` — id, title, description, sort_order, created_at
- `images` — id, album_id, url, thumb_url, width, height, sort_order, created_at
- `site_settings` — id, config (JSON blob), updated_at

## Deployment

Production targets DigitalOcean (Ubuntu 22.04). See `deploy/DEPLOY.md`. Images are pushed to Docker Hub (`phuc16/cosplay-backend`, `phuc16/cosplay-frontend`) and pulled on the server via `docker-compose.pull.yml`. Host Nginx handles SSL termination and proxies to the frontend container, which in turn proxies `/api` to the backend container.
