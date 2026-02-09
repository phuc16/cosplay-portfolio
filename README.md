# Cosplay Portfolio

Ứng dụng portfolio cosplay cho phép quản lý và hiển thị gallery ảnh cosplay.

## Tính năng

- **Gallery**: Xem ảnh dạng grid, lightbox xem phóng to
- **Admin**: Đăng nhập, upload ảnh kéo thả, xóa/sửa ảnh
- **Thumbnail tự động**: Worker tạo thumbnail cho ảnh mới
- **Cache Redis**: Cache gallery để tăng tốc truy vấn

## Yêu cầu hệ thống

- **Docker** và **Docker Compose** (khuyến nghị)
- Hoặc: **Node.js 20+**, **MySQL 8**, **Redis 7**

---

## Cài đặt & chạy với Docker

### 1. Clone & chuẩn bị

```bash
git clone <repo-url>
cd cosplay-portfolio
```

### 2. Tạo file cấu hình (tùy chọn)

Copy `.env.example` thành `.env` nếu muốn tùy chỉnh:

```bash
cp .env.example .env
```

Đổi `JWT_SECRET` khi deploy production.

### 3. Build và chạy

```bash
docker compose up -d --build
```

### 4. Truy cập

| Dịch vụ    | URL                    | Mô tả                 |
|-----------|------------------------|------------------------|
| Frontend  | http://localhost:5173  | Giao diện chính        |
| Backend   | http://localhost:5000  | API server             |
| MySQL     | localhost:3307         | Database (user: root)  |
| Redis     | localhost:6379         | Cache                  |

---

## Chạy development (không dùng Docker)

### 1. Cài đặt MySQL & Redis

Đảm bảo MySQL và Redis đang chạy local hoặc qua Docker:

```bash
docker compose up -d mysql redis
```

### 2. Cấu hình môi trường

```bash
cp .env.example .env
```

Chỉnh `.env` nếu cần:
- `DB_HOST=localhost` (hoặc `127.0.0.1`)
- `DB_PASS=root`
- `REDIS_HOST=localhost`

### 3. Backend

```bash
cd backend
npm install
npm run migrate
npm run seed
node server.js
```

Chạy thêm worker (terminal khác):

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

### Quản trị (admin)

1. Vào http://localhost:5173/admin
2. Click **Login Admin**
3. Đăng nhập với:
   - Username: `admin`
   - Password: `admin`
4. Sau khi đăng nhập:
   - **Upload ảnh**: Kéo thả file ảnh vào vùng "Drag & Drop Upload"
   - Hỗ trợ: JPG, PNG, GIF, WebP

### Đổi mật khẩu admin

1. Kết nối MySQL
2. Tạo hash bcrypt cho mật khẩu mới (ví dụ bằng Node):
   ```js
   const bcrypt = require('bcrypt')
   bcrypt.hash('mat-khau-moi', 10).then(console.log)
   ```
3. Cập nhật bảng `admins`:
   ```sql
   UPDATE admins SET password = '<hash>' WHERE username = 'admin';
   ```

---

## Biến môi trường

| Biến        | Mô tả           | Mặc định       |
|-------------|-----------------|----------------|
| DB_HOST     | Host MySQL      | localhost      |
| DB_USER     | User MySQL      | root           |
| DB_PASS     | Mật khẩu MySQL  | (trống)        |
| DB_NAME     | Tên database    | cosplay        |
| REDIS_HOST  | Host Redis      | localhost      |
| JWT_SECRET  | Secret cho JWT  | change-me...   |

**Lưu ý**: Đặt `JWT_SECRET` mạnh trong production.

---

## Cấu trúc dự án

```
cosplay-portfolio/
├── backend/           # API Node.js + Express
│   ├── migrations/    # Knex migrations
│   ├── seeds/         # Seed data (admin mặc định)
│   ├── server.js      # API server
│   └── worker.js      # Worker tạo thumbnail
├── frontend/          # React + Vite + Tailwind
│   └── src/
│       ├── pages/     # Portfolio, Admin
│       └── components/# Gallery, Lightbox, AdminUpload...
├── deploy/            # Nginx config (reverse proxy)
├── docker-compose.yml
└── .env.example
```

---

## API Reference

| Method | Endpoint        | Auth | Mô tả              |
|--------|-----------------|------|--------------------|
| POST   | /api/login      | -    | Đăng nhập admin    |
| GET    | /api/gallery    | -    | Lấy danh sách ảnh  |
| POST   | /api/image      | ✓    | Thêm ảnh           |
| PUT    | /api/image/:id  | ✓    | Cập nhật ảnh       |
| DELETE | /api/image/:id  | ✓    | Xóa ảnh            |

**Headers khi cần auth:**
```
Authorization: Bearer <token>
```

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
