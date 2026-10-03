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
import { AccessDenied } from '@/components/access-denied';
import TimingServerPage from '../page';

function mockAccess(roles: string[], employeeId: string | null = null, allowed = true) {
  (checkPageAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed,
    roles,
    session: {
      userId: 'user-1',
      user: {
        id: 'user-1',
        employeeId,
        roles: roles.map((code) => ({ role: { code } })),
      },
    },
  });
}

describe('Экран «Хронометраж»: доступ, фильтры и область видимости (M10, T-046)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.stageTiming.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.productionOrderLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('роль без права timing:read получает экран «Доступ запрещён»', async () => {
    mockAccess(['OPR'], 'emp-1', false);

    const element = await TimingServerPage({ searchParams: {} });

    expect(element.type).toBe(AccessDenied);
    expect(prisma.stageTiming.findMany).not.toHaveBeenCalled();
  });

  it('читает переходы с фильтром по типу документа и страницей', async () => {
    mockAccess(['NP']);

    const element = await TimingServerPage({
      searchParams: { documentType: 'GOODS_TRANSFER', page: '2' },
    });

    expect(element.type).toBe('main');
    expect(prisma.stageTiming.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { documentType: 'GOODS_TRANSFER' },
        skip: 50,
        take: 51,
      }),
    );
  });

  it('ОПР видит только переходы по своим ПЗ (M10 §3)', async () => {
    mockAccess(['OPR'], 'emp-1');
    (prisma.productionOrderLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { orderId: 'po-1' },
    ]);

    await TimingServerPage({ searchParams: {} });

    expect(prisma.productionOrderLine.findMany).toHaveBeenCalledWith({
      where: { operatorId: 'emp-1' },
      select: { orderId: true },
    });
    expect(prisma.stageTiming.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { documentId: { in: ['po-1'] }, documentType: 'PRODUCTION_ORDER' },
      }),
    );
  });

  it('при выбранном документе дополнительно считает длительности этапов', async () => {
    mockAccess(['NP']);

    await TimingServerPage({
      searchParams: { documentType: 'PRODUCTION_ORDER', documentId: 'po-1' },
    });

    const calls = (prisma.stageTiming.findMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toMatchObject({
      where: { documentType: 'PRODUCTION_ORDER', documentId: 'po-1' },
      orderBy: [{ transitionedAt: 'asc' }],
    });
  });
});
