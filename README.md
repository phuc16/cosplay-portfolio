# Cosplay Portfolio

**English** | [Tiếng Việt](README.vi.md)

A cosplay portfolio (photo gallery with albums) plus a merch shop (photocards, posters, digital goods, gacha...), sharing one backend and frontend. Live at https://kamidayhehe.com.

## Features

- **Gallery**: grid view, lightbox, albums with sub-albums, watermark on album photos, bilingual (vi/en) site copy
- **Admin**: login, drag-and-drop upload, edit/delete photos, shop management, bilingual admin UI
- **Shop**: Collection (a sale window that can be scheduled to open/close) → Product → Variant, cart, checkout, VietQR/Momo/PayPal/COD payments, delivery or event pickup, digital products (download link delivery), Digital/Physical grouping and filters, shareable product links
- **Gacha**: gacha products with server-side weighted draws (the client never decides the prize), a practice page, and a staff-run booth kiosk for cash sales (see [docs/GACHA_ANTI_CHEAT.md](docs/GACHA_ANTI_CHEAT.md))
- **Gift**: optional free gift for orders above a minimum total
- **Orders**: lifecycle pending → confirmed → shipped/completed (or cancelled), automatic cancellation of unpaid orders past the deadline with stock release, transactional emails (placed/confirmed/shipped/cancelled), order lookup by link + PIN, queue numbers for packing and pickup
- **Shipping**: ViettelPost export/import, event pickup roster with a print-ready PDF export
- **Automatic thumbnails**: a worker generates thumbnails for new photos
- **Redis cache**: caches gallery/settings for faster reads

## Requirements

- **Docker** and **Docker Compose** (recommended)
- Or: **Node.js 20+**, **MySQL 8**, **Redis 7**, **MinIO** (S3-compatible object storage)

---

## Install and run with Docker

### 1. Clone

```bash
git clone https://github.com/phuc16/cosplay-portfolio.git
cd cosplay-portfolio
```

### 2. Create the config file

```bash
cp .env.example .env
```

See `.env.example` for every variable. You must set `ADMIN_USERNAME`/`ADMIN_PASSWORD` and `JWT_SECRET`; the backend refuses to start without `ADMIN_USERNAME`/`ADMIN_PASSWORD`.

### 3. Build and run

```bash
docker compose up -d --build
```

### 4. Open

| Service       | URL                   | Description                |
|---------------|-----------------------|----------------------------|
| Frontend      | http://localhost:5173 | Portfolio + shop           |
| Backend       | http://localhost:5000 | API server                 |
| MySQL         | localhost:3307        | Database (user: root)      |
| Redis         | localhost:6380        | Cache                      |
| MinIO API     | localhost:9000        | Object storage             |
| MinIO Console | localhost:9001        | MinIO management UI        |

---

## Development without Docker

### 1. Start MySQL, Redis, MinIO

```bash
docker compose up -d mysql redis minio
```

### 2. Configure the environment

```bash
cp .env.example .env
```

Edit `.env` for your local setup (MySQL, Redis and MinIO host/port from the table above; use `DB_PORT=3307` and `REDIS_PORT=6380`).

### 3. Backend

```bash
cd backend
npm install
npm run migrate
node server.js
```

Also run the worker (another terminal). It generates thumbnails, cancels expired unpaid orders, and sends queued emails:

```bash
cd backend
node worker.js
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

---

## Usage

### Browse the gallery (visitors)

1. Open http://localhost:5173
2. Browse the photo grid and albums on the home page
3. Click a photo to open the lightbox
4. Close it with the X button or by clicking outside

### Buy merch (shop)

1. Go to `/merchandise` to see the collections on sale
2. Pick a product/variant and add it to the cart (`/cart`)
3. Checkout: enter delivery details, choose delivery or event pickup (if available), choose a payment method
4. After ordering you are taken straight to the order page (`/order/:token`); the link and a verification PIN are also emailed

### Administration

1. Go to http://localhost:5173/admin
2. Log in with the `ADMIN_USERNAME`/`ADMIN_PASSWORD` from `.env`
3. You can then manage: portfolio photos and albums, shop collections/products/variants, gacha prizes, orders, payment settings, gift settings, shop display order, email templates, stats, and shipping import/export

### Change the admin login

Edit `ADMIN_USERNAME`/`ADMIN_PASSWORD` in `.env` and restart the backend. There is no `admins` table or password hash; credentials are read directly from environment variables.

---

## Environment variables

Full, commented list in [`.env.example`](.env.example). Main groups:

| Group | Variables |
|---|---|
| Database | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` |
| Redis | `REDIS_HOST`, `REDIS_PORT` |
| MinIO | `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` |
| Auth | `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (required, no defaults) |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (leave empty and emails are skipped without error) |
| Shop | `SITE_URL`, `SHOP_NAME`, `ADMIN_EMAIL`, `GOONG_API_KEY` (optional, address search in checkout) |

**Note**: use a strong `JWT_SECRET` and your own `ADMIN_USERNAME`/`ADMIN_PASSWORD` in production.

---

## Project structure

```
cosplay-portfolio/
├── backend/
│   ├── migrations/    # Knex migrations (run in order, never edited once applied)
│   ├── seeds/         # Seed data
│   ├── shop/          # Shop domain logic: catalog, orders, payments, shipping, gacha, stats, email
│   ├── routes/        # Routers: shop, orders, admin* (catalog/orders/payments/gacha/gift/display/email/stats/shipping)
│   ├── tests/         # Vitest, run against a real MySQL + Redis
│   ├── server.js      # API server + middleware (portfolio routes inline)
│   └── worker.js      # Worker: thumbnails, order expiry, email queue
├── frontend/
│   └── src/
│       ├── pages/       # Portfolio, Admin, Shop, Collection, Cart, Checkout, Order, Faq, Gacha kiosk/practice
│       ├── components/  # Gallery, admin upload/catalog/orders...
│       ├── i18n/        # vi/en translations
│       └── shop/        # cart.js, faq.js, shop-specific utilities
├── deploy/            # Nginx config, deploy/backup/restore scripts, deployment guide
├── scripts/           # build-push.sh (builds and pushes linux/amd64 images)
├── docs/              # Decisions (DECISIONS.md), handled edge cases (EDGE_CASE_CHECKLIST.md), gacha anti-cheat reference
├── docker-compose.yml         # Dev (build from source)
├── docker-compose.pull.yml    # Production (pull prebuilt images)
└── .env.example
```

See `CLAUDE.md` for architecture details (order flow, auth, order data snapshotting...).

---

## API

The API is split into routers matching the files in `backend/routes/`:

| Router | Prefix | Auth | Description |
|---|---|---|---|
| (inline in `server.js`) | `/api/login`, `/api/refresh`, `/api/gallery`, `/api/settings`, `/api/storage/*` | - / admin | Admin login, portfolio gallery/settings, MinIO image proxy |
| `shop.js` | `/api/shop/*` | - | Public collections/products, address search |
| `orders.js` | `/api/orders/*` | - / PIN | Place orders, order lookup, payment proof upload, PIN verification |
| `adminCatalog.js` | `/api/admin/collections`, `/api/admin/products` | admin | Manage collections/products/variants |
| `adminGacha.js` | `/api/admin/gacha-*` | admin | Gacha prizes, booth sessions, draws |
| `adminOrders.js` | `/api/admin/orders` | admin | View/process orders |
| `adminPayments.js` | `/api/admin/payment-settings` | admin | Payment config (bank/Momo/PayPal/COD) |
| `adminGift.js`, `adminShopDisplay.js` | `/api/admin/*` | admin | Free-gift rule, shop group display order |
| `adminEmail.js` | `/api/admin/email-templates`, `/api/admin/email-queue` | admin | Email templates, failed email queue |
| `adminStats.js` | `/api/admin/stats/*` | admin | Sales stats |
| `adminShipping.js` | `/api/admin/shipping/*` | admin | ViettelPost export/import, event pickup roster |

**Headers for authenticated (admin) calls:**
```
Authorization: Bearer <token>
```

Public order endpoints (`/api/orders/:token/...`) use a separate PIN-verification JWT, not the admin token.

---

## Useful commands

```bash
# Follow logs
docker compose logs -f backend

# Rebuild only the backend
docker compose build backend

# Reset the database (delete the MySQL volume)
docker compose down -v
docker compose up -d

# Run backend tests (needs real MySQL + Redis; see CLAUDE.md for env vars)
cd backend && npm test

# Run frontend tests
cd frontend && npm test
```

---

## Troubleshooting

**Port already in use**
- Change the port in `docker-compose.yml` (for example `5174:80` for the frontend)

**MySQL not ready**
- The backend has a healthcheck; wait a few seconds and retry
- Check the log: `docker compose logs mysql`

**Sharp fails to build on Alpine**
- The backend Dockerfile uses `node:20-slim` to avoid building sharp on Alpine

**Backend won't start and reports missing `ADMIN_USERNAME`/`ADMIN_PASSWORD`**
- Set both in `.env`; there are no defaults and the backend deliberately refuses to start without them
