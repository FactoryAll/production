#!/usr/bin/env bash
set -uo pipefail

# ProdTrack — последеплойная проверка. Вывод скрипта и есть отчёт о развёртывании: его присылают целиком.
# Запуск на VPS:  cd /opt/prodtrack && bash scripts/postdeploy-check.sh
# Без записи в прод-базу:                bash scripts/postdeploy-check.sh --no-db-write
# Дев-стенд:                             bash scripts/postdeploy-check.sh --dev
#
# --dev переключает проверку на дев-стенд (docker-compose.dev.yml, порт 3001, своя база).
# По правилу docs/dev_environment.md доработка сначала проверяется на деве, и только потом
# едет в прод — один и тот же скрипт проверяет оба стенда, чтобы не расходились критерии.
#
# --no-db-write пропускает раздел 3 (prisma migrate deploy и двукратный сид). Нужен,
# когда развёртывание не меняет схему и трогать прод-данные не хочется: остальные
# разделы (коммит, контейнеры, смоук, версия, счётчики, канал, соседи, логи) — только чтение.
#
# Номер версии в шапке намеренно не указан: раньше здесь стояло «v1.2.0», и строка
# устарела молча вслед за релизом. Версия берётся из docker-compose.yml в разделе 2.
#
# Важно: приложение живёт в standalone-образе, где нет pnpm-воркспейса,
# поэтому миграции и сид запускаются через CLI prisma/tsx (они стоят в образе глобально).

APP_DIR="${PRODTRACK_DIR:-/opt/prodtrack}"

NO_DB_WRITE=0
DEV_STAND=0
for arg in "$@"; do
  case "${arg}" in
    --no-db-write) NO_DB_WRITE=1 ;;
    --dev) DEV_STAND=1 ;;
    -h|--help)
      # Шапка целиком: печать начинается с первого комментария и кончается на первой строке кода.
      awk '/^#!/ { next } f && !/^#/ { exit } /^#/ { sub(/^# ?/, ""); print; f=1 }' "$0"
      exit 0
      ;;
    *)
      echo "Неизвестный аргумент: ${arg}" >&2
      echo "Допустимо: --no-db-write, --dev, --help" >&2
      exit 2
      ;;
  esac
done

# cd — после разбора аргументов: --help и отказ на неизвестный флаг должны работать
# и вне сервера, а не упираться в отсутствующий /opt/prodtrack.
cd "${APP_DIR}" || { echo "Нет каталога ${APP_DIR}"; exit 1; }

# Какой стенд проверяем. Прод и дев отличаются только файлом compose, портом и подписью —
# логика проверок одна и та же, поэтому расхождению критериев взяться неоткуда.
if [ "${DEV_STAND}" = "1" ]; then
  COMPOSE=(docker compose -f docker-compose.dev.yml)
  STAND_NAME="ДЕВ-СТЕНД"
  APP_PORT="${PRODTRACK_PORT:-3001}"
  DOMAIN="prodtracker-dev.factoryall.ru"
  WEB_CONTAINER="prodtrack_dev_web"
  PG_CONTAINER="prodtrack_dev_postgres"
else
  COMPOSE=(docker compose)
  STAND_NAME="ПРОД"
  APP_PORT="${PRODTRACK_PORT:-3000}"
  DOMAIN="prodtracker.factoryall.ru"
  WEB_CONTAINER="prodtrack_web"
  PG_CONTAINER="prodtrack_postgres"
fi

# Выполняет SQL в контейнере postgres (SQL подаём в stdin — без экранирования кавычек).
db() {
  echo "$1" | "${COMPOSE[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

echo "=== 0. Стенд: ${STAND_NAME}, порт ${APP_PORT} ==="
echo
echo "=== 1. Коммит и контейнеры ==="
git log -1 --oneline
"${COMPOSE[@]}" ps

# Свежесть образа (ОПЭ-47). Коммит в каталоге и код в контейнере — разные вещи: сегодня
# контейнер «Up 5 hours» спокойно жил с новым git-коммитом, и проверка этого не замечала.
# Сравниваем время сборки образа со временем коммита.
WEB_IMAGE="$("${COMPOSE[@]}" images -q web 2>/dev/null | head -1)"
if [ -n "${WEB_IMAGE}" ]; then
  IMAGE_TS="$(docker image inspect -f '{{.Created}}' "${WEB_IMAGE}" 2>/dev/null || true)"
  if [ -n "${IMAGE_TS}" ]; then
    IMAGE_EPOCH="$(date -d "${IMAGE_TS}" +%s 2>/dev/null || echo 0)"
    COMMIT_EPOCH="$(git log -1 --format=%ct)"
    if [ "${IMAGE_EPOCH}" -lt "${COMMIT_EPOCH}" ]; then
      echo "ВНИМАНИЕ: образ собран раньше последнего коммита — контейнер работает на старом коде."
      echo "  образ:  ${IMAGE_TS}"
      echo "  коммит: $(git log -1 --format=%ci)"
      echo "  пересоберите: docker compose build && docker compose up -d"
    else
      echo "Образ собран после последнего коммита — код в контейнере актуален."
    fi
  fi
fi

echo
echo "=== 2. Смоук /login и версия в футере ==="
curl -sI --max-time 10 -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:${APP_PORT}/login
# Суффикс обязателен в шаблоне: прежняя регулярка `v[0-9]+\.[0-9]+\.[0-9]+` отрезала хвост
# и на деве показывала «v2.1.1» вместо «v2.1.1-dev» — стенды становились неразличимы.
VERSION_IN_PAGE=$(curl -s --max-time 10 http://127.0.0.1:${APP_PORT}/login | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?' | head -1 || true)
echo "версия в HTML: ${VERSION_IN_PAGE:-не найдена (проверьте футер в браузере)}"

echo
if [ "${NO_DB_WRITE}" = "1" ]; then
  echo "=== 3. Миграции и сид — ПРОПУЩЕНО (--no-db-write) ==="
  echo "В прод-базу ничего не писали. Если схема менялась — запустите без флага."
else
  echo "=== 3. Миграции и сид (идемпотентность) ==="
  "${COMPOSE[@]}" exec -T web sh -lc 'prisma migrate deploy --schema=/app/packages/db/prisma/schema.prisma || npx --yes prisma@5.22.0 migrate deploy --schema=/app/packages/db/prisma/schema.prisma'
  "${COMPOSE[@]}" exec -T web sh -lc 'cd /app/packages/db && (tsx prisma/seed.ts || npx --yes tsx@4.15.0 prisma/seed.ts)'
  "${COMPOSE[@]}" exec -T web sh -lc 'cd /app/packages/db && (tsx prisma/seed.ts || npx --yes tsx@4.15.0 prisma/seed.ts)'
fi

echo
echo "=== 4. Счётчики БД (пункт H) ==="
db 'SELECT count(*) AS notifications FROM notifications;'
db 'SELECT "eventCode", count(*) FROM notifications GROUP BY "eventCode" ORDER BY "eventCode";'
db 'SELECT count(*) AS discrepancies FROM discrepancies;'
db 'SELECT count(*) AS audit_records, count(*) FILTER (WHERE archived) AS archived FROM audit_records;'
db 'SELECT count(*) AS timings FROM stage_timings;'
db 'SELECT count(*) AS permissions, count(*) FILTER (WHERE code = '\''timing:read'\'') AS timing_read FROM permissions;'

echo
echo "=== 5. Канал уведомлений (SSE) ==="
curl -s -o /dev/null -w 'HTTP %{http_code} (ожидается 401 без cookie)\n' --max-time 8 http://127.0.0.1:${APP_PORT}/api/events/notifications

echo
echo "=== 6. Соседи по серверу ==="
curl -sI --max-time 10 https://mes-midex.factoryall.ru | head -1 || echo 'mes-midex DOWN'
curl -sI --max-time 10 https://tracker.factoryall.ru | head -1 || echo 'tracker DOWN'

echo
echo "=== 7. Что отдаёт домен (проверка nginx) ==="
echo '--- server_name в sites-enabled ---'
grep -rn 'server_name' /etc/nginx/sites-enabled/ 2>/dev/null || echo 'нет доступа к /etc/nginx'
echo '--- заголовки ответа домена ---'
curl -sI --max-time 10 "https://${DOMAIN}/login" | head -5 || echo 'домен недоступен'

echo
echo "=== 8. Логи web (последние 20 строк) ==="
"${COMPOSE[@]}" logs --tail=20 web

echo
echo "=== Проверка завершена. Пришлите вывод целиком. ==="
