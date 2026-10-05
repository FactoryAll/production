import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  ONE_C_SOURCE_TYPES,
  syncProductionOrderTask,
  syncTaskForOneC,
  syncTransferTask,
} from '../tasks';
import { buildProductionTaskData, buildTransferTaskData } from '../task-data';

const Decimal = Prisma.Decimal;

const orderFixture = {
  id: 'po-1',
  completedAt: new Date('2026-10-06T20:15:00.000Z'),
  shift: { number: 1, date: new Date('2026-10-06T00:00:00.000Z') },
  lines: [
    {
      workCenter: { code: '01', name: 'РЦ 01' },
      product: { code: 'GP-001', name: 'Крем', unit: 'шт' },
      facts: [
        {
          factCategory: 'GP' as const,
          quantity: new Decimal('80'),
          consumptions: [
            {
              quantity: new Decimal('70.25'),
              product: { code: 'M-001', name: 'Масса', unit: 'кг' },
            },
          ],
        },
      ],
    },
  ],
};

const transferFixture = {
  id: 'tr-1',
  status: 'SUBMITTED' as const,
  submittedAt: new Date('2026-10-06T09:00:00.000Z'),
  sourceWarehouse: { name: 'Производственный склад' },
  destinationWarehouse: { name: 'Склад ГП' },
  lines: [
    {
      product: { code: 'GP-001', name: 'Крем', unit: 'шт' },
      plannedQuantity: new Decimal('100'),
      actualQuantity: null,
    },
  ],
};

interface MockOptions {
  order?: unknown;
  transfer?: unknown;
  task?: unknown;
}

function makeTx(options: MockOptions = {}) {
  const tx = {
    productionOrder: {
      findUnique: vi.fn().mockResolvedValue(options.order ?? null),
    },
    goodsTransfer: {
      findUnique: vi.fn().mockResolvedValue(options.transfer ?? null),
    },
    taskForOneC: {
      findUnique: vi.fn().mockResolvedValue(options.task ?? null),
      create: vi.fn().mockResolvedValue({ id: 'task-1' }),
      update: vi.fn().mockResolvedValue({ id: 'task-1' }),
      delete: vi.fn().mockResolvedValue({ id: 'task-1' }),
    },
  };
  return tx as unknown as Prisma.TransactionClient & {
    taskForOneC: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    productionOrder: { findUnique: ReturnType<typeof vi.fn> };
    goodsTransfer: { findUnique: ReturnType<typeof vi.fn> };
  };
}

describe('syncTaskForOneC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a task when the source has none', async () => {
    const tx = makeTx();
    const data = buildProductionTaskData(orderFixture);

    const outcome = await syncTaskForOneC(tx, {
      type: 'PRODUCTION',
      sourceType: ONE_C_SOURCE_TYPES.PRODUCTION,
      sourceId: 'po-1',
      data,
    });

    expect(outcome).toBe('created');
    expect(tx.taskForOneC.findUnique).toHaveBeenCalledWith({
      where: { type_sourceId: { type: 'PRODUCTION', sourceId: 'po-1' } },
    });
    expect(tx.taskForOneC.create).toHaveBeenCalledWith({
      data: {
        type: 'PRODUCTION',
        sourceType: 'PRODUCTION_ORDER',
        sourceId: 'po-1',
        data,
      },
    });
    expect(tx.taskForOneC.update).not.toHaveBeenCalled();
  });

  it('updates the existing task when the data changed', async () => {
    const tx = makeTx({
      task: { id: 'task-1', sourceType: 'PRODUCTION_ORDER', data: { taskType: 'PRODUCTION', stale: true } },
    });
    const data = buildProductionTaskData(orderFixture);

    const outcome = await syncTaskForOneC(tx, {
      type: 'PRODUCTION',
      sourceType: ONE_C_SOURCE_TYPES.PRODUCTION,
      sourceId: 'po-1',
      data,
    });

    expect(outcome).toBe('updated');
    expect(tx.taskForOneC.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { sourceType: 'PRODUCTION_ORDER', data },
    });
    expect(tx.taskForOneC.create).not.toHaveBeenCalled();
  });

  it('reopens a processed task when the source data changed (BR-5 + BR-9, вариант B)', async () => {
    const tx = makeTx({
      task: {
        id: 'task-1',
        sourceType: 'PRODUCTION_ORDER',
        status: 'PROCESSED',
        data: { taskType: 'PRODUCTION', stale: true },
      },
    });
    const data = buildProductionTaskData(orderFixture);

    const outcome = await syncTaskForOneC(tx, {
      type: 'PRODUCTION',
      sourceType: ONE_C_SOURCE_TYPES.PRODUCTION,
      sourceId: 'po-1',
      data,
    });

    expect(outcome).toBe('updated');
    expect(tx.taskForOneC.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: {
        sourceType: 'PRODUCTION_ORDER',
        data,
        status: 'PENDING',
        processedAt: null,
        processedById: null,
      },
    });
  });

  it('keeps a processed task marked as processed while the source data is unchanged', async () => {
    const data = buildProductionTaskData(orderFixture);
    const tx = makeTx({
      task: {
        id: 'task-1',
        sourceType: 'PRODUCTION_ORDER',
        status: 'PROCESSED',
        data: JSON.parse(JSON.stringify(data)),
      },
    });

    const outcome = await syncTaskForOneC(tx, {
      type: 'PRODUCTION',
      sourceType: ONE_C_SOURCE_TYPES.PRODUCTION,
      sourceId: 'po-1',
      data,
    });

    expect(outcome).toBe('unchanged');
    expect(tx.taskForOneC.update).not.toHaveBeenCalled();
  });

  it('does not set processed fields when reopening a pending task', async () => {
    const tx = makeTx({
      task: {
        id: 'task-1',
        sourceType: 'PRODUCTION_ORDER',
        status: 'PENDING',
        data: { taskType: 'PRODUCTION', stale: true },
      },
    });
    const data = buildProductionTaskData(orderFixture);

    await syncTaskForOneC(tx, {
      type: 'PRODUCTION',
      sourceType: ONE_C_SOURCE_TYPES.PRODUCTION,
      sourceId: 'po-1',
      data,
    });

    expect(tx.taskForOneC.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { sourceType: 'PRODUCTION_ORDER', data },
    });
  });

  it('leaves the task untouched when the data is unchanged (no false «последнее изменение»)', async () => {
    const data = buildProductionTaskData(orderFixture);
    const tx = makeTx({
      task: { id: 'task-1', sourceType: 'PRODUCTION_ORDER', data: JSON.parse(JSON.stringify(data)) },
    });

    const outcome = await syncTaskForOneC(tx, {
      type: 'PRODUCTION',
      sourceType: ONE_C_SOURCE_TYPES.PRODUCTION,
      sourceId: 'po-1',
      data,
    });

    expect(outcome).toBe('unchanged');
    expect(tx.taskForOneC.update).not.toHaveBeenCalled();
    expect(tx.taskForOneC.create).not.toHaveBeenCalled();
  });

  it('updates when only the source type differs', async () => {
    const data = buildProductionTaskData(orderFixture);
    const tx = makeTx({
      task: { id: 'task-1', sourceType: 'OTHER', data: JSON.parse(JSON.stringify(data)) },
    });

    const outcome = await syncTaskForOneC(tx, {
      type: 'PRODUCTION',
      sourceType: ONE_C_SOURCE_TYPES.PRODUCTION,
      sourceId: 'po-1',
      data,
    });

    expect(outcome).toBe('updated');
  });
});

describe('syncProductionOrderTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the order with facts and consumption and creates the PRODUCTION task', async () => {
    const tx = makeTx({ order: orderFixture });

    const outcome = await syncProductionOrderTask(tx, 'po-1');

    expect(outcome).toBe('created');
    expect(tx.productionOrder.findUnique).toHaveBeenCalledWith({
      where: { id: 'po-1' },
      include: {
        shift: true,
        lines: {
          include: {
            workCenter: true,
            product: true,
            facts: { include: { consumptions: { include: { product: true } } } },
          },
        },
      },
    });

    const created = tx.taskForOneC.create.mock.calls[0][0];
    expect(created.data.type).toBe('PRODUCTION');
    expect(created.data.sourceType).toBe(ONE_C_SOURCE_TYPES.PRODUCTION);
    expect(created.data.sourceId).toBe('po-1');
    expect(created.data.data.output[0]).toMatchObject({ productCode: 'GP-001', category: 'GP', quantity: '80.0000' });
    expect(created.data.data.consumption[0]).toMatchObject({ productCode: 'M-001', quantity: '70.25' });
  });

  it('throws when the order is missing', async () => {
    const tx = makeTx({ order: null });
    await expect(syncProductionOrderTask(tx, 'missing')).rejects.toThrow('ПЗ не найдено');
  });
});

describe('syncTransferTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the TRANSFER task once the receiving side accepted the transfer (RECEIVED)', async () => {
    const tx = makeTx({ transfer: { ...transferFixture, status: 'RECEIVED' } });

    const outcome = await syncTransferTask(tx, 'tr-1');

    expect(outcome).toBe('created');
    expect(tx.goodsTransfer.findUnique).toHaveBeenCalledWith({
      where: { id: 'tr-1' },
      include: {
        sourceWarehouse: true,
        destinationWarehouse: true,
        lines: { include: { product: true } },
      },
    });

    const created = tx.taskForOneC.create.mock.calls[0][0];
    expect(created.data.type).toBe('TRANSFER');
    expect(created.data.sourceType).toBe(ONE_C_SOURCE_TYPES.TRANSFER);
    expect(created.data.data).toMatchObject({
      taskType: 'TRANSFER',
      status: 'RECEIVED',
      sourceWarehouse: 'Производственный склад',
      destinationWarehouse: 'Склад ГП',
    });
  });

  it('does not create a task while the receiving side has not confirmed the quantity (SUBMITTED)', async () => {
    const tx = makeTx({ transfer: { ...transferFixture, status: 'SUBMITTED' } });

    const outcome = await syncTransferTask(tx, 'tr-1');

    expect(outcome).toBe('skipped');
    expect(tx.taskForOneC.create).not.toHaveBeenCalled();
  });

  it('does not create a task while the quantities are still disputed (DISCREPANCY)', async () => {
    const tx = makeTx({ transfer: { ...transferFixture, status: 'DISCREPANCY' } });

    const outcome = await syncTransferTask(tx, 'tr-1');

    expect(outcome).toBe('skipped');
    expect(tx.taskForOneC.create).not.toHaveBeenCalled();
  });

  it('removes a prematurely created task while the transfer is not accepted yet', async () => {
    const tx = makeTx({
      transfer: { ...transferFixture, status: 'SUBMITTED' },
      task: { id: 'task-1', sourceType: ONE_C_SOURCE_TYPES.TRANSFER, data: { taskType: 'TRANSFER' } },
    });

    const outcome = await syncTransferTask(tx, 'tr-1');

    expect(outcome).toBe('removed');
    expect(tx.taskForOneC.delete).toHaveBeenCalledWith({ where: { id: 'task-1' } });
  });

  it('removes the task when the transfer was cancelled', async () => {
    const tx = makeTx({
      transfer: { ...transferFixture, status: 'CANCELLED' },
      task: { id: 'task-1', sourceType: ONE_C_SOURCE_TYPES.TRANSFER, data: { taskType: 'TRANSFER' } },
    });

    const outcome = await syncTransferTask(tx, 'tr-1');

    expect(outcome).toBe('removed');
    expect(tx.taskForOneC.delete).toHaveBeenCalled();
  });

  it('refreshes an existing task when the transfer status changed (BR-9)', async () => {
    const existing = buildTransferTaskData(transferFixture);
    const tx = makeTx({
      transfer: { ...transferFixture, status: 'RECONCILED' },
      task: { id: 'task-1', sourceType: ONE_C_SOURCE_TYPES.TRANSFER, data: JSON.parse(JSON.stringify(existing)) },
    });

    const outcome = await syncTransferTask(tx, 'tr-1');

    expect(outcome).toBe('updated');
    const update = tx.taskForOneC.update.mock.calls[0][0];
    expect(update.data.data.status).toBe('RECONCILED');
  });

  it('throws when the transfer is missing', async () => {
    const tx = makeTx({ transfer: null });
    await expect(syncTransferTask(tx, 'missing')).rejects.toThrow('Перемещение не найдено');
  });
});
