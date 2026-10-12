import { PrismaClient } from '@prisma/client';

/**
 * Клиент Prisma — один на процесс.
 *
 * В dev-режиме Next.js собирает каждый маршрут отдельным бандлом, и этот пакет попадает в каждый
 * из них. Пока клиент создавался на уровне модуля, каждый посещённый маршрут открывал свой пул
 * соединений: на живом замере 12.10.2026 к десятой странице набегало +2 соединения на маршрут,
 * в e2e-прогоне соединения заканчивались («Too many clients already»), и страницы падали с 500.
 * `globalThis` общий для процесса, поэтому все бандлы переиспользуют один клиент.
 */
const globalForPrisma = globalThis as unknown as { __prodtrackPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__prodtrackPrisma ?? new PrismaClient();

globalForPrisma.__prodtrackPrisma = prisma;
