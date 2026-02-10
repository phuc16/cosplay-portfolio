#!/bin/bash
# Build và push Docker images lên Docker Hub
# Cần: docker login (phuc16)
# Chạy: ./scripts/build-push.sh [tag]

set -e
TAG="${1:-latest}"
DOCKER_USER="phuc16"

echo "Building and pushing with tag: $TAG"

# Backend
docker build -t "$DOCKER_USER/cosplay-backend:$TAG" ./backend
docker push "$DOCKER_USER/cosplay-backend:$TAG"

# Frontend
docker build -t "$DOCKER_USER/cosplay-frontend:$TAG" ./frontend
docker push "$DOCKER_USER/cosplay-frontend:$TAG"

echo "Done: $DOCKER_USER/cosplay-backend:$TAG, $DOCKER_USER/cosplay-frontend:$TAG"
