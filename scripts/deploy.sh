#!/usr/bin/env bash
set -euo pipefail

# ProdTrack — развёртывание на VPS (T-062).
# Запуск: bash scripts/deploy.sh <тег-или-коммит>   (например: bash scripts/deploy.sh v2.1.1)
#
# НА СЕРВЕРЕ С МАЛОЙ ПАМЯТЬЮ (Timeweb, 1 ГБ) ЭТОТ СКРИПТ СОБИРАТЬ НЕ ДОЛЖЕН.
# Измерено 03.11.2026: сборка Next.js — 740 МБ на процесс и до ~2 ГБ на дерево процессов;
# на 1 ГБ рядом с postgres и nginx это OOM. Поэтому скрипт сам проверяет память и при
# MemTotal < 2 ГБ отказывается собирать (см. `--no-build` ниже и docs/deploy_timeweb.md).
#
# ПОЧЕМУ ТЕГ — АРГУМЕНТ, А НЕ КОНСТАНТА В СКРИПТЕ.
# Раньше здесь было `GIT_TAG="v1.2.0"` и `git checkout "${GIT_TAG}"`. Документ
# (`docs/deploy_vps.md`, раздел «Обновление на конкретный тег») предлагал этот скрипт как
# способ обновиться на нужную версию — то есть команда выглядела безобидной, а на деле
# молча откатывала стенд к v1.2.0. Ошибку заметили при подготовке редеплоя 17.10.2026.
# Теперь без аргумента скрипт отказывает, а не угадывает.

APP_DIR="${PRODTRACK_DIR:-/opt/prodtrack}"
COMPOSE_PROJECT_NAME="prodtrack"

# ФАЙЛЫ COMPOSE. На малом сервере нужен второй слой (docker-compose.timeweb.yml):
# лимиты памяти, настройки postgres под 1 ГБ и ограничение логов. Без него контейнеры
# поднимаются без потолков — то есть ровно так, как ломается на гигабайте.
#
# Раньше скрипт всегда звал `docker compose` с одним файлом, и перенесённый образ
# (prodtrack-web:<тег>) не находился: в базовом compose у сервиса web нет поля image,
# compose ждал образ prodtrack-web без тега. Теперь слой подключается явно.
#
# Переопределяется списком: PRODTRACK_COMPOSE_FILES="-f a.yml -f b.yml".
# Память сервера: сборка на слабой машине убьёт и приложение, и базу.
# Файл можно подменить через PRODTRACK_MEMINFO_FILE — это нужно для проверки самой проверки.
MEMINFO="${PRODTRACK_MEMINFO_FILE:-/proc/meminfo}"
MEM_TOTAL_MB=0
if [ -r "${MEMINFO}" ]; then
    MEM_TOTAL_MB="$(awk '/^MemTotal:/ {printf "%d", $2/1024}' "${MEMINFO}" 2>/dev/null || echo 0)"
fi

COMPOSE=(docker compose)
if [ -n "${PRODTRACK_COMPOSE_FILES:-}" ]; then
    # shellcheck disable=SC2206
    COMPOSE+=( ${PRODTRACK_COMPOSE_FILES} )
elif [ -f docker-compose.timeweb.yml ] && [ "${MEM_TOTAL_MB}" -lt 2048 ] 2>/dev/null; then
    COMPOSE+=( -f docker-compose.yml -f docker-compose.timeweb.yml )
fi

TARGET=""
NO_BUILD=0
for arg in "$@"; do
    case "${arg}" in
        --no-build) NO_BUILD=1 ;;
        -*) echo "[deploy] ОТКАЗ: неизвестный флаг ${arg}. Допустимо: --no-build." >&2; exit 1 ;;
        *) TARGET="${arg}" ;;
    esac
done

if [ -z "${TARGET}" ]; then
    echo "[deploy] ОТКАЗ: не указан тег или коммит." >&2
    echo "         Использование: bash scripts/deploy.sh <тег-или-коммит> [--no-build]" >&2
    echo "         Например:      bash scripts/deploy.sh v2.1.1" >&2
    echo "         На малом сервере (1 ГБ): --no-build с заранее перенесённым образом." >&2
    exit 1
fi


if [ "${NO_BUILD}" -eq 0 ] && [ "${MEM_TOTAL_MB}" -gt 0 ] && [ "${MEM_TOTAL_MB}" -lt 2048 ]; then
    echo "[deploy] ОТКАЗ: на этой машине ${MEM_TOTAL_MB} МБ памяти — сборка образа уйдёт в OOM." >&2
    echo "         Измерено: сборка Next.js берёт 740 МБ на процесс и до ~2 ГБ на дерево." >&2
    echo "" >&2
    echo "         Соберите образ на рабочей машине и перенесите:" >&2
    echo "           docker build --platform linux/amd64 -t prodtrack-web:<тег> -f apps/web/Dockerfile ." >&2
    echo "           docker save prodtrack-web:<тег> | gzip -1 | ssh <user>@<ip> 'gunzip | docker load'" >&2
    echo "         Затем здесь: bash scripts/deploy.sh <тег> --no-build" >&2
    echo "         Подробно — docs/deploy_timeweb.md." >&2
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
if [ "${NO_BUILD}" -eq 1 ]; then
    echo "[deploy] Запуск БЕЗ сборки (--no-build): используется перенесённый образ."
    if ! docker image inspect "prodtrack-web:${TARGET}" >/dev/null 2>&1; then
        echo "[deploy] ОТКАЗ: образа prodtrack-web:${TARGET} нет на машине." >&2
        echo "         Перенесите его (docs/deploy_timeweb.md, шаг 3) или уберите --no-build." >&2
        exit 1
    fi
    "${COMPOSE[@]}" up -d --no-build
else
    echo "[deploy] Building and starting containers..."
    "${COMPOSE[@]}" up -d --build
fi

# Wait for postgres to be healthy (не дольше ~60 с: дальше ждать бессмысленно — если база
# не поднялась, смотреть логи, а не ждать)
echo "[deploy] Waiting for postgres healthy..."
DB_READY=0
for i in $(seq 1 30); do
    if "${COMPOSE[@]}" ps 2>/dev/null | grep "prodtrack_postgres" | grep "healthy" >/dev/null; then
        DB_READY=1
        echo "[deploy] Postgres is healthy."
        break
    fi
    sleep 2
done
if [ "${DB_READY}" -eq 0 ]; then
    echo "[deploy] ВНИМАНИЕ: postgres не отчитался как healthy за 60 с." >&2
    echo "          Смотрите: docker compose logs --tail=40 postgres" >&2
fi

# 4. Run migrations and seed (idempotent)
# Важно: в standalone-образе нет pnpm-воркспейса, поэтому `pnpm --filter` не работает
# («No projects matched the filters in "/app"»). Используем глобальные prisma/tsx из образа.
echo "[deploy] Running Prisma migrate deploy..."
"${COMPOSE[@]}" exec -T web sh -lc 'prisma migrate deploy --schema=/app/packages/db/prisma/schema.prisma || npx --yes prisma@5.22.0 migrate deploy --schema=/app/packages/db/prisma/schema.prisma'

echo "[deploy] Running seed (first pass)..."
"${COMPOSE[@]}" exec -T web sh -lc 'cd /app/packages/db && (tsx prisma/seed.ts || npx --yes tsx@4.15.0 prisma/seed.ts)'

echo "[deploy] Running seed again (idempotency check)..."
"${COMPOSE[@]}" exec -T web sh -lc 'cd /app/packages/db && (tsx prisma/seed.ts || npx --yes tsx@4.15.0 prisma/seed.ts)'

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
