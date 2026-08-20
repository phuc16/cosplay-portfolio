#!/bin/bash
# Build và push Docker images lên Docker Hub
# Cần: docker login (phuc16)
# Chạy: ./scripts/build-push.sh [tag]

set -e
TAG="${1:-latest}"
DOCKER_USER="phuc16"
PLATFORM="linux/amd64"

echo "Building and pushing with tag: $TAG (platform: $PLATFORM)"

# buildx --platform forces a plain linux/amd64 manifest. Plain `docker build`
# on an Apple Silicon host stamps the pushed image with the build VM's
# detected CPU microarchitecture level (e.g. amd64/v3) instead — a cloud VPS
# whose CPU doesn't support that exact level then fails to pull it with
# "no matching manifest", even though it's a completely ordinary amd64 box.
docker buildx build --platform "$PLATFORM" --provenance=false \
  -t "$DOCKER_USER/cosplay-backend:$TAG" --push ./backend

docker buildx build --platform "$PLATFORM" --provenance=false \
  -t "$DOCKER_USER/cosplay-frontend:$TAG" --push ./frontend

echo "Done: $DOCKER_USER/cosplay-backend:$TAG, $DOCKER_USER/cosplay-frontend:$TAG"
