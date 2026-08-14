#!/bin/bash
# Build và push Docker images lên Docker Hub
# Cần: docker login (phuc16)
# Chạy: ./scripts/build-push.sh [tag]

set -e
TAG="${1:-latest}"
DOCKER_USER="phuc16"

# Vite bakes VITE_* vars into the frontend build at compile time, so the
# build-arg has to be threaded through here — a container env var at deploy
# time would be too late. Sourced from the root .env (gitignored), same as
# every other secret in this script's environment; optional (see
# .env.example — an unset key just degrades the address field gracefully).
if [ -f .env ]; then
  VITE_GOONG_API_KEY=$(grep -E '^VITE_GOONG_API_KEY=' .env | cut -d '=' -f2-)
fi

echo "Building and pushing with tag: $TAG"

# Backend
docker build -t "$DOCKER_USER/cosplay-backend:$TAG" ./backend
docker push "$DOCKER_USER/cosplay-backend:$TAG"

# Frontend
docker build --build-arg VITE_GOONG_API_KEY="${VITE_GOONG_API_KEY:-}" -t "$DOCKER_USER/cosplay-frontend:$TAG" ./frontend
docker push "$DOCKER_USER/cosplay-frontend:$TAG"

echo "Done: $DOCKER_USER/cosplay-backend:$TAG, $DOCKER_USER/cosplay-frontend:$TAG"
