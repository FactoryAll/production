# syntax=docker/dockerfile:1

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@11.8.0

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/tsconfig/package.json ./packages/tsconfig/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/packages ./packages
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.json ./
COPY apps/web ./apps/web
COPY packages ./packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
ENV NEXT_TELEMETRY_DISABLED=1
ARG VERSION=dev
ENV VERSION=${VERSION}
RUN pnpm --filter @prodtrack/db db:generate
RUN pnpm build

# Источник libssl/openssl для стадии runner: в slim-образе их нет, а ставить через apt
# с этого сервера невозможно (см. комментарий в стадии runner).
FROM node:22-bookworm AS ssl-source

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG VERSION=dev
ENV VERSION=${VERSION}
# Движку Prisma нужна библиотека libssl, а в node:22-slim её нет (проверено 20.10.2026:
# `openssl: not found`, /usr/lib/x86_64-linux-gnu/libssl* отсутствует).
#
# Раньше её ставили через apt-get. Это оказалось единственной хрупкой точкой сборки:
# deb.debian.org с этого сервера недоступен, и сборка падала трижды — 20.10 два раза и 23.10.
# Повторы не помогали: таймаут на всех зеркалах сразу. Теперь библиотеки просто копируются
# из официального полного образа node:22-bookworm — без обращения к Debian вообще.
# Итоговый образ остаётся slim: полный образ живёт только в промежуточной стадии.
COPY --from=ssl-source /usr/lib/x86_64-linux-gnu/libssl.so.3 /usr/lib/x86_64-linux-gnu/
COPY --from=ssl-source /usr/lib/x86_64-linux-gnu/libcrypto.so.3 /usr/lib/x86_64-linux-gnu/
# CLI openssl нужен Prisma для определения версии OpenSSL; сама библиотека — из строк выше.
COPY --from=ssl-source /usr/bin/openssl /usr/bin/openssl
COPY --from=ssl-source /usr/lib/ssl/openssl.cnf /usr/lib/ssl/openssl.cnf
# Prisma ищет библиотеку через `ldconfig -p`. Скопированные файлы попадают в каталог,
# но кэш динамического линкера о них не знает — Prisma не находит OpenSSL и предупреждает,
# что будет использовать openssl-1.1.x (ОПЭ-46). Обновляем кэш.
RUN ldconfig
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
# В standalone-сборку Next.js не копирует public автоматически: без этой строки логотип
# и тёмный вариант иконки отдавали бы 404.
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/node_modules ./node_modules
RUN npm install -g prisma@5.22.0 tsx@4.15.0 && prisma generate --schema=/app/packages/db/prisma/schema.prisma
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/web/server.js"]