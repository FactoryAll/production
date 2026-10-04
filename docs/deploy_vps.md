# Деплой ProdTrack на VPS (ПРОЦ-03)

> **Важно:** сервер разделяемый. На нём уже работают сервисы 
> `mes-midex.factoryall.ru`, `tracker.factoryall.ru` и их контейнеры.
> **Ничего не трогайте**, кроме конфигурации для `prodtracker.factoryall.ru`.

## Требования к серверу (аудит)

- Ubuntu 24.04 LTS
- Docker ≥ 24.x и Docker Compose (`docker compose`)
- nginx + certbot (Let's Encrypt)
- Доступ по SSH-ключу (root разрешён)
- RAM ≥ 3.8 GB, диск ≥ 20 GB свободно
- Порт 3000 свободен на localhost
- Домен `prodtracker.factoryall.ru` → A-запись на IP сервера

## Шаги развёртывания

### 1. Клонирование и подготовка

```bash
mkdir -p /opt/prodtrack
cd /opt/prodtrack
git clone https://github.com/FactoryAll/production.git .
git checkout v1.1.0
```

### 2. Переменные окружения

```bash
cp .env.example .env
# Отредактируйте .env (особенно POSTGRES_PASSWORD)
chmod 600 .env
```

Если `.env` уже существует — сохраните его.

### 3. Запуск ProdTrack

```bash
./scripts/deploy.sh
```

Скрипт выполнит:
- `docker compose up -d --build`
- Ожидание healthy postgres
- `prisma migrate deploy`
- Сид ×2 (идемпотентность)
- Смоук (curl /login)

### 4. Настройка nginx (хостовый)

**Бэкап существующих конфигов:**
```bash
cp -r /etc/nginx/sites-enabled /root/nginx-backup-$(date +%F)
```

**Добавить конфиг:**
```bash
cp docs/nginx/prodtracker.factoryall.ru.conf /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/prodtracker.factoryall.ru.conf /etc/nginx/sites-enabled/
nginx -t
```

**Если `nginx -t` OK — reload:**
```bash
systemctl reload nginx
```

**Если `nginx -t` FAIL — восстановить:**
```bash
rm /etc/nginx/sites-enabled/prodtracker.factoryall.ru.conf
cp -r /root/nginx-backup-$(date +%F)/* /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 5. SSL (Let's Encrypt)

```bash
certbot --nginx -d prodtracker.factoryall.ru --non-interactive --agree-tos
```

### 6. Смоук-тест

```bash
# Локально
curl -sI http://127.0.0.1:3000/login
# Через домен
curl -sI https://prodtracker.factoryall.ru/login
```

Проверьте, что в HTML есть `ProdTrack v1.1.0`.

## Проверка соседей

После деплоя убедитесь, что другие сервисы живы:
```bash
curl -sI https://mes-midex.factoryall.ru || echo "mes-midex DOWN"
curl -sI https://tracker.factoryall.ru || echo "tracker DOWN"
```

## Обновление

### Проверенная процедура редеплоя (использовать именно её)

Выполняется **на VPS пользователем** (владельцем продукта) — у агента доступа к серверу нет.
Агент присылает эти команды, пользователь выполняет и возвращает вывод.

```bash
cd /opt/prodtrack
git pull origin main
git log -1 --oneline            # убедиться, что подтянулся нужный коммит
docker compose down
docker compose build --no-cache
docker compose up -d
sleep 20
docker compose logs --tail=10 web
```

После деплоя — смоук: открыть https://prodtracker.factoryall.ru/login и проверить версию в футере
(должна совпадать со значением `VERSION` в `docker-compose.yml`).

### Важные особенности (проверено на практике)

1. **Версия в футере задаётся в `docker-compose.yml`** (build arg `VERSION` и переменная окружения),
   а не в `.env` и не git-тегом автоматически. Чтобы футер показал новую версию, нужно:
   - поднять значение в `docker-compose.yml` (и `.env.example`),
   - пересобрать образ (`docker compose build --no-cache`).

   Значение **встраивается на этапе сборки** (`next.config.js` → `env.VERSION`), а не читается в рантайме:
   правка `VERSION` в `.env` без пересборки образа на футер не влияет (проверено дымовым тестом
   production-сборки, см. `docs/phase_4_selfcheck_report.md` §2.2).
2. **`docker build -t … .` из корня репозитория не работает** — Dockerfile лежит в `apps/web/Dockerfile`
   и используется только через `docker compose`. Собирать нужно через compose.
3. **`docker compose down` удаляет контейнеры вместе с их логами.** Если нужно разобрать ошибку —
   снять лог **до** перезапуска:
   ```bash
   docker compose logs --tail=50 web
   ```
   Либо использовать `docker compose restart` (логи сохраняются) вместо `down` + `up`.
4. **`scripts/deploy.sh` может не иметь бита выполнения** («Permission denied»). Тогда:
   `bash scripts/deploy.sh`. Скрипт дополнительно выполняет `prisma migrate deploy`, идемпотентный
   `pnpm db:seed` и смоук; при ручном редеплое через `docker compose` сид не запускается.
5. **Сервер общий.** Кроме ProdTrack на нём работают `mes-midex.factoryall.ru` и `tracker.factoryall.ru`.
   Ничего, кроме конфигурации ProdTrack, не трогать. После деплоя проверять соседей:
   ```bash
   curl -sI https://mes-midex.factoryall.ru || echo "mes-midex DOWN"
   curl -sI https://tracker.factoryall.ru || echo "tracker DOWN"
   ```
6. **Сид после изменений матрицы прав.** Права проверяются кодом (`packages/contracts`), поэтому
   работоспособность от сида не зависит. Сид нужен только чтобы новые коды прав появились
   в справочнике на экране «Роли».

   **Важно (проверено на проде 03.10.2026): в контейнере нет pnpm-воркспейса**, поэтому команда
   `docker compose exec -T web pnpm --filter @prodtrack/db db:seed` падает с
   `No projects matched the filters in "/app"` — сид при таком вызове не выполняется. Рабочий способ —
   глобальные `prisma` и `tsx`, установленные в образ:

   ```bash
   cd /opt/prodtrack
   docker compose exec -T web sh -lc 'prisma migrate deploy --schema=/app/packages/db/prisma/schema.prisma'
   docker compose exec -T web sh -lc 'cd /app/packages/db && tsx prisma/seed.ts'   # и повторить для проверки идемпотентности
   ```

7. **Конфиг nginx правим аккуратно.** Если файл сайта до этого менял `certbot --nginx`,
   в нём есть блок `listen 443 ssl` с сертификатами. Копирование файла целиком из репозитория
   затрёт эти строки и может уронить HTTPS: перед копированием снимите бэкап и после копирования
   проверьте, что `nginx -T | grep -A2 'server_name prodtracker'` показывает и 80, и 443.
   Для одного лишь SSE-блока (он нужен только для real-time) достаточно вставить `location /api/events/`
   в существующий конфиг.

### Последеплойная проверка одним скриптом (с v1.2.0)

```bash
cd /opt/prodtrack
bash scripts/postdeploy-check.sh
```

Скрипт проверяет коммит и контейнеры, смоук `/login` и версию в футере, прогоняет `db:migrate` и `db:seed` ×2
(идемпотентность), выгружает счётчики `notifications`/`discrepancies`/`audit_records`/`stage_timings`,
проверяет ответ канала уведомлений (401 без cookie) и доступность соседних сервисов, печатает последние логи.

### SSE-канал уведомлений и nginx (с v1.2.0)

Центр уведомлений использует Server-Sent Events: `/api/events/notifications`. Приложение отдаёт
заголовок `X-Accel-Buffering: no` и keep-alive-кадр каждые 15 секунд, но надёжнее явно отключить
буферизацию в nginx — иначе кадры могут копиться в буфере прокси и real-time перестанет работать.

Действия при первом деплое релиза с SSE (один раз):

```bash
cp -r /etc/nginx/sites-enabled /root/nginx-backup-$(date +%F)
cd /opt/prodtrack
cp docs/nginx/prodtracker.factoryall.ru.conf /etc/nginx/sites-available/
nginx -t
systemctl reload nginx
```

Проверка, что канал открыт и не буферизуется (в заголовках должен быть `text/event-stream`):

```bash
curl -sS -N -D - -o /dev/null --max-time 6 \
  -H "Cookie: session=<значение cookie сессии>" \
  https://prodtracker.factoryall.ru/api/events/notifications | head -12
```

> Cookie сессии берётся из браузера (DevTools → Application → Cookies → `session`). Без cookie
> канал отвечает `401` — это ожидаемое поведение (M09 BR-5).

### Регулярная архивация аудита (Р-16, с v1.2.0)

Аудит-записи старше 12 месяцев не удаляются, а помечаются `archived = true` (M13 BR-6).
Архивация идемпотентна: повторный запуск ничего не меняет.

Ручной запуск (внутри контейнера, как `db:migrate` в `scripts/deploy.sh`):

```bash
cd /opt/prodtrack
docker compose exec -T web pnpm --filter @prodtrack/db db:archive-audit
```

По расписанию (cron, ежедневно в 03:00):

```bash
crontab -e
# добавить строку:
0 3 * * * cd /opt/prodtrack && docker compose exec -T web pnpm --filter @prodtrack/db db:archive-audit >> /var/log/prodtrack-archive.log 2>&1
```

Альтернатива для АДМ: кнопка «Архивировать старые записи» на экране «Аудит» — та же операция.

### Обновление на конкретный тег (альтернатива)

```bash
cd /opt/prodtrack
git fetch origin
git checkout vX.Y.Z
bash scripts/deploy.sh
```

## Рекомендуемый харденинг после стабилизации

1. **SSH:** `PermitRootLogin prohibit-password` в `/etc/ssh/sshd_config`.
2. **Firewall:** включить `ufw`, открыть только 22, 80, 443.
3. **Пользователь:** создать отдельного админа (не root) для деплоя.
4. **Мониторинг:** настроить alerts на падение контейнеров.

## Откат

Если ProdTrack не работает после деплоя:
```bash
cd /opt/prodtrack
docker compose down
# Восстановить nginx из бэкапа (см. шаг 4)
```

## Поддержка

- Логи: `docker compose logs -f web` / `docker compose logs -f postgres`
- Контейнеры: `docker compose ps`
- Сеть: `docker network ls | grep prodtrack`
