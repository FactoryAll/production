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

## Восстановление тестового покрытия

Проведена диагностика по файлам сравнением `v1.0.0` (коммит `65b24d5`) и текущего `main`.

| Файл | v1.0.0 it() | v1.0.1 it() | Δ | Причина |
|------|-------------|-------------|---|---------|
| `apps/web/src/app/nsi/shifts/__tests__/shifts.test.ts` | 6 | 7 | +1 | добавлен тест `findUnique` lookup для timezone-исправления (hotfix BR-4) |
| `apps/web/src/app/production-orders/__tests__/actions.test.ts` | 64 | 65 | +1 | переименование сценария подстановки + добавлен `blocks substitute without output` (hotfix Р-11/Р-13) |
| `packages/contracts/src/access.test.ts` | 12 | 15 | +3 | добавлены тесты `getPrimaryRole` (hotfix auth) |
| `packages/db/src/seed.test.ts` | 7 | 8 | +1 | добавлены константы `test_s1c` (hotfix EV-09) |
| `packages/ui/src/button.test.tsx` | 2 | 4 | +2 | добавлены тесты цветов, радиуса и отступов кнопок (hotfix UI) |
| **ИТОГО** | **367** | **375** | **+8** | **покрытие увеличилось** |

Фактические результаты `pnpm test -- --run --reporter=verbose`:
- v1.0.0: contracts 34 + ui 2 + db 14 + web 317 = **367**
- v1.0.1: contracts 37 + ui 4 + db 15 + web 319 = **375**

Требование ПРОЦ-05 §5.4 («число тестов не должно уменьшаться») выполнено.

## Проблемы и действия

- `tracker.factoryall.ru` возвращает 502 Bad Gateway — соседний сервис, не связан с ProdTrack. Вне зоны ответственности релиза.
- Версия в футере не отображалась после первого деплоя: выяснилось, что `VERSION` передавался только на этапе `builder`, а не в финальный `runner`-контейнер. Добавлен `ARG VERSION` и `ENV VERSION` в `runner` stage Dockerfile; футер нормализован против двойного `v`.
- Ложное ощущение регрессии тестов: предыдущий отчёт ошибочно привёл только `@prodtrack/web` (319), но полное число тестов на `main` — 375, что больше 367.
