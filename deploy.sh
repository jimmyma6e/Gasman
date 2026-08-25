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

# QNAP's Container Station docker binary isn't on the default non-interactive
# SSH PATH, and wrapping remote commands in a login shell (bash -lc) to fix
# that trips QNAP's console-menu handler ("Inappropriate ioctl for device").
# Call docker by its absolute path instead.
NAS_DOCKER="/share/CACHEDEV1_DATA/.qpkg/container-station/usr/bin/.libs/docker"

SSH="ssh -i $NAS_KEY -o StrictHostKeyChecking=no $NAS_USER@$NAS_HOST"

echo "==> Building Docker image locally (linux/amd64 for QNAP)..."
# Apple Silicon Macs build arm64 by default; the QNAP is amd64. Without
# --platform the container crashes on the NAS with "exec format error".
docker build --platform linux/amd64 $NO_CACHE -t "$IMAGE" .

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
  $NAS_DOCKER load < $NAS_DIR/gasman-image.tar.gz
  rm $NAS_DIR/gasman-image.tar.gz
  cd $NAS_DIR
  $NAS_DOCKER compose up -d --force-recreate --remove-orphans
  $NAS_DOCKER compose ps
"

rm /tmp/gasman-image.tar.gz
echo "==> Done. GASMAN running — accessible via cloudflared as http://gasman:8000"
