import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type ProductionOrder, type ProductionOrderLine } from '@prisma/client';
const Decimal = Prisma.Decimal;
import { checkAndCloseProductionOrder, transitionToInProgress } from './production-order-closing';
import { writeAudit, writeTiming } from '@prodtrack/db';
import type { SessionWithUser } from '@/lib/auth/session-token';

vi.mock('@prodtrack/db', () => ({
  writeAudit: vi.fn(),
  writeTiming: vi.fn(),
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

  it('closes 1-RC order when single line is REPORTED', async () => {
    const order = makeOrder({ status: 'CONFIRMED', lines: [makeLine({ status: 'REPORTED' })] });
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession);

    expect(result.closed).toBe(true);
    expect(result.status).toBe('COMPLETED');
    expect(writeAudit).toHaveBeenCalled();
    expect(writeTiming).toHaveBeenCalled();
  });

  it('does not close 1-RC order when single line is only ACCEPTED', async () => {
    const order = makeOrder({ status: 'CONFIRMED', lines: [makeLine({ status: 'ACCEPTED' })] });
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession);

    expect(result.closed).toBe(false);
    expect(result.status).toBe('CONFIRMED');
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('closes multi-RC order when all lines are ACCEPTED and REPORTED', async () => {
    const order = makeOrder({
      status: 'IN_PROGRESS',
      lines: [
        makeLine({ id: 'line-1', status: 'REPORTED' }),
        makeLine({ id: 'line-2', workCenterId: 'wc-03', productId: 'gp-1', status: 'REPORTED' }),
        makeLine({ id: 'line-3', workCenterId: 'wc-04', productId: 'gp-1', status: 'REPORTED' }),
      ],
    });
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession);

    expect(result.closed).toBe(true);
    expect(result.status).toBe('COMPLETED');
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
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession);

    expect(result.closed).toBe(false);
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('does not close multi-RC order when all ACCEPTED but only 2 of 3 REPORTED', async () => {
    const order = makeOrder({
      status: 'IN_PROGRESS',
      lines: [
        makeLine({ id: 'line-1', status: 'REPORTED' }),
        makeLine({ id: 'line-2', workCenterId: 'wc-03', productId: 'gp-1', status: 'REPORTED' }),
        makeLine({ id: 'line-3', workCenterId: 'wc-04', productId: 'gp-1', status: 'ACCEPTED' }),
      ],
    });
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession);

    expect(result.closed).toBe(false);
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('does not close multi-RC order when all REPORTED but only 2 of 3 ACCEPTED', async () => {
    const order = makeOrder({
      status: 'IN_PROGRESS',
      lines: [
        makeLine({ id: 'line-1', status: 'REPORTED' }),
        makeLine({ id: 'line-2', workCenterId: 'wc-03', productId: 'gp-1', status: 'REPORTED' }),
        makeLine({ id: 'line-3', workCenterId: 'wc-04', productId: 'gp-1', status: 'REPORTED' }),
      ],
    });
    // Заменяем статус третьей строки на ASSIGNED, чтобы она не была ни ACCEPTED, ни REPORTED.
    order.lines[2].status = 'ASSIGNED';
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession);

    expect(result.closed).toBe(false);
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('does not close already COMPLETED order', async () => {
    const order = makeOrder({ status: 'COMPLETED', lines: [makeLine({ status: 'REPORTED' })] });
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession);

    expect(result.closed).toBe(false);
    expect(result.status).toBe('COMPLETED');
  });

  it('does not close DRAFT order', async () => {
    const order = makeOrder({ status: 'DRAFT', lines: [makeLine({ status: 'REPORTED' })] });
    const prisma = makeMockPrisma(order);
    const result = await checkAndCloseProductionOrder('po-1', prisma, baseSession);

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
    const result = await transitionToInProgress('po-1', prisma, baseSession);

    expect(result.transitioned).toBe(true);
    expect(writeAudit).toHaveBeenCalled();
    expect(writeTiming).toHaveBeenCalled();
  });

  it('does not transition CONFIRMED order without ACCEPTED lines', async () => {
    const order = makeOrder({ status: 'CONFIRMED', lines: [makeLine({ status: 'ASSIGNED' })] });
    const prisma = makeMockPrisma(order);
    const result = await transitionToInProgress('po-1', prisma, baseSession);

    expect(result.transitioned).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('does not transition already IN_PROGRESS order', async () => {
    const order = makeOrder({ status: 'IN_PROGRESS', lines: [makeLine({ status: 'ACCEPTED' })] });
    const prisma = makeMockPrisma(order);
    const result = await transitionToInProgress('po-1', prisma, baseSession);

    expect(result.transitioned).toBe(false);
  });

  it('does not transition DRAFT order', async () => {
    const order = makeOrder({ status: 'DRAFT', lines: [makeLine({ status: 'ACCEPTED' })] });
    const prisma = makeMockPrisma(order);
    const result = await transitionToInProgress('po-1', prisma, baseSession);

    expect(result.transitioned).toBe(false);
  });
});
