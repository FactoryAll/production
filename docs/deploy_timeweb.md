# Прод ProdTrack на Timeweb (1 vCPU, 1 ГБ RAM, 15 ГБ NVMe)

> **Отличие от прежнего деплоя.** Здесь поднимается **только прод**. Дев- и фикс-стенды
> на этой машине не живут: 1 ГБ не хватит на три приложения и три базы. Доработки
> проверяются локально, а на сервер попадает то, что уже проверено.

## 0. Что понадобится от владельца

| Что | Зачем |
|---|---|
| IP сервера и доступ по SSH (root или sudo-пользователь) | зайти и развернуть |
| Имена доменов/поддоменов под прод (например `prodtracker.timeweb.example`) | A-запись и сертификат |
| Доступ к DNS-зоне | переключить A-записи (TTL уже короткий — 5–10 минут) |
| Пароль базы (сгенерируем) | `.env` на сервере |
| Куда складывать бэкапы за пределами сервера | S3 Timeweb или второй хост |

## 1. Подготовка сервера

```bash
apt update && apt upgrade -y
apt install -y nginx certbot python3-certbot-nginx fail2ban apache2-utils git curl

# Docker
curl -fsSL https://get.docker.com | sh

# SWAP — без него 1 ГБ не переживёт сборку мусора и пики postgres
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.conf

# Firewall
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 2. Код и окружение

```bash
mkdir -p /opt/prodtrack && cd /opt/prodtrack
git clone https://github.com/FactoryAll/production.git .
git checkout v2.9.3            # тег версии, которую выпускаем

cp .env.example .env
# заполнить POSTGRES_PASSWORD и DATABASE_URL (пароль в строке подключения — тот же)
# VERSION в .env должен совпадать с тегом
chmod 600 .env
```

## 3. Сборка образа — на рабочей машине, не на сервере

Next.js на 1 ГБ собирается в OOM. Собираем локально и переносим готовый образ.

**На рабочей машине** (в каталоге репозитория):

```bash
docker build -t prodtrack-web:v2.9.3 -f apps/web/Dockerfile --build-arg VERSION=v2.9.3 .
docker save prodtrack-web:v2.9.3 | gzip -1 | ssh <user>@<ip> 'gunzip | docker load'
```

**На сервере:**

```bash
cd /opt/prodtrack
docker images | grep prodtrack-web        # образ на месте
```

> Если собирать всё же на сервере, то только с `NODE_OPTIONS=--max-old-space-size=768`
> и при включённом swap — и следите за `dmesg | tail` на OOM. Этот путь медленнее и
> ненадёжнее; основной — перенос образа.

## 4. Запуск

```bash
cd /opt/prodtrack

# схема и данные — вручную, контейнер их не накатывает
docker compose -f docker-compose.yml -f docker-compose.timeweb.yml up -d --no-build postgres
sleep 10
docker compose -f docker-compose.yml -f docker-compose.timeweb.yml run --rm --no-deps web \
  sh -lc 'prisma migrate deploy --schema=/app/packages/db/prisma/schema.prisma'
docker compose -f docker-compose.yml -f docker-compose.timeweb.yml run --rm --no-deps web \
  sh -lc 'cd /app/packages/db && tsx prisma/seed.ts'

# приложение
docker compose -f docker-compose.yml -f docker-compose.timeweb.yml up -d --no-build
sleep 20

bash scripts/postdeploy-check.sh --no-db-write 2>&1 | head -40
```

**Пароль администратора** — в выводе сида, в рамке. Логин `admin`, вход потребует смены
пароля. Если хотите задать свой — `ADMIN_INITIAL_PASSWORD` в `.env` **до** первого запуска.

## 5. nginx и сертификат

```bash
cp docs/nginx/prodtracker.factoryall.ru.conf /etc/nginx/sites-available/<домен>.conf
# поправить server_name и порт (у нас 127.0.0.1:3000), путь к статике не нужен
ln -sf /etc/nginx/sites-available/<домен>.conf /etc/nginx/sites-enabled/
certbot --nginx -d <домен>
nginx -t && systemctl reload nginx
```

Стендов нет → сниппет с паролем не нужен, но защита от сканеров — нужна:
`docs/nginx/snippets/prodtrack-junk-paths.conf`.

## 6. Бэкапы — обязательно за пределы сервера

```bash
# ежедневно в 02:15 МСК
( crontab -l 2>/dev/null; echo '15 2 * * * cd /opt/prodtrack && bash scripts/backup-db.sh >> /var/log/prodtrack-backup.log 2>&1 && bash scripts/backup-offsite.sh >> /var/log/prodtrack-backup.log 2>&1' ) | crontab -

# выгрузка: настроить ОДИН из способов и проверить вручную
export PRODTRACK_OFFSITE_SCP_TARGET="backup@<хост>:/srv/prodtrack-backups"
#   или
export PRODTRACK_OFFSITE_RCLONE_REMOTE="timeweb-s3:prodtrack-backups"
bash scripts/backup-offsite.sh                       # код 0 = выгружено
bash scripts/backup-db.sh && bash scripts/backup-offsite.sh
```

Проверка раз в месяц: развернуть дамп на тестовой базе и убедиться, что он читается.

## 7. Диск 15 ГБ — за чем следить

```bash
docker system df                       # образы и тома
docker image prune -f                  # старые образы после каждого релиза
du -sh /var/backups/prodtrack          # копии: 14 файлов ~ по 1–5 МБ
journalctl --disk-usage                # системные логи
```

Логи контейнеров ограничены в `docker-compose.timeweb.yml` (3 файла по 10 МБ).

## 8. Обновление версии

```bash
# локально: собрать и перенести образ (шаг 3), затем на сервере:
cd /opt/prodtrack && git fetch origin && git checkout <новый тег>
sed -i 's/^VERSION=.*/VERSION=<новый тег>/' .env
docker compose -f docker-compose.yml -f docker-compose.timeweb.yml up -d --no-build
sleep 20 && bash scripts/postdeploy-check.sh
docker image prune -f
```

## 9. Чего на этой машине НЕ будет

- дев- и фикс-стендов: 1 ГБ не тянет три приложения;
- сборки на сервере;
- хранения бэкапов на том же диске как единственной копии.
