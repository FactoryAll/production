# ProdTrack — Технологический стек и архитектурные решения

> Развивает `specs/_tech_decisions.md` (не дублирует его). Источник истины по требованиям — `specs/` v1.3; этот документ фиксирует **как** требования реализуются.

## 1. Монорепо

Управление — pnpm workspaces + Turborepo.

```
production/
├── apps/
│   └── web/                  # Next.js (App Router) — фронт + API routes
├── packages/
│   ├── db/                   # Prisma schema, клиент, seed
│   ├── ui/                   # shadcn/ui + дизайн-токены FactoryAll
│   └── contracts/            # общие типы/константы (enums, статусы, события)
├── specs/                    # источник истины (v1.3)
├── plan.md / tasks.md / tech_stack.md
```

- `packages/db` — единственное место определения схемы; `apps/web` и `packages/ui` импортируют сгенерированный клиент и типы.
- `packages/contracts` — перечисления, разделяемые между сервером и клиентом: `ProductCategory` (категория номенклатуры) `{MASS, GP}` и `FactCategory` (категория при вводе факта) `{MASS, GP, PF}` (Масса всегда MASS; ГП-номенклатура → GP или PF, Р-01); типы задач `{PRODUCTION, TRANSFER}`, причины ввода за Оператора `{ILLNESS, NO_SHOW, LEFT_SHIFT, OTHER}`, статусные коды документов, коды событий `EV-01…EV-10`.

## 2. Next.js App Router — структура роутов

Роуты сгруппированы по модулям M01…M13:

```
apps/web/src/app/
├── (auth)/login/                 # M02 — вход
├── (auth)/change-password/       # M02 — смена пароля (первый вход)
├── dashboard/                    # M11 — сводный дашборд (Фаза 6)
├── nsi/                          # M01 — справочники
│   ├── work-centers/
│   ├── employees/
│   ├── products/
│   ├── defect-reasons/
│   ├── substitution-reasons/     # Р-13
│   ├── shifts/
│   └── warehouses/               # Р-19
├── users/                        # M02 — пользователи/роли
├── production-orders/            # M03 — ПЗ
├── shift-execution/              # M04 — исполнение смены
├── stock/                        # M05 — остатки
├── shift-reports/                # M06 — отчёт смены
├── transfers/                    # M07 — перемещения
├── receiving/                    # M08 — приёмка/расхождения
├── notifications/                # M09 — центр уведомлений
├── timing/                       # M10 — хронометраж
├── onec/                         # M12 — рабочее место С1С
└── audit/                        # M13 — аудит
```

Каждый модуль — набор server components (чтение) + route handlers (`/api/...`) для мутаций. Серверные действия (server actions) используются для мутаций форм; SSE — для real-time (M09/M11).

## 3. Prisma schema — верхнеуровневая модель

Соответствие сущностей спекам (v1.3):

| Сущность Prisma | Спек | Ключевые атрибуты |
|-----------------|------|-------------------|
| `WorkCenter` | M01 §4.1 | `code` (unique), `producesMass`, `active` |
| `Employee` | M01 §4.1 | `tabNumber` (unique), `active` |
| `Product` | M01 §4.1 | `code` (unique), `category` (MASS\|GP), `unit`, `active` |
| `DefectReason` / `SubstitutionReason` | M01 §4.1 | `code` (enum), `active` |
| `Shift` | M01 §4.1 | `number`, `date`, `start`, `end`, `active` |
| `Warehouse` | M01 §4.1 (Р-19) | `name`, `description`, `type` |
| `User` | M02 §4.1 | `login`, `passwordHash`, `mustChangePassword`, `roles[]` (M2M) |
| `Role` / `Permission` | M02 §4.1 | `code` (enum), `permissions[]` |
| `Session` | M02 §4.1 | `expiresAt` (12 ч, Р-07) |
| `ProductionOrder` / `ProductionOrderLine` | M03 | статусы `DRAFT…COMPLETED/CANCELLED`, строки `ASSIGNED…REPORTED` |
| `ProductionFact` | M04 | `output[]`, `consumption[]`, `defect[]`, `stops` |
| `StockMovement` / `StockBalance` | M05 | типы приход/списание/потребление/возврат |
| `ShiftSummary` | M06 | агрегированный итог смены |
| `GoodsTransfer` / `TransferLine` | M07 | статусы `DRAFT…RECONCILED/CANCELLED` |
| `Discrepancy` | M08 | расхождение по строке приёмки |
| `Notification` | M09 | `eventCode` (EV-01…EV-10), `payload`, `readAt`, `link` |
| `StageTiming` | M10 | `transition`, `from`, `to`, `at` |
| `TaskForOneC` | M12 (Р-24) | `type` (PRODUCTION\|TRANSFER), `status`, `processedAt`, `lastChangedAt` |
| `AuditRecord` | M13 | `action`, `field`, `oldValue`, `newValue`, `archived` (Р-16) |

Статусные коды хранятся как строковые enum в БД; переходы валидируются серверной логикой (state machine), не триггерами БД.

## 4. Авторизация

- **Middleware Next.js** (`middleware.ts`) — проверка сессии и редирект на `/login`.
- **Сессии** — cookie (httpOnly, secure) + строка `Session` в БД; срок 12 ч (Р-07).
- **Окно доступа ОПР (Р-07)** — проверяется в middleware и в route handlers: ОПР может действовать только в окне `[начало смены − 1 ч; конец смены + 1 ч]` (14 ч); вне окна — отказ во входе и в действиях.
- **Матрица доступа** — центральный модуль в `packages/contracts`/сервере; роль → права. Множественные роли: итоговые права = объединение (Р-23).
- **Первый вход (Р-15)** — при `mustChangePassword = true` редирект на `/change-password`; другие роуты недоступны до смены пароля.
- **Атрибуция роли в аудите (Р-23)** — роль определяется по типу действия согласно матрице, а не «первой» ролью пользователя.

## 5. Real-time (SSE)

- **Эндпоинты:** `/api/events/notifications` (M09) и `/api/events/dashboard` (M11).
- Сервер пушит только после бизнес-мутаций (после commit транзакции); клиент подписывается и обновляет центр уведомлений/виджеты.
- Односторонний канал (сервер → клиент) — SSE достаточно; WebSocket не используется.

## 6. UI-библиотека и дизайн-токены

- **shadcn/ui** + Tailwind CSS; кастомные токены бренда — в `packages/ui` (см. раздел 7).
- Таблицы данных — TanStack Table (сортировка/фильтры по справочникам и спискам).

## 7. Дизайн-токены FactoryAll (Brandbook v1.0)

Источник токенов — `packages/ui/src/tokens.css` (CSS variables) + Tailwind-конфиг.

### Цвета (core)
| Токен | HEX |
|-------|-----|
| `--color-graphite-core` | `#1F2733` |
| `--color-deep-industry-blue` | `#163A70` |
| `--color-signal-amber` | `#C88A2B` |
| `--color-graphite-surface` | `#232D3A` |

### Нейтральная шкала
| Токен | HEX |
|-------|-----|
| `--color-forge-black` | `#14181F` |
| `--color-steel-graphite` | `#4B5563` |
| `--color-machine-gray` | `#8A94A6` |
| `--color-mist-metal` | `#CBD3DD` |
| `--color-cold-white-gray` | `#F3F6F9` |
| `--color-pure-white` | `#FFFFFF` |

### Правила применения
- **Пропорция:** 70% нейтрали, 20% синий (`#163A70`), 10% янтарный акцент (`#C88A2B`).
- **Янтарный акцент** — только: CTA-кнопки, цифры KPI, маркеры шагов. Без градиентов; 1 сильный акцент на экран.
- **Типографика:** IBM Plex Sans (H1–H4) + Inter (body, таблицы, UI-элементы).
- **Радиус:** 12–16 px; бордеры 1 px `#CBD3DD` (Mist Metal).
- **Кнопки:** sentence case, высота 48–52 px.

## 8. Диаграммы

Recharts: план/факт по РЦ; структура выпуска Масса/ПФ/ГП; брак по причинам (Парето); остановки по длительности (Р-08, M06/M11).

## 9. Тесты

- **Vitest** — unit-тесты серверной логики (state machine, валидации BR, расчёт остатков, окно доступа ОПР).
- **Playwright** — e2e критичных сценариев: вход/смена пароля, полный цикл ПЗ→факт→остатки→отчёт, Перемещение→приёмка→расхождение, ввод за Оператора, отмена документа, рабочее место С1С.
- Тестовые задачи включены в `tasks.md` для всех BR.

## 10. Решения и допущения (сверх `_tech_decisions.md`)

1. **Хранение сессий** — cookie + строка `Session` в БД (деталь реализации, закрывает [ДОПУЩЕНИЕ] из `_tech_decisions.md`).
2. **Статусные коды** — строковые enum в БД + серверная state machine (не триггеры).
3. **Деплой-таргет** — VPS (self-hosted, контейнер). Вопрос закрыт: артефакты релиза — `docker-compose.yml` (web + postgres + nginx), `.env.example`, `scripts/deploy.sh`, `docs/deploy_vps.md`; процедура описана в `process.md` (ПРОЦ-03).
4. **Версионирование** — SemVer `X.Y.Z`, git-теги `vX.Y.Z`, `CHANGELOG.md` в формате Keep a Changelog, версия в UI-футере из env `VERSION`; подробности — `process.md` (ПРОЦ-02).