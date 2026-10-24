# syntax=docker/dockerfile:1

# Источник libssl/openssl: в slim-образе их нет, а apt с этого сервера недоступен
# (deb.debian.org не отвечает, сборка падала трижды — 20.10 и 23.10).
FROM node:22-bookworm AS ssl-source

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Библиотеки нужны и сборке (`prisma generate` в builder), и рантайму (движок запросов),
# поэтому кладём их в общую базовую стадию — иначе предупреждение Prisma остаётся (ОПЭ-46).
# `ldconfig` обязателен: Prisma ищет OpenSSL через кэш динамического линкера, а скопированные
# файлы в кэш сами не попадают.
COPY --from=ssl-source /usr/lib/x86_64-linux-gnu/libssl.so.3 /usr/lib/x86_64-linux-gnu/
COPY --from=ssl-source /usr/lib/x86_64-linux-gnu/libcrypto.so.3 /usr/lib/x86_64-linux-gnu/
COPY --from=ssl-source /usr/bin/openssl /usr/bin/openssl
COPY --from=ssl-source /usr/lib/ssl/openssl.cnf /usr/lib/ssl/openssl.cnf
RUN ldconfig
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

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG VERSION=dev
ENV VERSION=${VERSION}
# libssl и openssl приходят из базовой стадии (см. комментарий у `base`): они нужны движку
# Prisma в рантайме, и там же обновлён кэш динамического линкера.
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