#!/usr/bin/env bash
# Automates DEPLOY.md's Bước 4–10 end to end: Docker install → fetch deploy
# config → .env with generated secrets → pull/up prebuilt images → migrate
# → host Nginx reverse proxy → Let's Encrypt TLS → firewall. Run as root on
# a fresh Ubuntu 22.04 droplet (Bước 1–3 — creating the droplet, pointing
# DNS at it, and SSHing in — are manual/external and stay that way; this
# script starts from "you're now root on the box").
#
# Does NOT git-clone the repo. DEPLOY.md's whole design is "prebuilt images,
# nothing built on the server" — the server only ever needs docker-compose.
# pull.yml (to know what to run) and the deploy/ scripts (operational
# tooling), never the application source. Fetches just those few files
# directly from GitHub instead, which also sidesteps needing git installed
# or git credentials at all — a full clone of a private repo would
# otherwise prompt for a username/password it has no way to answer
# non-interactively.
#
# Idempotent: safe to re-run. .env is only ever created, never overwritten
# (regenerating its secrets against an already-initialized mysql/minio
# volume would lock the app out of its own data) — everything else (the
# fetched config files, Docker installs, Nginx/TLS config) is cheap to
# refresh on every run.
#
# Usage:
#   ./deploy/auto-deploy.sh --domain shop.example.com --email you@example.com
#
# Optional flags:
#   --repo URL           GitHub repo (default: this project's origin) —
#                         only used to derive owner/name, never cloned
#   --branch NAME         Branch to fetch files from (default: main)
#   --github-token TOKEN  Needed only if --repo is private (or set the
#                          GITHUB_TOKEN env var instead of passing this on
#                          the command line, so it doesn't end up in shell
#                          history). A fine-grained PAT with read-only
#                          "Contents" access to just this repo is enough.
#   --dir PATH            Install directory (default: /opt/cosplay-portfolio)
#   --admin-email EMAIL   Seller's own address, cc'd on every new order
#   --shop-name NAME      Shown in email subjects/templates (default: Shop)
#   --skip-tls            Stop after Bước 8 (migrations) — no host Nginx/certbot/
#                          firewall. Use when DNS isn't pointed at this droplet
#                          yet, or you're testing the app-layer steps only.
#   --skip-firewall       Configure TLS but leave ufw alone (e.g. a managed
#                         firewall already handles this at the provider level).
#
# Remote one-liner (curl the raw script instead of fetching it first) —
# only works if THIS script itself is reachable unauthenticated, i.e. the
# repo is public, or you fetched this one file out-of-band already:
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
BRANCH="main"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
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
    --branch) BRANCH="$2"; shift 2 ;;
    --github-token) GITHUB_TOKEN="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
    --shop-name) SHOP_NAME="$2"; shift 2 ;;
    --skip-tls) SKIP_TLS=1; shift ;;
    --skip-firewall) SKIP_FIREWALL=1; shift ;;
    -h|--help)
      sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'
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

# github.com/OWNER/NAME(.git) -> OWNER/NAME, for raw.githubusercontent.com URLs.
REPO_SLUG="${REPO_URL#https://github.com/}"
REPO_SLUG="${REPO_SLUG%.git}"

# ── Bước 4: Docker (+ openssl, the one other prerequisite a stock cloud
# image may or may not already have. No git needed — see the file header:
# this script fetches individual files over HTTPS, never clones. curl
# itself is the one thing that CAN'T be bootstrapped this way: it's what
# fetches this script in the one-liner form, so it must already exist for
# that path to even start. Nearly every stock Ubuntu 22.04 cloud image
# ships it, but if yours doesn't, `apt install -y curl` once, manually,
# first.) ───────────────────────────────────────────────────────────────
apt update -y

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

# ── Bước 5: Fetch just the deploy-time files (no git clone — see header) ─
mkdir -p "$INSTALL_DIR/deploy"
cd "$INSTALL_DIR"

fetch_file() {
  # $1 = path within the repo, relative to its root
  local url="https://raw.githubusercontent.com/${REPO_SLUG}/${BRANCH}/$1"
  local auth_header=()
  [ -n "$GITHUB_TOKEN" ] && auth_header=(-H "Authorization: token ${GITHUB_TOKEN}")
  curl -fsSL "${auth_header[@]}" "$url" -o "$1" \
    || die "Could not fetch $1 from $REPO_SLUG@$BRANCH. If this repo is private, pass --github-token (or set \$GITHUB_TOKEN) with a read-only PAT."
}

log "Fetching deploy config from $REPO_SLUG@$BRANCH (docker-compose.pull.yml + deploy/*.sh)..."
fetch_file docker-compose.pull.yml
fetch_file deploy/backup.sh
fetch_file deploy/restore.sh
fetch_file deploy/migrate-data.sh
chmod +x deploy/*.sh

[ -f docker-compose.pull.yml ] || die "docker-compose.pull.yml not found in $INSTALL_DIR after fetch — wrong --repo/--branch?"

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
