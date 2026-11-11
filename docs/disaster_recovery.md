# Восстановление и переезд ProdTrack (после потери сервера)

> **Когда читать.** Сервер недоступен или утрачен: железо умерло, хостинг потерял данные,
> нужен переезд на другого провайдера. Документ описывает, что можно восстановить из
> репозитория, а что — только из резервных копий, и в каком порядке это делать.

## 1. Что где лежит

| Часть системы | Где | Переживает потерю сервера? |
|---|---|---|
| Код (приложение, пакеты, миграции, сид) | GitHub `FactoryAll/production` | **да** |
| Инфраструктура как код: `docker-compose*.yml`, `scripts/`, `docs/nginx/`, `docs/nginx/fail2ban/` | GitHub | **да** |
| Правила и постановки (`docs/`, `specs/`, `tasks.md`) | GitHub | **да** |
| Переменные окружения (`.env*`) | только сервер, в git не попадают | **нет** — пересоздаются по шаблонам |
| База данных (ПЗ, смены, факты, остатки, пользователи) | сервер, PostgreSQL в docker | **нет** — только из дампа |
| Резервные копии БД | `/var/backups/prodtrack` **на том же сервере** | **нет** |
| Пароль стендов `.htpasswd` | сервер, `/etc/nginx/` | **нет** — пересоздаётся |
| Сертификаты Let's Encrypt | сервер, `/etc/letsencrypt/` | **нет** — выпускаются заново |

**Главный вывод.** Код и инфраструктура восстанавливаются из репозитория полностью.
Данные — нет: их можно вернуть только из дампа, лежащего **вне** потерянного сервера.

## 2. Сразу после инцидента — что сделать до восстановления

1. **Сменить все учётные данные**, которые были на сервере: пароль `POSTGRES_PASSWORD`
   в `.env`, пароль стендов, пароли пользователей приложения, ключи SSH, токены.
   Даже если данных не тронули, сервер им больше не доверяем.
2. **Проверить, есть ли дамп вне сервера.** Искать: локальные копии у владельца,
   письма/файлы с `prodtrack_*.sql.gz`, копии в облаке. Без дампа база начинается с нуля
   (сид создаст справочники и администратора, но не ПЗ и смены).
3. **Зафиксировать, какой версией работали.** Версия в футере и в теге git — на момент
   потери это `v2.9.1` (`e323aec`). Теги проставлены на все релизы начиная с `v2.4.0`.

## 3. Подъём на новом сервере (с нуля)

### 3.1 Требования

- Ubuntu 22.04/24.04 LTS, root по SSH-ключу;
- Docker ≥ 24 и `docker compose`;
- nginx + certbot;
- RAM ≥ 4 GB, диск ≥ 20 GB;
- свободный порт 3000 на localhost;
- A-запись домена на IP нового сервера.

Пакеты, которых на чистом Ubuntu нет (ставим до всего остального):

```bash
apt update && apt install -y nginx certbot python3-certbot-nginx fail2ban apache2-utils
# apache2-utils нужен для htpasswd — им создаётся пароль дев- и фикс-стендов
```

### 3.2 Код и окружение

```bash
mkdir -p /opt/prodtrack && cd /opt/prodtrack
git clone https://github.com/FactoryAll/production.git .
git checkout v2.9.1            # или нужный тег

cp .env.example .env
# заполнить: POSTGRES_PASSWORD и DATABASE_URL (пароль в строке подключения должен совпадать).
# Остальное в шаблоне уже готово: VERSION, TZ=Europe/Moscow, NODE_ENV=production.
chmod 600 .env
```

Для стендов — свои шаблоны и свой генератор:

```bash
bash scripts/make-dev-env.sh          # .env.dev
bash scripts/make-dev-env.sh --fix    # .env.fix
```

**Правило:** пароли стендов не совпадают между стендами и с продом; базы стендов
не пересекаются.

### 3.3 Запуск

```bash
docker compose build
docker compose up -d
sleep 20

# Схему НИКТО не накатывает автоматически: контейнер запускает только приложение
# (`CMD node apps/web/server.js`, entrypoint миграций нет). Накатываем вручную —
# иначе приложение поднимется на пустой базе и это не будет видно по логам.
docker compose exec -T web sh -lc \
  'prisma migrate deploy --schema=/app/packages/db/prisma/schema.prisma'
docker compose exec -T web sh -lc 'cd /app/packages/db && tsx prisma/seed.ts'

bash scripts/postdeploy-check.sh      # 10 разделов: образ, миграции, сид, стенды, БД
```

Либо одной командой, которая делает то же самое и проверяет тег:
`bash scripts/deploy.sh <тег>`. Сид идемпотентен — его можно гонять повторно.

### 3.4 Если есть дамп базы

```bash
# 1) поднять только базу
docker compose up -d postgres && sleep 10

# 2) залить дамп (файл снят scripts/backup-db.sh, gzip)
gunzip -c /path/to/prodtrack_YYYY-MM-DD_HHMM.sql.gz | \
  docker compose exec -T postgres psql -U prodtrack -d prodtrack

# 3) проверить, что данные на месте
docker compose exec -T postgres psql -U prodtrack -d prodtrack \
  -c "select count(*) from production_orders; select count(*) from production_facts;"

# 4) поднять приложение и прогнать проверку
docker compose up -d && sleep 20 && bash scripts/postdeploy-check.sh
```

Если дампа нет — база создаётся с нуля: справочники из сида, пользователь-администратор,
остальное вводится заново. Об этом нужно честно сказать пользователям.

### 3.5 nginx, сертификат и защита стендов

Пошагово для нынешнего сервера — `docs/deploy_timeweb.md` (nginx и сертификат, раздел 5).
Коротко:

```bash
# 1) конфиг сайта — образец в репозитории (домен нынешнего прода)
cp docs/nginx/prodtrack.vegas-ai.ru.conf /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/prodtrack.vegas-ai.ru.conf /etc/nginx/sites-enabled/

# 2) сниппет защиты от сканеров: конфиг его подключает, без файла nginx не запустится
cp docs/nginx/snippets/prodtrack-junk-paths.conf /etc/nginx/snippets/

# 3) сертификат (certbot допишет блок 443)
certbot --nginx -d prodtrack.vegas-ai.ru

nginx -t && systemctl reload nginx

# Пароль на стенды ставить НЕ нужно: на нынешнем сервере стендов нет
# (1 ГБ не тянет три приложения). Если когда-нибудь вернутся — пароль, а не список IP:
#   htpasswd -c /etc/nginx/.htpasswd-prodtrack prodtrack
#   cp docs/nginx/snippets/prodtracker-stand-auth.conf /etc/nginx/snippets/prodtracker-dev-allow.conf
```

SSE-канал уведомлений требует отдельного `location /api/events/` — образец и объяснение
в `docs/deploy_vps.md` (раздел «SSE-канал уведомлений и nginx»).

### 3.6 Резервные копии — и сразу ВНЕ сервера

```bash
# на сервере: ежедневный дамп (cron 02:15 UTC)
0 2 * * * cd /opt/prodtrack && bash scripts/backup-db.sh >> /var/log/prodtrack-backup.log 2>&1
```

**Этого недостаточно** — именно так копии и погибли вместе с сервером. Дополнительно
нужно настроить выгрузку дампов за пределы машины, минимум одно из:

- `rclone`/`aws s3 cp` в объектное хранилище другого провайдера;
- `scp` на отдельный сервер;
- синхронизация каталога `/var/backups/prodtrack` в облако диска.

Проверка: раз в месяц разворачивать дамп на тестовой базе и убеждаться, что он читается.

## 4. Переезд без потери данных (если сервер ещё жив)

```bash
# на старом сервере
bash scripts/backup-db.sh
ls -la /var/backups/prodtrack | tail -3
# забрать свежий дамп любым способом (scp, s3, файлообменник) — НЕ через тот же диск

# на новом сервере
# шаги 3.1–3.3, затем 3.4 (залить дамп), 3.5 (nginx), 3.6 (бэкапы)
```

После переключения DNS: проверить `https://<домен>/login`, версию в футере,
и прогнать `bash scripts/postdeploy-check.sh`.

## 5. Чего в репозитории нет и не будет

- реальных значений `.env` — только шаблоны;
- дампов базы — их место в хранилище бэкапов, а не в git;
- сертификатов и `.htpasswd`;
- ключей SSH и токенов.

Всё это передаётся отдельным защищённым каналом (менеджер паролей, а не переписка).
