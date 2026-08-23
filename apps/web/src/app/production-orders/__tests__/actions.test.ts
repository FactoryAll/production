import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type WorkCenter, type Product, type Employee, type Shift } from '@prisma/client';
const Decimal = Prisma.Decimal;
import { createProductionOrder, createProductionOrderAction } from '../actions';

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
  completedAt: null,
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

function buildMockPrisma(overrides: {
  shift?: Shift | null;
  workCenters?: WorkCenter[];
  products?: Product[];
  employees?: Employee[];
  order?: typeof mockOrder;
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
      create: vi.fn().mockResolvedValue(overrides.order ?? mockOrder),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        productionOrder: {
          create: vi.fn().mockResolvedValue(overrides.order ?? mockOrder),
        },
      };
      return cb(tx);
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
    ).rejects.toThrow('Выбранная смена неактивна');
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
