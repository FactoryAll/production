import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@prodtrack/db', () => ({
  prisma: {
    productionOrderLine: { findMany: vi.fn(), aggregate: vi.fn() },
    shiftSummary: { aggregate: vi.fn() },
    goodsTransfer: { findMany: vi.fn() },
    stockMovement: { aggregate: vi.fn() },
    productionOrder: { findMany: vi.fn(), aggregate: vi.fn() },
    stageTiming: { findMany: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
  },
}));
vi.mock('@/app/timing/queries', () => ({
  buildStageDurationGroups: vi.fn(() => []),
}));

import { Prisma } from '@prisma/client';
import { prisma } from '@prodtrack/db';
import {
  getDashboardDocuments,
  getDashboardRevision,
  getInProduction,
  getInTransferTotals,
  getProducedTotals,
  getReceivedToFinishedGoods,
} from '../queries';

const now = new Date(2026, 9, 6, 10, 0, 0);
const range = { from: new Date(2026, 9, 6, 8, 0, 0), to: new Date(2026, 9, 6, 20, 0, 0) };

function planned(value: number) {
  return new Prisma.Decimal(value);
}

describe('Виджеты дашборда: выборки (M11 §8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('«производится» — ПЗ текущей смены в CONFIRMED/IN_PROGRESS (BR-5)', async () => {
    (prisma.productionOrderLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        orderId: 'po-1',
        status: 'ACCEPTED',
        plannedQuantity: planned(100),
        workCenter: { id: 'wc-01', code: '01', name: '01.Реактор' },
        product: { code: 'M-001', name: 'Масса', category: 'MASS' },
        order: { status: 'IN_PROGRESS' },
      },
      {
        orderId: 'po-1',
        status: 'ASSIGNED',
        plannedQuantity: planned(50),
        workCenter: { id: 'wc-03', code: '03', name: '03.Тубировка' },
        product: { code: 'GP-001', name: 'Крем', category: 'GP' },
        order: { status: 'IN_PROGRESS' },
      },
    ]);

    const summary = await getInProduction(now);

    expect(prisma.productionOrderLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          order: {
            status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
            shift: { number: 1 },
          },
        },
      }),
    );
    expect(summary.plannedMass).toBe(100);
    expect(summary.plannedGp).toBe(50);
    expect(summary.ordersCount).toBe(1);
    expect(summary.workCenterCount).toBe(2);
  });

  it('ночью «производится» берёт вторую смену', async () => {
    (prisma.productionOrderLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await getInProduction(new Date(2026, 9, 6, 23, 0, 0));

    expect(prisma.productionOrderLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ order: expect.objectContaining({ shift: { number: 2 } }) }),
      }),
    );
  });

  it('Оператор видит только свои РЦ', async () => {
    (prisma.productionOrderLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await getInProduction(now, ['wc-01']);

    expect(prisma.productionOrderLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workCenterId: { in: ['wc-01'] } }),
      }),
    );
  });

  it('«произведено» суммирует итоги смен за период', async () => {
    (prisma.shiftSummary.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { massOutput: planned(1200), pfOutput: planned(30), gpOutput: planned(300) },
    });

    const totals = await getProducedTotals(range);

    expect(totals).toEqual({ mass: 1200, pf: 30, gp: 300 });
    expect(prisma.shiftSummary.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { completedAt: { gte: range.from, lt: range.to } } }),
    );
  });

  it('«в перемещении» — только открытые Перемещения, количество заявленное', async () => {
    (prisma.goodsTransfer.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 't-1', lines: [{ plannedQuantity: planned(10) }, { plannedQuantity: planned(5) }] },
      { id: 't-2', lines: [{ plannedQuantity: planned(2) }] },
    ]);

    const totals = await getInTransferTotals();

    expect(totals).toEqual({ count: 2, plannedQuantity: 17 });
    expect(prisma.goodsTransfer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ['SUBMITTED', 'DISCREPANCY'] } } }),
    );
  });

  it('«принято на склад ГП» — приход ГП на склад готовой продукции за период', async () => {
    (prisma.stockMovement.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { quantity: planned(42) },
      _count: { _all: 3 },
    });

    const totals = await getReceivedToFinishedGoods(range);

    expect(totals).toEqual({ count: 3, quantity: 42 });
    expect(prisma.stockMovement.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'RECEIPT',
          stockCategory: 'GP',
          warehouse: { type: 'FINISHED_GOODS' },
        }),
      }),
    );
  });

  it('отпечаток состояния собирается из таблиц, которые читает дашборд (BR-2)', async () => {
    (prisma.productionOrder.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _count: { _all: 2 },
      _max: { updatedAt: new Date('2026-10-06T08:00:00.000Z') },
    });
    (prisma.productionOrderLine.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _count: { _all: 4 },
      _max: { updatedAt: null },
    });
    (prisma.stageTiming.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _count: { _all: 7 },
      _max: { transitionedAt: new Date('2026-10-06T08:05:00.000Z') },
    });
    (prisma.stockMovement.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _count: { _all: 1 },
      _max: { createdAt: new Date('2026-10-06T08:06:00.000Z') },
    });

    const revision = await getDashboardRevision();

    expect(revision).toBe(
      '2@2026-10-06T08:00:00.000Z|4@-|7@2026-10-06T08:05:00.000Z|1@2026-10-06T08:06:00.000Z',
    );
  });

  it('отпечаток меняется, когда появляется новый переход', async () => {
    (prisma.productionOrder.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _count: { _all: 2 },
      _max: { updatedAt: null },
    });
    (prisma.productionOrderLine.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _count: { _all: 4 },
      _max: { updatedAt: null },
    });
    (prisma.stockMovement.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _count: { _all: 1 },
      _max: { createdAt: null },
    });
    (prisma.stageTiming.aggregate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ _count: { _all: 7 }, _max: { transitionedAt: null } })
      .mockResolvedValueOnce({ _count: { _all: 8 }, _max: { transitionedAt: null } });

    const before = await getDashboardRevision();
    const after = await getDashboardRevision();

    expect(after).not.toBe(before);
  });

  it('список документов: возраст считается от последнего перехода, старые сверху', async () => {
    (prisma.productionOrder.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'po-1', status: 'CONFIRMED', createdAt: new Date(2026, 9, 6, 9, 0, 0), shift: { number: 1 } },
    ]);
    (prisma.goodsTransfer.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 't-1',
        status: 'SUBMITTED',
        createdAt: new Date(2026, 9, 6, 9, 0, 0),
        sourceWarehouse: { name: 'Производственный' },
        destinationWarehouse: { name: 'Склад ГП' },
      },
    ]);
    (prisma.stageTiming.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { documentId: 'po-1', _max: { transitionedAt: new Date(2026, 9, 6, 9, 30, 0) } },
    ]);

    const rows = await getDashboardDocuments(now, { type: 'ALL', status: 'ALL' });

    expect(rows.map((row) => row.id)).toEqual(['t-1', 'po-1']);
    expect(rows[0].ageMs).toBe(60 * 60 * 1000);
    expect(rows[1].ageMs).toBe(30 * 60 * 1000);
    expect(rows[1].href).toBe('/production-orders/po-1');
  });

  it('список документов: фильтр по типу не трогает второй тип', async () => {
    (prisma.productionOrder.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.stageTiming.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await getDashboardDocuments(now, { type: 'PRODUCTION_ORDER', status: 'ALL' });

    expect(prisma.goodsTransfer.findMany).not.toHaveBeenCalled();
  });

  it('список документов: статус другого типа не применяется к ПЗ', async () => {
    (prisma.goodsTransfer.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.stageTiming.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await getDashboardDocuments(now, { type: 'ALL', status: 'RECEIVED' });

    expect(prisma.productionOrder.findMany).not.toHaveBeenCalled();
    expect(prisma.goodsTransfer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'RECEIVED' } }),
    );
  });
});
