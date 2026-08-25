import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type WorkCenter, type Product, type Employee, type Shift } from '@prisma/client';
const Decimal = Prisma.Decimal;
import { createProductionOrder, createProductionOrderAction, confirmProductionOrder, updateProductionOrder, substituteOperator, cancelProductionOrder, correctProductionFact } from '../actions';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const mockOrder = {
  id: 'po-1',
  shiftId: 'shift-1',
  status: 'DRAFT',
  createdById: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null as Date | null,
  confirmedAt: null as Date | null,
  confirmedByUserId: null as string | null,
  cancelledAt: null as Date | null,
  cancelledByUserId: null as string | null,
  cancellationReason: null as string | null,
  lines: [
    {
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
    },
  ],
};

function buildMockOrder(overrides: Partial<typeof mockOrder> = {}) {
  return { ...mockOrder, ...overrides };
}

type MockOrderLine = (typeof mockOrder)['lines'][number] & { operator?: Employee | null };

function buildMockPrisma(overrides: {
  shift?: Shift | null;
  workCenters?: WorkCenter[];
  products?: Product[];
  employees?: Employee[];
  order?: ReturnType<typeof buildMockOrder>;
} = {}) {
  const workCenters = overrides.workCenters ?? [
    {
      id: 'wc-01',
      code: '01',
      name: '01.Реактор',
      producesMass: true,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'wc-03',
      code: '03',
      name: '03.Тубировка крем',
      producesMass: false,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ] as WorkCenter[];

  const products = overrides.products ?? [
    {
      id: 'mass-1',
      code: 'M-001',
      name: 'Масса',
      category: 'MASS',
      unit: 'кг',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'gp-1',
      code: 'GP-001',
      name: 'Крем',
      category: 'GP',
      unit: 'шт',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ] as Product[];

  const employees = overrides.employees ?? [
    {
      id: 'emp-1',
      tabNumber: '001',
      fullName: 'Иванов И.И.',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ] as Employee[];

  const shift = overrides.shift !== undefined ? overrides.shift : {
    id: 'shift-1',
    number: 1,
    date: new Date(),
    start: '08:00',
    end: '20:00',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Shift;

  const resolvedOrder = overrides.order ?? mockOrder;

  return {
    shift: {
      findUnique: vi.fn().mockResolvedValue(shift),
    },
    workCenter: {
      findMany: vi.fn().mockResolvedValue(workCenters),
    },
    product: {
      findMany: vi.fn().mockResolvedValue(products),
    },
    employee: {
      findMany: vi.fn().mockResolvedValue(employees),
    },
    productionOrder: {
      create: vi.fn().mockResolvedValue(resolvedOrder),
      findUnique: vi.fn().mockResolvedValue(resolvedOrder),
      update: vi.fn().mockResolvedValue(resolvedOrder),
    },
    notification: {
      createMany: vi.fn().mockResolvedValue(undefined),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const updateSpy = vi.fn().mockImplementation((args: { data: { status?: string; cancelledAt?: Date; cancelledByUserId?: string; cancellationReason?: string } }) => {
        return Promise.resolve({
          ...resolvedOrder,
          status: args.data.status ?? resolvedOrder.status,
          confirmedAt: args.data.status === 'CONFIRMED' ? new Date() : resolvedOrder.confirmedAt,
          confirmedByUserId: args.data.status === 'CONFIRMED' ? 'user-1' : resolvedOrder.confirmedByUserId,
          cancelledAt: args.data.cancelledAt ?? resolvedOrder.cancelledAt,
          cancelledByUserId: args.data.cancelledByUserId ?? resolvedOrder.cancelledByUserId,
          cancellationReason: args.data.cancellationReason ?? resolvedOrder.cancellationReason,
        });
      });
      const lineUpdateSpy = vi.fn().mockResolvedValue(undefined);
      const createManySpy = vi.fn().mockResolvedValue(undefined);
      const deleteManySpy = vi.fn().mockResolvedValue(undefined);
      const createSpy = vi.fn().mockResolvedValue({ id: 'line-new' });
      const userFindManySpy = vi.fn().mockResolvedValue([{ id: 's1c-user-1' }]);
      const tx = {
        productionOrder: {
          create: vi.fn().mockResolvedValue(resolvedOrder),
          findUnique: vi.fn().mockResolvedValue(resolvedOrder),
          update: updateSpy,
        },
        productionOrderLine: {
          deleteMany: deleteManySpy,
          create: createSpy,
          findUnique: vi.fn().mockResolvedValue(resolvedOrder.lines[0]),
          update: lineUpdateSpy,
        },
        notification: {
          createMany: createManySpy,
        },
        user: {
          findMany: userFindManySpy,
        },
      };
      const result = await cb(tx);
      return result;
    }),
  } as unknown as typeof import('@prodtrack/db').prisma;
}

function buildMockDeps(overrides: Parameters<typeof buildMockPrisma>[0] = {}) {
  const writeAudit = vi.fn();
  const writeTiming = vi.fn();
  const requirePermission = vi.fn().mockResolvedValue({
    userId: 'user-1',
    user: { roles: [{ role: { code: 'NP' } }] },
  });

  return {
    prisma: buildMockPrisma(overrides),
    writeAudit,
    writeTiming,
    requirePermission,
  };
}

describe('createProductionOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates DRAFT order with valid MASS line on РЦ 01', async () => {
    const deps = buildMockDeps();
    const result = await createProductionOrder(
      {
        shiftId: 'shift-1',
        lines: [
          {
            workCenterId: 'wc-01',
            productId: 'mass-1',
            plannedQuantity: 10,
            operatorId: 'emp-1',
            workerIds: [],
          },
        ],
      },
      deps,
    );

    expect(result.status).toBe('DRAFT');
    expect(result.lines.length).toBe(1);
    expect(result.lines[0].status).toBe('ASSIGNED');
    expect(deps.writeAudit).toHaveBeenCalled();
    expect(deps.writeTiming).toHaveBeenCalled();

    const auditCall = deps.writeAudit.mock.calls[0][1];
    expect(auditCall.action).toBe('CREATE');
    expect(auditCall.objectType).toBe('ProductionOrder');

    const timingCall = deps.writeTiming.mock.calls[0][1];
    expect(timingCall.documentType).toBe('PRODUCTION_ORDER');
    expect(timingCall.toStatus).toBe('DRAFT');
  });

  it('rejects MASS on РЦ 03 (BR-7)', async () => {
    const deps = buildMockDeps();
    await expect(
      createProductionOrder(
        {
          shiftId: 'shift-1',
          lines: [
            {
              workCenterId: 'wc-03',
              productId: 'mass-1',
              plannedQuantity: 5,
              operatorId: 'emp-1',
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('ГП можно планировать только на РЦ 03–12');
  });

  it('rejects GP on РЦ 01 (BR-7)', async () => {
    const deps = buildMockDeps();
    await expect(
      createProductionOrder(
        {
          shiftId: 'shift-1',
          lines: [
            {
              workCenterId: 'wc-01',
              productId: 'gp-1',
              plannedQuantity: 5,
              operatorId: 'emp-1',
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('Массу можно планировать только на РЦ 01/02');
  });

  it('rejects line without operator (BR-3)', async () => {
    const deps = buildMockDeps();
    await expect(
      createProductionOrder(
        {
          shiftId: 'shift-1',
          lines: [
            {
              workCenterId: 'wc-01',
              productId: 'mass-1',
              plannedQuantity: 5,
              operatorId: '',
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('Заполните РЦ, номенклатуру, количество и Оператора');
  });

  it('rejects inactive work center', async () => {
    const deps = buildMockDeps({
      workCenters: [
        {
          id: 'wc-01',
          code: '01',
          name: '01.Реактор',
          producesMass: true,
          active: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as WorkCenter[],
    });
    await expect(
      createProductionOrder(
        {
          shiftId: 'shift-1',
          lines: [
            {
              workCenterId: 'wc-01',
              productId: 'mass-1',
              plannedQuantity: 5,
              operatorId: 'emp-1',
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('РЦ деактивирован');
  });

  it('rejects inactive product', async () => {
    const deps = buildMockDeps({
      products: [
        {
          id: 'mass-1',
          code: 'M-001',
          name: 'Масса',
          category: 'MASS',
          unit: 'кг',
          active: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as Product[],
    });
    await expect(
      createProductionOrder(
        {
          shiftId: 'shift-1',
          lines: [
            {
              workCenterId: 'wc-01',
              productId: 'mass-1',
              plannedQuantity: 5,
              operatorId: 'emp-1',
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('Номенклатура деактивирована');
  });

  it('rejects inactive operator', async () => {
    const deps = buildMockDeps({
      employees: [
        {
          id: 'emp-1',
          tabNumber: '001',
          fullName: 'Иванов И.И.',
          active: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as Employee[],
    });
    await expect(
      createProductionOrder(
        {
          shiftId: 'shift-1',
          lines: [
            {
              workCenterId: 'wc-01',
              productId: 'mass-1',
              plannedQuantity: 5,
              operatorId: 'emp-1',
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('Сотрудник деактивирован');
  });

  it('rejects duplicate work center in one order', async () => {
    const deps = buildMockDeps();
    await expect(
      createProductionOrder(
        {
          shiftId: 'shift-1',
          lines: [
            {
              workCenterId: 'wc-01',
              productId: 'mass-1',
              plannedQuantity: 5,
              operatorId: 'emp-1',
            },
            {
              workCenterId: 'wc-01',
              productId: 'mass-1',
              plannedQuantity: 3,
              operatorId: 'emp-1',
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('РЦ может встречаться в ПЗ только один раз');
  });

  it('rejects zero and negative quantity', async () => {
    const deps = buildMockDeps();
    await expect(
      createProductionOrder(
        {
          shiftId: 'shift-1',
          lines: [
            {
              workCenterId: 'wc-01',
              productId: 'mass-1',
              plannedQuantity: 0,
              operatorId: 'emp-1',
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('Плановое количество должно быть больше 0');
  });

  it('rejects empty lines', async () => {
    const deps = buildMockDeps();
    await expect(
      createProductionOrder(
        {
          shiftId: 'shift-1',
          lines: [],
        },
        deps,
      ),
    ).rejects.toThrow('Добавьте хотя бы одну строку ПЗ');
  });

  it('rejects missing shift (BR-4)', async () => {
    const deps = buildMockDeps({ shift: null });
    await expect(
      createProductionOrder(
        {
          shiftId: 'missing-shift',
          lines: [
            {
              workCenterId: 'wc-01',
              productId: 'mass-1',
              plannedQuantity: 5,
              operatorId: 'emp-1',
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('Смена не найдена');
  });

  it('rejects inactive shift (BR-4)', async () => {
    const deps = buildMockDeps({
      shift: {
        id: 'shift-1',
        number: 1,
        date: new Date(),
        start: '08:00',
        end: '20:00',
        active: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Shift,
    });
    await expect(
      createProductionOrder(
        {
          shiftId: 'shift-1',
          lines: [
            {
              workCenterId: 'wc-01',
              productId: 'mass-1',
              plannedQuantity: 5,
              operatorId: 'emp-1',
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('Смена деактивирована');
  });

  it('rejects duplicate work center with different operators (BR-3)', async () => {
    const deps = buildMockDeps({
      employees: [
        {
          id: 'emp-1',
          tabNumber: '001',
          fullName: 'Иванов И.И.',
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'emp-2',
          tabNumber: '002',
          fullName: 'Петров П.П.',
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as Employee[],
    });
    await expect(
      createProductionOrder(
        {
          shiftId: 'shift-1',
          lines: [
            {
              workCenterId: 'wc-01',
              productId: 'mass-1',
              plannedQuantity: 5,
              operatorId: 'emp-1',
            },
            {
              workCenterId: 'wc-01',
              productId: 'mass-1',
              plannedQuantity: 3,
              operatorId: 'emp-2',
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('РЦ может встречаться в ПЗ только один раз');
  });

  it('rejects line without work center (completeness)', async () => {
    const deps = buildMockDeps();
    await expect(
      createProductionOrder(
        {
          shiftId: 'shift-1',
          lines: [
            {
              workCenterId: '',
              productId: 'mass-1',
              plannedQuantity: 5,
              operatorId: 'emp-1',
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('Заполните РЦ, номенклатуру, количество и Оператора');
  });

  it('rejects line without product (completeness)', async () => {
    const deps = buildMockDeps();
    await expect(
      createProductionOrder(
        {
          shiftId: 'shift-1',
          lines: [
            {
              workCenterId: 'wc-01',
              productId: '',
              plannedQuantity: 5,
              operatorId: 'emp-1',
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('Заполните РЦ, номенклатуру, количество и Оператора');
  });

  it('rejects line without planned quantity (completeness)', async () => {
    const deps = buildMockDeps();
    await expect(
      createProductionOrder(
        {
          shiftId: 'shift-1',
          lines: [
            {
              workCenterId: 'wc-01',
              productId: 'mass-1',
              plannedQuantity: undefined as unknown as number,
              operatorId: 'emp-1',
            },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('Плановое количество должно быть больше 0');
  });
});

describe('createProductionOrderAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success with order id on valid input', async () => {
    const deps = buildMockDeps();
    vi.resetModules();
    vi.doMock('@prodtrack/db', () => ({
      prisma: deps.prisma,
      writeAudit: deps.writeAudit,
      writeTiming: deps.writeTiming,
    }));
    vi.doMock('@/lib/auth/access', () => ({
      requirePermission: deps.requirePermission,
    }));

    const { createProductionOrderAction: action } = await import('../actions');
    const formData = new FormData();
    formData.set('shiftId', 'shift-1');
    formData.set(
      'lines',
      JSON.stringify([
        {
          workCenterId: 'wc-01',
          productId: 'mass-1',
          plannedQuantity: 10,
          operatorId: 'emp-1',
        },
      ]),
    );

    const result = await action(formData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.id).toBe('po-1');
    }
  });
});

type ConfirmableOrder = ReturnType<typeof buildMockOrder> & { shift: Shift; lines: MockOrderLine[] };
type ConfirmableOrderOverrides = Partial<Omit<ConfirmableOrder, 'shift' | 'lines'>> & { shift?: Shift; lines?: MockOrderLine[] };

function buildConfirmableOrder(overrides: ConfirmableOrderOverrides = {}): ConfirmableOrder {
  const defaultShift = {
    id: 'shift-1',
    number: 1,
    date: new Date(),
    start: '08:00',
    end: '20:00',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Shift;

  const { shift: shiftOverride, lines, ...restOverrides } = overrides;
  const shift = shiftOverride ?? defaultShift;
  return {
    ...buildMockOrder(restOverrides),
    shift,
    lines: lines ?? [
      {
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
        operator: {
          id: 'emp-1',
          tabNumber: '001',
          fullName: 'Иванов И.И.',
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Employee,
      },
    ],
  } as ConfirmableOrder;
}

describe('confirmProductionOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms DRAFT order and updates status to CONFIRMED', async () => {
    const order = buildConfirmableOrder();
    const deps = buildMockDeps({ order });
    const result = await confirmProductionOrder('po-1', deps);

    expect(result.status).toBe('CONFIRMED');
    expect(deps.prisma.$transaction).toHaveBeenCalled();
    const txUpdate = (deps.prisma.$transaction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const txMock = {
      productionOrder: {
        create: vi.fn().mockResolvedValue(order),
        findUnique: vi.fn().mockResolvedValue(order),
        update: vi.fn().mockResolvedValue({ ...order, status: 'CONFIRMED' }),
      },
      notification: {
        createMany: vi.fn().mockResolvedValue(undefined),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user-opr-1' }]),
      },
    };
    await txUpdate(txMock);
    expect(txMock.productionOrder.update).toHaveBeenCalled();
    const updateData = txMock.productionOrder.update.mock.calls[0][0].data;
    expect(updateData.status).toBe('CONFIRMED');
    expect(updateData.confirmedByUserId).toBe('user-1');
    expect(updateData.confirmedAt).toBeInstanceOf(Date);
  });

  it('writes audit and timing records on confirm', async () => {
    const order = buildConfirmableOrder();
    const deps = buildMockDeps({ order });
    await confirmProductionOrder('po-1', deps);

    const result = await confirmProductionOrder('po-1', deps);
    expect(result.status).toBe('CONFIRMED');

    expect(deps.writeAudit).toHaveBeenCalled();
    const auditCall = deps.writeAudit.mock.calls[0][1];
    expect(auditCall.action).toBe('UPDATE');
    expect(auditCall.objectType).toBe('ProductionOrder');
    expect(auditCall.oldValue).toBe('DRAFT');
    expect(auditCall.newValue).toBe('CONFIRMED');

    expect(deps.writeTiming).toHaveBeenCalled();
    const timingCall = deps.writeTiming.mock.calls[0][1];
    expect(timingCall.documentType).toBe('PRODUCTION_ORDER');
    expect(timingCall.fromStatus).toBe('DRAFT');
    expect(timingCall.toStatus).toBe('CONFIRMED');
  });

  it('creates EV-01 notification for each unique operator', async () => {
    const order = buildConfirmableOrder({
      lines: [
        {
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
          operator: {
            id: 'emp-1',
            tabNumber: '001',
            fullName: 'Иванов И.И.',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as Employee,
        } as MockOrderLine,
        {
          id: 'line-2',
          orderId: 'po-1',
          workCenterId: 'wc-03',
          productId: 'gp-1',
          plannedQuantity: new Decimal(5),
          operatorId: 'emp-1',
          status: 'ASSIGNED',
          comment: null,
          substitutionReasonId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          operator: {
            id: 'emp-1',
            tabNumber: '001',
            fullName: 'Иванов И.И.',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as Employee,
        },
      ],
    });
    const deps = buildMockDeps({ order });
    await confirmProductionOrder('po-1', deps);

    expect(deps.prisma.$transaction).toHaveBeenCalled();
    const txUpdate = (deps.prisma.$transaction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const txMock = {
      productionOrder: {
        create: vi.fn().mockResolvedValue(order),
        findUnique: vi.fn().mockResolvedValue(order),
        update: vi.fn().mockResolvedValue({ ...order, status: 'CONFIRMED' }),
      },
      notification: {
        createMany: vi.fn().mockResolvedValue(undefined),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user-opr-1' }]),
      },
    };
    await txUpdate(txMock);

    expect(txMock.notification.createMany).toHaveBeenCalled();
    const createData = txMock.notification.createMany.mock.calls[0][0].data;
    expect(createData).toHaveLength(1);
    expect(createData[0].eventCode).toBe('EV_01');
    expect(createData[0].recipientId).toBe('user-opr-1');
    expect(createData[0].deepLink).toBe('/production-orders/po-1');
    expect(JSON.parse(createData[0].body)).toMatchObject({
      orderId: 'po-1',
      shiftId: 'shift-1',
      linesCount: 2,
    });
  });

  it('blocks confirm of CONFIRMED order', async () => {
    const order = buildConfirmableOrder({ status: 'CONFIRMED' });
    const deps = buildMockDeps({ order });
    await expect(confirmProductionOrder('po-1', deps)).rejects.toThrow('ПЗ нельзя подтвердить в этом статусе');
  });

  it('blocks confirm of IN_PROGRESS order', async () => {
    const order = buildConfirmableOrder({ status: 'IN_PROGRESS' });
    const deps = buildMockDeps({ order });
    await expect(confirmProductionOrder('po-1', deps)).rejects.toThrow('ПЗ нельзя подтвердить в этом статусе');
  });

  it('blocks confirm of CANCELLED order', async () => {
    const order = buildConfirmableOrder({ status: 'CANCELLED' });
    const deps = buildMockDeps({ order });
    await expect(confirmProductionOrder('po-1', deps)).rejects.toThrow('ПЗ нельзя подтвердить в этом статусе');
  });

  it('blocks confirm of order without lines (BR-1)', async () => {
    const order = buildConfirmableOrder({ lines: [] });
    const deps = buildMockDeps({ order });
    await expect(confirmProductionOrder('po-1', deps)).rejects.toThrow('ПЗ не содержит строк');
  });

  it('blocks confirm of order with incomplete line missing work center (BR-1)', async () => {
    const order = buildConfirmableOrder({
      lines: [
        {
          id: 'line-1',
          orderId: 'po-1',
          workCenterId: '',
          productId: 'mass-1',
          plannedQuantity: new Decimal(10),
          operatorId: 'emp-1',
          status: 'ASSIGNED',
          comment: null,
          substitutionReasonId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          operator: {
            id: 'emp-1',
            tabNumber: '001',
            fullName: 'Иванов И.И.',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as Employee,
        } as MockOrderLine,
      ],
    });
    const deps = buildMockDeps({ order });
    await expect(confirmProductionOrder('po-1', deps)).rejects.toThrow('ПЗ содержит неполную строку');
  });

  it('blocks confirm of order with line missing operator (BR-3 / BR-1)', async () => {
    const order = buildConfirmableOrder({
      lines: [
        {
          id: 'line-1',
          orderId: 'po-1',
          workCenterId: 'wc-01',
          productId: 'mass-1',
          plannedQuantity: new Decimal(10),
          operatorId: null,
          status: 'ASSIGNED',
          comment: null,
          substitutionReasonId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          operator: null,
        } as unknown as MockOrderLine,
      ],
    });
    const deps = buildMockDeps({ order });
    await expect(confirmProductionOrder('po-1', deps)).rejects.toThrow('ПЗ содержит неполную строку');
  });
});

describe('updateProductionOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates DRAFT order lines and keeps status', async () => {
    const order = buildConfirmableOrder();
    const deps = buildMockDeps({ order });
    await updateProductionOrder(
      'po-1',
      {
        shiftId: 'shift-1',
        lines: [
          { workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 15, operatorId: 'emp-1' },
          { workCenterId: 'wc-03', productId: 'gp-1', plannedQuantity: 7, operatorId: 'emp-1' },
        ],
      },
      deps,
    );

    expect(deps.prisma.$transaction).toHaveBeenCalled();
    expect(deps.writeAudit).toHaveBeenCalled();
    expect(deps.writeTiming).toHaveBeenCalled();
    const timingCall = deps.writeTiming.mock.calls[0][1];
    expect(timingCall.fromStatus).toBe('DRAFT');
    expect(timingCall.toStatus).toBe('DRAFT');
  });

  it('updates CONFIRMED order quantity', async () => {
    const order = buildConfirmableOrder({ status: 'CONFIRMED' });
    const deps = buildMockDeps({ order });
    await updateProductionOrder(
      'po-1',
      {
        shiftId: 'shift-1',
        lines: [{ workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 20, operatorId: 'emp-1' }],
      },
      deps,
    );
    expect(deps.prisma.$transaction).toHaveBeenCalled();
  });

  it('updates IN_PROGRESS order operator', async () => {
    const order = buildConfirmableOrder({ status: 'IN_PROGRESS' });
    const deps = buildMockDeps({
      order,
      employees: [
        {
          id: 'emp-1',
          tabNumber: '001',
          fullName: 'Иванов И.И.',
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'emp-2',
          tabNumber: '002',
          fullName: 'Петров П.П.',
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as Employee[],
    });
    await updateProductionOrder(
      'po-1',
      {
        shiftId: 'shift-1',
        lines: [{ workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-2' }],
      },
      deps,
    );
    expect(deps.prisma.$transaction).toHaveBeenCalled();
  });

  it('blocks update of COMPLETED order', async () => {
    const order = buildConfirmableOrder({ status: 'COMPLETED' });
    const deps = buildMockDeps({ order });
    await expect(
      updateProductionOrder(
        'po-1',
        { shiftId: 'shift-1', lines: [{ workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' }] },
        deps,
      ),
    ).rejects.toThrow('ПЗ нельзя корректировать в этом статусе');
  });

  it('blocks update of CANCELLED order', async () => {
    const order = buildConfirmableOrder({ status: 'CANCELLED' });
    const deps = buildMockDeps({ order });
    await expect(
      updateProductionOrder(
        'po-1',
        { shiftId: 'shift-1', lines: [{ workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' }] },
        deps,
      ),
    ).rejects.toThrow('ПЗ нельзя корректировать в этом статусе');
  });

  it('blocks update when any line is REPORTED (BR-2)', async () => {
    const order = buildConfirmableOrder({
      lines: [
        {
          id: 'line-1',
          orderId: 'po-1',
          workCenterId: 'wc-01',
          productId: 'mass-1',
          plannedQuantity: new Decimal(10),
          operatorId: 'emp-1',
          status: 'REPORTED',
          comment: null,
          substitutionReasonId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          operator: {
            id: 'emp-1',
            tabNumber: '001',
            fullName: 'Иванов И.И.',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as Employee,
        } as MockOrderLine,
      ],
    });
    const deps = buildMockDeps({ order });
    await expect(
      updateProductionOrder(
        'po-1',
        { shiftId: 'shift-1', lines: [{ workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' }] },
        deps,
      ),
    ).rejects.toThrow('Корректировка невозможна после внесения итога');
  });

  it('blocks update violating BR-7', async () => {
    const order = buildConfirmableOrder();
    const deps = buildMockDeps({ order });
    await expect(
      updateProductionOrder(
        'po-1',
        { shiftId: 'shift-1', lines: [{ workCenterId: 'wc-03', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' }] },
        deps,
      ),
    ).rejects.toThrow('ГП можно планировать только на РЦ 03–12');
  });

  it('blocks update violating BR-3 duplicate work center', async () => {
    const order = buildConfirmableOrder();
    const deps = buildMockDeps({ order });
    await expect(
      updateProductionOrder(
        'po-1',
        {
          shiftId: 'shift-1',
          lines: [
            { workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' },
            { workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 5, operatorId: 'emp-1' },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('РЦ может встречаться в ПЗ только один раз');
  });

  it('blocks update with incomplete line', async () => {
    const order = buildConfirmableOrder();
    const deps = buildMockDeps({ order });
    await expect(
      updateProductionOrder(
        'po-1',
        { shiftId: 'shift-1', lines: [{ workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: '' }] },
        deps,
      ),
    ).rejects.toThrow('Заполните РЦ, номенклатуру, количество и Оператора');
  });
});

function buildSubstitutableLine(
  status: 'ASSIGNED' | 'ACCEPTED' | 'REPORTED',
  overrides: Partial<MockOrderLine> = {},
): MockOrderLine {
  return {
    id: 'line-1',
    orderId: 'po-1',
    workCenterId: 'wc-01',
    productId: 'mass-1',
    plannedQuantity: new Decimal(10),
    operatorId: 'emp-1',
    status,
    comment: null,
    substitutionReasonId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    operator: {
      id: 'emp-1',
      tabNumber: '001',
      fullName: 'Иванов И.И.',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Employee,
    product: {
      id: 'mass-1',
      code: 'MASS-01',
      name: 'Масса',
      unit: 'кг',
      category: 'MASS',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    workCenter: {
      id: 'wc-01',
      code: '01',
      name: '01.Реактор',
      active: true,
      producesMass: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    ...overrides,
  } as MockOrderLine;
}

function buildSubstituteDeps(
  line: MockOrderLine,
  order: ReturnType<typeof buildConfirmableOrder>,
  s1cUsers: { id: string }[] = [{ id: 's1c-user-1' }],
) {
  const requirePermission = vi.fn().mockResolvedValue({
    userId: 'user-1',
    user: { roles: [{ role: { code: 'NP' } }] },
  });
  const writeAudit = vi.fn();
  const writeTiming = vi.fn();
  const applyStockMovements = vi.fn().mockResolvedValue(undefined);
  const updateShiftSummary = vi.fn().mockResolvedValue(undefined);
  const lineUpdate = vi.fn().mockResolvedValue({ ...line, status: 'REPORTED' });
  const notificationCreateMany = vi.fn().mockResolvedValue(undefined);
  const userFindMany = vi.fn().mockResolvedValue(s1cUsers);
  const orderUpdate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...order, ...data }),
  );
  const orderFindUnique = vi.fn().mockResolvedValue(order);
  const productionOrderLineFindUnique = vi.fn().mockResolvedValue(line);
  let productionFactCreateCallIndex = 0;
  const productionFactUpsert = vi.fn().mockImplementation((args: { create: Record<string, unknown> }) => {
    productionFactCreateCallIndex += 1;
    return Promise.resolve({
      id: `fact-${productionFactCreateCallIndex}`,
      ...args.create,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
  const productionFactUpdate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'fact-1', ...data, createdAt: new Date(), updatedAt: new Date() }),
  );
  const warehouseFindFirstOrThrow = vi.fn().mockResolvedValue({ id: 'wh-prod', type: 'PRODUCTION' });
  const productFindMany = vi.fn().mockResolvedValue([]);
  const defectReasonFindUnique = vi.fn().mockResolvedValue({
    id: 'defect-1',
    code: 'D-1',
    name: 'Брак',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const tx = {
    productionOrderLine: {
      update: lineUpdate,
      findUnique: productionOrderLineFindUnique,
    },
    productionOrder: {
      update: orderUpdate,
      findUnique: orderFindUnique,
    },
    productionFact: {
      upsert: productionFactUpsert,
      update: productionFactUpdate,
    },
    factConsumption: {
      createMany: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue(undefined),
    },
    notification: {
      createMany: notificationCreateMany,
    },
    user: {
      findMany: userFindMany,
      findFirst: vi.fn().mockResolvedValue({ id: 'user-opr-1' }),
    },
    warehouse: {
      findFirstOrThrow: warehouseFindFirstOrThrow,
    },
    product: {
      findMany: productFindMany,
    },
    defectReason: {
      findUnique: defectReasonFindUnique,
    },
  };

  const prisma = {
    productionOrderLine: {
      findUnique: productionOrderLineFindUnique,
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as NonNullable<Parameters<typeof substituteOperator>[2]>['prisma'];

  return {
    prisma,
    requirePermission,
    writeAudit,
    writeTiming,
    applyStockMovements,
    updateShiftSummary,
    lineUpdate,
    productionFactUpsert,
    notificationCreateMany,
    userFindMany,
    tx,
  };
}

function buildSubstitutableOrder(
  status: 'DRAFT' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED',
  lines: MockOrderLine[],
): ReturnType<typeof buildConfirmableOrder> {
  return buildConfirmableOrder({ status, lines });
}

vi.mock('@/lib/production-order-closing', () => ({
  transitionToInProgress: vi.fn().mockResolvedValue({ transitioned: true }),
  checkAndCloseProductionOrder: vi.fn().mockResolvedValue({ closed: false, status: 'CONFIRMED' }),
}));

describe('substituteOperator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports ASSIGNED line and creates ProductionFact for ILLNESS with comment (Р-11/Р-13)', async () => {
    const line = buildSubstitutableLine('ASSIGNED');
    const order = buildSubstitutableOrder('CONFIRMED', [line as MockOrderLine]);
    const deps = buildSubstituteDeps(line, order);
    await substituteOperator('line-1', { reasonCode: 'ILLNESS', comment: 'Заболевание', output: 50, factCategory: 'MASS' }, {
      prisma: deps.prisma,
      requirePermission: deps.requirePermission,
      writeAudit: deps.writeAudit,
      writeTiming: deps.writeTiming,
      applyStockMovements: deps.applyStockMovements,
      updateShiftSummary: deps.updateShiftSummary,
    });

    expect(deps.productionFactUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ quantity: expect.anything(), factCategory: 'MASS' }),
      }),
    );
    expect(deps.applyStockMovements).toHaveBeenCalled();
    expect(deps.lineUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'REPORTED' } }));
    expect(deps.writeAudit).toHaveBeenCalledTimes(3);
    expect(deps.writeTiming).toHaveBeenCalledTimes(1);
  });

  it('reports ACCEPTED line', async () => {
    const line = buildSubstitutableLine('ACCEPTED');
    const order = buildSubstitutableOrder('IN_PROGRESS', [line as MockOrderLine]);
    const deps = buildSubstituteDeps(line, order);
    await substituteOperator('line-1', { reasonCode: 'NO_SHOW', comment: 'Не вышел', output: 10, factCategory: 'MASS' }, {
      prisma: deps.prisma,
      requirePermission: deps.requirePermission,
      writeAudit: deps.writeAudit,
      writeTiming: deps.writeTiming,
      applyStockMovements: deps.applyStockMovements,
      updateShiftSummary: deps.updateShiftSummary,
    });

    expect(deps.lineUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'REPORTED' } }));
  });

  it('generates EV_08 and EV_03 notifications with correct payload and recipients', async () => {
    const line = buildSubstitutableLine('ASSIGNED');
    const order = buildSubstitutableOrder('CONFIRMED', [line as MockOrderLine]);
    const deps = buildSubstituteDeps(line, order, [{ id: 's1c-user-1' }, { id: 's1c-user-2' }]);
    await substituteOperator('line-1', { reasonCode: 'LEFT_SHIFT', comment: 'Ушёл', output: 15, factCategory: 'MASS' }, {
      prisma: deps.prisma,
      requirePermission: deps.requirePermission,
      writeAudit: deps.writeAudit,
      writeTiming: deps.writeTiming,
      applyStockMovements: deps.applyStockMovements,
      updateShiftSummary: deps.updateShiftSummary,
    });

    expect(deps.notificationCreateMany).toHaveBeenCalledTimes(2);
    const calls = deps.notificationCreateMany.mock.calls;
    const ev08Call = calls.find((call) => call[0].data.some((item: { eventCode: string }) => item.eventCode === 'EV_08'));
    const ev03Call = calls.find((call) => call[0].data.some((item: { eventCode: string }) => item.eventCode === 'EV_03'));

    expect(ev08Call).toBeDefined();
    const ev08Data = ev08Call![0].data;
    expect(ev08Data).toHaveLength(3); // operator user + 2 S1C
    expect(ev08Data.map((item: { recipientId: string }) => item.recipientId).sort()).toEqual(['s1c-user-1', 's1c-user-2', 'user-opr-1']);
    const ev08Payload = JSON.parse(ev08Data[0].body);
    expect(ev08Payload).toMatchObject({ orderId: 'po-1', lineId: 'line-1', operatorId: 'emp-1', reasonCode: 'LEFT_SHIFT', comment: 'Ушёл' });

    expect(ev03Call).toBeDefined();
    const ev03Data = ev03Call![0].data;
    expect(ev03Data).toHaveLength(2);
    expect(ev03Data.every((item: { recipientId: string }) => ['s1c-user-1', 's1c-user-2'].includes(item.recipientId))).toBe(true);
  });

  it('calls writeAudit for status and substitution fields', async () => {
    const line = buildSubstitutableLine('ASSIGNED');
    const order = buildSubstitutableOrder('CONFIRMED', [line as MockOrderLine]);
    const deps = buildSubstituteDeps(line, order);
    await substituteOperator('line-1', { reasonCode: 'OTHER', comment: 'Иная', output: 20, factCategory: 'MASS' }, {
      prisma: deps.prisma,
      requirePermission: deps.requirePermission,
      writeAudit: deps.writeAudit,
      writeTiming: deps.writeTiming,
      applyStockMovements: deps.applyStockMovements,
      updateShiftSummary: deps.updateShiftSummary,
    });

    const statusAudit = deps.writeAudit.mock.calls.find((call) => call[1].field === 'status');
    const substitutionAudit = deps.writeAudit.mock.calls.find((call) => call[1].field === 'substitution');
    expect(statusAudit).toBeDefined();
    expect(substitutionAudit).toBeDefined();
    expect(statusAudit![1]).toMatchObject({ objectType: 'ProductionOrderLine', oldValue: 'ASSIGNED', newValue: 'REPORTED' });
    expect(substitutionAudit![1]).toMatchObject({ objectType: 'ProductionOrderLine', field: 'substitution' });
    expect(JSON.parse(substitutionAudit![1].newValue)).toEqual({ reasonCode: 'OTHER', comment: 'Иная' });
  });

  it('calls checkAndCloseProductionOrder via closing module', async () => {
    const line = buildSubstitutableLine('ASSIGNED');
    const order = buildSubstitutableOrder('CONFIRMED', [line as MockOrderLine]);
    const deps = buildSubstituteDeps(line, order);
    const { checkAndCloseProductionOrder, transitionToInProgress } = await import('@/lib/production-order-closing');
    await substituteOperator('line-1', { reasonCode: 'ILLNESS', comment: 'Болезнь', output: 30, factCategory: 'MASS' }, {
      prisma: deps.prisma,
      requirePermission: deps.requirePermission,
      writeAudit: deps.writeAudit,
      writeTiming: deps.writeTiming,
      applyStockMovements: deps.applyStockMovements,
      updateShiftSummary: deps.updateShiftSummary,
    });

    expect(transitionToInProgress).toHaveBeenCalled();
    expect(checkAndCloseProductionOrder).toHaveBeenCalled();
  });

  it('blocks substitute for REPORTED line', async () => {
    const line = buildSubstitutableLine('REPORTED');
    const order = buildSubstitutableOrder('CONFIRMED', [line as MockOrderLine]);
    const deps = buildSubstituteDeps(line, order);
    await expect(
      substituteOperator('line-1', { reasonCode: 'ILLNESS', comment: 'Болезнь', output: 10, factCategory: 'MASS' }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Строка уже в REPORTED');
  });

  it('blocks substitute without reason', async () => {
    const line = buildSubstitutableLine('ASSIGNED');
    const order = buildSubstitutableOrder('CONFIRMED', [line as MockOrderLine]);
    const deps = buildSubstituteDeps(line, order);
    await expect(
      substituteOperator('line-1', { reasonCode: '', comment: 'Болезнь', output: 10, factCategory: 'MASS' }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Недопустимый код причины ввода за Оператора');
  });

  it('blocks substitute with unknown reason', async () => {
    const line = buildSubstitutableLine('ASSIGNED');
    const order = buildSubstitutableOrder('CONFIRMED', [line as MockOrderLine]);
    const deps = buildSubstituteDeps(line, order);
    await expect(
      substituteOperator('line-1', { reasonCode: 'UNKNOWN', comment: 'Болезнь', output: 10, factCategory: 'MASS' }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Недопустимый код причины ввода за Оператора');
  });

  it('blocks substitute without comment', async () => {
    const line = buildSubstitutableLine('ASSIGNED');
    const order = buildSubstitutableOrder('CONFIRMED', [line as MockOrderLine]);
    const deps = buildSubstituteDeps(line, order);
    await expect(
      substituteOperator('line-1', { reasonCode: 'ILLNESS', comment: '', output: 10, factCategory: 'MASS' }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Комментарий обязателен');
  });

  it('blocks substitute without output', async () => {
    const line = buildSubstitutableLine('ASSIGNED');
    const order = buildSubstitutableOrder('CONFIRMED', [line as MockOrderLine]);
    const deps = buildSubstituteDeps(line, order);
    await expect(
      substituteOperator('line-1', { reasonCode: 'ILLNESS', comment: 'Болезнь' }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Укажите выпуск');
  });

  it('blocks substitute without permission', async () => {
    const line = buildSubstitutableLine('ASSIGNED');
    const order = buildSubstitutableOrder('CONFIRMED', [line as MockOrderLine]);
    const deps = buildSubstituteDeps(line, order);
    deps.requirePermission.mockRejectedValue(new Error('Forbidden'));
    await expect(
      substituteOperator('line-1', { reasonCode: 'ILLNESS', comment: 'Болезнь', output: 10, factCategory: 'MASS' }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Forbidden');
  });
});

function buildCancellableOrder(
  status: 'DRAFT' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED',
  lineStatuses: ('ASSIGNED' | 'ACCEPTED' | 'REPORTED')[],
  lineOperatorId: string = 'emp-1',
): ReturnType<typeof buildConfirmableOrder> {
  const lines = lineStatuses.map((status, index) => ({
    id: `line-${index + 1}`,
    orderId: 'po-1',
    workCenterId: index === 0 ? 'wc-01' : `wc-0${index + 3}`,
    productId: index === 0 ? 'mass-1' : 'gp-1',
    plannedQuantity: new Decimal(10),
    operatorId: lineOperatorId,
    status,
    comment: null,
    substitutionReasonId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    operator: {
      id: lineOperatorId,
      tabNumber: '001',
      fullName: 'Иванов И.И.',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Employee,
  } as MockOrderLine));

  return buildConfirmableOrder({ status, lines });
}

function buildCancelDeps(
  order: ReturnType<typeof buildConfirmableOrder>,
  userRoles: string[] = ['NP'],
) {
  const writeAudit = vi.fn();
  const writeTiming = vi.fn();
  const applyStockMovements = vi.fn().mockResolvedValue(undefined);
  const updateShiftSummary = vi.fn().mockResolvedValue(undefined);
  const requirePermission = vi.fn().mockResolvedValue({
    userId: 'user-1',
    user: { roles: userRoles.map((code) => ({ role: { code } })) },
  });

  const orderUpdate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...order, ...data }),
  );
  const orderFindUnique = vi.fn().mockResolvedValue(order);
  const notificationCreateMany = vi.fn().mockResolvedValue(undefined);

  const tx = {
    productionOrder: {
      update: orderUpdate,
      findUnique: orderFindUnique,
    },
    notification: {
      createMany: notificationCreateMany,
    },
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: 'user-opr-1' }]),
    },
  };

  const prisma = {
    productionOrder: {
      findUnique: orderFindUnique,
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as NonNullable<Parameters<typeof cancelProductionOrder>[2]>['prisma'];

  return {
    prisma,
    requirePermission,
    writeAudit,
    writeTiming,
    applyStockMovements,
    updateShiftSummary,
    orderUpdate,
    notificationCreateMany,
    tx,
  };
}

describe('cancelProductionOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cancels DRAFT order and records metadata', async () => {
    const order = buildCancellableOrder('DRAFT', ['ASSIGNED']);
    const deps = buildCancelDeps(order);
    const result = await cancelProductionOrder('po-1', { reason: 'Брак сырья' }, {
      prisma: deps.prisma,
      requirePermission: deps.requirePermission,
      writeAudit: deps.writeAudit,
      writeTiming: deps.writeTiming,
      applyStockMovements: deps.applyStockMovements,
      updateShiftSummary: deps.updateShiftSummary,
    });

    expect(result.status).toBe('CANCELLED');
    expect(result.cancelledAt).toBeInstanceOf(Date);
    expect(result.cancelledByUserId).toBe('user-1');
    expect(result.cancellationReason).toBe('Брак сырья');
    expect(deps.orderUpdate).toHaveBeenCalled();
    expect(deps.writeAudit).toHaveBeenCalledTimes(2);
    expect(deps.writeTiming).toHaveBeenCalledTimes(1);
  });

  it('cancels CONFIRMED order without REPORTED lines', async () => {
    const order = buildCancellableOrder('CONFIRMED', ['ASSIGNED', 'ACCEPTED']);
    const deps = buildCancelDeps(order);
    const result = await cancelProductionOrder('po-1', { reason: 'Отсутствие материалов' }, {
      prisma: deps.prisma,
      requirePermission: deps.requirePermission,
      writeAudit: deps.writeAudit,
      writeTiming: deps.writeTiming,
      applyStockMovements: deps.applyStockMovements,
      updateShiftSummary: deps.updateShiftSummary,
    });

    expect(result.status).toBe('CANCELLED');
    expect(deps.writeTiming).toHaveBeenCalled();
    const timingCall = deps.writeTiming.mock.calls[0][1];
    expect(timingCall.fromStatus).toBe('CONFIRMED');
    expect(timingCall.toStatus).toBe('CANCELLED');
  });

  it('emits EV_09 with correct payload and recipients', async () => {
    const order = buildCancellableOrder('CONFIRMED', ['ASSIGNED', 'ASSIGNED'], 'emp-1');
    const deps = buildCancelDeps(order);
    await cancelProductionOrder('po-1', { reason: 'Ремонт РЦ' }, {
      prisma: deps.prisma,
      requirePermission: deps.requirePermission,
      writeAudit: deps.writeAudit,
      writeTiming: deps.writeTiming,
      applyStockMovements: deps.applyStockMovements,
      updateShiftSummary: deps.updateShiftSummary,
    });

    expect(deps.notificationCreateMany).toHaveBeenCalled();
    const data = deps.notificationCreateMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0].eventCode).toBe('EV_09');
    expect(data[0].recipientId).toBe('user-opr-1');
    expect(data[0].deepLink).toBe('/production-orders/po-1');
    const payload = JSON.parse(data[0].body);
    expect(payload).toMatchObject({ orderId: 'po-1', reason: 'Ремонт РЦ' });
    expect(payload.cancelledAt).toBeDefined();
  });

  it('deduplicates operator recipients for EV_09', async () => {
    const order = buildCancellableOrder('CONFIRMED', ['ASSIGNED', 'ASSIGNED'], 'emp-1');
    const deps = buildCancelDeps(order);
    await cancelProductionOrder('po-1', { reason: 'План изменился' }, {
      prisma: deps.prisma,
      requirePermission: deps.requirePermission,
      writeAudit: deps.writeAudit,
      writeTiming: deps.writeTiming,
      applyStockMovements: deps.applyStockMovements,
      updateShiftSummary: deps.updateShiftSummary,
    });

    const data = deps.notificationCreateMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0].recipientId).toBe('user-opr-1');
  });

  it('blocks cancel of IN_PROGRESS order', async () => {
    const order = buildCancellableOrder('IN_PROGRESS', ['ACCEPTED']);
    const deps = buildCancelDeps(order);
    await expect(
      cancelProductionOrder('po-1', { reason: 'Причина' }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('ПЗ нельзя отменить в этом статусе');
  });

  it('blocks cancel of COMPLETED order', async () => {
    const order = buildCancellableOrder('COMPLETED', ['REPORTED']);
    const deps = buildCancelDeps(order);
    await expect(
      cancelProductionOrder('po-1', { reason: 'Причина' }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('ПЗ нельзя отменить в этом статусе');
  });

  it('blocks cancel of CANCELLED order', async () => {
    const order = buildCancellableOrder('CANCELLED', ['ASSIGNED']);
    const deps = buildCancelDeps(order);
    await expect(
      cancelProductionOrder('po-1', { reason: 'Причина' }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('ПЗ нельзя отменить в этом статусе');
  });

  it('blocks cancel when any line is REPORTED (Р-12)', async () => {
    const order = buildCancellableOrder('CONFIRMED', ['ASSIGNED', 'REPORTED']);
    const deps = buildCancelDeps(order);
    await expect(
      cancelProductionOrder('po-1', { reason: 'Причина' }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Отмена невозможна: есть строка в статусе REPORTED');
  });

  it('blocks cancel with empty reason', async () => {
    const order = buildCancellableOrder('DRAFT', ['ASSIGNED']);
    const deps = buildCancelDeps(order);
    await expect(
      cancelProductionOrder('po-1', { reason: '   ' }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Укажите причину отмены');
  });

  it('blocks cancel without production_order:confirm permission', async () => {
    const order = buildCancellableOrder('DRAFT', ['ASSIGNED']);
    const deps = buildCancelDeps(order);
    deps.requirePermission.mockRejectedValue(new Error('Forbidden'));
    await expect(
      cancelProductionOrder('po-1', { reason: 'Причина' }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Forbidden');
  });
});

function buildMockProductionFact(
  overrides: Partial<{
    id: string;
    lineId: string;
    productId: string;
    quantity: Prisma.Decimal;
    defectQuantity: Prisma.Decimal;
    defectReasonId: string | null;
    stopsDurationMinutes: number;
    postCompletionCorrection: boolean;
    correctionReason: string | null;
    line: ReturnType<typeof buildSubstitutableOrder>['lines'][number] & { order: ReturnType<typeof buildSubstitutableOrder> };
  }> = {},
): {
  id: string;
  lineId: string;
  productId: string;
  quantity: Prisma.Decimal;
  defectQuantity: Prisma.Decimal;
  defectReasonId: string | null;
  stopsDurationMinutes: number;
  comment: string | null;
  recordedAt: Date;
  createdById: string;
  postCompletionCorrection: boolean;
  correctionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  line: ReturnType<typeof buildSubstitutableOrder>['lines'][number] & { order: ReturnType<typeof buildSubstitutableOrder> };
} {
  const order = buildSubstitutableOrder('COMPLETED', [
    buildSubstitutableLine('REPORTED'),
  ] as MockOrderLine[]);
  const line = overrides.line ?? { ...order.lines[0], order };

  return {
    id: 'fact-1',
    lineId: line.id,
    productId: 'mass-1',
    quantity: new Decimal(10),
    defectQuantity: new Decimal(0),
    defectReasonId: null,
    stopsDurationMinutes: 0,
    comment: null,
    recordedAt: new Date(),
    createdById: 'user-opr',
    postCompletionCorrection: false,
    correctionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    line,
    ...overrides,
  };
}

function buildCorrectFactDeps(
  fact: ReturnType<typeof buildMockProductionFact>,
  userRoles: string[] = ['NP'],
) {
  const writeAudit = vi.fn();
  const writeTiming = vi.fn();
  const applyStockMovements = vi.fn().mockResolvedValue(undefined);
  const updateShiftSummary = vi.fn().mockResolvedValue(undefined);
  const requirePermission = vi.fn().mockResolvedValue({
    userId: 'user-1',
    user: { roles: userRoles.map((code) => ({ role: { code } })) },
  });

  const factUpdate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...fact, ...data }),
  );
  const factFindUnique = vi.fn().mockResolvedValue(fact);

  const tx = {
    productionFact: {
      update: factUpdate,
      findUnique: factFindUnique,
    },
    warehouse: {
      findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'wh-prod', type: 'PRODUCTION' }),
    },
  };

  const prisma = {
    productionFact: {
      findUnique: factFindUnique,
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as NonNullable<Parameters<typeof correctProductionFact>[2]>['prisma'];

  return {
    prisma,
    requirePermission,
    writeAudit,
    writeTiming,
    factUpdate,
    tx,
    applyStockMovements,
    updateShiftSummary,
  };
}

describe('correctProductionFact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('corrects fact for COMPLETED order and marks postCompletionCorrection', async () => {
    const fact = buildMockProductionFact();
    const deps = buildCorrectFactDeps(fact);
    const result = await correctProductionFact('fact-1', {
      quantity: 15,
      correctionReason: 'Уточнение выпуска',
    }, {
      prisma: deps.prisma,
      requirePermission: deps.requirePermission,
      writeAudit: deps.writeAudit,
      writeTiming: deps.writeTiming,
      applyStockMovements: deps.applyStockMovements,
      updateShiftSummary: deps.updateShiftSummary,
    });

    expect(result.quantity.toNumber()).toBe(15);
    expect(result.postCompletionCorrection).toBe(true);
    expect(result.correctionReason).toBe('Уточнение выпуска');
    expect(deps.factUpdate).toHaveBeenCalled();
    expect(deps.writeAudit).toHaveBeenCalled();
    expect(deps.writeTiming).toHaveBeenCalled();
  });

  it('corrects fact with defectQuantity and defectReasonId', async () => {
    const fact = buildMockProductionFact();
    const deps = buildCorrectFactDeps(fact);
    const result = await correctProductionFact('fact-1', {
      quantity: 10,
      defectQuantity: 2,
      defectReasonId: 'reason-1',
      correctionReason: 'Добавлен брак',
    }, {
      prisma: deps.prisma,
      requirePermission: deps.requirePermission,
      writeAudit: deps.writeAudit,
      writeTiming: deps.writeTiming,
      applyStockMovements: deps.applyStockMovements,
      updateShiftSummary: deps.updateShiftSummary,
    });

    expect(result.defectQuantity.toNumber()).toBe(2);
    expect(result.defectReasonId).toBe('reason-1');
  });

  it('corrects fact with stopsDurationMinutes', async () => {
    const fact = buildMockProductionFact();
    const deps = buildCorrectFactDeps(fact);
    const result = await correctProductionFact('fact-1', {
      quantity: 10,
      stopsDurationMinutes: 45,
      correctionReason: 'Учтены остановки',
    }, {
      prisma: deps.prisma,
      requirePermission: deps.requirePermission,
      writeAudit: deps.writeAudit,
      writeTiming: deps.writeTiming,
      applyStockMovements: deps.applyStockMovements,
      updateShiftSummary: deps.updateShiftSummary,
    });

    expect(result.stopsDurationMinutes).toBe(45);
  });

  it('blocks correction for IN_PROGRESS order', async () => {
    const line = buildSubstitutableLine('REPORTED');
    const order = buildSubstitutableOrder('IN_PROGRESS', [line as MockOrderLine]);
    const fact = buildMockProductionFact({ line: { ...line, order } });
    const deps = buildCorrectFactDeps(fact);
    await expect(
      correctProductionFact('fact-1', {
        quantity: 10,
        correctionReason: 'Причина',
      }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Корректировка факта возможна только после закрытия ПЗ');
  });

  it('blocks correction for DRAFT order', async () => {
    const line = buildSubstitutableLine('REPORTED');
    const order = buildSubstitutableOrder('DRAFT', [line as MockOrderLine]);
    const fact = buildMockProductionFact({ line: { ...line, order } });
    const deps = buildCorrectFactDeps(fact);
    await expect(
      correctProductionFact('fact-1', {
        quantity: 10,
        correctionReason: 'Причина',
      }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Корректировка факта возможна только после закрытия ПЗ');
  });

  it('blocks correction with empty correctionReason', async () => {
    const fact = buildMockProductionFact();
    const deps = buildCorrectFactDeps(fact);
    await expect(
      correctProductionFact('fact-1', {
        quantity: 10,
        correctionReason: '   ',
      }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Причина корректировки обязательна');
  });

  it('blocks correction with negative quantity', async () => {
    const fact = buildMockProductionFact();
    const deps = buildCorrectFactDeps(fact);
    await expect(
      correctProductionFact('fact-1', {
        quantity: -1,
        correctionReason: 'Причина',
      }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Значение не может быть отрицательным');
  });

  it('blocks correction with defectQuantity > 0 and no defectReasonId', async () => {
    const fact = buildMockProductionFact();
    const deps = buildCorrectFactDeps(fact);
    await expect(
      correctProductionFact('fact-1', {
        quantity: 10,
        defectQuantity: 1,
        correctionReason: 'Причина',
      }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Укажите причину брака');
  });

  it('blocks correction without production_order:confirm permission', async () => {
    const fact = buildMockProductionFact();
    const deps = buildCorrectFactDeps(fact);
    deps.requirePermission.mockRejectedValue(new Error('Forbidden'));
    await expect(
      correctProductionFact('fact-1', {
        quantity: 10,
        correctionReason: 'Причина',
      }, {
        prisma: deps.prisma,
        requirePermission: deps.requirePermission,
        writeAudit: deps.writeAudit,
        writeTiming: deps.writeTiming,
      }),
    ).rejects.toThrow('Forbidden');
  });
});
