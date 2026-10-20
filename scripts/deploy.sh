#!/usr/bin/env bash
set -euo pipefail

# ProdTrack — развёртывание на VPS (T-062).
# Запуск: bash scripts/deploy.sh <тег-или-коммит>   (например: bash scripts/deploy.sh v2.1.1)
#
# ПОЧЕМУ ТЕГ — АРГУМЕНТ, А НЕ КОНСТАНТА В СКРИПТЕ.
# Раньше здесь было `GIT_TAG="v1.2.0"` и `git checkout "${GIT_TAG}"`. Документ
# (`docs/deploy_vps.md`, раздел «Обновление на конкретный тег») предлагал этот скрипт как
# способ обновиться на нужную версию — то есть команда выглядела безобидной, а на деле
# молча откатывала стенд к v1.2.0. Ошибку заметили при подготовке редеплоя 17.10.2026.
# Теперь без аргумента скрипт отказывает, а не угадывает.

APP_DIR="${PRODTRACK_DIR:-/opt/prodtrack}"
COMPOSE_PROJECT_NAME="prodtrack"

TARGET="${1:-}"

if [ -z "${TARGET}" ]; then
    echo "[deploy] ОТКАЗ: не указан тег или коммит." >&2
    echo "         Использование: bash scripts/deploy.sh <тег-или-коммит>" >&2
    echo "         Например:      bash scripts/deploy.sh v2.1.1" >&2
    exit 1
fi

cd "${APP_DIR}"

# 1. Репозиторий и переход на указанную версию
echo "[deploy] Fetching origin (tags included)..."
if [ ! -d ".git" ]; then
    echo "[deploy] ERROR: not a git repository." >&2
    exit 1
fi
git fetch origin --tags || {
    echo "[deploy] ОТКАЗ: не удалось получить обновления с origin (сеть или права)." >&2
    exit 1
}

# Проверяем цель до checkout: иначе сообщение git будет невнятным и легко принять опечатку
# за сетевую ошибку.
if ! git rev-parse --verify --quiet "${TARGET}^{commit}" >/dev/null; then
    echo "[deploy] ОТКАЗ: '${TARGET}' не найден ни как ветка, ни как тег, ни как коммит." >&2
    exit 1
fi

echo "[deploy] Checking out ${TARGET}..."
git checkout "${TARGET}"
echo "[deploy] Развёртывается коммит: $(git log -1 --oneline)"

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
# Важно: в standalone-образе нет pnpm-воркспейса, поэтому `pnpm --filter` не работает
# («No projects matched the filters in "/app"»). Используем глобальные prisma/tsx из образа.
echo "[deploy] Running Prisma migrate deploy..."
docker compose exec -T web sh -lc 'prisma migrate deploy --schema=/app/packages/db/prisma/schema.prisma || npx --yes prisma@5.22.0 migrate deploy --schema=/app/packages/db/prisma/schema.prisma'

echo "[deploy] Running seed (first pass)..."
docker compose exec -T web sh -lc 'cd /app/packages/db && (tsx prisma/seed.ts || npx --yes tsx@4.15.0 prisma/seed.ts)'

echo "[deploy] Running seed again (idempotency check)..."
docker compose exec -T web sh -lc 'cd /app/packages/db && (tsx prisma/seed.ts || npx --yes tsx@4.15.0 prisma/seed.ts)'

# 5. Smoke test
echo "[deploy] Smoke test: curl http://127.0.0.1:3000/login"
HTTP_CODE=$(curl -sI --max-time 10 "http://127.0.0.1:3000/login" -o /dev/null -w '%{http_code}' || true)
if [ "${HTTP_CODE}" = "200" ]; then
    echo "[deploy] Smoke test PASSED (HTTP 200)."
else
    echo "[deploy] Smoke test FAILED (HTTP ${HTTP_CODE})."
    exit 1
fi

# Версию в футере сверяем со значением из compose, а не с прошитой строкой: версия
# встраивается при сборке из docker-compose.yml, и константа в скрипте устаревает молча.
DEPLOY_VERSION="$(grep -m1 -oE 'VERSION: *v[0-9]+\.[0-9]+\.[0-9]+' docker-compose.yml | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' || true)"
echo "[deploy] Checking version in footer (ожидается ${DEPLOY_VERSION:-неизвестно})..."
if [ -n "${DEPLOY_VERSION}" ] && curl -s --max-time 10 "http://127.0.0.1:3000/login" | grep -q "${DEPLOY_VERSION}"; then
    echo "[deploy] Version ${DEPLOY_VERSION} found in page."
else
    echo "[deploy] WARNING: version ${DEPLOY_VERSION:-из compose} NOT found in page."
fi

echo "[deploy] Done. Дальше: bash scripts/postdeploy-check.sh"
