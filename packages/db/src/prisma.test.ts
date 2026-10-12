import { describe, it, expect } from 'vitest';
import { prisma } from './prisma';

describe('Клиент Prisma — один на процесс', () => {
  it('хранится в globalThis, чтобы бандлы маршрутов переиспользовали его', () => {
    // В dev- и production-сборке Next.js каждый маршрут — отдельный бандл, и пакет попадает
    // в каждый из них. Без общего хранилища каждый посещённый маршрут открывал свой пул
    // соединений: на замере 12.10.2026 это давало +2 соединения на маршрут, а в e2e-прогоне
    // и на долго живущем стенде заканчивались соединения PostgreSQL («too many clients already»).
    const holder = globalThis as unknown as { __prodtrackPrisma?: unknown };
    expect(holder.__prodtrackPrisma).toBe(prisma);
  });
});
