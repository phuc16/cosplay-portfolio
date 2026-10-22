# Cosplay Portfolio

[English](README.md) | **Tiếng Việt**

Portfolio cosplay (gallery ảnh theo album) kèm một shop bán merch (photocard, poster, sản phẩm số, gacha...) dùng chung backend/frontend. Chạy thật tại https://kamidayhehe.com.

## Tính năng

- **Gallery**: Xem ảnh dạng grid, lightbox xem phóng to, album và album con, watermark trên ảnh album, nội dung song ngữ vi/en
- **Admin**: Đăng nhập, upload ảnh kéo thả, xóa/sửa ảnh, quản lý shop, giao diện admin song ngữ
- **Shop**: Collection (đợt mở bán, có thể đặt lịch mở/đóng) → Product → Variant, giỏ hàng, checkout, thanh toán VietQR/Momo/PayPal/COD, giao hàng hoặc nhận tại sự kiện, sản phẩm số (giao link tải), nhóm và lọc Digital/Physical, link sản phẩm chia sẻ được
- **Gacha**: Sản phẩm gacha với quay thưởng có trọng số do server quyết định (client không bao giờ chọn giải), trang chơi thử, và kiosk do nhân viên vận hành để bán tiền mặt tại booth (xem [docs/GACHA_ANTI_CHEAT.md](docs/GACHA_ANTI_CHEAT.md))
- **Quà tặng**: Tặng quà tùy chọn cho đơn đạt tổng tiền tối thiểu
- **Đơn hàng**: Vòng đời pending → confirmed → shipped/completed (hoặc cancelled), tự hủy đơn quá hạn thanh toán và hoàn kho, email giao dịch (đặt hàng/xác nhận/giao hàng/hủy), tra cứu đơn qua link + mã PIN, số thứ tự (STT) để đóng gói và nhận hàng
- **Vận chuyển**: Xuất/nhập file ViettelPost, danh sách nhận hàng tại sự kiện (roster) có xuất PDF để in
- **Thumbnail tự động**: Worker tạo thumbnail cho ảnh mới
- **Cache Redis**: Cache gallery/settings để tăng tốc truy vấn

## Yêu cầu hệ thống

- **Docker** và **Docker Compose** (khuyến nghị)
- Hoặc: **Node.js 20+**, **MySQL 8**, **Redis 7**, **MinIO** (S3-compatible object storage)

---

## Cài đặt & chạy với Docker

### 1. Clone & chuẩn bị

```bash
git clone https://github.com/phuc16/cosplay-portfolio.git
cd cosplay-portfolio
```

### 2. Tạo file cấu hình

```bash
cp .env.example .env
```

Xem chi tiết từng biến trong `.env.example`. Bắt buộc phải đặt `ADMIN_USERNAME`/`ADMIN_PASSWORD` và `JWT_SECRET` - backend sẽ không khởi động nếu thiếu `ADMIN_USERNAME`/`ADMIN_PASSWORD`.

### 3. Build và chạy

```bash
docker compose up -d --build
```

### 4. Truy cập

| Dịch vụ         | URL                     | Mô tả                          |
|-----------------|-------------------------|--------------------------------|
| Frontend        | http://localhost:5173   | Portfolio + shop               |
| Backend         | http://localhost:5000   | API server                     |
| MySQL           | localhost:3307          | Database (user: root)          |
| Redis           | localhost:6380          | Cache                          |
| MinIO API       | localhost:9000          | Object storage                 |
| MinIO Console   | localhost:9001          | Giao diện quản lý MinIO        |

---

## Chạy development (không dùng Docker)

### 1. Chạy MySQL, Redis, MinIO

```bash
docker compose up -d mysql redis minio
```

### 2. Cấu hình môi trường

```bash
cp .env.example .env
```

Chỉnh `.env` cho phù hợp với môi trường local (host/port của MySQL, Redis, MinIO ở trên; dùng `DB_PORT=3307` và `REDIS_PORT=6380`).

### 3. Backend

```bash
cd backend
npm install
npm run migrate
node server.js
```

Chạy thêm worker (terminal khác) - xử lý thumbnail, tự hủy đơn quá hạn, gửi email hàng đợi:

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

Truy cập: http://localhost:5173

---

## Hướng dẫn sử dụng

### Xem gallery (người dùng)

1. Mở http://localhost:5173
2. Xem ảnh dạng grid trên trang chủ
3. Click ảnh để mở lightbox xem phóng to
4. Đóng lightbox bằng nút X hoặc click ra ngoài

### Mua hàng (shop)

1. Vào `/merchandise` để xem các đợt mở bán (collection)
2. Chọn sản phẩm/mẫu (variant), thêm vào giỏ (`/cart`)
3. Checkout: điền thông tin nhận hàng, chọn giao hàng/nhận tại sự kiện (nếu có), chọn phương thức thanh toán
4. Sau khi đặt hàng, được chuyển thẳng tới trang đơn hàng (`/order/:token`) - đường link này và mã PIN xác thực cũng được gửi qua email

### Quản trị (admin)

1. Vào http://localhost:5173/admin
2. Đăng nhập bằng `ADMIN_USERNAME`/`ADMIN_PASSWORD` đã đặt trong `.env`
3. Sau khi đăng nhập, quản lý được: ảnh và album portfolio, collection/product/variant của shop, giải thưởng gacha, đơn hàng, cài đặt thanh toán, quà tặng, thứ tự hiển thị shop, mẫu email, thống kê, xuất/nhập vận chuyển

### Đổi thông tin đăng nhập admin

Sửa `ADMIN_USERNAME`/`ADMIN_PASSWORD` trong `.env` rồi khởi động lại backend - không có bảng `admins` hay hash mật khẩu, thông tin đăng nhập chỉ đọc trực tiếp từ biến môi trường.

---

## Biến môi trường

Xem đầy đủ và có chú thích trong [`.env.example`](.env.example). Các nhóm chính:

| Nhóm | Biến |
|---|---|
| Database | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` |
| Redis | `REDIS_HOST`, `REDIS_PORT` |
| MinIO | `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` |
| Auth | `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (bắt buộc, không có mặc định) |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (để trống thì email không gửi, không lỗi) |
| Shop | `SITE_URL`, `SHOP_NAME`, `ADMIN_EMAIL`, `GOONG_API_KEY` (tùy chọn, tìm địa chỉ trong checkout) |

**Lưu ý**: Đặt `JWT_SECRET` mạnh và `ADMIN_USERNAME`/`ADMIN_PASSWORD` riêng khi deploy production.

---

## Cấu trúc dự án

```
cosplay-portfolio/
├── backend/
│   ├── migrations/    # Knex migrations (chạy tuần tự, không sửa lại sau khi đã chạy)
│   ├── seeds/         # Seed data
│   ├── shop/          # Domain logic của shop: catalog, orders, payments, shipping, gacha, stats, email
│   ├── routes/        # Router: shop, orders, admin* (catalog/orders/payments/gacha/gift/display/email/stats/shipping)
│   ├── tests/         # Vitest, chạy trên MySQL + Redis thật
│   ├── server.js      # API server + middleware (route portfolio nằm trực tiếp trong file)
│   └── worker.js      # Worker: thumbnail, hết hạn đơn, hàng đợi email
├── frontend/
│   └── src/
│       ├── pages/       # Portfolio, Admin, Shop, Collection, Cart, Checkout, Order, Faq, Gacha kiosk/practice
│       ├── components/  # Gallery, AdminUpload, AdminCollections/Products/Variants/Orders...
│       ├── i18n/        # Bản dịch vi/en
│       └── shop/        # cart.js, faq.js, các util riêng cho shop
├── deploy/            # Nginx config, script deploy/backup/restore, hướng dẫn deploy
├── scripts/           # build-push.sh (build và push image linux/amd64)
├── docs/              # Quyết định sản phẩm (DECISIONS.md), edge case đã xử lý (EDGE_CASE_CHECKLIST.md), tài liệu chống gian lận gacha
├── docker-compose.yml         # Dev (build từ source)
├── docker-compose.pull.yml    # Production (pull image có sẵn)
└── .env.example
```

Xem `CLAUDE.md` để biết chi tiết kiến trúc (luồng đặt hàng, cơ chế auth, snapshot dữ liệu đơn hàng...).

---

## API

API được chia theo router, tương ứng các file trong `backend/routes/`:

| Router | Prefix | Auth | Mô tả |
|---|---|---|---|
| (inline trong `server.js`) | `/api/login`, `/api/refresh`, `/api/gallery`, `/api/settings`, `/api/storage/*` | - / admin | Đăng nhập admin, gallery/settings portfolio, proxy ảnh MinIO |
| `shop.js` | `/api/shop/*` | - | Danh sách collection/product công khai, tra cứu địa chỉ |
| `orders.js` | `/api/orders/*` | - / PIN | Đặt hàng, tra cứu đơn, upload ảnh chuyển khoản, xác thực PIN |
| `adminCatalog.js` | `/api/admin/collections`, `/api/admin/products` | admin | Quản lý collection/product/variant |
| `adminGacha.js` | `/api/admin/gacha-*` | admin | Giải thưởng gacha, phiên booth, quay thưởng |
| `adminOrders.js` | `/api/admin/orders` | admin | Xem/xử lý đơn hàng |
| `adminPayments.js` | `/api/admin/payment-settings` | admin | Cấu hình thanh toán (bank/Momo/PayPal/COD) |
| `adminGift.js`, `adminShopDisplay.js` | `/api/admin/*` | admin | Quy tắc quà tặng, thứ tự hiển thị nhóm trong shop |
| `adminEmail.js` | `/api/admin/email-templates`, `/api/admin/email-queue` | admin | Mẫu email, hàng đợi email lỗi |
| `adminStats.js` | `/api/admin/stats/*` | admin | Thống kê bán hàng |
| `adminShipping.js` | `/api/admin/shipping/*` | admin | Xuất/nhập ViettelPost, danh sách nhận hàng tại sự kiện |

**Headers khi cần auth (admin):**
```
Authorization: Bearer <token>
```

Đơn hàng công khai (`/api/orders/:token/...`) dùng JWT xác thực PIN riêng, không dùng token admin.

---

## Lệnh hữu ích

```bash
# Xem logs
docker compose logs -f backend

# Chỉ build lại backend
docker compose build backend

# Reset database (xóa volume MySQL)
docker compose down -v
docker compose up -d

# Chạy test backend (cần MySQL + Redis thật, xem CLAUDE.md để set biến môi trường)
cd backend && npm test

# Chạy test frontend
cd frontend && npm test
```

---

## Xử lý lỗi thường gặp

**Port đã được sử dụng**
- Đổi port trong `docker-compose.yml` (ví dụ `5174:80` cho frontend)

**MySQL chưa sẵn sàng**
- Backend có healthcheck, chờ vài giây rồi thử lại
- Xem log: `docker compose logs mysql`

**Sharp build lỗi trên Alpine**
- Dockerfile backend dùng `node:20-slim` để tránh build sharp trên Alpine

**Backend không khởi động, báo thiếu `ADMIN_USERNAME`/`ADMIN_PASSWORD`**
- Đặt cả hai biến trong `.env` - không có mặc định, backend cố ý dừng khởi động nếu thiếu
