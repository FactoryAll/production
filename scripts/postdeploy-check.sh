#!/usr/bin/env bash
set -uo pipefail

# ProdTrack v1.2.0 — последеплойная проверка.
# Запуск на VPS:  cd /opt/prodtrack && bash scripts/postdeploy-check.sh
#
# Важно: приложение живёт в standalone-образе, где нет pnpm-воркспейса,
# поэтому миграции и сид запускаются через CLI prisma/tsx (они стоят в образе глобально).

APP_DIR="/opt/prodtrack"
cd "${APP_DIR}" || { echo "Нет каталога ${APP_DIR}"; exit 1; }

# Выполняет SQL в контейнере postgres (SQL подаём в stdin — без экранирования кавычек).
db() {
  echo "$1" | docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

echo "=== 1. Коммит и контейнеры ==="
git log -1 --oneline
docker compose ps

echo
echo "=== 2. Смоук /login и версия в футере ==="
curl -sI --max-time 10 -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/login
VERSION_IN_PAGE=$(curl -s --max-time 10 http://127.0.0.1:3000/login | grep -o 'v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*' | head -1 || true)
echo "версия в HTML: ${VERSION_IN_PAGE:-не найдена (проверьте футер в браузере)}"

echo
echo "=== 3. Миграции и сид (идемпотентность) ==="
docker compose exec -T web sh -lc 'prisma migrate deploy --schema=/app/packages/db/prisma/schema.prisma || npx --yes prisma@5.22.0 migrate deploy --schema=/app/packages/db/prisma/schema.prisma'
docker compose exec -T web sh -lc 'cd /app/packages/db && (tsx prisma/seed.ts || npx --yes tsx@4.15.0 prisma/seed.ts)'
docker compose exec -T web sh -lc 'cd /app/packages/db && (tsx prisma/seed.ts || npx --yes tsx@4.15.0 prisma/seed.ts)'

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
curl -s -o /dev/null -w 'HTTP %{http_code} (ожидается 401 без cookie)\n' --max-time 8 http://127.0.0.1:3000/api/events/notifications

echo
echo "=== 6. Соседи по серверу ==="
curl -sI --max-time 10 https://mes-midex.factoryall.ru | head -1 || echo 'mes-midex DOWN'
curl -sI --max-time 10 https://tracker.factoryall.ru | head -1 || echo 'tracker DOWN'

echo
echo "=== 7. Что отдаёт домен (проверка nginx) ==="
echo '--- server_name в sites-enabled ---'
grep -rn 'server_name' /etc/nginx/sites-enabled/ 2>/dev/null || echo 'нет доступа к /etc/nginx'
echo '--- заголовки ответа домена ---'
curl -sI --max-time 10 https://prodtracker.factoryall.ru/login | head -5 || echo 'домен недоступен'

echo
echo "=== 8. Логи web (последние 20 строк) ==="
docker compose logs --tail=20 web

echo
echo "=== Проверка завершена. Пришлите вывод целиком. ==="
