import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type ProductionOrder, type ProductionOrderLine } from '@prisma/client';
const Decimal = Prisma.Decimal;
import { acceptProductionOrderLine } from '../actions';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/production-order-closing', () => ({
  transitionToInProgress: vi.fn().mockResolvedValue({ transitioned: true }),
  checkAndCloseProductionOrder: vi.fn().mockResolvedValue({ closed: false, status: 'IN_PROGRESS' }),
}));

const baseSession = {
  userId: 'user-1',
  id: 'session-1',
  token: 'token',
  userAgent: null,
  expiresAt: new Date(),
  createdAt: new Date(),
  user: {
    id: 'user-1',
    login: 'opr',
    passwordHash: 'hash',
    mustChangePassword: false,
    active: true,
    employeeId: 'emp-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    roles: [{ role: { code: 'OPR' } }],
  },
};

function makeOrder(overrides: Partial<ProductionOrder> = {}): ProductionOrder {
  return {
    id: 'po-1',
    shiftId: 'shift-1',
    status: 'CONFIRMED',
    createdById: 'user-2',
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    confirmedAt: null,
    confirmedByUserId: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    ...overrides,
  };
}

function makeLine(overrides: Partial<ProductionOrderLine> = {}): ProductionOrderLine {
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
  };
}

function buildMockPrisma(overrides: {
  line?: ProductionOrderLine;
  order?: ProductionOrder;
} = {}) {
  const order = overrides.order ?? makeOrder();
  const line = overrides.line ?? makeLine({ orderId: order.id });

  const lineUpdate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...line, ...data }),
  );
  const lineFindUnique = vi.fn().mockResolvedValue({
    ...line,
    order,
    operator: { id: 'emp-1', tabNumber: '001', fullName: 'Иванов И.И.', active: true },
  });
  const notificationCreateMany = vi.fn().mockResolvedValue(undefined);
  const userFindMany = vi.fn().mockResolvedValue([{ id: 'np-user-1' }]);

  const tx = {
    productionOrderLine: {
      update: lineUpdate,
      findUnique: lineFindUnique,
    },
    notification: {
      createMany: notificationCreateMany,
    },
    user: {
      findMany: userFindMany,
    },
  };

  const prisma = {
    productionOrderLine: {
      findUnique: lineFindUnique,
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as NonNullable<Parameters<typeof acceptProductionOrderLine>[1]>['prisma'];

  return {
    prisma,
    lineUpdate,
    notificationCreateMany,
    userFindMany,
  };
}

describe('acceptProductionOrderLine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts own ASSIGNED line and returns ACCEPTED', async () => {
    const deps = buildMockPrisma();
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    const result = await acceptProductionOrderLine('line-1', {
      prisma: deps.prisma,
      writeAudit,
      writeTiming,
      requireShiftWindow,
    });

    expect(result.status).toBe('ACCEPTED');
    expect(deps.lineUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'ACCEPTED' } }));
    expect(writeAudit).toHaveBeenCalled();
    expect(writeTiming).toHaveBeenCalled();
  });

  it('emits EV-02 with payload and NP recipients', async () => {
    const deps = buildMockPrisma();
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await acceptProductionOrderLine('line-1', {
      prisma: deps.prisma,
      writeAudit,
      writeTiming,
      requireShiftWindow,
    });

    expect(deps.notificationCreateMany).toHaveBeenCalled();
    const data = deps.notificationCreateMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0].eventCode).toBe('EV_02');
    expect(data[0].recipientId).toBe('np-user-1');
    expect(data[0].deepLink).toBe('/production-orders/po-1');
    const payload = JSON.parse(data[0].body);
    expect(payload).toMatchObject({ orderId: 'po-1', lineId: 'line-1', workCenterId: 'wc-01', operatorId: 'emp-1' });
  });

  it('calls transitionToInProgress and checkAndCloseProductionOrder', async () => {
    const { transitionToInProgress, checkAndCloseProductionOrder } = await import('@/lib/production-order-closing');
    const deps = buildMockPrisma();
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await acceptProductionOrderLine('line-1', {
      prisma: deps.prisma,
      writeAudit,
      writeTiming,
      requireShiftWindow,
    });

    expect(transitionToInProgress).toHaveBeenCalledWith('po-1', expect.anything(), baseSession);
    expect(checkAndCloseProductionOrder).toHaveBeenCalledWith('po-1', expect.anything(), baseSession);
  });

  it('blocks accepting line for another operator', async () => {
    const line = makeLine({ operatorId: 'emp-2' });
    const deps = buildMockPrisma({ line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      acceptProductionOrderLine('line-1', {
        prisma: deps.prisma,
        writeAudit,
        writeTiming,
        requireShiftWindow,
      }),
    ).rejects.toThrow('Подтвердить получение может только Оператор, назначенный на этот РЦ');
  });

  it('blocks accepting already ACCEPTED line', async () => {
    const line = makeLine({ status: 'ACCEPTED' });
    const deps = buildMockPrisma({ line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      acceptProductionOrderLine('line-1', {
        prisma: deps.prisma,
        writeAudit,
        writeTiming,
        requireShiftWindow,
      }),
    ).rejects.toThrow('Строка уже подтверждена или введён итог');
  });

  it('blocks accepting REPORTED line', async () => {
    const line = makeLine({ status: 'REPORTED' });
    const deps = buildMockPrisma({ line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      acceptProductionOrderLine('line-1', {
        prisma: deps.prisma,
        writeAudit,
        writeTiming,
        requireShiftWindow,
      }),
    ).rejects.toThrow('Строка уже подтверждена или введён итог');
  });

  it('blocks accepting when order is DRAFT', async () => {
    const order = makeOrder({ status: 'DRAFT' });
    const deps = buildMockPrisma({ order });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      acceptProductionOrderLine('line-1', {
        prisma: deps.prisma,
        writeAudit,
        writeTiming,
        requireShiftWindow,
      }),
    ).rejects.toThrow('ПЗ не может быть принят в работу в этом статусе');
  });

  it('blocks accepting when order is CANCELLED', async () => {
    const order = makeOrder({ status: 'CANCELLED' });
    const deps = buildMockPrisma({ order });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      acceptProductionOrderLine('line-1', {
        prisma: deps.prisma,
        writeAudit,
        writeTiming,
        requireShiftWindow,
      }),
    ).rejects.toThrow('ПЗ не может быть принят в работу в этом статусе');
  });

  it('blocks accepting when order is COMPLETED', async () => {
    const order = makeOrder({ status: 'COMPLETED' });
    const deps = buildMockPrisma({ order });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      acceptProductionOrderLine('line-1', {
        prisma: deps.prisma,
        writeAudit,
        writeTiming,
        requireShiftWindow,
      }),
    ).rejects.toThrow('ПЗ не может быть принят в работу в этом статусе');
  });

  it('blocks accepting without production_order:accept permission', async () => {
    const session = {
      ...baseSession,
      user: { ...baseSession.user, roles: [{ role: { code: 'S1C' } }] },
    };
    const deps = buildMockPrisma();
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(session);

    await expect(
      acceptProductionOrderLine('line-1', {
        prisma: deps.prisma,
        writeAudit,
        writeTiming,
        requireShiftWindow,
      }),
    ).rejects.toThrow('Forbidden: insufficient permissions');
  });

  it('blocks accepting outside shift window', async () => {
    const deps = buildMockPrisma();
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockRejectedValue(new Error('Вне рабочего времени'));

    await expect(
      acceptProductionOrderLine('line-1', {
        prisma: deps.prisma,
        writeAudit,
        writeTiming,
        requireShiftWindow,
      }),
    ).rejects.toThrow('Вне рабочего времени');
  });
});
