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
git checkout v1.0.0
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

Проверьте, что в HTML есть `ProdTrack v1.0.0`.

## Проверка соседей

После деплоя убедитесь, что другие сервисы живы:
```bash
curl -sI https://mes-midex.factoryall.ru || echo "mes-midex DOWN"
curl -sI https://tracker.factoryall.ru || echo "tracker DOWN"
```

## Обновление

Для обновления на новый тег:
```bash
cd /opt/prodtrack
git fetch origin
git checkout vX.Y.Z
./scripts/deploy.sh
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
