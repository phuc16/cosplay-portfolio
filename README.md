<a id="readme-top"></a>

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]

<br />
<div align="center">
  <h3 align="center">Cosplay Portfolio</h3>

  <p align="center">
    A cosplay photo portfolio and a merch shop (photocards, posters, digital goods, gacha) on one backend and frontend.
    <br />
    <a href="docs/DECISIONS.md"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://kamidayhehe.com">View Demo</a>
    &middot;
    <a href="https://github.com/phuc16/cosplay-portfolio/issues/new">Report Bug</a>
    &middot;
    <a href="https://github.com/phuc16/cosplay-portfolio/issues/new">Request Feature</a>
  </p>

</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## About The Project

Live at **[kamidayhehe.com](https://kamidayhehe.com)**. A cosplay portfolio (photo gallery with albums) and merch shop, running in production.

Key features:

- **Gallery**: grid view, lightbox, albums with sub-albums, watermark on album photos, bilingual (vi/en) site copy
- **Admin**: login, drag-and-drop upload, edit/delete photos, shop management, bilingual admin UI
- **Shop**: Collection (a sale window that can be scheduled to open/close) → Product → Variant, cart, checkout, VietQR/Momo/PayPal/COD payments, delivery or event pickup, digital products (download link delivery), Digital/Physical grouping and filters, shareable product links
- **Gacha**: server-side weighted draws (the client never decides the prize), a practice page, and a staff-run booth kiosk for cash sales (see [docs/GACHA_ANTI_CHEAT.md](docs/GACHA_ANTI_CHEAT.md))
- **Gift**: optional free gift for orders above a minimum total
- **Orders**: lifecycle pending → confirmed → shipped/completed (or cancelled), automatic cancellation of unpaid orders past the deadline with stock release, transactional emails, order lookup by link + PIN, queue numbers for packing and pickup
- **Shipping**: ViettelPost export/import, event pickup roster with a print-ready PDF export
- **Automatic thumbnails** via a worker, and a **Redis cache** for gallery/settings reads

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![React][React.js]][React-url]
* [![Vite][Vite.js]][Vite-url]
* [![TailwindCSS][Tailwind]][Tailwind-url]
* [![Node.js][Node.js]][Node-url]
* [![Express][Express.js]][Express-url]
* [![MySQL][MySQL]][MySQL-url]
* [![Redis][Redis]][Redis-url]
* [![Docker][Docker]][Docker-url]

Also: MinIO (S3-compatible object storage), Nginx, Knex migrations, Vitest.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

Follow these steps to run the project locally.

### Prerequisites

- **Docker** and **Docker Compose** (recommended)
- Or: **Node.js 20+**, **MySQL 8**, **Redis 7**, **MinIO** (S3-compatible object storage)

### Installation

**With Docker (recommended)**

1. Clone the repo
   ```sh
   git clone https://github.com/phuc16/cosplay-portfolio.git
   cd cosplay-portfolio
   ```
2. Create the config file
   ```sh
   cp .env.example .env
   ```
   See `.env.example` for every variable. You must set `ADMIN_USERNAME`/`ADMIN_PASSWORD` and `JWT_SECRET`; the backend refuses to start without `ADMIN_USERNAME`/`ADMIN_PASSWORD`.
3. Build and run
   ```sh
   docker compose up -d --build
   ```
4. Open the services

   | Service       | URL                   | Description           |
   |---------------|-----------------------|-----------------------|
   | Frontend      | http://localhost:5173 | Portfolio + shop      |
   | Backend       | http://localhost:5000 | API server            |
   | MySQL         | localhost:3307        | Database (user: root) |
   | Redis         | localhost:6380        | Cache                 |
   | MinIO API     | localhost:9000        | Object storage        |
   | MinIO Console | localhost:9001        | MinIO management UI   |

**Without Docker (development)**

1. Start MySQL, Redis and MinIO
   ```sh
   docker compose up -d mysql redis minio
   ```
2. Configure the environment: `cp .env.example .env`, then set the local hosts (use `DB_PORT=3307` and `REDIS_PORT=6380`).
3. Run the backend
   ```sh
   cd backend
   npm install
   npm run migrate
   node server.js
   ```
4. In another terminal, run the worker (thumbnails, expired-order cancellation, queued emails)
   ```sh
   cd backend
   node worker.js
   ```
5. Run the frontend, then open http://localhost:5173
   ```sh
   cd frontend
   npm install
   npm run dev
   ```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

**Visitors:** open the home page, browse the photo grid and albums, and click a photo to open the lightbox.

**Buying merch:** go to `/merchandise`, pick a product/variant, add it to the cart (`/cart`), check out (delivery or event pickup, then a payment method). You are taken to the order page (`/order/:token`); the link and a verification PIN are also emailed.

**Admin:** go to `/admin` and log in with `ADMIN_USERNAME`/`ADMIN_PASSWORD` from `.env`. You can manage portfolio photos and albums, shop collections/products/variants, gacha prizes, orders, payment settings, gift settings, shop display order, email templates, stats, and shipping import/export. To change the login, edit those variables and restart the backend (there is no `admins` table; credentials are read from the environment).

<details>
<summary><strong>Environment variables</strong></summary>

Full, commented list in [`.env.example`](.env.example). Main groups:

| Group | Variables |
|---|---|
| Database | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` |
| Redis | `REDIS_HOST`, `REDIS_PORT` |
| MinIO | `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` |
| Auth | `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (required, no defaults) |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (leave empty and emails are skipped without error) |
| Shop | `SITE_URL`, `SHOP_NAME`, `ADMIN_EMAIL`, `GOONG_API_KEY` (optional, address search in checkout) |

Use a strong `JWT_SECRET` and your own admin credentials in production.
</details>

<details>
<summary><strong>Project structure</strong></summary>

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
├── docs/              # Decisions, handled edge cases, gacha anti-cheat reference
├── docker-compose.yml         # Dev (build from source)
├── docker-compose.pull.yml    # Production (pull prebuilt images)
└── .env.example
```

See `CLAUDE.md` for architecture details (order flow, auth, order data snapshotting).
</details>

<details>
<summary><strong>API overview</strong></summary>

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

Admin calls send `Authorization: Bearer <token>`. Public order endpoints (`/api/orders/:token/...`) use a separate PIN-verification JWT.
</details>

<details>
<summary><strong>Useful commands and troubleshooting</strong></summary>

```sh
docker compose logs -f backend        # follow logs
docker compose build backend          # rebuild only the backend
docker compose down -v && docker compose up -d   # reset the database (deletes the MySQL volume)
cd backend && npm test                # backend tests (need real MySQL + Redis; see CLAUDE.md)
cd frontend && npm test               # frontend tests
```

- **Port already in use:** change the port in `docker-compose.yml` (for example `5174:80` for the frontend).
- **MySQL not ready:** the backend has a healthcheck; wait a few seconds, or check `docker compose logs mysql`.
- **Sharp fails to build on Alpine:** the backend Dockerfile uses `node:20-slim` to avoid this.
- **Backend reports missing `ADMIN_USERNAME`/`ADMIN_PASSWORD`:** set both in `.env`; there are no defaults on purpose.
</details>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] Portfolio gallery with albums and bilingual (vi/en) UI
- [x] Merch shop with collections, variants, cart, checkout and multiple payment methods
- [x] Gacha with server-side draws and a staff booth kiosk
- [x] Order lifecycle automation (expiry, stock release, transactional emails)
- [x] ViettelPost shipping export/import and event pickup roster

See the [open issues](https://github.com/phuc16/cosplay-portfolio/issues) for proposed features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement". Don't forget to give the project a star!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

No license file has been added to this repository yet, so all rights are reserved by default. Open an issue if you would like to use any part of it.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Phuc Truong Hoang - [@phuc16](https://github.com/phuc16)

Project Link: [https://github.com/phuc16/cosplay-portfolio](https://github.com/phuc16/cosplay-portfolio)

Live site: [https://kamidayhehe.com](https://kamidayhehe.com)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)
* [Shields.io](https://shields.io)
* [Knex.js](https://knexjs.org)
* [MinIO](https://min.io)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/phuc16/cosplay-portfolio.svg?style=for-the-badge
[contributors-url]: https://github.com/phuc16/cosplay-portfolio/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/phuc16/cosplay-portfolio.svg?style=for-the-badge
[forks-url]: https://github.com/phuc16/cosplay-portfolio/network/members
[stars-shield]: https://img.shields.io/github/stars/phuc16/cosplay-portfolio.svg?style=for-the-badge
[stars-url]: https://github.com/phuc16/cosplay-portfolio/stargazers
[issues-shield]: https://img.shields.io/github/issues/phuc16/cosplay-portfolio.svg?style=for-the-badge
[issues-url]: https://github.com/phuc16/cosplay-portfolio/issues
[React.js]: https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[React-url]: https://reactjs.org/
[Vite.js]: https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white
[Vite-url]: https://vitejs.dev/
[Tailwind]: https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white
[Tailwind-url]: https://tailwindcss.com/
[Node.js]: https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white
[Node-url]: https://nodejs.org/
[Express.js]: https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white
[Express-url]: https://expressjs.com/
[MySQL]: https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white
[MySQL-url]: https://www.mysql.com/
[Redis]: https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white
[Redis-url]: https://redis.io/
[Docker]: https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white
[Docker-url]: https://www.docker.com/
