import { describe, it, expect, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { buildShiftSummary, updateShiftSummary } from '../shift-summary-service';

const Decimal = Prisma.Decimal;

function makeMockPrisma() {
  const summaries = new Map<string, Record<string, unknown>>();
  const consumptions = new Map<string, Array<Record<string, unknown>>>();
  const auditRecords: Record<string, unknown>[] = [];
  const timings: Record<string, unknown>[] = [];

  const shiftSummaryUpsert = vi.fn().mockImplementation(async ({ where, update, create }: { where: { productionOrderId_workCenterId: { productionOrderId: string; workCenterId: string } }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
    const key = `${where.productionOrderId_workCenterId.productionOrderId}:${where.productionOrderId_workCenterId.workCenterId}`;
    const record = summaries.get(key) ?? { id: `summary-${key}`, ...create };
    const updated = { ...record, ...update };
    summaries.set(key, updated);
    return updated;
  });

  const shiftSummaryFindMany = vi.fn().mockImplementation(async ({ where }: { where: { productionOrderId: string } }) => {
    return Array.from(summaries.values()).filter((s) => s.productionOrderId === where.productionOrderId);
  });

  const shiftSummaryFindUnique = vi.fn().mockImplementation(async ({ where }: { where: { productionOrderId_workCenterId: { productionOrderId: string; workCenterId: string } } }) => {
    const key = `${where.productionOrderId_workCenterId.productionOrderId}:${where.productionOrderId_workCenterId.workCenterId}`;
    return summaries.get(key) ?? null;
  });

  const shiftSummaryConsumptionDeleteMany = vi.fn().mockImplementation(async ({ where }: { where: { shiftSummaryId: string } }) => {
    consumptions.set(where.shiftSummaryId, []);
    return { count: 0 };
  });

  const shiftSummaryConsumptionCreateMany = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) => {
    for (const item of data) {
      const list = consumptions.get(item.shiftSummaryId as string) ?? [];
      list.push(item);
      consumptions.set(item.shiftSummaryId as string, list);
    }
    return { count: data.length };
  });

  const auditCreate = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    auditRecords.push(data);
    return data;
  });

  const timingCreate = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    timings.push(data);
    return data;
  });

  const tx = {
    shiftSummary: {
      upsert: shiftSummaryUpsert,
      findMany: shiftSummaryFindMany,
      findUnique: shiftSummaryFindUnique,
    },
    shiftSummaryConsumption: {
      deleteMany: shiftSummaryConsumptionDeleteMany,
      createMany: shiftSummaryConsumptionCreateMany,
    },
    auditRecord: { create: auditCreate },
    stageTiming: { create: timingCreate },
  };

  const client = {
    productionOrder: {
      findUnique: vi.fn(),
    },
    productionOrderLine: {
      findUnique: vi.fn(),
    },
    shiftSummary: {
      findUnique: shiftSummaryFindUnique,
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as PrismaClient;

  return {
    client,
    tx,
    summaries,
    consumptions,
    auditRecords,
    timings,
  };
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-1',
    shiftId: 'shift-1',
    status: 'COMPLETED',
    lines: [] as unknown[],
    shift: { id: 'shift-1' },
    ...overrides,
  };
}

function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    orderId: 'po-1',
    workCenterId: 'wc-01',
    productId: 'mass-1',
    plannedQuantity: new Decimal(100),
    status: 'REPORTED',
    workCenter: { id: 'wc-01' },
    product: { id: 'mass-1', unit: 'кг' },
    facts: [] as unknown[],
    ...overrides,
  };
}

function makeFact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fact-1',
    lineId: 'line-1',
    productId: 'mass-1',
    factCategory: 'MASS',
    quantity: new Decimal(50),
    defectQuantity: new Decimal(2),
    stopsCount: 1,
    stopsDurationMinutes: 15,
    consumptions: [] as unknown[],
    ...overrides,
  };
}

function makeConsumption(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fc-1',
    productionFactId: 'fact-1',
    productId: 'gp-2',
    quantity: overrides.quantity ? new Decimal(overrides.quantity as number) : new Decimal(10),
    product: { id: 'gp-2', unit: 'шт' },
    ...overrides,
  };
}

describe('buildShiftSummary', () => {
  it('creates one summary per work center', async () => {
    const { client, summaries } = makeMockPrisma();
    (client.productionOrder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeOrder({
        lines: [
          makeLine({ id: 'line-1', workCenterId: 'wc-01' }),
          makeLine({ id: 'line-2', workCenterId: 'wc-02' }),
          makeLine({ id: 'line-3', workCenterId: 'wc-02', productId: 'gp-1' }),
        ],
      }),
    );

    await buildShiftSummary('po-1', client);

    expect(summaries.size).toBe(2);
  });

  it('aggregates mass/pf/gp output correctly', async () => {
    const { client, summaries } = makeMockPrisma();
    (client.productionOrder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeOrder({
        lines: [
          makeLine({
            id: 'line-1',
            facts: [makeFact({ factCategory: 'MASS', quantity: 100 })],
          }),
          makeLine({
            id: 'line-2',
            workCenterId: 'wc-02',
            productId: 'pf-1',
            facts: [makeFact({ factCategory: 'PF', quantity: 20 }), makeFact({ factCategory: 'GP', quantity: 30 })],
          }),
        ],
      }),
    );

    await buildShiftSummary('po-1', client);

    const wc1 = summaries.get('po-1:wc-01');
    expect((wc1?.massOutput as Prisma.Decimal).toNumber()).toBe(100);
    expect((wc1?.pfOutput as Prisma.Decimal).toNumber()).toBe(0);
    expect((wc1?.gpOutput as Prisma.Decimal).toNumber()).toBe(0);

    const wc2 = summaries.get('po-1:wc-02');
    expect((wc2?.pfOutput as Prisma.Decimal).toNumber()).toBe(20);
    expect((wc2?.gpOutput as Prisma.Decimal).toNumber()).toBe(30);
  });

  it('aggregates defect, stops count and duration', async () => {
    const { client, summaries } = makeMockPrisma();
    (client.productionOrder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeOrder({
        lines: [
          makeLine({
            facts: [
              makeFact({ defectQuantity: 2, stopsCount: 1, stopsDurationMinutes: 10 }),
              makeFact({ defectQuantity: 3, stopsCount: 2, stopsDurationMinutes: 20 }),
            ],
          }),
        ],
      }),
    );

    await buildShiftSummary('po-1', client);

    const summary = summaries.get('po-1:wc-01');
    expect((summary?.defectQuantity as Prisma.Decimal).toNumber()).toBe(5);
    expect(summary?.stopsCount).toBe(3);
    expect(summary?.stopsDurationMinutes).toBe(30);
  });

  it('aggregates consumption by product', async () => {
    const { client, consumptions } = makeMockPrisma();
    (client.productionOrder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeOrder({
        lines: [
          makeLine({
            facts: [
              makeFact({
                consumptions: [
                  makeConsumption({ productId: 'gp-2', quantity: 10 }),
                  makeConsumption({ productId: 'gp-3', quantity: 5 }),
                ],
              }),
              makeFact({
                consumptions: [makeConsumption({ productId: 'gp-2', quantity: 7 })],
              }),
            ],
          }),
        ],
      }),
    );

    await buildShiftSummary('po-1', client);

    const list = consumptions.get('summary-po-1:wc-01') ?? [];
    expect(list).toHaveLength(2);
    const gp2 = list.find((c) => c.productId === 'gp-2') as { quantity: Prisma.Decimal };
    const gp3 = list.find((c) => c.productId === 'gp-3') as { quantity: Prisma.Decimal };
    expect(gp2.quantity.toNumber()).toBe(17);
    expect(gp3.quantity.toNumber()).toBe(5);
  });

  it('stores planned quantity and product ids', async () => {
    const { client, summaries } = makeMockPrisma();
    (client.productionOrder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeOrder({
        lines: [makeLine({ plannedQuantity: 123 })],
      }),
    );

    await buildShiftSummary('po-1', client);

    const summary = summaries.get('po-1:wc-01');
    expect(new Prisma.Decimal(summary?.plannedQuantity as number).toNumber()).toBe(123);
    expect(summary?.plannedProductIds).toEqual(['mass-1']);
  });

  it('marks all summaries completed on close', async () => {
    const { client, summaries } = makeMockPrisma();
    (client.productionOrder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeOrder({
        lines: [
          makeLine({ workCenterId: 'wc-01' }),
          makeLine({ id: 'line-2', workCenterId: 'wc-02' }),
        ],
      }),
    );

    await buildShiftSummary('po-1', client);

    for (const summary of summaries.values()) {
      expect(summary.completed).toBe(true);
      expect(summary.completedAt).toBeInstanceOf(Date);
    }
  });

  it('writes audit record', async () => {
    const { client, auditRecords } = makeMockPrisma();
    (client.productionOrder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeOrder({ lines: [makeLine()] }));

    await buildShiftSummary('po-1', client);

    expect(auditRecords.length).toBeGreaterThan(0);
    expect(auditRecords[0]).toMatchObject({ action: 'CREATE', objectType: 'ShiftSummary' });
  });

  it('writes timing record on close', async () => {
    const { client, timings } = makeMockPrisma();
    (client.productionOrder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeOrder({ lines: [makeLine()] }));

    await buildShiftSummary('po-1', client);

    expect(timings.length).toBe(1);
    expect(timings[0]).toMatchObject({ documentType: 'PRODUCTION_ORDER', documentId: 'po-1' });
  });
});

describe('updateShiftSummary', () => {
  it('creates summary on first fact report', async () => {
    const { client, summaries } = makeMockPrisma();
    (client.productionOrderLine.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeLine({
        order: { id: 'po-1', shiftId: 'shift-1', status: 'IN_PROGRESS', shift: { id: 'shift-1' } },
        facts: [makeFact()],
      }),
    );

    await updateShiftSummary('line-1', client);

    expect(summaries.size).toBe(1);
    const summary = summaries.get('po-1:wc-01');
    expect((summary?.massOutput as Prisma.Decimal).toNumber()).toBe(50);
    expect(summary?.completed).toBe(false);
  });

  it('updates summary on correction before close', async () => {
    const { client, summaries, tx } = makeMockPrisma();
    summaries.set('po-1:wc-01', {
      id: 'summary-existing',
      productionOrderId: 'po-1',
      workCenterId: 'wc-01',
      completed: false,
      massOutput: new Decimal(100),
    });
    (client.productionOrderLine.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeLine({
        order: { id: 'po-1', shiftId: 'shift-1', status: 'IN_PROGRESS', shift: { id: 'shift-1' } },
        facts: [makeFact({ quantity: 80 })],
      }),
    );

    await updateShiftSummary('line-1', client);

    expect(tx.shiftSummary.upsert).toHaveBeenCalled();
    const summary = summaries.get('po-1:wc-01');
    expect((summary?.massOutput as Prisma.Decimal).toNumber()).toBe(80);
    expect(summary?.completed).toBe(false);
  });

  it('keeps completed true on NP correction after close', async () => {
    const { client, summaries } = makeMockPrisma();
    summaries.set('po-1:wc-01', {
      id: 'summary-existing',
      productionOrderId: 'po-1',
      workCenterId: 'wc-01',
      completed: true,
      completedAt: new Date('2026-08-01'),
      massOutput: new Decimal(100),
    });
    (client.productionOrderLine.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeLine({
        order: { id: 'po-1', shiftId: 'shift-1', status: 'COMPLETED', shift: { id: 'shift-1' } },
        facts: [makeFact({ quantity: 90 })],
      }),
    );

    await updateShiftSummary('line-1', client);

    const summary = summaries.get('po-1:wc-01');
    expect((summary?.massOutput as Prisma.Decimal).toNumber()).toBe(90);
    expect(summary?.completed).toBe(true);
    expect(summary?.completedAt).toBeInstanceOf(Date);
  });

  it('writes audit on update', async () => {
    const { client, auditRecords, summaries } = makeMockPrisma();
    summaries.set('po-1:wc-01', {
      id: 'summary-existing',
      productionOrderId: 'po-1',
      workCenterId: 'wc-01',
      completed: false,
      massOutput: new Decimal(0),
    });
    (client.productionOrderLine.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeLine({
        order: { id: 'po-1', shiftId: 'shift-1', status: 'IN_PROGRESS', shift: { id: 'shift-1' } },
        facts: [makeFact()],
      }),
    );

    await updateShiftSummary('line-1', client);

    expect(auditRecords.length).toBeGreaterThan(0);
    expect(auditRecords[0]).toMatchObject({ action: 'UPDATE', objectType: 'ShiftSummary' });
  });
});
