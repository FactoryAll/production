import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStockAdjustment } from '../actions';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/**
 * Документ корректировки остатков (решение владельца 18.11.2026).
 *
 * Тесты держат три вещи, из-за которых документ и заводился: без права — отказ;
 * без причины — отказ; списание больше остатка — отказ. И одну, ради которой история
 * не правится: корректировка добавляет компенсирующее движение, а не меняет прошлое.
 */
function buildDeps(options: {
  roles?: string[];
  balances?: Array<{ warehouseId: string; productId: string; stockCategory: string; quantity: number }>;
  warehouses?: Array<{ id: string; type: string; name: string }>;
  products?: Array<{ id: string; code: string; name: string; unit: string; active: boolean }>;
} = {}) {
  const roles = options.roles ?? ['NP'];
  const warehouses = options.warehouses ?? [
    { id: 'wh-prod', type: 'PRODUCTION', name: 'Производственный' },
    { id: 'wh-gp', type: 'FINISHED_GOODS', name: 'Склад ГП' },
  ];
  const products = options.products ?? [
    { id: 'mass-1', code: 'БП-00000178', name: 'Масса Спрей', unit: 'кг', active: true },
    { id: 'gp-1', code: '00-00001249', name: 'Крем', unit: 'шт', active: true },
  ];
  const balances = options.balances ?? [
    { warehouseId: 'wh-prod', productId: 'mass-1', stockCategory: 'MASS', quantity: -313 },
  ];

  const requirePermission = vi.fn().mockResolvedValue({
    userId: 'user-1',
    user: { roles: roles.map((code) => ({ role: { code } })) },
  });
  const writeAudit = vi.fn().mockResolvedValue(undefined);
  const applyStockMovements = vi.fn().mockResolvedValue(undefined);

  const adjustmentCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: 'adjustment-1',
      number: data.number,
      status: undefined,
      ...data,
      lines: (data.lines as { create: unknown[] }).create.map((line, index) => ({
        id: `line-${index + 1}`,
        ...(line as Record<string, unknown>),
      })),
    }),
  );

  const txTarget = {
    $queryRaw: vi.fn().mockResolvedValue([{ nextval: BigInt(123) }]),
    stockAdjustment: { create: adjustmentCreate },
  };
  // Прокси вместо простого объекта: обращение к таблице, которой в документе быть не должно
  // (уведомления), падает прямо в тесте, а не остаётся незамеченным.
  const tx = new Proxy(txTarget, {
    get(target, property) {
      if (!(property in target)) {
        throw new Error(`Неожиданное обращение к tx.${String(property)}`);
      }
      return Reflect.get(target, property);
    },
  });

  const prisma = {
    warehouse: { findMany: vi.fn().mockResolvedValue(warehouses) },
    product: { findMany: vi.fn().mockResolvedValue(products) },
    stockBalance: { findMany: vi.fn().mockResolvedValue(balances) },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as NonNullable<Parameters<typeof createStockAdjustment>[1]>['prisma'];

  return { prisma, writeAudit, requirePermission, applyStockMovements, adjustmentCreate, tx };
}

describe('createStockAdjustment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseInput = {
    reasonCode: 'INVENTORY' as const,
    reason: 'Инвентаризация 18.11: Масса списана дважды, остаток ушёл в минус',
    lines: [
      {
        warehouseId: 'wh-prod',
        productId: 'mass-1',
        stockCategory: 'MASS' as const,
        direction: 'RECEIPT' as const,
        quantity: 313,
      },
    ],
  };

  it('создаёт документ с номером, строкой, движением и аудитом (18.11.2026)', async () => {
    const deps = buildDeps();

    const created = await createStockAdjustment(baseInput, {
      prisma: deps.prisma,
      writeAudit: deps.writeAudit,
      requirePermission: deps.requirePermission,
      applyStockMovements: deps.applyStockMovements,
      now: () => new Date('2026-11-18T15:00:00Z'),
    });

    expect(created).toEqual({ id: 'adjustment-1', number: 'КОР-2026-000123' });
    expect(deps.adjustmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          number: 'КОР-2026-000123',
          reasonCode: 'INVENTORY',
          createdById: 'user-1',
        }),
      }),
    );

    // Движение — компенсирующее: приход с источником STOCK_ADJUSTMENT, а не правка истории.
    const movements = deps.applyStockMovements.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(movements).toHaveLength(1);
    expect(movements[0]).toEqual(
      expect.objectContaining({
        productId: 'mass-1',
        stockCategory: 'MASS',
        type: 'RECEIPT',
        sourceType: 'STOCK_ADJUSTMENT',
        sourceId: 'adjustment-1',
      }),
    );

    expect(deps.writeAudit).toHaveBeenCalledTimes(1);
    const audit = deps.writeAudit.mock.calls[0][1] as { oldValue: string; newValue: string };
    // «Было → стало»: по журналу видно, из какого минуса получился ноль.
    expect(JSON.parse(audit.oldValue).quantity).toBe('-313');
    expect(JSON.parse(audit.newValue).balanceAfter).toBe('0');
  });

  it('пишет несколько позиций одним документом (решение владельца: несколько строк)', async () => {
    const deps = buildDeps({
      balances: [
        { warehouseId: 'wh-prod', productId: 'mass-1', stockCategory: 'MASS', quantity: -313 },
        { warehouseId: 'wh-prod', productId: 'gp-1', stockCategory: 'GP', quantity: 500 },
      ],
      products: [
        { id: 'mass-1', code: 'БП-00000178', name: 'Масса Спрей', unit: 'кг', active: true },
        { id: 'gp-1', code: '00-00001249', name: 'Крем', unit: 'шт', active: true },
      ],
    });

    await createStockAdjustment(
      {
        ...baseInput,
        lines: [
          { warehouseId: 'wh-prod', productId: 'mass-1', stockCategory: 'MASS', direction: 'RECEIPT', quantity: 313 },
          { warehouseId: 'wh-prod', productId: 'gp-1', stockCategory: 'GP', direction: 'ISSUE', quantity: 200 },
        ],
      },
      {
        prisma: deps.prisma,
        writeAudit: deps.writeAudit,
        requirePermission: deps.requirePermission,
        applyStockMovements: deps.applyStockMovements,
      },
    );

    const movements = deps.applyStockMovements.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(movements.map((movement) => movement.type)).toEqual(['RECEIPT', 'ISSUE']);
    expect(deps.writeAudit).toHaveBeenCalledTimes(2);
  });

  it('отказывает, если списание больше остатка: «доступно N» (BR-2 постановки)', async () => {
    const deps = buildDeps({
      balances: [{ warehouseId: 'wh-prod', productId: 'gp-1', stockCategory: 'GP', quantity: 100 }],
    });

    await expect(
      createStockAdjustment(
        {
          ...baseInput,
          lines: [
            { warehouseId: 'wh-prod', productId: 'gp-1', stockCategory: 'GP', direction: 'ISSUE', quantity: 500 },
          ],
        },
        {
          prisma: deps.prisma,
          writeAudit: deps.writeAudit,
          requirePermission: deps.requirePermission,
          applyStockMovements: deps.applyStockMovements,
        },
      ),
    ).rejects.toThrow('Недостаточно остатка: доступно 100 шт');

    expect(deps.adjustmentCreate).not.toHaveBeenCalled();
    expect(deps.applyStockMovements).not.toHaveBeenCalled();
  });

  it('не даёт списать с отрицательного остатка — сначала приход', async () => {
    const deps = buildDeps();

    await expect(
      createStockAdjustment(
        {
          ...baseInput,
          lines: [
            { warehouseId: 'wh-prod', productId: 'mass-1', stockCategory: 'MASS', direction: 'ISSUE', quantity: 10 },
          ],
        },
        {
          prisma: deps.prisma,
          writeAudit: deps.writeAudit,
          requirePermission: deps.requirePermission,
          applyStockMovements: deps.applyStockMovements,
        },
      ),
    ).rejects.toThrow('Недостаточно остатка: доступно 0 кг');
  });

  it('требует причину не короче 10 символов', async () => {
    const deps = buildDeps();

    await expect(
      createStockAdjustment({ ...baseInput, reason: 'ок' }, {
        prisma: deps.prisma,
        writeAudit: deps.writeAudit,
        requirePermission: deps.requirePermission,
      }),
    ).rejects.toThrow('Причина обязательна');

    expect(deps.adjustmentCreate).not.toHaveBeenCalled();
  });

  it('не даёт скорректировать остаток роли без права stock:adjust', async () => {
    const deps = buildDeps({ roles: ['KSGP'] });

    await expect(
      createStockAdjustment(baseInput, {
        prisma: deps.prisma,
        writeAudit: deps.writeAudit,
        requirePermission: deps.requirePermission,
      }),
    ).rejects.toThrow('Forbidden');

    expect(deps.adjustmentCreate).not.toHaveBeenCalled();
  });

  it('не пускает Массу на склад ГП (BR-1 модуля M05)', async () => {
    const deps = buildDeps();

    await expect(
      createStockAdjustment(
        {
          ...baseInput,
          lines: [
            { warehouseId: 'wh-gp', productId: 'mass-1', stockCategory: 'MASS', direction: 'RECEIPT', quantity: 10 },
          ],
        },
        {
          prisma: deps.prisma,
          writeAudit: deps.writeAudit,
          requirePermission: deps.requirePermission,
        },
      ),
    ).rejects.toThrow('На складе ГП хранится только готовая продукция');
  });

  it('не отправляет уведомлений — их в документе нет вовсе (решение владельца 18.11.2026)', async () => {
    const deps = buildDeps();

    await createStockAdjustment(baseInput, {
      prisma: deps.prisma,
      writeAudit: deps.writeAudit,
      requirePermission: deps.requirePermission,
      applyStockMovements: deps.applyStockMovements,
    });

    // Транзакция — прокси: обращение к любой таблице, кроме двух разрешённых, падает.
    // Документ не отправляет уведомлений вовсе (решение владельца 18.11.2026).
    expect(deps.adjustmentCreate).toHaveBeenCalledTimes(1);
    expect(deps.writeAudit).toHaveBeenCalledTimes(1);
  });

  it('отказывает на повторе позиции в одном документе', async () => {
    const deps = buildDeps();

    await expect(
      createStockAdjustment(
        {
          ...baseInput,
          lines: [
            { warehouseId: 'wh-prod', productId: 'mass-1', stockCategory: 'MASS', direction: 'RECEIPT', quantity: 10 },
            { warehouseId: 'wh-prod', productId: 'mass-1', stockCategory: 'MASS', direction: 'ISSUE', quantity: 5 },
          ],
        },
        {
          prisma: deps.prisma,
          writeAudit: deps.writeAudit,
          requirePermission: deps.requirePermission,
        },
      ),
    ).rejects.toThrow('Позиция повторяется');
  });

  it('защищает от опечатки в ноликах: потолок на строку', async () => {
    const deps = buildDeps();

    await expect(
      createStockAdjustment(
        {
          ...baseInput,
          lines: [
            { warehouseId: 'wh-prod', productId: 'mass-1', stockCategory: 'MASS', direction: 'RECEIPT', quantity: 1000001 },
          ],
        },
        {
          prisma: deps.prisma,
          writeAudit: deps.writeAudit,
          requirePermission: deps.requirePermission,
        },
      ),
    ).rejects.toThrow('не может быть больше 1000000');
  });
});

describe('createStockAdjustment: причина не подставляется по умолчанию', () => {
  it('отказывает, если тип причины не выбран', async () => {
    const deps = (() => {
      const requirePermission = vi.fn().mockResolvedValue({
        userId: 'user-1',
        user: { roles: [{ role: { code: 'NP' } }] },
      });
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ nextval: BigInt(1) }]),
        stockAdjustment: { create: vi.fn() },
      };
      const prisma = {
        warehouse: { findMany: vi.fn().mockResolvedValue([]) },
        product: { findMany: vi.fn().mockResolvedValue([]) },
        stockBalance: { findMany: vi.fn().mockResolvedValue([]) },
        $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
      } as unknown as NonNullable<Parameters<typeof createStockAdjustment>[1]>['prisma'];
      return { prisma, requirePermission, writeAudit: vi.fn() };
    })();

    await expect(
      createStockAdjustment(
        {
          // Причина не выбрана: пустая строка вместо кода.
          reasonCode: '' as never,
          reason: 'Проверка без выбранной причины',
          lines: [
            { warehouseId: 'wh-prod', productId: 'mass-1', stockCategory: 'MASS', direction: 'RECEIPT', quantity: 10 },
          ],
        },
        { prisma: deps.prisma, writeAudit: deps.writeAudit, requirePermission: deps.requirePermission },
      ),
    ).rejects.toThrow('Выберите причину корректировки');
  });
});
