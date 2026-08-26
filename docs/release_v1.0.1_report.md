# Релиз-отчёт v1.0.1

- Дата: 2026-08-25
- Git-тег: v1.0.1
- Коммит: 877883d
- Деплой: выполнен dsh
- Смоук: OK

## Что вошло в релиз

Хотфикс-релиз, закрывающий все дефекты, выявленные при ручном тестировании v1.0.0 (см. `docs/release_v1.0.0_test_report.md`):

1. **Unique constraint на `lineId` блокировал ввод ГП+ПФ и ввод за Оператора.**
   - Миграция заменила одиночный unique index на составной `production_facts_lineId_factCategory_key`; код ввода факта переведён на `upsert`.
   - Фикс-коммиты: `2edf649`, `571b736`.

2. **ПЗ не закрывалось автоматически при переходе всех строк в REPORTED.**
   - `checkAndCloseProductionOrder` вызывается после каждого отчёта строки; корректно генерируются EV-03/EV-07.
   - Фикс-коммит: `0b94a6c`.

3. **Ввод за Оператора не создавал `ProductionFact` (выпуск = 0).**
   - В форму и server action добавлены поля выпуска/брака/остановок/потребления; создаётся факт, `FactConsumption`, движения остатков, обновляется отчёт смены.
   - Фикс-коммит: `b7e44e4`.

4. **Ложное срабатывание unique constraint при создании смены из-за timezone drift.**
   - `parseDate` строит дату через `Date.UTC(year, month - 1, day, 12, 0, 0)`.
   - Фикс-коммит: `6829204`.

5. **Сборка Docker-образа падала с `TS2305 Module '@prisma/client' has no exported member 'Prisma'`.**
   - `packages/db/package.json` теперь запускает `prisma generate && tsc` для `build` и `typecheck`; `turbo.json` зависит от `^db:generate`.
   - Фикс-коммит: `94f7a26`.

6. **Уведомление EV-09 не создавалось при отмене ПЗ.**
   - Получатели расширены: операторы строк, все S1C и отменивший ПЗ пользователь.
   - Фикс-коммит: `57cbd33`.

7. **Цвета диаграмм, обрезанные подписи, группировка структуры выпуска.**
   - Использована брендовая палитра (`steel-graphite`, `machine-gray`), добавлены `labelLine`, структура выпуска сгруппирована по категориям MASS/GP/PF.
   - Фикс-коммит: `57cbd33`.

8. **Стили кнопок и отсутствие Tailwind-классов из `packages/ui`.**
   - Обновлены токены кнопок (радиус 6px, padding, контраст); `apps/web/tailwind.config.ts` теперь сканирует `packages/ui/src`; `VERSION` проброшен в runner-стадию Dockerfile.
   - Фикс-коммиты: `85917b5`, `f9986bc`, `9263491`, `f6bb572`, `718119d`.

9. **Двойной префикс `vv` в футере при `VERSION=v1.0.1`.**
   - `Footer` нормализует строку версии, избегая дублирования `v`.
   - Фикс-коммит: `877883d`.

## Артефакты

- docker-compose.yml: OK (VERSION подставляется из `.env`)
- .env.example: OK
- scripts/deploy.sh: OK
- docs/nginx/prodtracker.factoryall.ru.conf: OK
- docs/deploy_vps.md: OK
- CHANGELOG.md: обновлён секцией `[1.0.1]`
- docs/release_v1.0.1_regression_checklist.md: создан

## VPS деплой

- Хост: 193.168.46.254
- Домен: https://prodtracker.factoryall.ru
- SSL: Let's Encrypt
- База: PostgreSQL 15 в Docker (`prodtrack_postgres`), изолированная сеть `prodtrack_prodtrack_net`
- Web: `prodtrack_web` на 127.0.0.1:3000, проксирование через хостовый nginx
- Миграции: 11 миграций, `Database schema is up to date!`
- Смоук:
  - `http://127.0.0.1:3000/login` → 200
  - Версия в футере: `ProdTrack v1.0.1`
- Примечание: образ пересобирался с `--no-cache`, так как `VERSION` должен быть зашит в runtime; `docker-compose.yml` и `.env` обновлены для использования переменной `VERSION`.

## Проблемы и действия

- `tracker.factoryall.ru` возвращает 502 Bad Gateway — соседний сервис, не связан с ProdTrack. Вне зоны ответственности релиза.
- Версия в футере не отображалась после первого деплоя: выяснилось, что `VERSION` передавался только на этапе `builder`, а не в финальный `runner`-контейнер. Добавлен `ARG VERSION` и `ENV VERSION` в `runner` stage Dockerfile; футер нормализован против двойного `v`.
