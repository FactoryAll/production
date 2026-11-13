# Дев-стенд и правило «сначала дев, потом прод»

Заведено 21.10.2026 по решению владельца продукта. Повод прямой: в этот день доработки
дважды уезжали сразу в прод, и оба раза проверка на живом стенде ломалась на глазах
у пользователей — один раз упала сборка образа после `docker compose down` (прод лежал),
второй раз нашлись дефекты, которые ловились за минуту на любом стенде: у роли не было
кнопки проведения, а в списке продуктов предлагались позиции, которых на складе нет.

Дев-стенд — это то же приложение из того же репозитория, но со своим портом, своей базой
и своим набором контейнеров. Прод он не видит и испортить не может.

## Стенды

| | Прод | Дев |
|---|---|---|
| Домен | `prodtrack.vegas-ai.ru` (прод на Timeweb) | локально (серверных стендов больше нет) |
| Порт на сервере | `127.0.0.1:3000` | `127.0.0.1:3001` |
| Compose | `docker-compose.yml` | `docker-compose.dev.yml` |
| Проект compose | `prodtrack` | `prodtrack-dev` |
| Контейнеры | `prodtrack_web`, `prodtrack_postgres` | `prodtrack_dev_web`, `prodtrack_dev_postgres` |
| База и том | `prodtrack_pgdata` | `prodtrack_dev_pgdata` (отдельный) |
| Переменные | `.env` | `.env.dev` (свой пароль базы) |
| Версия в футере | `v2.2.0` | `v2.2.0-dev` |

Третий стенд — **фикс** (порт 3002, `prodtracker-fix.factoryall.ru`, `v2.2.0-fix`).
Полная модель веток и стендов — `docs/branching_model.md`; правила оттуда обязательны.
| Кто пользуется | реальные пользователи | владелец и агент |

Версия на деве несёт суффикс `-dev` — чтобы скриншот нельзя было спутать с продом.

## Правило

1. **Ни один коммит не едет в прод, пока тот же коммит не отработал на деве.**
2. Порядок один: собрать на деве → прогнать проверку дева → посмотреть глазами то, что
   менялось → только потом прод.
3. Проверка одна и та же на обоих стендах — один скрипт с разными ключами, чтобы критерии
   не разъезжались.
4. Если на деве что-то не так — правка и повтор с начала. В прод ничего не уходит.
5. В прод уходит **тот же коммит**, который прошёл дев. Не «свежий `main`» и не «после ещё
   пары правок».

## Дев: развёртывание

Первый раз (владелец, на сервере):

```bash
cd /opt/prodtrack && git pull origin main && bash scripts/make-dev-env.sh && docker compose -f docker-compose.dev.yml build && docker compose -f docker-compose.dev.yml up -d && sleep 20 && bash scripts/postdeploy-check.sh --dev
```

`scripts/make-dev-env.sh` сам создаёт `.env.dev`: генерирует пароль базы и секрет сессий,
подставляет пароль в два места (в `POSTGRES_PASSWORD` и внутри `DATABASE_URL` — иначе первый
же вход упрётся в «password authentication failed»), ставит права `600` и **не печатает
значения**: вывод пересылают в чат, а секрет в чате — утечка. Существующий `.env.dev` он не
перезаписывает; пересоздать — `--force`.

Где посмотреть значения, если понадобится (только на сервере, не в чате):

```bash
sudo grep -oE '^[A-Z_]+=' /opt/prodtrack/.env.dev      # только имена ключей
sudo cat /opt/prodtrack/.env.dev                       # значения
```

Продовые значения из `/opt/prodtrack/.env` для дева **не годятся**: это продовые секреты,
и дев-база с ними не нужна. Форма строки подключения видна там же:
`postgresql://prodtrack:<пароль>@postgres:5432/prodtrack?schema=public`.

Каждый следующий раз — то же, кроме создания `.env.dev`:

```bash
cd /opt/prodtrack && git pull origin main && docker compose -f docker-compose.dev.yml build && docker compose -f docker-compose.dev.yml up -d && sleep 20 && bash scripts/postdeploy-check.sh --dev
```

Дев-сид создаёт те же учётные записи (в том числе `admin`), но в **своей** базе: данные
пользователей прода и дева не пересекаются.

## Локальный стенд (проверки владельца)

Проверяем всё **здесь**, а не на сервере (решение владельца 14.11.2026, правило 16).

**Поднять (две команды, проверено 14.11.2026):**

```bash
export PATH=/usr/lib/postgresql/16/bin:$PATH
pg_ctl -D /home/user/projects/work/production/.local/pgdata \
       -l /home/user/projects/work/production/.local/pgdata.log \
       -o "-p 55432 -k /tmp" start

cd /home/user/projects/work/production/.worktrees/dev
DATABASE_URL="postgresql://prodtrack@127.0.0.1:55432/prodtrack_local?schema=public" \
VERSION=local-check \
  pnpm --filter @prodtrack/web exec next dev -p 3100
```

**Проверить, что поднялся:** `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/login` → `200`.

**Что выдать владельцу вместе с заданием:** адрес `http://localhost:3100`, логин, пароль.

| Логин | Пароль | Роли |
|---|---|---|
| `admin` | задаётся линией при подъёме (см. ниже) | АДМ |
| `test_multi_role` | `test1234` (из `seed.ts`, публично) | НП + ОПР |

Пароль `admin` при сиде генерируется случайно и в логах не сохраняется. Если входной пароль неизвестен —
пересчитать хеш и записать в базу стенда (только стенд!):

```bash
cd apps/web && node -e "require('bcryptjs').hash('Prodtrack2026!',10).then(h=>console.log(h))"
psql -h 127.0.0.1 -p 55432 -U prodtrack -d prodtrack_local \
  -c "UPDATE users SET \"passwordHash\"='<хеш>', \"mustChangePassword\"=false WHERE login='admin';"
```

Проверять вход надо сверкой хеша (`bcrypt.compare`), а не «на глаз»: 14.11.2026 так и делалось.

## Прод: развёртывание

Только после успешного дева — процедура из `docs/deploy_vps.md`:

```bash
cd /opt/prodtrack && git pull origin main && git log -1 --oneline && docker compose build && docker compose up -d && sleep 20 && bash scripts/postdeploy-check.sh
```

`down` перед сборкой не делаем: если сборка упадёт, прод продолжит работать на прежнем
образе.

## Как открыть дев

Адрес: **https://prodtracker-dev.factoryall.ru** (поддомен настроен 22.10.2026, задача T-090).
Вход тем же `admin`, что создаёт сид, но в дев-базе.

**Доступ ограничен по адресам** (22.10.2026): snippet `/etc/nginx/snippets/prodtracker-dev-allow.conf`
разрешает только адреса владельца и офисный выход, остальным — `403`. Исключение сделано только для
`/.well-known/acme-challenge/`: без него автопродление сертификата в январе упрётся в `deny`.
Добавить адрес — дописать строку `allow <ip>;` в этот файл и перезагрузить nginx.

Резервный путь, если домен недоступен — SSH-туннель (ключ заведён на сервере):

```powershell
# Стенды живут ЛОКАЛЬНО: серверные дев- и фикс-стенды не поднимаются — на 1 ГБ им не хватает места.
# Туннель к прод-серверу нужен только чтобы посмотреть прод снаружи:
ssh -N -L 3001:127.0.0.1:3000 prodtrack@prodtrack.vegas-ai.ru
```

> Вход под `root` как штатный способ не используется: у отдельного пользователя меньше прав,
> а `root` нужен только для `nginx`/`certbot`/`docker` и настраивается через `sudo`
> (`docs/branching_model.md`, `docs/disaster_recovery.md` §3.1).

Окно держать открытым, затем в браузере `http://127.0.0.1:3001`. Без открытого туннеля
браузер выдаст `ERR_CONNECTION_REFUSED` — это нормально, а не поломка стенда.

## Поддомен и nginx (делает владелец, задача T-090)

1. **DNS:** A-запись `prodtracker-dev.factoryall.ru` → IP сервера.
2. **Конфиг:** `docs/nginx/prodtracker-dev.factoryall.ru.conf` → скопировать в
   `/etc/nginx/sites-available/`, симлинк в `sites-enabled/`, затем
   `nginx -t && systemctl reload nginx`.
3. **Сертификат:** `certbot --nginx -d prodtracker-dev.factoryall.ru --non-interactive --agree-tos`.
   После этого файл из репозитория **не копировать** поверх рабочего — затрёт SSL-блок
   (так уже было с продом 03.10.2026).
4. **Проверка:** `curl -sI https://prodtracker-dev.factoryall.ru/login | head -1` → `200`.

## Чего дев не делает

- **Не заменяет живую проверку владельцем.** Дев ловит поломки сборки, прав, пустых
  списков и вёрстки; но решение «это то, что просили пользователи» остаётся за владельцем.
- **Не имеет продовых данных.** Фидбэк, который «виден только на реальных данных»,
  на деве не воспроизведётся — такие случаи по-прежнему проверяются на проде.
- **Не открыт наружу без ограничения.** Пока в nginx не добавлены `allow/deny`, стенд
  виден любому, у кого есть ссылка, и вход в него открыт тем же учётным записям, что и в прод.
  Ограничение по адресам — в шаблоне конфига, закомментировано.

## Откат

Дев — это расходник: если он сломан, достаточно пересобрать из нужного коммита.

```bash
cd /opt/prodtrack && git checkout <коммит> && docker compose -f docker-compose.dev.yml build && docker compose -f docker-compose.dev.yml up -d
```

Прод откатывается по `docs/deploy_vps.md` (раздел «Откат»).
