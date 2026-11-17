import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type ProductionOrder, type ProductionOrderLine } from '@prisma/client';
const Decimal = Prisma.Decimal;
import {
  checkAndCloseProductionOrder,
  closeProductionOrderByNP,
  transitionToInProgress,
} from './production-order-closing';
import { writeAudit, writeTiming } from '@prodtrack/db';
import { buildShiftSummary } from '@/lib/shift-summary-service';
import { syncProductionOrderTask } from '@/lib/onec/tasks';
import type { SessionWithUser } from '@/lib/auth/session-token';

vi.mock('@prodtrack/db', () => ({
  writeAudit: vi.fn(),
  writeTiming: vi.fn(),
}));

vi.mock('@/lib/shift-summary-service', () => ({
  buildShiftSummary: vi.fn(),
}));

vi.mock('@/lib/onec/tasks', () => ({
  syncProductionOrderTask: vi.fn(),
}));

const baseSession: SessionWithUser = {
  userId: 'user-1',
  id: 'session-1',
  token: 'token',
  userAgent: null,
  expiresAt: new Date(),
  createdAt: new Date(),
  user: {
    id: 'user-1',
    login: 'np',
    passwordHash: 'hash',
    mustChangePassword: false,
  notificationScope: 'ALL' as const,
    active: true,
    employeeId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    roles: [{ role: { code: 'NP' } }],
  },
};

function makeLine(overrides: Partial<ProductionOrderLine> & { status?: ProductionOrderLine['status'] } = {}): ProductionOrderLine {
  return {
    id: 'line-1',
    orderId: 'po-1',
    workCenterId: 'wc-01',
    productId: 'mass-1',
    plannedQuantity: new Decimal(10),
    operatorId: 'emp-1',
    status: 'ASSIGNED',
    comment: null,
    substitutionReasonId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ProductionOrderLine;
}

function makeOrder(overrides: Partial<ProductionOrder> & { lines?: ProductionOrderLine[] } = {}) {
  const lines = overrides.lines ?? [makeLine()];
  return {
    id: 'po-1',
    shiftId: 'shift-1',
    status: 'CONFIRMED',
    createdById: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    confirmedAt: null,
    confirmedByUserId: null,
    lines,
    ...overrides,
  } as ProductionOrder & { lines: ProductionOrderLine[] };
}

function makeMockPrisma(order: ReturnType<typeof makeOrder>) {
  return {
    productionOrder: {
      findUnique: vi.fn().mockResolvedValue(order),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...order, ...data }),
      ),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        productionOrder: {
          update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ ...order, ...data }),
          ),
        },
      };
      return cb(tx);
    }),
  } as unknown as Parameters<typeof checkAndCloseProductionOrder>[1];
}

describe('checkAndCloseProductionOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 14.11.2026, фидбэк НП: ПЗ больше не закрывается само — ставится «Ожидает закрытия НП».
  it('ставит «Ожидает закрытия НП», когда единственная строка отчитана', async () => {
    const order = makeOrder({ status: 'IN_PROGRESS', lines: [makeLine({ status: 'REPORTED' })] });
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession, 'production_order:report');

    expect(result.closed).toBe(false);
    expect(result.readyForClose).toBe(true);
    expect(result.status).toBe('READY_FOR_CLOSE');
    expect(prisma.productionOrder.update).toHaveBeenCalledWith({
      where: { id: 'po-1' },
      data: { status: 'READY_FOR_CLOSE' },
    });
    // Автозакрытия нет: ни итог смены, ни задача 1С здесь не формируются.
    expect(buildShiftSummary).not.toHaveBeenCalled();
    expect(syncProductionOrderTask).not.toHaveBeenCalled();
  });

  it('does not close 1-RC order when single line is only ACCEPTED', async () => {
    const order = makeOrder({ status: 'CONFIRMED', lines: [makeLine({ status: 'ACCEPTED' })] });
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession, 'production_order:confirm');

    expect(result.closed).toBe(false);
    expect(result.status).toBe('CONFIRMED');
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('ставит «Ожидает закрытия НП» по многоРЦ-ПЗ, когда отчитались все строки', async () => {
    const order = makeOrder({
      status: 'IN_PROGRESS',
      lines: [
        makeLine({ id: 'line-1', status: 'REPORTED' }),
        makeLine({ id: 'line-2', workCenterId: 'wc-03', productId: 'gp-1', status: 'REPORTED' }),
        makeLine({ id: 'line-3', workCenterId: 'wc-04', productId: 'gp-1', status: 'REPORTED' }),
      ],
    });
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession, 'production_order:report');

    expect(result.closed).toBe(false);
    expect(result.readyForClose).toBe(true);
    expect(result.status).toBe('READY_FOR_CLOSE');
    expect(buildShiftSummary).not.toHaveBeenCalled();
  });

  it('формирует задачу 1С при закрытии начальником производства (T-050, UC-M12-1)', async () => {
    const order = makeOrder({ status: 'READY_FOR_CLOSE', lines: [makeLine({ status: 'REPORTED' })] });
    const prisma = makeMockPrisma(order);
    const result = await closeProductionOrderByNP('po-1', prisma, baseSession, 'production_order:confirm');

    expect(result.closed).toBe(true);
    expect(result.status).toBe('COMPLETED');
    expect(buildShiftSummary).toHaveBeenCalledWith('po-1', prisma);
    expect(syncProductionOrderTask).toHaveBeenCalledWith(prisma, 'po-1');
  });

  it('не закрывает ПЗ, если не все РЦ отчитались', async () => {
    const order = makeOrder({
      status: 'IN_PROGRESS',
      lines: [makeLine({ id: 'l1', status: 'REPORTED' }), makeLine({ id: 'l2', status: 'ACCEPTED' })],
    });
    const prisma = makeMockPrisma(order);

    await expect(
      closeProductionOrderByNP('po-1', prisma, baseSession, 'production_order:confirm'),
    ).rejects.toThrow(/все РЦ внесли итоги/);
    expect(syncProductionOrderTask).not.toHaveBeenCalled();
  });

  it('does not form the 1С task when the order did not close', async () => {
    const order = makeOrder({ status: 'CONFIRMED', lines: [makeLine({ status: 'ACCEPTED' })] });
    const prisma = makeMockPrisma(order);
    await checkAndCloseProductionOrder('po-1', prisma, baseSession, 'production_order:report');

    expect(syncProductionOrderTask).not.toHaveBeenCalled();
  });

  it('does not call buildShiftSummary when closing did not happen', async () => {
    const order = makeOrder({ status: 'IN_PROGRESS', lines: [makeLine({ status: 'REPORTED' })] });
    order.lines[0].status = 'ACCEPTED';
    const prisma = makeMockPrisma(order);
    await checkAndCloseProductionOrder('po-1', prisma, baseSession, 'production_order:confirm');
    expect(buildShiftSummary).not.toHaveBeenCalled();
  });

  it('does not close multi-RC order when 2 of 3 lines are REPORTED and 1 ACCEPTED', async () => {
    const order = makeOrder({
      status: 'IN_PROGRESS',
      lines: [
        makeLine({ id: 'line-1', status: 'REPORTED' }),
        makeLine({ id: 'line-2', workCenterId: 'wc-03', productId: 'gp-1', status: 'REPORTED' }),
        makeLine({ id: 'line-3', workCenterId: 'wc-04', productId: 'gp-1', status: 'ACCEPTED' }),
      ],
    });
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession, 'production_order:confirm');

    expect(result.closed).toBe(false);
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('does not close multi-RC order when only 2 of 3 lines are REPORTED and 1 is ACCEPTED', async () => {
    const order = makeOrder({
      status: 'IN_PROGRESS',
      lines: [
        makeLine({ id: 'line-1', status: 'REPORTED' }),
        makeLine({ id: 'line-2', workCenterId: 'wc-03', productId: 'gp-1', status: 'REPORTED' }),
        makeLine({ id: 'line-3', workCenterId: 'wc-04', productId: 'gp-1', status: 'ACCEPTED' }),
      ],
    });
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession, 'production_order:confirm');

    expect(result.closed).toBe(false);
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('does not close multi-RC order when a line is ASSIGNED', async () => {
    const order = makeOrder({
      status: 'IN_PROGRESS',
      lines: [
        makeLine({ id: 'line-1', status: 'REPORTED' }),
        makeLine({ id: 'line-2', workCenterId: 'wc-03', productId: 'gp-1', status: 'REPORTED' }),
        makeLine({ id: 'line-3', workCenterId: 'wc-04', productId: 'gp-1', status: 'ASSIGNED' }),
      ],
    });
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession, 'production_order:confirm');

    expect(result.closed).toBe(false);
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('does not close already COMPLETED order', async () => {
    const order = makeOrder({ status: 'COMPLETED', lines: [makeLine({ status: 'REPORTED' })] });
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession, 'production_order:confirm');

    expect(result.closed).toBe(false);
    expect(result.status).toBe('COMPLETED');
  });

  it('does not close DRAFT order', async () => {
    const order = makeOrder({ status: 'DRAFT', lines: [makeLine({ status: 'REPORTED' })] });
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession, 'production_order:confirm');

    expect(result.closed).toBe(false);
    expect(result.status).toBe('DRAFT');
  });
});

describe('transitionToInProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transitions CONFIRMED order to IN_PROGRESS when first line is ACCEPTED', async () => {
    const order = makeOrder({ status: 'CONFIRMED', lines: [makeLine({ status: 'ACCEPTED' })] });
    const prisma = makeMockPrisma(order);
    const result = await transitionToInProgress('po-1', prisma, baseSession, 'production_order:accept');

    expect(result.transitioned).toBe(true);
    expect(writeAudit).toHaveBeenCalled();
    expect(writeTiming).toHaveBeenCalled();
  });

  it('does not transition CONFIRMED order without ACCEPTED lines', async () => {
    const order = makeOrder({ status: 'CONFIRMED', lines: [makeLine({ status: 'ASSIGNED' })] });
    const prisma = makeMockPrisma(order);
    const result = await transitionToInProgress('po-1', prisma, baseSession, 'production_order:accept');

    expect(result.transitioned).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('does not transition already IN_PROGRESS order', async () => {
    const order = makeOrder({ status: 'IN_PROGRESS', lines: [makeLine({ status: 'ACCEPTED' })] });
    const prisma = makeMockPrisma(order);
    const result = await transitionToInProgress('po-1', prisma, baseSession, 'production_order:accept');

    expect(result.transitioned).toBe(false);
  });

  it('does not transition DRAFT order', async () => {
    const order = makeOrder({ status: 'DRAFT', lines: [makeLine({ status: 'ACCEPTED' })] });
    const prisma = makeMockPrisma(order);
    const result = await transitionToInProgress('po-1', prisma, baseSession, 'production_order:accept');

    expect(result.transitioned).toBe(false);
  });
  it('регресс: переход Оператора атрибутируется правом accept, а не правом НП', async () => {
    // Дефект ручного тестирования v1.2.0: переход CONFIRMED → IN_PROGRESS писал аудит
    // с правом production_order:confirm. У Оператора этого права нет, и kernel-функция
    // writeAudit падала с «No role has permission production_order:confirm» —
    // подтверждение получения ПЗ ломалось прямо в интерфейсе.
    const order = makeOrder({ status: 'CONFIRMED', lines: [makeLine({ status: 'ACCEPTED' })] });
    const prisma = makeMockPrisma(order);
    const operatorSession: SessionWithUser = {
      ...baseSession,
      user: { ...baseSession.user, login: 'opr1', roles: [{ role: { code: 'OPR' } }] },
    };

    await transitionToInProgress('po-1', prisma, operatorSession, 'production_order:accept');

    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: 'production_order:accept' }),
    );
    expect(writeTiming).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ initiatorRole: 'OPR' }),
    );
  });

  it('регресс: закрытие ПЗ атрибутируется правом начальника производства (14.11.2026)', async () => {
    // Автозакрытия больше нет: аудит перехода в COMPLETED пишется при закрытии НП и несёт
    // право `production_order:confirm`, а не `report` — иначе след в журнале врал бы о том,
    // кто закрыл смену.
    const order = makeOrder({ status: 'READY_FOR_CLOSE', lines: [makeLine({ status: 'REPORTED' })] });
    const prisma = makeMockPrisma(order);

    await closeProductionOrderByNP('po-1', prisma, baseSession, 'production_order:confirm');

    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: 'production_order:confirm' }),
    );
  });
});