# Hướng dẫn deploy Cosplay Portfolio lên DigitalOcean Droplet

Hướng dẫn từng bước để host project này trên VPS (DigitalOcean Droplet).

---

## Tổng quan stack

| Thành phần | Mô tả |
|------------|--------|
| **Frontend** | React + Vite, build → Nginx (port 80) |
| **Backend** | Node.js + Express (port 5000) |
| **Worker** | Xử lý ảnh thumbnail |
| **MySQL** | Database |
| **Redis** | Cache |
| **MinIO** | Lưu ảnh (S3-compatible) |

---

## Bước 1: Tạo Droplet trên DigitalOcean

1. Đăng nhập [DigitalOcean](https://cloud.digitalocean.com)
2. **Create** → **Droplets**
3. Chọn options:

   | Option | Gợi ý |
   |--------|--------|
   **Image** | Ubuntu 22.04 LTS |
   **Plan** | Basic – **Premium** 2 GB RAM / 1 vCPU ($14/mo) hoặc 4 GB / 2 vCPU (~$24/mo) |
   **Storage** | 50–80 GB SSD |
   **Datacenter** | Singapore (SGP1) – gần Việt Nam |
   **Authentication** | SSH key (khuyến nghị) hoặc Password |

4. Đặt hostname: `cosplay-portfolio`
5. **Create Droplet** → chờ vài phút

---

## Bước 2: Trỏ domain về Droplet

1. Vào nhà cung cấp domain (Namecheap, Cloudflare, GoDaddy…)
2. Thêm **A Record**:

   | Type | Name | Value | TTL |
   |------|------|-------|-----|
   | A | @ | `IP_DROPLET` | 300 |
   | A | www | `IP_DROPLET` | 300 |

3. Đợi tối đa 48h (thường 5–15 phút)

---

## Bước 3: Kết nối SSH vào Droplet

```bash
ssh root@IP_DROPLET
```

(Nếu dùng SSH key, không cần nhập mật khẩu.)

---

## Bước 4: Cài đặt Docker trên server

```bash
# Cập nhật hệ thống
apt update && apt upgrade -y

# Cài Docker
curl -fsSL https://get.docker.com | sh

# Cài Docker Compose
apt install docker-compose-plugin -y

# Kiểm tra
docker --version
docker compose version
```

---

## Bước 5: Chuẩn bị thư mục deploy

Chỉ cần clone repo để lấy `docker-compose.pull.yml` và `.env.example`:

```bash
cd /opt
git clone https://github.com/YOUR_USERNAME/cosplay-portfolio.git
cd cosplay-portfolio
```

(Thay `YOUR_USERNAME` bằng username GitHub của bạn.)

**Lưu ý:** Deploy dùng **pre-built images** từ Docker Hub (`phuc16/cosplay-backend`, `phuc16/cosplay-frontend`), không cần build trên server. Maintainer cần chạy `./scripts/build-push.sh` lần đầu để push images lên Docker Hub.

---

## Bước 6: Tạo file `.env` cho production

```bash
nano .env
```

Nội dung ví dụ:

```env
# Database
DB_HOST=mysql
DB_USER=root
DB_PASS=CHANGE_ME_STRONG_PASSWORD
DB_NAME=cosplay

# Redis
REDIS_HOST=redis

# MinIO
MINIO_ROOT_USER=CHANGE_ME
MINIO_ROOT_PASSWORD=CHANGE_ME_STRONG_PASSWORD
MINIO_BUCKET=cosplay

# JWT - dùng lệnh tạo random: openssl rand -hex 32
JWT_SECRET=YOUR_64_CHAR_HEX_SECRET

# Admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHANGE_ME_STRONG_PASSWORD
```

Tạo secret mạnh:

```bash
# JWT secret
openssl rand -hex 32

# Ví dụ password
openssl rand -base64 16
```

Lưu file: `Ctrl+O`, `Enter`, `Ctrl+X`.

---

## Bước 7: Pull images và chạy

```bash
cd /opt/cosplay-portfolio
docker compose -f docker-compose.pull.yml pull
docker compose -f docker-compose.pull.yml up -d
```

Chỉ cần **pull** và **up** – không build trên server.

Kiểm tra:

```bash
docker compose -f docker-compose.pull.yml ps
```

Các service phải ở trạng thái `running`.

---

## Bước 8: Chạy database migrations

```bash
docker compose -f docker-compose.pull.yml exec backend npm run migrate
```

---

## Bước 9: Cài SSL (HTTPS) với Let's Encrypt

Vì frontend container đang listen port 80, cần một Nginx ở host để nhận HTTPS và proxy sang container.

### 9.1. Cài Nginx và Certbot

```bash
apt install nginx certbot python3-certbot-nginx -y
```

### 9.2. Cấu hình Nginx làm reverse proxy

Frontend container đã proxy `/api` vào backend, nên host Nginx chỉ cần proxy tất cả vào frontend:

```bash
nano /etc/nginx/sites-available/cosplay
```

Nội dung (thay `yourdomain.com` bằng domain của bạn):

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    client_max_body_size 500M;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Kích hoạt site:

```bash
ln -s /etc/nginx/sites-available/cosplay /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default  # nếu có
nginx -t
systemctl reload nginx
```

### 9.3. Lấy SSL

```bash
certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Làm theo hướng dẫn (email, điều khoản). Certbot sẽ tự cấu hình Nginx cho HTTPS.

---

## Bước 10: Mở firewall

```bash
ufw allow 22      # SSH
ufw allow 80      # HTTP
ufw allow 443     # HTTPS
ufw enable
ufw status
```

---

## Tóm tắt lệnh sau khi setup

```bash
cd /opt/cosplay-portfolio

# Cập nhật images mới (khi maintainer push phiên bản mới)
docker compose -f docker-compose.pull.yml pull
docker compose -f docker-compose.pull.yml up -d

# Chạy migration (nếu có thay đổi)
docker compose -f docker-compose.pull.yml exec backend npm run migrate

# Xem logs
docker compose -f docker-compose.pull.yml logs -f
```

---

## Phụ lục: Build và push images (cho maintainer)

Khi thay đổi code, cần build và push images lên Docker Hub:

```bash
# Đăng nhập Docker Hub
docker login

# Chạy script (Linux/Mac)
./scripts/build-push.sh

# Hoặc Windows PowerShell
.\scripts\build-push.ps1

# Push với tag cụ thể (vd: v1.0)
./scripts/build-push.sh v1.0
```

Images: `phuc16/cosplay-backend:latest`, `phuc16/cosplay-frontend:latest`

---

## Lưu ý

1. **Backup**: Định kỳ backup MySQL và volume MinIO.
2. **JWT_SECRET**: Đổi khác so với mặc định.
3. **ADMIN_PASSWORD**: Đặt mật khẩu mạnh.
4. **MinIO**: Đổi `MINIO_ROOT_USER` và `MINIO_ROOT_PASSWORD`.
5. **DB_PASS**: Đặt mật khẩu mạnh cho MySQL.

---

## Troubleshooting

| Vấn đề | Cách xử lý |
|--------|------------|
| 502 Bad Gateway | Kiểm tra `docker compose ps`, backend có chạy không |
| Migration lỗi | `docker compose exec backend npm run migrate` |
| Ảnh không load | Kiểm tra MinIO bucket `cosplay` đã tạo chưa |
| Upload ảnh lỗi | Kiểm tra `client_max_body_size` trong Nginx |
