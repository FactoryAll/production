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

### Сначала дев, потом прод

С 21.10.2026 доработка сначала проверяется на дев-стенде «`prodtracker-dev.factoryall.ru`,
порт 3001» и только после успеха едет в прод — правило целиком в `docs/dev_environment.md`.
Проверка на деве: `bash scripts/postdeploy-check.sh --dev`.

### Проверенная процедура редеплоя (использовать именно её)

Выполняется **на VPS пользователем** (владельцем продукта) — у агента доступа к серверу нет.
Агент присылает эти команды, пользователь выполняет и возвращает вывод.

```bash
cd /opt/prodtrack
git pull origin main
git log -1 --oneline            # убедиться, что подтянулся нужный коммит
docker compose build
docker compose up -d
sleep 20
docker compose logs --tail=10 web
```

**`down` перед сборкой не нужен и вреден.** Сначала собираем, потом поднимаем: если сборка упадёт,
сайт продолжит работать на прежнем образе. С `down` в начале упавшая сборка оставляет прод лежать —
так и случилось 20.10.2026, дважды.

**`--no-cache` брать не нужно по умолчанию.** Он выбрасывает закэшированный apt-слой, и сборка идёт
в `deb.debian.org` — а с этого сервера он отвечает нестабильно (20.10.2026: индексы скачались,
а `.deb` отвалились по таймауту). `--no-cache` уместен только когда меняется базовый образ
или системные пакеты.

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
Вывод скрипта — это и есть отчёт о развёртывании; его присылают целиком.

**Без записи в прод-базу:** `bash scripts/postdeploy-check.sh --no-db-write` — пропускает раздел 3
(`prisma migrate deploy` и двукратный сид), остальные разделы только читают. Нужен, когда развёртывание
не меняет схему: тогда в прод-данные ничего не пишется.

### SSE-канал уведомлений и nginx (с v1.2.0)

Центр уведомлений использует Server-Sent Events: `/api/events/notifications`. Приложение отдаёт
заголовок `X-Accel-Buffering: no` и keep-alive-кадр каждые 15 секунд, но надёжнее явно отключить
буферизацию в nginx — иначе кадры могут копиться в буфере прокси и real-time перестанет работать.

Действия при первом деплое релиза с SSE (один раз) — **вставить только блок `location /api/events/`**
в существующий конфиг сайта (файл целиком копировать нельзя: там блок `listen 443 ssl` от certbot):

```bash
# 1) бэкап именно содержимого файла (cp -r по sites-enabled копирует только симлинки!)
cp /etc/nginx/sites-available/prodtracker.factoryall.ru.conf /root/prodtracker-nginx-$(date +%F).conf

# 2) добавить блок location /api/events/ внутрь server-блока с server_name prodtracker.factoryall.ru
#    (он лежит в docs/nginx/prodtracker.factoryall.ru.conf как образец)

# 3) проверить и перезагрузить
nginx -t && systemctl reload nginx

# 4) если HTTPS по какой-то причине отвалился — вернуть блок 443 одной командой:
#    certbot --nginx -d prodtracker.factoryall.ru --non-interactive --agree-tos
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

Тег или коммит передаётся **аргументом** — внутри скрипта он больше не прошит:

```bash
cd /opt/prodtrack
bash scripts/deploy.sh vX.Y.Z          # тег
bash scripts/deploy.sh 41b019d         # или конкретный коммит
```

Без аргумента скрипт отказывает и печатает подсказку. Так сделано после разбора 17.10.2026:
раньше в `scripts/deploy.sh` стояло `GIT_TAG="v1.2.0"` с безусловным `git checkout v1.2.0`,
и эта команда из документа молча откатывала стенд к v1.2.0 вместо обновления.

## Рекомендуемый харденинг после стабилизации

1. **SSH:** `PermitRootLogin prohibit-password` в `/etc/ssh/sshd_config`.
2. **Firewall:** включить `ufw`, открыть только 22, 80, 443.
3. **Пользователь:** создать отдельного админа (не root) для деплоя.
4. **Мониторинг:** настроить alerts на падение контейнеров.

## Откат

Откат — это развёртывание предыдущего коммита тем же способом, которым шло обновление.
Порядок проверен на практике 17.10.2026 (дополнен: раньше здесь были только `down`
и восстановление nginx, без возврата кода).

```bash
cd /opt/prodtrack
git log --oneline -5              # выбрать предыдущий рабочий коммит
git checkout <предыдущий-коммит>  # например: git checkout 41b019d
docker compose down
docker compose build --no-cache
docker compose up -d
sleep 20
bash scripts/postdeploy-check.sh --no-db-write
```

Либо то же самое одной командой, если развёртывание шло через скрипт:

```bash
cd /opt/prodtrack && bash scripts/deploy.sh 41b019d
```

**Что откат НЕ делает — про это надо знать заранее.**

1. **Схема БД не откатывается.** Если откатываемая версия добавляла миграции, база останется
   «впереди» кода: старый код работает на новой схеме, пока изменения не мешают. Удалять
   миграции и колонки вручную не нужно и опасно — данные пропадут. Если откат делается
   из-за миграции, сначала снимите дамп (`docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql`).
2. **nginx не трогается.** Конфиг сайта от отката кода не зависит. Восстанавливать его из
   бэкапа нужно только если он менялся в том же окне (см. шаг 4 и особенность 7 выше).
3. **Логи предыдущего контейнера пропадут** после `docker compose down`. Если откат делается
   из-за ошибки — сначала снимите лог: `docker compose logs --tail=200 web > /root/prodtrack-fail-$(date +%F-%H%M).log`.

Проверка после отката — тот же `postdeploy-check.sh`: в разделе 1 должен стоять
выбранный вами коммит, в разделе 2 — версия из `docker-compose.yml` этой версии.


## Разбор жалобы «не удаётся войти» (проверено 16.10.2026)

Порядок сложился на разборе реального обращения: четыре пользователя входили одновременно, двое получили
в браузере `ERR_CONNECTION_RESET`. Ниже — что смотреть, чтобы за минуту понять, при чём тут приложение.

**Важно про время: nginx пишет логи по UTC (в строке видно `+0000`), а база хранит время тоже по UTC.
Московское время — плюс три часа. То есть окно 14:30–14:50 МСК в логе выглядит как `11:30–11:50`.**

**Ловушка, на которой легко ошибиться (проверено 16.10.2026).** В контейнере базы часовой пояс
`Europe/Moscow` (из `.env`), а колонка `createdAt` хранит UTC. Поэтому запрос вида
`"createdAt" >= now() - interval '30 minutes'` вернёт **пустой результат даже когда входы были**:
naive-время строки сравнивается с московским «сейчас». Считайте границы окна явно, как ниже,
либо берите UTC-время запросом `(now() at time zone 'utc')`.

### 1. Всё ли живо на сервере

```bash
cd /opt/prodtrack
docker inspect --format '{{.Name}} | старт={{.State.StartedAt}} | перезапусков={{.RestartCount}} | OOM={{.State.OOMKilled}}' prodtrack_web prodtrack_postgres
free -m; uptime
```

Если `перезапусков=0` и `OOM=false`, приложение во время обращения не падало и не поднималось.

### 2. Доходили ли попытки входа до приложения (решающая проверка)

Журнал аудита пишет и удачные входы, и неудачные, с адресом клиента и браузером:

```bash
# последние 30 минут (границы считаются по UTC — см. ловушку выше)
docker compose exec -T postgres psql -U prodtrack -d prodtrack -c "
select to_char(\"createdAt\" + interval '3 hours', 'HH24:MI:SS') as msk,
       action, \"objectId\", left(\"newValue\", 150) as details
from audit_records
where action in ('LOGIN','LOGIN_FAILED')
  and \"createdAt\" >= (now() at time zone 'utc') - interval '30 minutes'
order by \"createdAt\";"

# или конкретное окно: время указывается в UTC (МСК минус 3 часа)
#   ... and \"createdAt\" >= '2026-10-16 11:20:00' and \"createdAt\" < '2026-10-16 12:10:00'
```

- есть `LOGIN_FAILED` — попытка дошла до приложения (например, неверный пароль);
- есть `LOGIN` — человек вошёл успешно, смотрите поле `ip` в `newValue`;
- **нет ни одной записи** — попытки до приложения не дошли: обрыв был между браузером и сервером
  (VPN, прокси, сеть офиса). В приложении и nginx чинить нечего.

### 3. Что видел nginx

```bash
grep -E '16/Oct/2026:11:[2-5]' /var/log/nginx/access.log | grep -vE '/api/v1/|/assets/' | awk '{print $1, $4, $7, $9}' | head -40
grep -E '16/Oct/2026:11:[2-5]' /var/log/nginx/access.log | awk '$9 ~ /^[45]/ {print $1, $4, $7, $9}'
```

Фильтр `-vE '/api/v1/|/assets/'` убирает запросы соседнего MES-Midex и статику — остаётся трафик ProdTrack.

- `499` — клиент сам оборвал соединение (это и есть «ERR_CONNECTION_RESET» со стороны браузера);
- `502`/`504` — приложение не ответило;
- `303` — успешный вход (серверное действие отвечает перенаправлением);
- одни `200`/`304` — входы в окне проходили нормально.

### Как определить адрес офисного VPN

Чтобы привязать адрес из логов к офису, попросите любого офисного пользователя открыть в браузере
`https://ifconfig.me` (или `https://2ip.ru`) — он покажет внешний адрес. Если он совпадёт с адресом
из логов, значит обрыв произошёл на выходе офисной сети, и дальше вопрос решает администратор VPN,
а не команда приложения.

### Практический вывод

Если записей в аудите нет, а в логе нет `499` и `5xx` — приложение не при чём: запросы не дошли.
Пользователю достаточно обновить страницу и войти заново; при повторяющихся случаях идти к администратору
офисного VPN/прокси — на нашей стороне следов не будет по определению.

## Поддержка

- Логи: `docker compose logs -f web` / `docker compose logs -f postgres`
- Контейнеры: `docker compose ps`
- Сеть: `docker network ls | grep prodtrack`
