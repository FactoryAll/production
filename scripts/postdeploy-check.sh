#!/usr/bin/env bash
set -uo pipefail

# ProdTrack v1.2.0 — последеплойная проверка.
# Запуск на VPS:  cd /opt/prodtrack && bash scripts/postdeploy-check.sh
# Вывод скрипта можно прислать целиком: он покрывает шаги 0.1-0.4 плана ручного тестирования.

APP_DIR="/opt/prodtrack"
cd "${APP_DIR}" || { echo "Нет каталога ${APP_DIR}"; exit 1; }

echo "=== 1. Коммит и контейнеры ==="
git log -1 --oneline
docker compose ps

echo
echo "=== 2. Смоук /login и версия в футере ==="
curl -sI --max-time 10 -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/login
curl -s --max-time 10 http://127.0.0.1:3000/login | grep -o 'ProdTrack v[0-9.]*' | head -1 || echo 'версия в футере не найдена'

echo
echo "=== 3. Миграции и сид (идемпотентность) ==="
docker compose exec -T web pnpm --filter @prodtrack/db db:migrate
docker compose exec -T web pnpm --filter @prodtrack/db db:seed
docker compose exec -T web pnpm --filter @prodtrack/db db:seed

echo
echo "=== 4. Счётчики БД (пункт H) ==="
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) AS notifications FROM notifications;"'
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT event_code, count(*) FROM notifications GROUP BY event_code ORDER BY event_code;"'
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) AS discrepancies FROM discrepancies;"'
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) AS audit_records, count(*) FILTER (WHERE archived) AS archived FROM audit_records;"'
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) AS timings FROM stage_timings;"'

echo
echo "=== 5. Канал уведомлений (SSE) ==="
curl -s -o /dev/null -w 'HTTP %{http_code} (ожидается 401 без cookie)\n' --max-time 8 http://127.0.0.1:3000/api/events/notifications

echo
echo "=== 6. Соседи по серверу ==="
curl -sI --max-time 10 https://mes-midex.factoryall.ru | head -1 || echo 'mes-midex DOWN'
curl -sI --max-time 10 https://tracker.factoryall.ru | head -1 || echo 'tracker DOWN'

echo
echo "=== 7. Логи web (последние 20 строк) ==="
docker compose logs --tail=20 web

echo
echo "=== Проверка завершена. Пришлите вывод целиком. ==="
