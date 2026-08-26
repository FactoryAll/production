import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type Warehouse, type Product, type User, type GoodsTransfer, type TransferLine } from '@prisma/client';
const Decimal = Prisma.Decimal;
import {
  createGoodsTransfer,
  submitGoodsTransfer,
  updateGoodsTransfer,
  cancelGoodsTransfer,
  receiveGoodsTransfer,
} from '../actions';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const productionWarehouse: Warehouse = {
  id: 'wh-prod',
  name: 'Производственный',
  description: null,
  type: 'PRODUCTION',
  active: true,
} as Warehouse;

const finishedGoodsWarehouse: Warehouse = {
  id: 'wh-fg',
  name: 'Склад ГП',
  description: null,
  type: 'FINISHED_GOODS',
  active: true,
} as Warehouse;

const gpProduct1: Product = {
  id: 'gp-1',
  code: 'GP-001',
  name: 'Крем',
  category: 'GP',
  unit: 'шт',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const gpProduct2: Product = {
  id: 'gp-2',
  code: 'GP-002',
  name: 'Паста',
  category: 'GP',
  unit: 'шт',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const massProduct: Product = {
  id: 'mass-1',
  code: 'M-001',
  name: 'Масса',
  category: 'MASS',
  unit: 'кг',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const inactiveGpProduct: Product = {
  id: 'gp-inactive',
  code: 'GP-IN',
  name: 'Неактивный',
  category: 'GP',
  unit: 'шт',
  active: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ksgpUser: User = {
  id: 'ksgp-user-1',
  login: 'ksgp',
  passwordHash: 'hash',
  mustChangePassword: false,
  active: true,
  employeeId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as User;

const npUser: User = {
  id: 'np-user-1',
  login: 'np',
  passwordHash: 'hash',
  mustChangePassword: false,
  active: true,
  employeeId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as User;

const usgpUser: User = {
  id: 'usgp-user-1',
  login: 'usgp',
  passwordHash: 'hash',
  mustChangePassword: false,
  active: true,
  employeeId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as User;

function buildMockTransfer(overrides: Partial<GoodsTransfer> = {}): GoodsTransfer {
  return {
    id: 'tr-1',
    status: 'DRAFT',
    sourceWarehouseId: productionWarehouse.id,
    destinationWarehouseId: finishedGoodsWarehouse.id,
    submittedAt: null,
    submittedByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildMockLine(overrides: Partial<TransferLine & { product: Product }> = {}): TransferLine & { product: Product } {
  return {
    id: 'tl-1',
    goodsTransferId: 'tr-1',
    productId: gpProduct1.id,
    plannedQuantity: new Decimal(10),
    actualQuantity: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    product: gpProduct1,
    ...overrides,
  } as TransferLine & { product: Product };
}

type MockTx = {
  goodsTransfer: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  transferLine: {
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  user: {
    findMany: ReturnType<typeof vi.fn>;
  };
  discrepancy: {
    create: ReturnType<typeof vi.fn>;
  };
};

function buildMockPrisma(overrides: {
  transfer?: GoodsTransfer;
  lines?: Array<TransferLine & { product: Product }>;
  warehouses?: Warehouse[];
  products?: Product[];
} = {}) {
  const transfer = overrides.transfer ?? buildMockTransfer();
  const lines = overrides.lines ?? [buildMockLine()];
  const warehouses = overrides.warehouses ?? [productionWarehouse, finishedGoodsWarehouse];
  const products = overrides.products ?? [gpProduct1, gpProduct2, massProduct];

  const transferWithLines = {
    ...transfer,
    sourceWarehouse: warehouses.find((w) => w.id === transfer.sourceWarehouseId) ?? productionWarehouse,
    destinationWarehouse: warehouses.find((w) => w.id === transfer.destinationWarehouseId) ?? finishedGoodsWarehouse,
    lines,
  };

  return {
    warehouse: {
      findMany: vi.fn().mockResolvedValue(warehouses),
    },
    product: {
      findMany: vi.fn().mockResolvedValue(products),
    },
    goodsTransfer: {
      create: vi.fn().mockImplementation((args: { data?: { lines?: { create?: unknown[] } } }) => {
        const createdLines = (args.data?.lines?.create ?? []).map((_: unknown, index: number) => ({
          id: `tl-${index + 1}`,
          goodsTransferId: transfer.id,
          productId: gpProduct1.id,
          plannedQuantity: new Decimal(10),
          actualQuantity: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
        return Promise.resolve({ ...transferWithLines, lines: createdLines });
      }),
      findUnique: vi.fn().mockResolvedValue(transferWithLines),
      update: vi.fn().mockImplementation((args: { data?: { status?: string } }) =>
        Promise.resolve({ ...transferWithLines, status: args.data?.status ?? transferWithLines.status, updatedAt: new Date() }),
      ),
    },
    transferLine: {
      createMany: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([ksgpUser]),
    },
    discrepancy: {
      create: vi.fn().mockResolvedValue({ id: 'disc-1' }),
    },
    $transaction: vi.fn(async (cb: (tx: MockTx) => Promise<unknown>) => {
      const tx: MockTx = {
        goodsTransfer: {
          create: vi.fn().mockImplementation((args: { data?: { lines?: { create?: unknown[] } } }) => {
            const createdLines = (args.data?.lines?.create ?? []).map((_: unknown, index: number) => ({
              id: `tl-${index + 1}`,
              goodsTransferId: transfer.id,
              productId: gpProduct1.id,
              plannedQuantity: new Decimal(10),
              actualQuantity: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            }));
            return Promise.resolve({ ...transferWithLines, lines: createdLines });
          }),
          findUnique: vi.fn().mockResolvedValue(transferWithLines),
          update: vi.fn().mockImplementation((args: { data?: { status?: string } }) =>
            Promise.resolve({ ...transferWithLines, status: args.data?.status ?? transferWithLines.status, updatedAt: new Date() }),
          ),
        },
        transferLine: {
          createMany: vi.fn().mockResolvedValue(undefined),
          deleteMany: vi.fn().mockResolvedValue(undefined),
          update: vi.fn().mockResolvedValue(undefined),
        },
        user: {
          findMany: vi.fn().mockResolvedValue([ksgpUser, npUser]),
        },
        discrepancy: {
          create: vi.fn().mockResolvedValue({ id: 'disc-1' }),
        },
      };
      return cb(tx);
    }),
  } as unknown as typeof import('@prodtrack/db').prisma;
}

function buildMockDeps(overrides: Parameters<typeof buildMockPrisma>[0] = {}) {
  const writeAudit = vi.fn();
  const writeTiming = vi.fn();
  const emitEvent = vi.fn();
  const applyStockMovements = vi.fn().mockResolvedValue(undefined);
  const buildTransferIssueMovements = vi.fn().mockReturnValue([
    {
      warehouseId: productionWarehouse.id,
      productId: gpProduct1.id,
      stockCategory: 'GP',
      type: 'ISSUE',
      quantity: new Decimal(10),
      sourceType: 'GOODS_TRANSFER',
      sourceId: 'tr-1',
    },
  ]);
  const buildTransferReturnMovements = vi.fn().mockReturnValue([
    {
      warehouseId: productionWarehouse.id,
      productId: gpProduct1.id,
      stockCategory: 'GP',
      type: 'RETURN',
      quantity: new Decimal(10),
      sourceType: 'TRANSFER_CANCEL',
      sourceId: 'tr-1',
    },
  ]);
  const getStockBalance = vi.fn().mockResolvedValue([
    {
      id: 'bal-1',
      warehouseId: productionWarehouse.id,
      productId: gpProduct1.id,
      stockCategory: 'GP',
      quantity: new Decimal(100),
      updatedAt: new Date(),
      product: gpProduct1,
      warehouse: { type: 'PRODUCTION' },
    },
  ]);
  const requirePermission = vi.fn().mockResolvedValue({
    userId: 'user-1',
    user: { roles: [{ role: { code: 'NP' } }] },
  });

  return {
    prisma: buildMockPrisma(overrides),
    writeAudit,
    writeTiming,
    emitEvent,
    applyStockMovements,
    buildTransferIssueMovements,
    buildTransferReturnMovements,
    buildTransferReceiptMovements: vi.fn().mockReturnValue([
      {
        warehouseId: finishedGoodsWarehouse.id,
        productId: gpProduct1.id,
        stockCategory: 'GP',
        type: 'RECEIPT',
        quantity: new Decimal(10),
        sourceType: 'GOODS_TRANSFER',
        sourceId: 'tr-1',
      },
    ]),
    getStockBalance,
    requirePermission,
  };
}

describe('createGoodsTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates DRAFT transfer with 2 GP lines', async () => {
    const deps = buildMockDeps();
    const result = await createGoodsTransfer(
      {
        sourceWarehouseId: productionWarehouse.id,
        destinationWarehouseId: finishedGoodsWarehouse.id,
        lines: [
          { productId: gpProduct1.id, plannedQuantity: 10 },
          { productId: gpProduct2.id, plannedQuantity: 5 },
        ],
      },
      deps,
    );

    expect(result.status).toBe('DRAFT');
    expect(result.lines).toHaveLength(2);
    expect(deps.prisma.$transaction).toHaveBeenCalled();
    expect(deps.writeAudit).toHaveBeenCalled();
    const auditCall = deps.writeAudit.mock.calls[0][1];
    expect(auditCall.action).toBe('CREATE');
    expect(auditCall.objectType).toBe('GoodsTransfer');
  });

  it('blocks source equal to destination', async () => {
    const deps = buildMockDeps();
    await expect(
      createGoodsTransfer(
        {
          sourceWarehouseId: productionWarehouse.id,
          destinationWarehouseId: productionWarehouse.id,
          lines: [{ productId: gpProduct1.id, plannedQuantity: 1 }],
        },
        deps,
      ),
    ).rejects.toThrow('Склад-источник и склад-приёмник должны различаться');
  });

  it('blocks empty lines', async () => {
    const deps = buildMockDeps();
    await expect(
      createGoodsTransfer(
        {
          sourceWarehouseId: productionWarehouse.id,
          destinationWarehouseId: finishedGoodsWarehouse.id,
          lines: [],
        },
        deps,
      ),
    ).rejects.toThrow('Добавьте хотя бы одну строку перемещения');
  });

  it('blocks quantity less than or equal to 0', async () => {
    const deps = buildMockDeps();
    await expect(
      createGoodsTransfer(
        {
          sourceWarehouseId: productionWarehouse.id,
          destinationWarehouseId: finishedGoodsWarehouse.id,
          lines: [{ productId: gpProduct1.id, plannedQuantity: 0 }],
        },
        deps,
      ),
    ).rejects.toThrow('Количество должно быть больше 0');
  });

  it('blocks non-GP product', async () => {
    const deps = buildMockDeps();
    await expect(
      createGoodsTransfer(
        {
          sourceWarehouseId: productionWarehouse.id,
          destinationWarehouseId: finishedGoodsWarehouse.id,
          lines: [{ productId: massProduct.id, plannedQuantity: 1 }],
        },
        deps,
      ),
    ).rejects.toThrow('Перемещения возможны только для ГП');
  });

  it('blocks inactive product', async () => {
    const deps = buildMockDeps({ products: [inactiveGpProduct, gpProduct1] });
    await expect(
      createGoodsTransfer(
        {
          sourceWarehouseId: productionWarehouse.id,
          destinationWarehouseId: finishedGoodsWarehouse.id,
          lines: [{ productId: inactiveGpProduct.id, plannedQuantity: 1 }],
        },
        deps,
      ),
    ).rejects.toThrow('Продукт деактивирован');
  });

  it('blocks inactive warehouse', async () => {
    const deps = buildMockDeps({
      warehouses: [{ ...productionWarehouse, active: false }, finishedGoodsWarehouse],
    });
    await expect(
      createGoodsTransfer(
        {
          sourceWarehouseId: productionWarehouse.id,
          destinationWarehouseId: finishedGoodsWarehouse.id,
          lines: [{ productId: gpProduct1.id, plannedQuantity: 1 }],
        },
        deps,
      ),
    ).rejects.toThrow('Склад деактивирован');
  });

  it('blocks duplicate productId', async () => {
    const deps = buildMockDeps();
    await expect(
      createGoodsTransfer(
        {
          sourceWarehouseId: productionWarehouse.id,
          destinationWarehouseId: finishedGoodsWarehouse.id,
          lines: [
            { productId: gpProduct1.id, plannedQuantity: 1 },
            { productId: gpProduct1.id, plannedQuantity: 2 },
          ],
        },
        deps,
      ),
    ).rejects.toThrow('Продукт в перемещении не может повторяться');
  });
});

describe('createGoodsTransferAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success with transfer id on valid form data', async () => {
    const deps = buildMockDeps();
    vi.resetModules();
    vi.doMock('@prodtrack/db', () => ({
      prisma: deps.prisma,
      writeAudit: deps.writeAudit,
      writeTiming: deps.writeTiming,
      emitEvent: deps.emitEvent,
    }));
    vi.doMock('@/lib/auth/access', () => ({
      requirePermission: deps.requirePermission,
    }));
    vi.doMock('@/lib/stock-service', () => ({
      applyStockMovements: deps.applyStockMovements,
      buildTransferIssueMovements: deps.buildTransferIssueMovements,
      getStockBalance: deps.getStockBalance,
    }));

    const { createGoodsTransferAction: action } = await import('../actions');
    const formData = new FormData();
    formData.set('sourceWarehouseId', productionWarehouse.id);
    formData.set('destinationWarehouseId', finishedGoodsWarehouse.id);
    formData.set('lines', JSON.stringify([{ productId: gpProduct1.id, plannedQuantity: 10 }]));

    const result = await action(formData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.id).toBe('tr-1');
    }
  });
});

describe('submitGoodsTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits DRAFT transfer and creates ISSUE movements', async () => {
    const deps = buildMockDeps();
    const result = await submitGoodsTransfer('tr-1', deps);

    expect(result.status).toBe('SUBMITTED');
    expect(deps.prisma.$transaction).toHaveBeenCalled();
    expect(deps.buildTransferIssueMovements).toHaveBeenCalled();
    expect(deps.applyStockMovements).toHaveBeenCalled();

    const movements = deps.applyStockMovements.mock.calls[0][1];
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      warehouseId: productionWarehouse.id,
      productId: gpProduct1.id,
      stockCategory: 'GP',
      type: 'ISSUE',
      sourceType: 'GOODS_TRANSFER',
      sourceId: 'tr-1',
    });
  });

  it('writes audit and timing records on submit', async () => {
    const deps = buildMockDeps();
    await submitGoodsTransfer('tr-1', deps);

    expect(deps.writeAudit).toHaveBeenCalled();
    const auditCall = deps.writeAudit.mock.calls[0][1];
    expect(auditCall.action).toBe('UPDATE');
    expect(auditCall.objectType).toBe('GoodsTransfer');
    expect(auditCall.field).toBe('status');
    expect(auditCall.oldValue).toBe('DRAFT');
    expect(auditCall.newValue).toBe('SUBMITTED');

    expect(deps.writeTiming).toHaveBeenCalled();
    const timingCall = deps.writeTiming.mock.calls[0][1];
    expect(timingCall.documentType).toBe('GOODS_TRANSFER');
    expect(timingCall.fromStatus).toBe('DRAFT');
    expect(timingCall.toStatus).toBe('SUBMITTED');
  });

  it('emits EV-04 to KSGP users with payload', async () => {
    const deps = buildMockDeps();
    await submitGoodsTransfer('tr-1', deps);

    expect(deps.emitEvent).toHaveBeenCalled();
    const emitCall = deps.emitEvent.mock.calls[0][1];
    expect(emitCall.eventCode).toBe('EV_04');
    expect(emitCall.recipientIds).toEqual(['ksgp-user-1', 'np-user-1']);
    expect(emitCall.title).toBe('Перемещение отправлено');
    const payload = emitCall.payload;
    expect(payload).toMatchObject({
      transferId: 'tr-1',
      linesCount: 1,
    });
    expect(payload.sourceWarehouse).toMatchObject({ id: productionWarehouse.id, name: productionWarehouse.name });
    expect(payload.destinationWarehouse).toMatchObject({ id: finishedGoodsWarehouse.id, name: finishedGoodsWarehouse.name });
  });

  it('blocks submit when balance is below planned quantity', async () => {
    const deps = buildMockDeps();
    deps.getStockBalance.mockResolvedValue([
      {
        id: 'bal-1',
        warehouseId: productionWarehouse.id,
        productId: gpProduct1.id,
        stockCategory: 'GP',
        quantity: new Decimal(5),
        updatedAt: new Date(),
        product: gpProduct1,
        warehouse: { type: 'PRODUCTION' },
      },
    ]);

    await expect(submitGoodsTransfer('tr-1', deps)).rejects.toThrow(
      'Недостаточно остатка для продукта Крем: требуется 10.00, доступно 5.00',
    );
  });

  it('blocks submit when transfer status is not DRAFT', async () => {
    const deps = buildMockDeps({ transfer: buildMockTransfer({ status: 'SUBMITTED' }) });
    await expect(submitGoodsTransfer('tr-1', deps)).rejects.toThrow(
      'Перемещение можно отправить только из статуса Черновик',
    );
  });

  it('blocks submit when product was deactivated after creation', async () => {
    const deps = buildMockDeps({
      lines: [buildMockLine({ product: inactiveGpProduct })],
    });
    await expect(submitGoodsTransfer('tr-1', deps)).rejects.toThrow('Продукт деактивирован');
  });

  it('blocks submit when warehouse was deactivated', async () => {
    const deps = buildMockDeps({
      warehouses: [{ ...productionWarehouse, active: false }, finishedGoodsWarehouse],
    });
    await expect(submitGoodsTransfer('tr-1', deps)).rejects.toThrow('Склад деактивирован');
  });

  it('blocks submit without transfer:update permission', async () => {
    const deps = buildMockDeps();
    deps.requirePermission.mockRejectedValue(new Error('Forbidden: insufficient permissions'));
    await expect(submitGoodsTransfer('tr-1', deps)).rejects.toThrow('Forbidden: insufficient permissions');
  });

  it('blocks submit for non-existing transfer', async () => {
    const deps = buildMockDeps();
    deps.prisma.goodsTransfer.findUnique = vi.fn().mockResolvedValue(null);
    await expect(submitGoodsTransfer('missing', deps)).rejects.toThrow('Перемещение не найдено');
  });
});

describe('updateGoodsTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates DRAFT transfer lines and warehouses', async () => {
    const deps = buildMockDeps();
    const result = await updateGoodsTransfer(
      'tr-1',
      {
        sourceWarehouseId: productionWarehouse.id,
        destinationWarehouseId: finishedGoodsWarehouse.id,
        lines: [
          { productId: gpProduct1.id, plannedQuantity: 20 },
          { productId: gpProduct2.id, plannedQuantity: 3 },
        ],
      },
      deps,
    );

    expect(result.status).toBe('DRAFT');
    expect(deps.prisma.$transaction).toHaveBeenCalled();
    expect(deps.writeAudit).toHaveBeenCalled();
  });

  it('blocks update when status is not DRAFT', async () => {
    const deps = buildMockDeps({ transfer: buildMockTransfer({ status: 'SUBMITTED' }) });
    await expect(
      updateGoodsTransfer(
        'tr-1',
        {
          sourceWarehouseId: productionWarehouse.id,
          destinationWarehouseId: finishedGoodsWarehouse.id,
          lines: [{ productId: gpProduct1.id, plannedQuantity: 1 }],
        },
        deps,
      ),
    ).rejects.toThrow('Редактирование доступно только в статусе Черновик');
  });
});

describe('cancelGoodsTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cancels DRAFT transfer without stock movements and emits EV-10', async () => {
    const deps = buildMockDeps({ transfer: buildMockTransfer({ status: 'DRAFT' }) });
    const result = await cancelGoodsTransfer('tr-1', deps);

    expect(result.status).toBe('CANCELLED');
    expect(deps.buildTransferReturnMovements).not.toHaveBeenCalled();
    expect(deps.applyStockMovements).not.toHaveBeenCalled();

    expect(deps.writeAudit).toHaveBeenCalled();
    const auditCall = deps.writeAudit.mock.calls[0][1];
    expect(auditCall.action).toBe('UPDATE');
    expect(auditCall.field).toBe('status');
    expect(auditCall.oldValue).toBe('DRAFT');
    expect(auditCall.newValue).toBe('CANCELLED');

    expect(deps.writeTiming).toHaveBeenCalled();
    const timingCall = deps.writeTiming.mock.calls[0][1];
    expect(timingCall.fromStatus).toBe('DRAFT');
    expect(timingCall.toStatus).toBe('CANCELLED');

    expect(deps.emitEvent).toHaveBeenCalled();
    const emitCall = deps.emitEvent.mock.calls[0][1];
    expect(emitCall.eventCode).toBe('EV_10');
    expect(emitCall.recipientIds).toEqual(['ksgp-user-1', 'np-user-1']);
    expect(emitCall.payload.status).toBe('CANCELLED');
  });

  it('cancels SUBMITTED transfer with RETURN movements and emits EV-10', async () => {
    const mockPrisma = buildMockPrisma({
      transfer: buildMockTransfer({ status: 'SUBMITTED', submittedAt: new Date(), submittedByUserId: 'user-1' }),
      lines: [buildMockLine()],
    });
    const deps = buildMockDeps({
      transfer: buildMockTransfer({ status: 'SUBMITTED', submittedAt: new Date(), submittedByUserId: 'user-1' }),
      lines: [buildMockLine()],
    });
    deps.prisma = mockPrisma as unknown as typeof deps.prisma;

    mockPrisma.user.findMany = vi.fn().mockResolvedValue([ksgpUser, npUser]);

    const result = await cancelGoodsTransfer('tr-1', deps);

    expect(result.status).toBe('CANCELLED');
    expect(deps.buildTransferReturnMovements).toHaveBeenCalled();
    expect(deps.applyStockMovements).toHaveBeenCalled();

    const movements = deps.applyStockMovements.mock.calls[0][1];
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      warehouseId: productionWarehouse.id,
      productId: gpProduct1.id,
      stockCategory: 'GP',
      type: 'RETURN',
      sourceType: 'TRANSFER_CANCEL',
      sourceId: 'tr-1',
    });

    const auditCall = deps.writeAudit.mock.calls[0][1];
    expect(auditCall.oldValue).toBe('SUBMITTED');
    expect(auditCall.newValue).toBe('CANCELLED');

    const timingCall = deps.writeTiming.mock.calls[0][1];
    expect(timingCall.fromStatus).toBe('SUBMITTED');
    expect(timingCall.toStatus).toBe('CANCELLED');

    const emitCall = deps.emitEvent.mock.calls[0][1];
    expect(emitCall.eventCode).toBe('EV_10');
    expect(emitCall.recipientIds).toEqual(['ksgp-user-1', 'np-user-1']);
  });

  it('emits EV-10 to NP and KSGP recipients when canceling DRAFT', async () => {
    const mockPrisma = buildMockPrisma({ transfer: buildMockTransfer({ status: 'DRAFT' }) });
    const deps = buildMockDeps({ transfer: buildMockTransfer({ status: 'DRAFT' }) });
    deps.prisma = mockPrisma as unknown as typeof deps.prisma;
    mockPrisma.user.findMany = vi.fn().mockResolvedValue([ksgpUser, npUser]);

    await cancelGoodsTransfer('tr-1', deps);

    const emitCall = deps.emitEvent.mock.calls[0][1];
    expect(emitCall.eventCode).toBe('EV_10');
    expect(emitCall.recipientIds).toEqual(['ksgp-user-1', 'np-user-1']);
  });

  it('blocks cancel from RECEIVED', async () => {
    const deps = buildMockDeps({ transfer: buildMockTransfer({ status: 'RECEIVED' }) });
    await expect(cancelGoodsTransfer('tr-1', deps)).rejects.toThrow('Перемещение нельзя отменить в этом статусе');
  });

  it('blocks cancel from DISCREPANCY', async () => {
    const deps = buildMockDeps({ transfer: buildMockTransfer({ status: 'DISCREPANCY' }) });
    await expect(cancelGoodsTransfer('tr-1', deps)).rejects.toThrow('Перемещение нельзя отменить в этом статусе');
  });

  it('blocks cancel from RECONCILED', async () => {
    const deps = buildMockDeps({ transfer: buildMockTransfer({ status: 'RECONCILED' }) });
    await expect(cancelGoodsTransfer('tr-1', deps)).rejects.toThrow('Перемещение нельзя отменить в этом статусе');
  });

  it('blocks cancel from CANCELLED', async () => {
    const deps = buildMockDeps({ transfer: buildMockTransfer({ status: 'CANCELLED' }) });
    await expect(cancelGoodsTransfer('tr-1', deps)).rejects.toThrow('Перемещение нельзя отменить в этом статусе');
  });

  it('blocks cancel without transfer:update permission', async () => {
    const deps = buildMockDeps({ transfer: buildMockTransfer({ status: 'DRAFT' }) });
    deps.requirePermission.mockRejectedValue(new Error('Forbidden: insufficient permissions'));
    await expect(cancelGoodsTransfer('tr-1', deps)).rejects.toThrow('Forbidden: insufficient permissions');
  });

  it('blocks cancel when product deactivated after submit', async () => {
    const deps = buildMockDeps({
      transfer: buildMockTransfer({ status: 'SUBMITTED', submittedAt: new Date(), submittedByUserId: 'user-1' }),
      lines: [buildMockLine({ product: inactiveGpProduct })],
    });
    await expect(cancelGoodsTransfer('tr-1', deps)).rejects.toThrow('Продукт деактивирован');
  });

  it('blocks cancel when warehouse deactivated', async () => {
    const deps = buildMockDeps({
      transfer: buildMockTransfer({ status: 'SUBMITTED', submittedAt: new Date(), submittedByUserId: 'user-1' }),
      warehouses: [{ ...productionWarehouse, active: false }, finishedGoodsWarehouse],
    });
    await expect(cancelGoodsTransfer('tr-1', deps)).rejects.toThrow('Склад деактивирован');
  });

  it('blocks cancel for non-existing transfer', async () => {
    const deps = buildMockDeps();
    deps.prisma.goodsTransfer.findUnique = vi.fn().mockResolvedValue(null);
    await expect(cancelGoodsTransfer('missing', deps)).rejects.toThrow('Перемещение не найдено');
  });
});

describe('receiveGoodsTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  let txRef: MockTx | undefined;

  function buildReceiveDeps(overrides: Parameters<typeof buildMockPrisma>[0] = {}, expectedStatus: 'RECEIVED' | 'DISCREPANCY' = 'RECEIVED', recipients: User[] = []) {
    const mockPrisma = buildMockPrisma(overrides);
    const baseTx = (mockPrisma.$transaction as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as MockTx | undefined;
    mockPrisma.$transaction = vi.fn((cb: (tx: MockTx) => Promise<unknown>) => {
      const tx: MockTx = {
        ...(baseTx ?? {
          goodsTransfer: {
            create: vi.fn(),
            findUnique: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue({ id: 'tr-1', status: expectedStatus }),
          },
          transferLine: {
            createMany: vi.fn().mockResolvedValue(undefined),
            deleteMany: vi.fn().mockResolvedValue(undefined),
            update: vi.fn().mockResolvedValue(undefined),
          },
          user: {
            findMany: vi.fn().mockResolvedValue(recipients),
          },
          discrepancy: {
            create: vi.fn().mockResolvedValue({ id: 'disc-1' }),
          },
        }),
        goodsTransfer: {
          create: baseTx?.goodsTransfer.create ?? vi.fn(),
          findUnique: baseTx?.goodsTransfer.findUnique ?? vi.fn().mockResolvedValue(null),
          update: vi.fn().mockImplementation((args: { data?: { status?: string } }) =>
            Promise.resolve({ id: 'tr-1', status: args.data?.status ?? expectedStatus }),
          ),
        },
        user: {
          findMany: vi.fn().mockResolvedValue(recipients),
        },
      };
      txRef = tx;
      return cb(tx);
    }) as unknown as typeof mockPrisma.$transaction;
    const deps = buildMockDeps(overrides);
    deps.prisma = mockPrisma as unknown as typeof deps.prisma;
    deps.requirePermission = vi.fn().mockResolvedValue({
      userId: 'user-ksgp',
      user: { roles: [{ role: { code: 'KSGP' } }] },
    });
    return { deps, mockPrisma };
  }

  it('receives without discrepancies and sets status RECEIVED, emits EV-05', async () => {
    txRef = undefined;
    const { deps } = buildReceiveDeps(
      {
        transfer: buildMockTransfer({ status: 'SUBMITTED', submittedAt: new Date(), submittedByUserId: 'user-1' }),
        lines: [buildMockLine()],
      },
      'RECEIVED',
      [npUser],
    );

    const line = buildMockLine();
    const result = await receiveGoodsTransfer(
      'tr-1',
      { lines: [{ transferLineId: line.id, actualQuantity: 10 }] },
      deps,
    );

    expect(result.status).toBe('RECEIVED');
    expect(deps.buildTransferReceiptMovements).toHaveBeenCalled();
    expect(deps.applyStockMovements).toHaveBeenCalled();

    const auditCall = deps.writeAudit.mock.calls[0][1];
    expect(auditCall.oldValue).toBe('SUBMITTED');
    expect(auditCall.newValue).toBe('RECEIVED');

    const timingCall = deps.writeTiming.mock.calls[0][1];
    expect(timingCall.toStatus).toBe('RECEIVED');

    expect(deps.emitEvent).toHaveBeenCalled();
    const emitCall = deps.emitEvent.mock.calls[deps.emitEvent.mock.calls.length - 1][1];
    expect(emitCall.eventCode).toBe('EV_05');
    expect(emitCall.recipientIds).toEqual(['np-user-1']);
  });

  it('receives with discrepancy and sets status DISCREPANCY, creates Discrepancy records, emits EV-06', async () => {
    txRef = undefined;
    const { deps } = buildReceiveDeps(
      {
        transfer: buildMockTransfer({ status: 'SUBMITTED', submittedAt: new Date(), submittedByUserId: 'user-1' }),
        lines: [buildMockLine()],
      },
      'DISCREPANCY',
      [npUser, usgpUser],
    );

    const line = buildMockLine();
    const result = await receiveGoodsTransfer(
      'tr-1',
      { lines: [{ transferLineId: line.id, actualQuantity: 12 }] },
      deps,
    );

    expect(result.status).toBe('DISCREPANCY');
    expect(deps.applyStockMovements).toHaveBeenCalled();

    expect(txRef).toBeDefined();
    const createdCall = txRef!.discrepancy.create;
    expect(createdCall).toHaveBeenCalled();
    const data = createdCall.mock.calls[0][0]?.data;
    expect(data).toMatchObject({
      goodsTransferId: 'tr-1',
      transferLineId: line.id,
      productId: gpProduct1.id,
      plannedQuantity: new Decimal(10),
      actualQuantity: new Decimal(12),
    });
    expect(data.difference.toNumber()).toBe(2);

    expect(deps.emitEvent).toHaveBeenCalled();
    const emitCall = deps.emitEvent.mock.calls[deps.emitEvent.mock.calls.length - 1][1];
    expect(emitCall.eventCode).toBe('EV_06');
    expect(emitCall.recipientIds).toEqual(['np-user-1', 'usgp-user-1']);
    expect(emitCall.payload.discrepanciesCount).toBe(1);
  });

  it('receives with negative discrepancy (actual < planned) and stores negative difference', async () => {
    txRef = undefined;
    const { deps } = buildReceiveDeps(
      {
        transfer: buildMockTransfer({ status: 'SUBMITTED', submittedAt: new Date(), submittedByUserId: 'user-1' }),
        lines: [buildMockLine()],
      },
      'DISCREPANCY',
      [npUser, usgpUser],
    );

    const line = buildMockLine();
    const result = await receiveGoodsTransfer(
      'tr-1',
      { lines: [{ transferLineId: line.id, actualQuantity: 8 }] },
      deps,
    );

    expect(result.status).toBe('DISCREPANCY');
    expect(txRef).toBeDefined();
    const data = txRef!.discrepancy.create.mock.calls[0][0]?.data;
    expect(data.difference.toNumber()).toBe(-2);
  });

  it('blocks receive from DRAFT', async () => {
    const { deps } = buildReceiveDeps({ transfer: buildMockTransfer({ status: 'DRAFT' }) });
    const line = buildMockLine();
    await expect(
      receiveGoodsTransfer('tr-1', { lines: [{ transferLineId: line.id, actualQuantity: 10 }] }, deps),
    ).rejects.toThrow('Перемещение можно принять только из статуса Отправлено');
  });

  it('blocks receive from RECEIVED', async () => {
    const { deps } = buildReceiveDeps({ transfer: buildMockTransfer({ status: 'RECEIVED' }) });
    const line = buildMockLine();
    await expect(
      receiveGoodsTransfer('tr-1', { lines: [{ transferLineId: line.id, actualQuantity: 10 }] }, deps),
    ).rejects.toThrow('Перемещение можно принять только из статуса Отправлено');
  });

  it('blocks receive from DISCREPANCY', async () => {
    const { deps } = buildReceiveDeps({ transfer: buildMockTransfer({ status: 'DISCREPANCY' }) });
    const line = buildMockLine();
    await expect(
      receiveGoodsTransfer('tr-1', { lines: [{ transferLineId: line.id, actualQuantity: 10 }] }, deps),
    ).rejects.toThrow('Перемещение можно принять только из статуса Отправлено');
  });

  it('blocks receive from CANCELLED', async () => {
    const { deps } = buildReceiveDeps({ transfer: buildMockTransfer({ status: 'CANCELLED' }) });
    const line = buildMockLine();
    await expect(
      receiveGoodsTransfer('tr-1', { lines: [{ transferLineId: line.id, actualQuantity: 10 }] }, deps),
    ).rejects.toThrow('Перемещение можно принять только из статуса Отправлено');
  });

  it('blocks receive when lines are missing', async () => {
    const { deps } = buildReceiveDeps({
      transfer: buildMockTransfer({ status: 'SUBMITTED', submittedAt: new Date(), submittedByUserId: 'user-1' }),
      lines: [buildMockLine()],
    });
    await expect(receiveGoodsTransfer('tr-1', { lines: [] }, deps)).rejects.toThrow(
      'Укажите фактическое количество для всех строк',
    );
  });

  it('blocks receive when transferLineId is duplicated', async () => {
    const { deps } = buildReceiveDeps({
      transfer: buildMockTransfer({ status: 'SUBMITTED', submittedAt: new Date(), submittedByUserId: 'user-1' }),
      lines: [buildMockLine()],
    });
    const line = buildMockLine();
    await expect(
      receiveGoodsTransfer(
        'tr-1',
        { lines: [{ transferLineId: line.id, actualQuantity: 10 }, { transferLineId: line.id, actualQuantity: 5 }] },
        deps,
      ),
    ).rejects.toThrow('Строка в приёмке не может повторяться');
  });

  it('blocks receive when transferLineId is unknown', async () => {
    const { deps } = buildReceiveDeps({
      transfer: buildMockTransfer({ status: 'SUBMITTED', submittedAt: new Date(), submittedByUserId: 'user-1' }),
      lines: [buildMockLine()],
    });
    await expect(
      receiveGoodsTransfer('tr-1', { lines: [{ transferLineId: 'unknown-line', actualQuantity: 10 }] }, deps),
    ).rejects.toThrow('Строка не найдена в перемещении');
  });

  it('blocks receive when actualQuantity is negative', async () => {
    const { deps } = buildReceiveDeps({
      transfer: buildMockTransfer({ status: 'SUBMITTED', submittedAt: new Date(), submittedByUserId: 'user-1' }),
      lines: [buildMockLine()],
    });
    const line = buildMockLine();
    await expect(
      receiveGoodsTransfer('tr-1', { lines: [{ transferLineId: line.id, actualQuantity: -1 }] }, deps),
    ).rejects.toThrow('Фактическое количество не может быть отрицательным');
  });

  it('blocks receive without transfer:receive permission', async () => {
    const { deps } = buildReceiveDeps({
      transfer: buildMockTransfer({ status: 'SUBMITTED', submittedAt: new Date(), submittedByUserId: 'user-1' }),
      lines: [buildMockLine()],
    });
    deps.requirePermission.mockRejectedValue(new Error('Forbidden: insufficient permissions'));
    const line = buildMockLine();
    await expect(
      receiveGoodsTransfer('tr-1', { lines: [{ transferLineId: line.id, actualQuantity: 10 }] }, deps),
    ).rejects.toThrow('Forbidden: insufficient permissions');
  });
});
