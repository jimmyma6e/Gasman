#!/usr/bin/env bash
# Deploy GASMAN to QNAP NAS via Tailscale
# Usage: ./deploy.sh [--no-cache]

set -euo pipefail

NAS_HOST="100.127.25.89"
NAS_USER="admin"
NAS_KEY="$HOME/.ssh/qnap_household_budget"
NAS_DIR="/share/Container/gasman"
IMAGE="gasman:latest"
NO_CACHE="${1:-}"

SSH="ssh -i $NAS_KEY -o StrictHostKeyChecking=no $NAS_USER@$NAS_HOST"

echo "==> Building Docker image locally..."
docker build $NO_CACHE -t "$IMAGE" .

echo "==> Saving image..."
docker save "$IMAGE" | gzip > /tmp/gasman-image.tar.gz

echo "==> Copying compose file to NAS..."
$SSH "mkdir -p $NAS_DIR"
scp -i "$NAS_KEY" -o StrictHostKeyChecking=no \
    docker-compose.yml "$NAS_USER@$NAS_HOST:$NAS_DIR/docker-compose.yml"

echo "==> Copying image to NAS (persistent share, not /tmp)..."
scp -i "$NAS_KEY" -o StrictHostKeyChecking=no \
    /tmp/gasman-image.tar.gz "$NAS_USER@$NAS_HOST:$NAS_DIR/gasman-image.tar.gz"

echo "==> Loading image and restarting on NAS..."
$SSH "
  docker load < $NAS_DIR/gasman-image.tar.gz
  rm $NAS_DIR/gasman-image.tar.gz
  cd $NAS_DIR
  docker compose down --remove-orphans
  docker compose up -d
  docker compose ps
"

rm /tmp/gasman-image.tar.gz
echo "==> Done. GASMAN running — accessible via cloudflared as http://gasman:8000"
