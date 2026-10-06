import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@prodtrack/db', async () => {
  const actual = await vi.importActual<typeof import('@prodtrack/db')>('@prodtrack/db');
  return {
    ...actual,
    prisma: {
    productionOrderLine: { findMany: vi.fn(), aggregate: vi.fn() },
    shiftSummary: { aggregate: vi.fn() },
    goodsTransfer: { findMany: vi.fn() },
    stockMovement: { aggregate: vi.fn() },
    productionOrder: { findMany: vi.fn(), aggregate: vi.fn() },
    stageTiming: { findMany: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
    },
    writeAudit: vi.fn(),
    writeTiming: vi.fn(),
  };
});
vi.mock('@/lib/auth/page-guard', () => ({ checkPageAccess: vi.fn() }));

import { prisma } from '@prodtrack/db';
import { checkPageAccess } from '@/lib/auth/page-guard';
import { AccessDenied } from '@/components/access-denied';
import DashboardServerPage from '../page';

function mockAccess(roles: string[], allowed = true, employeeId: string | null = 'emp-1') {
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

function propsOf(element: unknown): Record<string, unknown> {
  return (element as { props: Record<string, unknown> }).props;
}

describe('Экран «Сводный дашборд»: доступ и данные (M11 §3, §8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.productionOrderLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.shiftSummary.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({ _sum: {} });
    (prisma.goodsTransfer.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.stockMovement.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: {},
      _count: { _all: 0 },
      _max: {},
    });
    (prisma.productionOrder.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.stageTiming.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.stageTiming.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.productionOrder.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _count: { _all: 0 },
      _max: {},
    });
    (prisma.productionOrderLine.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _count: { _all: 0 },
      _max: {},
    });
    (prisma.stageTiming.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _count: { _all: 0 },
      _max: {},
    });
  });

  it('требует право на просмотр дашборда — своё или сводное (M11 §3)', async () => {
    mockAccess(['ADM']);

    await DashboardServerPage({ searchParams: {} });

    expect(checkPageAccess).toHaveBeenCalledWith(['dashboard:read', 'dashboard:read_own']);
  });

  it('роль без доступа получает экран «Доступ запрещён», а не 500', async () => {
    mockAccess([], false);

    const element = await DashboardServerPage({ searchParams: {} });

    expect(element.type).toBe(AccessDenied);
    expect(prisma.productionOrder.findMany).not.toHaveBeenCalled();
  });

  it('разбирает период и фильтры из строки запроса', async () => {
    mockAccess(['ADM']);

    const element = await DashboardServerPage({
      searchParams: { period: 'TODAY', type: 'PRODUCTION_ORDER', status: 'CONFIRMED' },
    });

    const props = propsOf(element);
    expect(props.period).toBe('TODAY');
    expect(props.filter).toEqual({ type: 'PRODUCTION_ORDER', status: 'CONFIRMED' });
    expect(props.scope).toBe('ALL');
  });

  it('неизвестные значения фильтров дают значения по умолчанию', async () => {
    mockAccess(['ADM']);

    const element = await DashboardServerPage({ searchParams: { period: 'X', type: 'Y', status: 'Z' } });

    const props = propsOf(element);
    expect(props.period).toBe('SHIFT');
    expect(props.filter).toEqual({ type: 'ALL', status: 'ALL' });
  });

  it('Оператор получает показатели в разрезе своих РЦ и своих документов', async () => {
    mockAccess(['OPR']);

    const element = await DashboardServerPage({ searchParams: {} });

    expect(propsOf(element).scope).toBe('OWN_WORK_CENTER');
    expect(prisma.productionOrderLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: { workCenterId: true } }),
    );
    expect(prisma.productionOrderLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: { orderId: true } }),
    );
  });

  it('Оператор без привязанного сотрудника не видит данные вместо всего предприятия', async () => {
    mockAccess(['OPR'], true, null);

    const element = await DashboardServerPage({ searchParams: {} });

    expect(propsOf(element).scope).toBe('OWN_WORK_CENTER');
    // Пустой список РЦ даёт выборку «ничего»: отсутствие фильтра открыло бы данные всего цеха.
    expect(prisma.productionOrderLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workCenterId: { in: [] } }),
      }),
    );
    expect(prisma.productionOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lines: { some: { workCenterId: { in: [] } } } }),
      }),
    );
  });

  it('сводные роли не ограничиваются своими РЦ', async () => {
    mockAccess(['KSGP']);

    const element = await DashboardServerPage({ searchParams: {} });

    expect(propsOf(element).scope).toBe('ALL');
    expect(prisma.productionOrderLine.findMany).toHaveBeenCalledTimes(1);
  });
});
