import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type ProductionOrder, type ProductionOrderLine, type Product, type DefectReason } from '@prisma/client';
const Decimal = Prisma.Decimal;
import { acceptProductionOrderLine, reportProductionFact } from '../actions';

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

const baseProduct: Product = {
  id: 'mass-1',
  code: 'MASS-01',
  name: 'Масса',
  unit: 'кг',
  category: 'MASS',
  active: true,
} as Product;

const gpProduct: Product = {
  ...baseProduct,
  id: 'gp-1',
  code: 'GP-01',
  name: 'Готовая продукция',
  category: 'GP',
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
  product?: Product;
  defectReason?: DefectReason | null;
  workCenter?: { id: string; code: string; name: string; active: boolean; producesMass: boolean };
} = {}) {
  const order = overrides.order ?? makeOrder();
  const line = overrides.line ?? makeLine({ orderId: order.id });
  const product = overrides.product ?? baseProduct;
  const workCenter = overrides.workCenter ?? { id: 'wc-01', code: 'WC-01', name: 'РЦ 01', active: true, producesMass: true };

  const lineUpdate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...line, ...data }),
  );
  const lineFindUnique = vi.fn().mockResolvedValue({
    ...line,
    order,
    product,
    workCenter,
    operator: { id: 'emp-1', tabNumber: '001', fullName: 'Иванов И.И.', active: true },
  });
  const notificationCreateMany = vi.fn().mockResolvedValue(undefined);
  const userFindMany = vi.fn().mockImplementation(({ where }: { where: { roles?: { some: { role: { code: string } } } } }) => {
    const roleCode = where.roles?.some.role.code;
    if (roleCode === 'NP') return Promise.resolve([{ id: 'np-user-1' }]);
    if (roleCode === 'S1C') return Promise.resolve([{ id: 's1c-user-1' }]);
    return Promise.resolve([]);
  });

  const createdFactId = 'fact-1';
  const productionFactCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({
    id: createdFactId,
    ...data,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  const defectReasonFindUnique = vi.fn().mockResolvedValue(overrides.defectReason ?? {
    id: 'defect-1',
    code: 'D-1',
    name: 'Брак',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const getAvailableBalance = vi.fn().mockResolvedValue({ available: 100, unit: 'кг' });
  const factConsumptionCreateMany = vi.fn().mockResolvedValue(undefined);

  const tx = {
    productionOrderLine: {
      update: lineUpdate,
      findUnique: lineFindUnique,
    },
    productionFact: {
      create: productionFactCreate,
    },
    factConsumption: {
      createMany: factConsumptionCreateMany,
    },
    notification: {
      createMany: notificationCreateMany,
    },
    user: {
      findMany: userFindMany,
    },
    defectReason: {
      findUnique: defectReasonFindUnique,
    },
  };

  const prisma = {
    productionOrderLine: {
      findUnique: lineFindUnique,
    },
    productionFact: {
      create: productionFactCreate,
    },
    factConsumption: {
      createMany: factConsumptionCreateMany,
    },
    product: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === 'mass-1') return Promise.resolve(baseProduct);
        if (where.id === 'gp-1') return Promise.resolve(gpProduct);
        return Promise.resolve(null);
      }),
    },
    defectReason: {
      findUnique: defectReasonFindUnique,
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as NonNullable<Parameters<typeof acceptProductionOrderLine>[1]>['prisma'];

  return {
    prisma,
    lineUpdate,
    productionFactCreate,
    factConsumptionCreateMany,
    notificationCreateMany,
    userFindMany,
    defectReasonFindUnique,
    getAvailableBalance,
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

describe('reportProductionFact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports GP line with factCategory GP and creates fact', async () => {
    const { checkAndCloseProductionOrder } = await import('@/lib/production-order-closing');
    const line = makeLine({ status: 'ACCEPTED', productId: 'gp-1' });
    const deps = buildMockPrisma({ line, product: gpProduct });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue({
      ...baseSession,
      user: { ...baseSession.user, roles: [{ role: { code: 'OPR' } }] },
    });

    const result = await reportProductionFact(
      'line-1',
      { quantity: 5, factCategory: 'GP' },
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
    );

    expect(result.fact.factCategory).toBe('GP');
    expect(deps.productionFactCreate).toHaveBeenCalled();
    expect(deps.lineUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'REPORTED' } }));
    expect(writeAudit).toHaveBeenCalledTimes(2);
    expect(writeTiming).toHaveBeenCalled();
    expect(checkAndCloseProductionOrder).toHaveBeenCalledWith('po-1', expect.anything(), expect.anything());
  });

  it('emits EV-03 to S1C users', async () => {
    const line = makeLine({ status: 'ACCEPTED', productId: 'gp-1' });
    const deps = buildMockPrisma({ line, product: gpProduct });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await reportProductionFact(
      'line-1',
      { quantity: 5, factCategory: 'GP' },
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
    );

    expect(deps.notificationCreateMany).toHaveBeenCalled();
    const data = deps.notificationCreateMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0].eventCode).toBe('EV_03');
    expect(data[0].recipientId).toBe('s1c-user-1');
    expect(data[0].deepLink).toBe('/production-orders/po-1');
  });

  it('reports MASS line always as MASS', async () => {
    const line = makeLine({ status: 'ACCEPTED', productId: 'mass-1' });
    const deps = buildMockPrisma({ line, product: baseProduct });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    const result = await reportProductionFact(
      'line-1',
      { quantity: 10, factCategory: 'MASS' },
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
    );

    expect(result.fact.factCategory).toBe('MASS');
  });

  it('blocks MASS line with input PF', async () => {
    const line = makeLine({ status: 'ACCEPTED', productId: 'mass-1' });
    const deps = buildMockPrisma({ line, product: baseProduct });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 10, factCategory: 'PF' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Для массового продукта категория факта всегда MASS');
  });

  it('blocks GP line with factCategory MASS', async () => {
    const line = makeLine({ status: 'ACCEPTED', productId: 'gp-1' });
    const deps = buildMockPrisma({ line, product: gpProduct });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 5, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Для готовой продукции разрешены категории GP или PF');
  });

  it('saves defect quantity and reason', async () => {
    const line = makeLine({ status: 'ACCEPTED' });
    const deps = buildMockPrisma({ line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await reportProductionFact(
      'line-1',
      { quantity: 10, factCategory: 'MASS', defectQuantity: 1, defectReasonId: 'defect-1' },
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
    );

    expect(deps.productionFactCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ defectQuantity: expect.objectContaining({}), defectReasonId: 'defect-1' }),
      }),
    );
  });

  it('blocks defect without reason', async () => {
    const line = makeLine({ status: 'ACCEPTED' });
    const deps = buildMockPrisma({ line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 10, factCategory: 'MASS', defectQuantity: 1 },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Укажите причину брака');
  });

  it('blocks inactive defect reason', async () => {
    const line = makeLine({ status: 'ACCEPTED' });
    const inactiveReason: DefectReason = {
      id: 'defect-2',
      code: 'D-2',
      name: 'Неактивная',
      active: false,
    } as DefectReason;
    const deps = buildMockPrisma({ line, defectReason: inactiveReason });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 10, factCategory: 'MASS', defectQuantity: 1, defectReasonId: 'defect-2' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Причина брака не найдена или неактивна');
  });

  it('saves stops count and duration', async () => {
    const line = makeLine({ status: 'ACCEPTED' });
    const deps = buildMockPrisma({ line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await reportProductionFact(
      'line-1',
      { quantity: 10, factCategory: 'MASS', stopsCount: 2, stopsDurationMinutes: 30 },
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
    );

    expect(deps.productionFactCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stopsCount: 2, stopsDurationMinutes: 30 }),
      }),
    );
  });

  it('blocks stops count without duration', async () => {
    const line = makeLine({ status: 'ACCEPTED' });
    const deps = buildMockPrisma({ line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 10, factCategory: 'MASS', stopsCount: 2 },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Количество остановок и длительность должны быть заданы вместе');
  });

  it('blocks duration without stops count', async () => {
    const line = makeLine({ status: 'ACCEPTED' });
    const deps = buildMockPrisma({ line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 10, factCategory: 'MASS', stopsDurationMinutes: 30 },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Количество остановок и длительность должны быть заданы вместе');
  });

  it('blocks negative quantity', async () => {
    const line = makeLine({ status: 'ACCEPTED' });
    const deps = buildMockPrisma({ line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: -1, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Значение не может быть отрицательным');
  });

  it('blocks reporting ASSIGNED line', async () => {
    const line = makeLine({ status: 'ASSIGNED' });
    const deps = buildMockPrisma({ line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 10, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Строка не готова к вводу итога');
  });

  it('blocks reporting REPORTED line', async () => {
    const line = makeLine({ status: 'REPORTED' });
    const deps = buildMockPrisma({ line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 10, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Строка не готова к вводу итога');
  });

  it('blocks reporting line of another operator', async () => {
    const line = makeLine({ status: 'ACCEPTED', operatorId: 'emp-2' });
    const deps = buildMockPrisma({ line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 10, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Внести итог может только Оператор, назначенный на этот РЦ');
  });

  it('blocks reporting when order is CANCELLED', async () => {
    const order = makeOrder({ status: 'CANCELLED' });
    const line = makeLine({ status: 'ACCEPTED' });
    const deps = buildMockPrisma({ order, line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 10, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('ПЗ не может принять итог в этом статусе');
  });

  it('blocks reporting without production_order:report permission', async () => {
    const session = {
      ...baseSession,
      user: { ...baseSession.user, roles: [{ role: { code: 'S1C' } }] },
    };
    const line = makeLine({ status: 'ACCEPTED' });
    const deps = buildMockPrisma({ line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(session);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 10, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Forbidden: insufficient permissions');
  });

  it('blocks reporting outside shift window', async () => {
    const line = makeLine({ status: 'ACCEPTED' });
    const deps = buildMockPrisma({ line });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockRejectedValue(new Error('Вне рабочего времени'));

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 10, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Вне рабочего времени');
  });
});

describe('fact consumption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates consumption rows for GP work center', async () => {
    const line = makeLine({ status: 'ACCEPTED', productId: 'gp-1', workCenterId: 'wc-03' });
    const deps = buildMockPrisma({
      line,
      product: gpProduct,
      workCenter: { id: 'wc-03', code: 'WC-03', name: 'РЦ 03', active: true, producesMass: false },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    const { fact } = await reportProductionFact(
      'line-1',
      {
        quantity: 5,
        factCategory: 'GP',
        consumption: [
          { productId: 'mass-1', quantity: 2 },
          { productId: 'gp-1', quantity: 1 },
        ],
      },
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
    );

    expect(fact.factCategory).toBe('GP');
    expect(deps.factConsumptionCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ productionFactId: fact.id, productId: 'mass-1' }),
        expect.objectContaining({ productionFactId: fact.id, productId: 'gp-1' }),
      ]),
    });
  });

  it('returns warnings when consumption exceeds available balance', async () => {
    const line = makeLine({ status: 'ACCEPTED', productId: 'gp-1', workCenterId: 'wc-03' });
    const deps = buildMockPrisma({
      line,
      product: gpProduct,
      workCenter: { id: 'wc-03', code: 'WC-03', name: 'РЦ 03', active: true, producesMass: false },
    });
    deps.getAvailableBalance.mockResolvedValue({ available: 0.5, unit: 'кг' });

    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    const { warnings } = await reportProductionFact(
      'line-1',
      {
        quantity: 5,
        factCategory: 'GP',
        consumption: [{ productId: 'mass-1', quantity: 2 }],
      },
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
    );

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('превышает остаток');
  });

  it('succeeds without consumption on mass-producing work center', async () => {
    const line = makeLine({ status: 'ACCEPTED', productId: 'mass-1' });
    const deps = buildMockPrisma({ line, product: baseProduct });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    const { fact } = await reportProductionFact(
      'line-1',
      { quantity: 10, factCategory: 'MASS' },
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
    );

    expect(fact.factCategory).toBe('MASS');
    expect(deps.factConsumptionCreateMany).not.toHaveBeenCalled();
  });

  it('blocks consumption on mass-producing work center', async () => {
    const line = makeLine({ status: 'ACCEPTED', productId: 'mass-1' });
    const deps = buildMockPrisma({ line, product: baseProduct });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 10, factCategory: 'MASS', consumption: [{ productId: 'mass-1', quantity: 2 }] },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Потребление указывается только на ГП/ПФ-РЦ');
  });

  it('blocks zero consumption quantity', async () => {
    const line = makeLine({ status: 'ACCEPTED', productId: 'gp-1', workCenterId: 'wc-03' });
    const deps = buildMockPrisma({
      line,
      product: gpProduct,
      workCenter: { id: 'wc-03', code: 'WC-03', name: 'РЦ 03', active: true, producesMass: false },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 5, factCategory: 'GP', consumption: [{ productId: 'mass-1', quantity: 0 }] },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Количество потребления должно быть больше 0');
  });

  it('blocks duplicate product in consumption', async () => {
    const line = makeLine({ status: 'ACCEPTED', productId: 'gp-1', workCenterId: 'wc-03' });
    const deps = buildMockPrisma({
      line,
      product: gpProduct,
      workCenter: { id: 'wc-03', code: 'WC-03', name: 'РЦ 03', active: true, producesMass: false },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        {
          quantity: 5,
          factCategory: 'GP',
          consumption: [
            { productId: 'mass-1', quantity: 1 },
            { productId: 'mass-1', quantity: 2 },
          ],
        },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Продукт в потреблении не может повторяться');
  });

  it('blocks consumption of unknown product', async () => {
    const line = makeLine({ status: 'ACCEPTED', productId: 'gp-1', workCenterId: 'wc-03' });
    const deps = buildMockPrisma({
      line,
      product: gpProduct,
      workCenter: { id: 'wc-03', code: 'WC-03', name: 'РЦ 03', active: true, producesMass: false },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { quantity: 5, factCategory: 'GP', consumption: [{ productId: 'unknown', quantity: 1 }] },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance },
      ),
    ).rejects.toThrow('Продукт не найден');
  });
});


describe('getAvailableBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculates MASS balance from MASS facts minus consumption', async () => {
    const { getAvailableBalance } = await import('@/lib/stock-preview');
    const productFindUnique = vi.fn().mockResolvedValue({ unit: 'кг', category: 'MASS' });
    const productionFactFindMany = vi.fn().mockImplementation(({ where }: { where: { factCategory: string; productId: string } }) => {
      if (where.factCategory === 'MASS') return Promise.resolve([{ quantity: new Decimal(100) }]);
      return Promise.resolve([]);
    });
    const factConsumptionFindMany = vi.fn().mockResolvedValue([{ quantity: new Decimal(30) }]);

    const result = await getAvailableBalance('mass-1', {
      product: { findUnique: productFindUnique },
      productionFact: { findMany: productionFactFindMany },
      factConsumption: { findMany: factConsumptionFindMany },
    } as never);

    expect(result.available).toBe(70);
    expect(result.unit).toBe('кг');
  });

  it('calculates GP PF balance from PF facts minus consumption, ignoring GP facts', async () => {
    const { getAvailableBalance } = await import('@/lib/stock-preview');
    const productionFactFindMany = vi.fn().mockImplementation(({ where }: { where: { factCategory: string; productId: string } }) => {
      if (where.factCategory === 'PF') return Promise.resolve([{ quantity: new Decimal(50) }]);
      return Promise.resolve([{ quantity: new Decimal(20) }]);
    });
    const factConsumptionFindMany = vi.fn().mockResolvedValue([{ quantity: new Decimal(10) }]);

    const result = await getAvailableBalance('gp-1', {
      product: { findUnique: vi.fn().mockResolvedValue({ unit: 'шт', category: 'GP' }) },
      productionFact: { findMany: productionFactFindMany },
      factConsumption: { findMany: factConsumptionFindMany },
    } as never);

    expect(result.available).toBe(40);
    expect(productionFactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { factCategory: 'PF', productId: 'gp-1' } }),
    );
  });
});
