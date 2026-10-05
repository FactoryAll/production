import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));
vi.mock('@prodtrack/db', () => ({
  prisma: {
    stageTiming: { findMany: vi.fn() },
    productionOrderLine: { findMany: vi.fn() },
  },
}));

import { checkPageAccess } from '@/lib/auth/page-guard';
import { prisma } from '@prodtrack/db';
import TimingServerPage from '../page';

const FULL_ID = '3dfa5dab-3d2d-445d-9221-16fea6cfb2fc';

function mockAccess() {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed: true,
    roles: ['NP'],
    session: { userId: 'user-1', user: { id: 'user-1', employeeId: null, roles: [{ role: { code: 'NP' } }] } },
  });
}

function record(id: string, fromStatus: string, toStatus: string, transitionedAt: string) {
  return {
    id,
    documentType: 'PRODUCTION_ORDER',
    documentId: FULL_ID,
    entityType: 'DOCUMENT',
    entityId: FULL_ID,
    fromStatus,
    toStatus,
    transitionedAt: new Date(transitionedAt),
    initiatorRole: 'NP',
    initiatorId: 'user-1',
  };
}

describe('Хронометраж: расчёт длительностей по префиксу id (дефект №6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess();
    (prisma.productionOrderLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('находит документ по префиксу и считает длительности по полному id', async () => {
    const rows = [
      record('t-1', 'DRAFT', 'CONFIRMED', '2026-10-04T14:25:13Z'),
      record('t-2', 'CONFIRMED', 'IN_PROGRESS', '2026-10-04T16:31:10Z'),
      record('t-3', 'IN_PROGRESS', 'COMPLETED', '2026-10-05T07:47:46Z'),
    ];
    (prisma.stageTiming.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

    const element = await TimingServerPage({ searchParams: { documentId: '3dfa5dab' } });

    // Первый запрос — список с фильтром по префиксу, второй — записи документа по полному id.
    const calls = (prisma.stageTiming.findMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1][0]).toMatchObject({ where: { documentId: FULL_ID } });

    const html = JSON.stringify(element);
    expect(html).toContain('Подтверждено');
  });

  it('если документ не найден в списке, длительности не считаются', async () => {
    (prisma.stageTiming.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await TimingServerPage({ searchParams: { documentId: 'нет-такого' } });

    expect(prisma.stageTiming.findMany).toHaveBeenCalledTimes(1);
  });
});
