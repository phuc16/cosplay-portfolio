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

## Bước 2: Trỏ domain về Droplet (qua Cloudflare — khuyến nghị)

Dùng Cloudflare (gói Free) làm proxy trước domain: chống DDoS, CDN cache ảnh, ẩn IP droplet, HTTP/2.

1. Đăng ký [cloudflare.com](https://cloudflare.com) → **Add site** → nhập domain → chọn plan **Free**.
2. Cloudflare tự quét DNS. Kiểm tra 2 record A (`@` và `www`) trỏ đúng `IP_DROPLET`, bật **Proxied** (đám mây cam 🟠).
3. Cloudflare cấp 2 nameserver (dạng `xxx.ns.cloudflare.com`).
4. Vào nhà cung cấp domain (vd Namecheap: Domain List → Manage → **Nameservers → Custom DNS**) → dán 2 nameserver → Save.
5. Chờ Cloudflare gửi email "**is now active**" (thường < 1h, tối đa 48h). Site vẫn chạy bình thường trong lúc chờ.
6. Sau khi Active, trong Cloudflare dashboard:
   - **SSL/TLS → Overview → Custom → Full (strict)** (bắt buộc — mặc định Flexible gây redirect loop với certbot).
   - **SSL/TLS → Edge Certificates → Always Use HTTPS: On**.
   - **Scrape Shield → Hotlink Protection: On** (chặn site khác nhúng thẳng ảnh).

CDN cache tự hoạt động: ảnh `.webp/.png/.jpg` được cache tại edge (kiểm tra bằng `curl -sI https://domain/api/storage/... | grep cf-cache-status` — lần 2 phải là `HIT`); route API động là `DYNAMIC` (không cache).

> Không dùng Cloudflare? Chỉ cần thêm 2 A record `@`/`www` trỏ `IP_DROPLET` tại nhà cung cấp domain.

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

# SMTP - bắt buộc phải set, nếu không email đơn hàng (và QR trong email) sẽ
# im lặng không gửi (sender.js no-op khi thiếu SMTP_HOST/USER/PASS)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=noreply@your-domain.com

# Site URL - bắt buộc, nếu không QR nhận hàng sẽ trỏ về path tương đối và
# không quét được bằng camera điện thoại
SITE_URL=https://your-domain.com

# Tên shop hiển thị trong email
SHOP_NAME=Tên Shop

# Email của bạn (seller) - nhận bản sao mỗi đơn hàng mới (tuỳ chọn)
ADMIN_EMAIL=you@example.com

# Goong Maps API key - gợi ý địa chỉ khi checkout (tuỳ chọn, để trống thì
# ô địa chỉ dùng textarea thường). Biến của backend - proxy qua API của
# mình (backend/routes/shop.js), không gửi thẳng cho browser, nên chỉ cần
# restart container backend khi đổi giá trị, không cần build lại image.
GOONG_API_KEY=
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

**Bảo mật của compose prod:**
- Không service nào publish port ra ngoài, trừ frontend bind `127.0.0.1:5173` (chỉ host Nginx vào được). MySQL/Redis/MinIO/backend chỉ nói chuyện trong mạng nội bộ Docker — không thể bị truy cập hoặc spoof `X-Forwarded-For` từ internet.
- File `.env` **bắt buộc** phải có `DB_PASS`, `MINIO_ROOT_USER/PASSWORD`, `JWT_SECRET`, `ADMIN_USERNAME/PASSWORD` — thiếu là compose từ chối chạy (không còn default `admin/admin`).
- Log tự xoay vòng (json-file, 10MB × 3 file/container) — không lo đầy đĩa.
- Khi đổi cấu hình compose (ports/logging), phải chạy `up -d --force-recreate` mới có hiệu lực.

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

Chỉ mở đúng 3 port — mọi service khác đã không publish ra ngoài (xem Bước 7):

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

# Log request backend là JSON structured (1 dòng/request):
# {"ts","level","method","path","status","ip","latency","bytes_in","bytes_out","user_agent","referer"}
docker compose -f docker-compose.pull.yml logs backend | grep '"msg":"request"' | tail -20
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

## Database Backups

Orders are financial and dispute-resolution records — they must survive corruption, bad migrations, and accidental deletion. The `deploy/backup.sh` script dumps the `cosplay` database nightly via `mysqldump` with `--single-transaction`, so the site remains operational and consistent snapshots are guaranteed.

**What is backed up:** The entire MySQL database (schema, data, stored procedures, triggers), via `deploy/backup.sh`. That script is MySQL-only.

**Known gap — MinIO is NOT backed up:** This deployment runs a single MinIO container on one droplet, backed by a local Docker volume (`minio_data`) — there is no replication or distributed redundancy. If that volume or disk is lost, every original image and thumbnail is gone, including payment proof screenshots (`proofs/`), which are dispute-resolution evidence for orders. Until a MinIO backup mechanism is added, treat this as a real gap: at minimum, take manual/periodic snapshots of the droplet's disk (DigitalOcean Droplet snapshots cover the `minio_data` volume along with everything else) and/or `rsync`/`mc mirror` the MinIO data directory offsite before relying on this deployment for anything irreplaceable.

**How often:** Every night at 03:00 UTC. Set this on the server via root's crontab:
```bash
crontab -e
# Add this line:
0 3 * * * cd /opt/cosplay && DB_PASS='YOUR_PASSWORD' ./deploy/backup.sh >> /var/log/cosplay-backup.log 2>&1
```

**Where dumps live:** `/var/backups/cosplay/` on the server. Each dump is named `cosplay-YYYYMMDD-HHMMSS.sql.gz`.

**Retention window:** 14 days. Older dumps are automatically pruned by the backup script, keeping ~100 MB of historical snapshots on disk.

**How to restore:** In the event of data loss, restore into a scratch database first to verify:
```bash
cd /opt/cosplay
./deploy/restore.sh /var/backups/cosplay/cosplay-<date>.sql.gz
# Prints row counts and the sum of order totals. Compare against production:
docker compose -f docker-compose.pull.yml exec mysql mysql -uroot -p"$DB_PASS" cosplay -e \
  "SELECT COUNT(*), COALESCE(SUM(total),0) FROM orders;"
```

If counts match, restore into production:
```bash
docker compose -f docker-compose.pull.yml exec mysql mysql -uroot -p"$DB_PASS" cosplay < <(gunzip -c /var/backups/cosplay/cosplay-<date>.sql.gz)
```

**Quarterly drill:** A backup that has never been restored is not a backup. Run `./deploy/restore.sh <dump>` quarterly against a real backup to confirm the mechanism works.

---

## Lưu ý

1. **JWT_SECRET**: Đổi khác so với mặc định.
2. **ADMIN_PASSWORD**: Đặt mật khẩu mạnh.
3. **MinIO**: Đổi `MINIO_ROOT_USER` và `MINIO_ROOT_PASSWORD`.
4. **DB_PASS**: Đặt mật khẩu mạnh cho MySQL.

---

## Troubleshooting

| Vấn đề | Cách xử lý |
|--------|------------|
| 502 Bad Gateway | Kiểm tra `docker compose ps`, backend có chạy không |
| Migration lỗi | `docker compose exec backend npm run migrate` |
| Ảnh không load | Kiểm tra MinIO bucket `cosplay` đã tạo chưa |
| Upload ảnh lỗi | Kiểm tra `client_max_body_size` trong Nginx |
| Redirect loop (quá nhiều lần chuyển hướng) | Cloudflare SSL mode đang Flexible → đổi sang **Full (strict)** |
| Lỗi 526 Invalid SSL certificate | Chứng chỉ origin hết hạn/sai domain → `certbot renew --dry-run` trên droplet |
| Ảnh chậm/không cache | `curl -sI .../api/storage/xxx.webp \| grep cf-cache-status` — `HIT` là qua CDN; `MISS` liên tục thì kiểm tra header `Cache-Control` từ backend |
| Compose từ chối chạy (`required variable ... is missing`) | Thiếu biến trong `.env` — cố ý, điền đủ secrets |
| Gợi ý địa chỉ (Goong) không hiện dù đã set `GOONG_API_KEY` | Kiểm tra backend đã restart với biến mới chưa (`docker compose restart backend`); test trực tiếp `GET /api/shop/address-autocomplete?input=...` qua backend xem có trả `predictions` không |
