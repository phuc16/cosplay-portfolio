#!/usr/bin/env bash
# Automates DEPLOY.md's Bước 4–10 end to end: Docker install → clone → .env
# with generated secrets → pull/up prebuilt images → migrate → host Nginx
# reverse proxy → Let's Encrypt TLS → firewall. Run as root on a fresh
# Ubuntu 22.04 droplet (Bước 1–3 — creating the droplet, pointing DNS at it,
# and SSHing in — are manual/external and stay that way; this script starts
# from "you're now root on the box").
#
# Idempotent: safe to re-run. Skips steps already done (Docker installed,
# repo already cloned, .env already present) rather than clobbering a live
# deployment's secrets or state.
#
# Usage:
#   ./deploy/auto-deploy.sh --domain shop.example.com --email you@example.com
#
# Optional flags:
#   --repo URL          Git repo to clone (default: this project's origin)
#   --dir PATH           Install directory (default: /opt/cosplay-portfolio)
#   --admin-email EMAIL  Seller's own address, cc'd on every new order
#   --shop-name NAME     Shown in email subjects/templates (default: Shop)
#   --skip-tls           Stop after Bước 8 (migrations) — no host Nginx/certbot/
#                         firewall. Use when DNS isn't pointed at this droplet
#                         yet, or you're testing the app-layer steps only.
#   --skip-firewall      Configure TLS but leave ufw alone (e.g. a managed
#                         firewall already handles this at the provider level).
#
# Remote one-liner (curl the raw script instead of cloning first):
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/auto-deploy.sh \
#     | bash -s -- --domain shop.example.com --email you@example.com
#
# What this script does NOT do (still manual, per DEPLOY.md):
#   - Creating the droplet itself (Bước 1)
#   - Pointing DNS/Cloudflare at the droplet's IP (Bước 2) — TLS issuance in
#     this script WILL fail if DNS isn't already live and pointed here
#   - Setting real SMTP credentials — .env is generated with SMTP_* blank;
#     without them, order confirmation emails silently no-op (sender.js)
#   - Scheduling deploy/backup.sh in cron (see DEPLOY.md's Database Backups
#     section) — printed as a reminder at the end, not done automatically,
#     since editing another root crontab from a script is easy to get wrong
#     (duplicate entries on re-run, clobbering unrelated existing cron jobs)
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────
REPO_URL="https://github.com/phuc16/cosplay-portfolio.git"
INSTALL_DIR="/opt/cosplay-portfolio"
DOMAIN=""
CERTBOT_EMAIL=""
ADMIN_EMAIL=""
SHOP_NAME="Shop"
SKIP_TLS=0
SKIP_FIREWALL=0

log() { echo "[DEPLOY] $*"; }
die() { echo "[DEPLOY] ERROR: $*" >&2; exit 1; }

# ── Arg parsing ───────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) CERTBOT_EMAIL="$2"; shift 2 ;;
    --repo) REPO_URL="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
    --shop-name) SHOP_NAME="$2"; shift 2 ;;
    --skip-tls) SKIP_TLS=1; shift ;;
    --skip-firewall) SKIP_FIREWALL=1; shift ;;
    -h|--help)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "Unknown argument: $1 (see --help)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "Must run as root (e.g. via sudo, or as root over SSH)."
if [ "$SKIP_TLS" -eq 0 ]; then
  [ -n "$DOMAIN" ] || die "--domain is required (or pass --skip-tls to stop before the Nginx/TLS steps)."
  [ -n "$CERTBOT_EMAIL" ] || die "--email is required for Let's Encrypt registration (or pass --skip-tls)."
fi

# ── Bước 4: Docker (+ the other prerequisites a stock cloud image may or
# may not already have — git and openssl, specifically. curl itself is the
# one thing that CAN'T be bootstrapped this way: it's what fetches this
# script in the one-liner form, so it must already exist for that path to
# even start. Nearly every stock Ubuntu 22.04 cloud image ships it, but if
# yours doesn't, `apt install -y curl` once, manually, first.) ────────────
apt update -y

if ! command -v git >/dev/null 2>&1; then
  log "Installing git..."
  apt install -y git
else
  log "git already installed ($(git --version)), skipping."
fi

if ! command -v openssl >/dev/null 2>&1; then
  log "Installing openssl..."
  apt install -y openssl
else
  log "openssl already installed, skipping."
fi

if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker..."
  apt upgrade -y
  curl -fsSL https://get.docker.com | sh
else
  log "Docker already installed ($(docker --version)), skipping."
fi

if ! docker compose version >/dev/null 2>&1; then
  log "Installing Docker Compose plugin..."
  apt install -y docker-compose-plugin
else
  log "Docker Compose plugin already installed ($(docker compose version)), skipping."
fi

# ── Bước 5: Clone repo ────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  log "Repo already present at $INSTALL_DIR, pulling latest..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  log "Cloning $REPO_URL into $INSTALL_DIR..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

[ -f docker-compose.pull.yml ] || die "docker-compose.pull.yml not found in $INSTALL_DIR — wrong --repo/--dir?"

# ── Bước 6: .env with generated secrets ──────────────────────────────────
# Only ever created, never overwritten — regenerating DB_PASS/MinIO creds
# against an already-initialized mysql/minio volume would lock the app out
# of its own data. Re-running this script against a live deployment must be
# safe, which is the whole point of checking first.
if [ -f .env ]; then
  log ".env already exists, leaving it untouched."
else
  log "Generating .env with random secrets..."
  DB_PASS_GEN="$(openssl rand -base64 24)"
  MINIO_USER_GEN="cosplay_$(openssl rand -hex 4)"
  MINIO_PASS_GEN="$(openssl rand -base64 24)"
  JWT_SECRET_GEN="$(openssl rand -hex 32)"
  ADMIN_USER_GEN="admin"
  ADMIN_PASS_GEN="$(openssl rand -base64 16)"

  cat > .env <<EOF
# Generated by deploy/auto-deploy.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ) — back these up.
DB_HOST=mysql
DB_USER=root
DB_PASS=${DB_PASS_GEN}
DB_NAME=cosplay

REDIS_HOST=redis

MINIO_ROOT_USER=${MINIO_USER_GEN}
MINIO_ROOT_PASSWORD=${MINIO_PASS_GEN}
MINIO_BUCKET=cosplay

JWT_SECRET=${JWT_SECRET_GEN}

ADMIN_USERNAME=${ADMIN_USER_GEN}
ADMIN_PASSWORD=${ADMIN_PASS_GEN}

# Left blank — order confirmation emails silently no-op until these are set
# (see backend/shop/email/sender.js). Fill in and run
# 'docker compose -f docker-compose.pull.yml up -d backend worker' to apply.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

SITE_URL=https://${DOMAIN:-your-domain.com}
SHOP_NAME=${SHOP_NAME}
ADMIN_EMAIL=${ADMIN_EMAIL}

# Optional — street-address autocomplete at checkout. Blank is fine.
GOONG_API_KEY=
EOF
  chmod 600 .env

  log "Generated secrets (SAVE THESE — shown only this once):"
  echo "  ADMIN_USERNAME=${ADMIN_USER_GEN}"
  echo "  ADMIN_PASSWORD=${ADMIN_PASS_GEN}"
  echo "  DB_PASS=${DB_PASS_GEN}"
  echo "  MINIO_ROOT_USER=${MINIO_USER_GEN}"
  echo "  MINIO_ROOT_PASSWORD=${MINIO_PASS_GEN}"
fi

# ── Bước 7: Pull and start ────────────────────────────────────────────────
log "Pulling images..."
docker compose -f docker-compose.pull.yml pull
log "Starting stack..."
docker compose -f docker-compose.pull.yml up -d

# ── Bước 8: Migrations ────────────────────────────────────────────────────
# The backend container has no explicit healthcheck of its own (only mysql
# does, which backend's depends_on already waits on) — it can still take a
# few seconds to finish booting after that. Retry rather than racing it.
log "Running database migrations..."
MIGRATE_OK=0
for _ in $(seq 1 12); do
  if docker compose -f docker-compose.pull.yml exec -T backend npm run migrate; then
    MIGRATE_OK=1
    break
  fi
  sleep 5
done
[ "$MIGRATE_OK" -eq 1 ] || die "Migrations failed after 60s of retries — check: docker compose -f docker-compose.pull.yml logs backend"

log "Stack is up. docker compose -f docker-compose.pull.yml ps:"
docker compose -f docker-compose.pull.yml ps

if [ "$SKIP_TLS" -eq 1 ]; then
  log "Skipping Nginx/TLS/firewall (--skip-tls). App is reachable at http://127.0.0.1:5173 on this host only."
  exit 0
fi

# ── Bước 9: Host Nginx + TLS ──────────────────────────────────────────────
log "Installing Nginx + Certbot..."
apt install -y nginx certbot python3-certbot-nginx

log "Writing Nginx site config for $DOMAIN..."
cat > /etc/nginx/sites-available/cosplay <<EOF
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};

    client_max_body_size 500M;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/cosplay /etc/nginx/sites-enabled/cosplay
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

log "Requesting Let's Encrypt certificate for ${DOMAIN} and www.${DOMAIN}..."
log "(This fails if DNS isn't already pointed at this droplet's IP — see DEPLOY.md Bước 2.)"
certbot --nginx \
  -d "$DOMAIN" -d "www.$DOMAIN" \
  --non-interactive --agree-tos -m "$CERTBOT_EMAIL" \
  --redirect

# ── Bước 10: Firewall ─────────────────────────────────────────────────────
if [ "$SKIP_FIREWALL" -eq 1 ]; then
  log "Skipping firewall setup (--skip-firewall)."
else
  log "Configuring ufw (22, 80, 443 only)..."
  ufw allow 22
  ufw allow 80
  ufw allow 443
  ufw --force enable
  ufw status
fi

log "Done. https://${DOMAIN} should now be live."
log "Reminders (not automated by this script):"
log "  - Point/verify DNS (or Cloudflare) at this droplet's IP if you haven't already."
log "  - Fill in SMTP_* in $INSTALL_DIR/.env, then:"
log "      docker compose -f docker-compose.pull.yml up -d backend worker"
log "  - Schedule nightly backups (DEPLOY.md 'Database Backups'):"
log "      crontab -e"
log "      0 3 * * * cd $INSTALL_DIR && DB_PASS='...' ./deploy/backup.sh >> /var/log/cosplay-backup.log 2>&1"
