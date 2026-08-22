# ProdTrack

Монорепозиторий ProdTrack — система учёта производственных операций.

## Структура

```
production/
├── apps/web          # Next.js (App Router) — фронт + API routes
├── packages/
│   ├── db            # Prisma schema, клиент, seed
│   ├── ui            # shadcn/ui + дизайн-токены FactoryAll
│   ├── contracts     # общие типы/константы (enums, статусы, события)
│   └── tsconfig      # общий tsconfig
├── specs/            # источник истины (v1.3)
└── tasks.md / tech_stack.md
```

## Быстрый старт

```bash
pnpm install
pnpm build
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Скрипты

- `pnpm build` — сборка всех пакетов
- `pnpm typecheck` — проверка типов
- `pnpm lint` — линтинг
- `pnpm test` — тесты
