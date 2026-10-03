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
   в справочнике на экране «Роли». При плановом деплое полезно выполнить `pnpm db:seed` или
   `bash scripts/deploy.sh`.

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
