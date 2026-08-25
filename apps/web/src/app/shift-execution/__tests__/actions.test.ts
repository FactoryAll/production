import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type ProductionOrder, type ProductionOrderLine, type Product, type DefectReason } from '@prisma/client';
const Decimal = Prisma.Decimal;
import { acceptProductionOrderLine, reportProductionFact, correctFactByOperator } from '../actions';

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
  existingFact?: { id?: string; quantity?: number; factCategory?: 'MASS' | 'GP' | 'PF'; defectQuantity?: number; defectReasonId?: string | null; stopsCount?: number; stopsDurationMinutes?: number; consumptions?: Array<{ productId: string; quantity: number | Prisma.Decimal }> };
} = {}) {
  const order = overrides.order ?? makeOrder();
  const line = overrides.line ?? makeLine({ orderId: order.id });
  const product = overrides.product ?? baseProduct;
  const workCenter = overrides.workCenter ?? { id: 'wc-01', code: 'WC-01', name: 'РЦ 01', active: true, producesMass: true };
  const existingFact = overrides.existingFact;
  const defaultFactId = 'fact-1';
  const existingFactId = line.id ? `fact-${line.id}` : defaultFactId;

  const lineUpdate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...line, ...data }),
  );
  const lineFindUnique = vi.fn().mockResolvedValue({
    ...line,
    order,
    product,
    workCenter,
    operator: { id: 'emp-1', tabNumber: '001', fullName: 'Иванов И.И.', active: true },
    facts: existingFact ? [
      {
        id: existingFact?.id ?? existingFactId,
        lineId: line.id,
        productId: line.productId,
        factCategory: existingFact.factCategory ?? product.category,
        quantity: new Decimal(existingFact.quantity ?? 5),
        defectQuantity: new Decimal(existingFact.defectQuantity ?? 0),
        defectReasonId: existingFact.defectReasonId ?? null,
        stopsCount: existingFact.stopsCount ?? 0,
        stopsDurationMinutes: existingFact.stopsDurationMinutes ?? 0,
        recordedAt: new Date(),
        reportedAt: new Date(),
        reportedByUserId: 'user-1',
        createdById: 'user-1',
        postCompletionCorrection: false,
        consumptions: (existingFact.consumptions ?? []).map((c) => ({
          id: `fc-${c.productId}`,
          productionFactId: existingFact?.id ?? existingFactId,
          productId: c.productId,
          quantity: c.quantity instanceof Decimal ? c.quantity : new Decimal(c.quantity),
          createdAt: new Date(),
        })),
      },
    ] : [],
  });

  let createCallIndex = 0;
  const productionFactCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
    createCallIndex += 1;
    return Promise.resolve({
      id: `${existingFactId}-${createCallIndex}`,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  const productionFactUpdate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({
    id: existingFact?.id ?? existingFactId,
    ...data,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  const notificationCreateMany = vi.fn().mockResolvedValue(undefined);
  const userFindMany = vi.fn().mockImplementation(({ where }: { where: { roles?: { some: { role: { code: string } } } } }) => {
    const roleCode = where.roles?.some.role.code;
    if (roleCode === 'NP') return Promise.resolve([{ id: 'np-user-1' }]);
    if (roleCode === 'S1C') return Promise.resolve([{ id: 's1c-user-1' }]);
    return Promise.resolve([]);
  });



  const factConsumptionDeleteMany = vi.fn().mockResolvedValue(undefined);
  const factConsumptionFindMany = vi.fn().mockResolvedValue([]);

  const defectReasonFindUnique = vi.fn().mockResolvedValue(overrides.defectReason ?? {
    id: 'defect-1',
    code: 'D-1',
    name: 'Брак',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const getAvailableBalance = vi.fn().mockResolvedValue({ available: 100, unit: 'кг' });
  const applyStockMovements = vi.fn().mockResolvedValue(undefined);
  const updateShiftSummary = vi.fn().mockResolvedValue(undefined);
  const factConsumptionCreateMany = vi.fn().mockResolvedValue(undefined);

  const productionFactUpsert = vi.fn().mockImplementation((args: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }) => {
    const category = (args.create.factCategory ?? args.update.factCategory) as string;
    return Promise.resolve({
      id: `${existingFactId}-${category}`,
      ...args.create,
      ...args.update,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  const tx = {
    productionOrderLine: {
      update: lineUpdate,
      findUnique: lineFindUnique,
    },
    productionFact: {
      create: productionFactCreate,
      upsert: productionFactUpsert,
      update: productionFactUpdate,
      deleteMany: vi.fn().mockResolvedValue(undefined),
    },
    factConsumption: {
      createMany: factConsumptionCreateMany,
      deleteMany: factConsumptionDeleteMany,
      findMany: factConsumptionFindMany,
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
    warehouse: {
      findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'wh-prod', type: 'PRODUCTION' }),
    },
    product: {
      findMany: vi.fn().mockResolvedValue([baseProduct, gpProduct]),
    },
  };

  const prisma = {
    productionOrderLine: {
      findUnique: lineFindUnique,
    },
    productionFact: {
      create: productionFactCreate,
      upsert: productionFactUpsert,
      update: productionFactUpdate,
      deleteMany: vi.fn().mockResolvedValue(undefined),
    },
    factConsumption: {
      createMany: factConsumptionCreateMany,
      deleteMany: factConsumptionDeleteMany,
      findMany: factConsumptionFindMany,
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
    productionFactUpsert,
    productionFactUpdate,
    productionFactDeleteMany: (tx.productionFact as unknown as { deleteMany: ReturnType<typeof vi.fn> }).deleteMany,
    factConsumptionCreateMany,
    factConsumptionDeleteMany,
    notificationCreateMany,
    userFindMany,
    defectReasonFindUnique,
    getAvailableBalance,
    applyStockMovements,
    updateShiftSummary,
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
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
    );

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].factCategory).toBe('GP');
    expect(deps.productionFactUpsert).toHaveBeenCalled();
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
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
    );

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].factCategory).toBe('MASS');
  });

  it('blocks MASS line with outputByCategory PF', async () => {
    const line = makeLine({ status: 'ACCEPTED', productId: 'mass-1' });
    const deps = buildMockPrisma({ line, product: baseProduct });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { outputByCategory: { PF: 10 } },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
      ),
    ).rejects.toThrow('Для данного продукта категория PF недопустима');
  });

  it('blocks GP line with outputByCategory MASS', async () => {
    const line = makeLine({ status: 'ACCEPTED', productId: 'gp-1' });
    const deps = buildMockPrisma({ line, product: gpProduct });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      reportProductionFact(
        'line-1',
        { outputByCategory: { MASS: 5 } },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
      ),
    ).rejects.toThrow('Для данного продукта категория MASS недопустима');
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
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
    );

    expect(deps.productionFactUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ defectQuantity: expect.objectContaining({}), defectReasonId: 'defect-1' }),
        update: expect.objectContaining({ defectQuantity: expect.objectContaining({}), defectReasonId: 'defect-1' }),
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
    );

    expect(deps.productionFactUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ stopsCount: 2, stopsDurationMinutes: 30 }),
        update: expect.objectContaining({ stopsCount: 2, stopsDurationMinutes: 30 }),
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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

    const { facts } = await reportProductionFact(
      'line-1',
      {
        quantity: 5,
        factCategory: 'GP',
        consumption: [
          { productId: 'mass-1', quantity: 2 },
          { productId: 'gp-1', quantity: 1 },
        ],
      },
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
    );

    expect(facts).toHaveLength(1);
    expect(facts[0].factCategory).toBe('GP');
    expect(deps.factConsumptionCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ productionFactId: facts[0].id, productId: 'mass-1' }),
        expect.objectContaining({ productionFactId: facts[0].id, productId: 'gp-1' }),
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
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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

    const { facts } = await reportProductionFact(
      'line-1',
      { quantity: 10, factCategory: 'MASS' },
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
    );

    expect(facts).toHaveLength(1);
    expect(facts[0].factCategory).toBe('MASS');
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
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
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
      ),
    ).rejects.toThrow('Продукт не найден');
  });
});


describe('getAvailableBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns MASS stock balance for MASS product', async () => {
    const { getAvailableBalance } = await import('@/lib/stock-service');
    const client = {
      product: { findUnique: vi.fn().mockResolvedValue({ unit: 'кг', category: 'MASS' }) },
      warehouse: { findFirst: vi.fn().mockResolvedValue({ id: 'wh-prod' }) },
      stockBalance: {
        findUnique: vi.fn().mockResolvedValue({ quantity: new Decimal(70) }),
      },
    } as never;

    const result = await getAvailableBalance(client, 'mass-1');
    expect(result.available).toBe(70);
    expect(result.unit).toBe('кг');
    expect(result.stockCategory).toBe('MASS');
  });

  it('returns PF stock balance for GP product', async () => {
    const { getAvailableBalance } = await import('@/lib/stock-service');
    const client = {
      product: { findUnique: vi.fn().mockResolvedValue({ unit: 'шт', category: 'GP' }) },
      warehouse: { findFirst: vi.fn().mockResolvedValue({ id: 'wh-prod' }) },
      stockBalance: {
        findUnique: vi.fn().mockResolvedValue({ quantity: new Decimal(40) }),
      },
    } as never;

    const result = await getAvailableBalance(client, 'gp-1');
    expect(result.available).toBe(40);
    expect(result.unit).toBe('шт');
    expect(result.stockCategory).toBe('PF');
  });
});


describe('correctFactByOperator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates quantity, defect, stops and writes audit with oldValue/newValue', async () => {
    const deps = buildMockPrisma({
      line: makeLine({ status: 'REPORTED' }),
      existingFact: { id: 'fact-old', quantity: 5, factCategory: 'MASS', defectQuantity: 0, stopsCount: 0, stopsDurationMinutes: 0 },
      workCenter: { id: 'wc-01', code: 'WC-01', name: 'РЦ 01', active: true, producesMass: true },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    const { facts } = await correctFactByOperator(
      'line-1',
      { quantity: 12, factCategory: 'MASS', defectQuantity: 1, defectReasonId: 'defect-1', stopsCount: 2, stopsDurationMinutes: 15 },
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
    );

    expect(facts).toHaveLength(1);
    expect(facts[0].quantity.toString()).toBe('12');
    expect(facts[0].factCategory).toBe('MASS');
    expect(facts[0].postCompletionCorrection).toBe(false);
    expect(deps.productionFactDeleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: { lineId: 'line-1' } }));
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'UPDATE',
        objectType: 'ProductionFact',
        field: 'fact',
        oldValue: expect.stringContaining('5'),
        newValue: expect.stringContaining('12'),
      }),
    );
    expect(writeTiming).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fromStatus: 'REPORTED', toStatus: 'REPORTED' }),
    );
  });

  it('changes factCategory from GP to PF (Р-01)', async () => {
    const deps = buildMockPrisma({
      line: makeLine({ status: 'REPORTED', productId: 'gp-1' }),
      order: makeOrder(),
      product: gpProduct,
      existingFact: { id: 'fact-old', quantity: 5, factCategory: 'GP' },
      workCenter: { id: 'wc-02', code: 'WC-02', name: 'РЦ 02', active: true, producesMass: false },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    const { facts } = await correctFactByOperator(
      'line-1',
      { quantity: 5, factCategory: 'PF' },
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
    );

    expect(facts).toHaveLength(1);
    expect(facts[0].factCategory).toBe('PF');
  });

  it('replaces consumption set and warns on overconsumption', async () => {
    const deps = buildMockPrisma({
      line: makeLine({ status: 'REPORTED', productId: 'gp-1' }),
      order: makeOrder(),
      product: gpProduct,
      existingFact: { id: 'fact-old', quantity: 5, factCategory: 'GP', consumptions: [{ productId: 'mass-1', quantity: 2 }] },
      workCenter: { id: 'wc-02', code: 'WC-02', name: 'РЦ 02', active: true, producesMass: false },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);
    deps.getAvailableBalance.mockResolvedValue({ available: 0, unit: 'кг' });

    const { warnings, facts } = await correctFactByOperator(
      'line-1',
      { quantity: 5, factCategory: 'GP', consumption: [{ productId: 'mass-1', quantity: 5 }] },
      { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
    );

    expect(facts).toHaveLength(1);
    expect(deps.factConsumptionDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { productionFactId: { in: ['fact-old'] } } }),
    );
    expect(deps.factConsumptionCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ productId: 'mass-1', quantity: expect.any(Decimal) }),
        ]),
      }),
    );
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('fails when order is COMPLETED (mentions NP)', async () => {
    const deps = buildMockPrisma({
      line: makeLine({ status: 'REPORTED' }),
      order: makeOrder({ status: 'COMPLETED' }),
      existingFact: { id: 'fact-old', quantity: 5 },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      correctFactByOperator(
        'line-1',
        { quantity: 5, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
      ),
    ).rejects.toThrow('После закрытия корректировка доступна только начальнику производства');
  });

  it('fails when order is CANCELLED', async () => {
    const deps = buildMockPrisma({
      line: makeLine({ status: 'REPORTED' }),
      order: makeOrder({ status: 'CANCELLED' }),
      existingFact: { id: 'fact-old', quantity: 5 },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      correctFactByOperator(
        'line-1',
        { quantity: 5, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
      ),
    ).rejects.toThrow('ПЗ отменено');
  });

  it('fails when line is ACCEPTED (fact not reported)', async () => {
    const deps = buildMockPrisma({
      line: makeLine({ status: 'ACCEPTED' }),
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      correctFactByOperator(
        'line-1',
        { quantity: 5, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
      ),
    ).rejects.toThrow('Факт ещё не внесён');
  });

  it('fails when correcting another operator line', async () => {
    const deps = buildMockPrisma({
      line: makeLine({ status: 'REPORTED', operatorId: 'emp-2' }),
      existingFact: { id: 'fact-old', quantity: 5 },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      correctFactByOperator(
        'line-1',
        { quantity: 5, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
      ),
    ).rejects.toThrow('Корректировать факт может только Оператор');
  });

  it('fails when defect > 0 without reason', async () => {
    const deps = buildMockPrisma({
      line: makeLine({ status: 'REPORTED' }),
      existingFact: { id: 'fact-old', quantity: 5 },
      workCenter: { id: 'wc-02', code: 'WC-02', name: 'РЦ 02', active: true, producesMass: false },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      correctFactByOperator(
        'line-1',
        { quantity: 5, factCategory: 'MASS', defectQuantity: 1 },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
      ),
    ).rejects.toThrow('Укажите причину брака');
  });

  it('fails when quantity is negative', async () => {
    const deps = buildMockPrisma({
      line: makeLine({ status: 'REPORTED' }),
      existingFact: { id: 'fact-old', quantity: 5 },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      correctFactByOperator(
        'line-1',
        { quantity: -1, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
      ),
    ).rejects.toThrow('Значение не может быть отрицательным');
  });

  it('fails when consumption on mass work center', async () => {
    const deps = buildMockPrisma({
      line: makeLine({ status: 'REPORTED' }),
      existingFact: { id: 'fact-old', quantity: 5 },
      workCenter: { id: 'wc-01', code: 'WC-01', name: 'РЦ 01', active: true, producesMass: true },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue(baseSession);

    await expect(
      correctFactByOperator(
        'line-1',
        { quantity: 5, factCategory: 'MASS', consumption: [{ productId: 'mass-1', quantity: 1 }] },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
      ),
    ).rejects.toThrow('Потребление указывается только на ГП/ПФ-РЦ');
  });

  it('fails when out of shift window (OPR with single role)', async () => {
    const deps = buildMockPrisma({
      line: makeLine({ status: 'REPORTED' }),
      existingFact: { id: 'fact-old', quantity: 5 },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockRejectedValue(new Error('Смена не открыта'));

    await expect(
      correctFactByOperator(
        'line-1',
        { quantity: 5, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
      ),
    ).rejects.toThrow('Смена не открыта');
  });

  it('fails without production_order:report permission', async () => {
    const deps = buildMockPrisma({
      line: makeLine({ status: 'REPORTED' }),
      existingFact: { id: 'fact-old', quantity: 5 },
    });
    const writeAudit = vi.fn();
    const writeTiming = vi.fn();
    const requireShiftWindow = vi.fn().mockResolvedValue({
      ...baseSession,
      user: { ...baseSession.user, roles: [{ role: { code: 'NP' } }] },
    });

    await expect(
      correctFactByOperator(
        'line-1',
        { quantity: 5, factCategory: 'MASS' },
        { prisma: deps.prisma, writeAudit, writeTiming, requireShiftWindow, getAvailableBalance: deps.getAvailableBalance, applyStockMovements: deps.applyStockMovements, updateShiftSummary: deps.updateShiftSummary },
      ),
    ).rejects.toThrow('Forbidden: insufficient permissions');
  });
});
