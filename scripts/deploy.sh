#!/usr/bin/env bash
set -euo pipefail

# ProdTrack v1.0.0 Deploy Script (T-062)
# Run from /opt/prodtrack on the VPS.

APP_DIR="/opt/prodtrack"
GIT_TAG="v1.0.0"
COMPOSE_PROJECT_NAME="prodtrack"

cd "${APP_DIR}"

# 1. Fetch latest repo and checkout tag
echo "[deploy] Pulling repository..."
if [ -d ".git" ]; then
    git fetch origin
    git checkout "${GIT_TAG}"
else
    echo "[deploy] ERROR: not a git repository."
    exit 1
fi

# 2. Create .env if missing
echo "[deploy] Checking .env..."
if [ ! -f ".env" ]; then
    echo "[deploy] Creating .env from .env.example..."
    cp .env.example .env
    # Generate secure DB password
    DB_PASS=$(openssl rand -hex 32)
    sed -i "s/change_me_in_production/${DB_PASS}/g" .env
    chmod 600 .env
    echo "[deploy] .env created with generated password."
else
    echo "[deploy] .env exists, preserving."
fi

# 3. Build and start containers
echo "[deploy] Building and starting containers..."
docker compose up -d --build

# Wait for postgres to be healthy
echo "[deploy] Waiting for postgres healthy..."
docker compose ps | grep "prodtrack_postgres" | grep "healthy" >/dev/null || {
    echo "[deploy] Waiting for healthcheck..."
    for i in $(seq 1 30); do
        if docker compose ps | grep "prodtrack_postgres" | grep "healthy" >/dev/null; then
            echo "[deploy] Postgres is healthy."
            break
        fi
        sleep 2
    done
}

# 4. Run migrations and seed (idempotent)
echo "[deploy] Running Prisma migrate deploy..."
docker compose exec -T web pnpm --filter @prodtrack/db db:migrate

echo "[deploy] Running seed (first pass)..."
docker compose exec -T web pnpm --filter @prodtrack/db db:seed

echo "[deploy] Running seed again (idempotency check)..."
docker compose exec -T web pnpm --filter @prodtrack/db db:seed

# 5. Smoke test
echo "[deploy] Smoke test: curl http://127.0.0.1:3000/login"
HTTP_CODE=$(curl -sI --max-time 10 "http://127.0.0.1:3000/login" -o /dev/null -w '%{http_code}' || true)
if [ "${HTTP_CODE}" = "200" ]; then
    echo "[deploy] Smoke test PASSED (HTTP 200)."
else
    echo "[deploy] Smoke test FAILED (HTTP ${HTTP_CODE})."
    exit 1
fi

# Check version in footer
echo "[deploy] Checking version in footer..."
if curl -s --max-time 10 "http://127.0.0.1:3000/login" | grep -q "v1.0.0"; then
    echo "[deploy] Version v1.0.0 found in page."
else
    echo "[deploy] WARNING: version v1.0.0 NOT found in page."
fi

echo "[deploy] Done."
