import { describe, it, expect, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { getShiftReportData } from '../shift-report-service';
import { formatDuration } from '../format';

const Decimal = Prisma.Decimal;

function makePrismaClient(overrides: {
  order?: Record<string, unknown> | null;
  summaries?: Record<string, unknown>[];
} = {}) {
  const order = {
    id: 'po-1',
    number: 'ПЗ-001',
    status: 'COMPLETED',
    shift: { id: 'shift-1', number: 1, date: new Date('2026-08-24'), start: '08:00', end: '20:00' },
    lines: [],
    ...overrides.order,
  };

  const client = {
    productionOrder: {
      findUnique: vi.fn().mockResolvedValue(order),
    },
    shiftSummary: {
      findMany: vi.fn().mockResolvedValue(overrides.summaries ?? []),
    },
  } as unknown as PrismaClient;

  return { client, order };
}

function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    orderId: 'po-1',
    workCenterId: 'wc-01',
    workCenter: { id: 'wc-01', code: '01', name: 'РЦ-1' },
    product: { id: 'mass-1', name: 'Масса', unit: 'кг' },
    plannedQuantity: new Decimal(100),
    operator: null,
    facts: [],
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
    defectQuantity: new Decimal(0),
    stopsCount: 0,
    stopsDurationMinutes: 0,
    defectReason: null,
    ...overrides,
  };
}

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'summary-1',
    productionOrderId: 'po-1',
    shiftId: 'shift-1',
    workCenterId: 'wc-01',
    workCenter: { id: 'wc-01', code: '01', name: 'РЦ-1' },
    massOutput: new Decimal(60),
    pfOutput: new Decimal(30),
    gpOutput: new Decimal(10),
    defectQuantity: new Decimal(2),
    stopsCount: 1,
    stopsDurationMinutes: 15,
    plannedQuantity: new Decimal(100),
    plannedProductIds: ['mass-1'],
    completed: true,
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    consumption: [],
    ...overrides,
  };
}

describe('formatDuration', () => {
  it('formats 0 minutes as 00:00', () => {
    expect(formatDuration(0)).toBe('00:00');
  });

  it('formats 30 minutes as 00:30', () => {
    expect(formatDuration(30)).toBe('00:30');
  });

  it('formats 90 minutes as 01:30', () => {
    expect(formatDuration(90)).toBe('01:30');
  });

  it('formats 150 minutes as 02:30', () => {
    expect(formatDuration(150)).toBe('02:30');
  });

  it('rounds fractional minutes', () => {
    expect(formatDuration(90.7)).toBe('01:31');
  });
});

describe('getShiftReportData', () => {
  it('throws when order is not found', async () => {
    const { client } = makePrismaClient({ order: null });
    client.productionOrder.findUnique = vi.fn().mockResolvedValue(null);
    await expect(getShiftReportData('missing', client)).rejects.toThrow('Производственное задание не найдено');
  });

  it('returns plan vs fact for two work centers', async () => {
    const lines = [
      makeLine({ id: 'line-1', workCenterId: 'wc-01', workCenter: { id: 'wc-01', code: '01', name: 'РЦ-1' }, plannedQuantity: 100 }),
      makeLine({ id: 'line-2', workCenterId: 'wc-02', workCenter: { id: 'wc-02', code: '02', name: 'РЦ-2' }, plannedQuantity: 200 }),
    ];
    const summaries = [
      makeSummary({ workCenterId: 'wc-01', workCenter: { id: 'wc-01', code: '01', name: 'РЦ-1' }, massOutput: 80, pfOutput: 10, gpOutput: 10 }),
      makeSummary({ id: 'summary-2', workCenterId: 'wc-02', workCenter: { id: 'wc-02', code: '02', name: 'РЦ-2' }, massOutput: 150, pfOutput: 30, gpOutput: 20 }),
    ];
    const { client } = makePrismaClient({ order: { lines }, summaries });

    const data = await getShiftReportData('po-1', client);

    expect(data.planVsFact).toHaveLength(2);
    expect(data.planVsFact[0]).toEqual({ workCenterCode: '01', workCenterName: 'РЦ-1', planned: 100, actual: 100 });
    expect(data.planVsFact[1]).toEqual({ workCenterCode: '02', workCenterName: 'РЦ-2', planned: 200, actual: 200 });
  });

  it('aggregates output structure by category', async () => {
    const summaries = [
      makeSummary({ massOutput: 100, pfOutput: 50, gpOutput: 30 }),
      makeSummary({ id: 'summary-2', workCenterId: 'wc-02', massOutput: 50, pfOutput: 0, gpOutput: 20 }),
    ];
    const { client } = makePrismaClient({ summaries });

    const data = await getShiftReportData('po-1', client);

    const mass = data.outputStructure.find((i) => i.category === 'MASS');
    const pf = data.outputStructure.find((i) => i.category === 'PF');
    const gp = data.outputStructure.find((i) => i.category === 'GP');
    expect(mass?.quantity).toBe(150);
    expect(pf?.quantity).toBe(50);
    expect(gp?.quantity).toBe(50);
  });

  it('filters zero categories from output structure', async () => {
    const summaries = [makeSummary({ massOutput: 100, pfOutput: 0, gpOutput: 0 })];
    const { client } = makePrismaClient({ summaries });

    const data = await getShiftReportData('po-1', client);

    expect(data.outputStructure).toHaveLength(1);
    expect(data.outputStructure[0].category).toBe('MASS');
  });

  it('groups defects by reason sorted descending', async () => {
    const lines = [
      makeLine({
        facts: [
          makeFact({ defectQuantity: 5, defectReason: { id: 'dr-1', name: 'Перерасход', code: 'OVER' } }),
          makeFact({ defectQuantity: 2, defectReason: { id: 'dr-2', name: 'Брак оборудования', code: 'EQUIP' } }),
          makeFact({ defectQuantity: 3, defectReason: { id: 'dr-1', name: 'Перерасход', code: 'OVER' } }),
        ],
      }),
    ];
    const { client } = makePrismaClient({ order: { lines } });

    const data = await getShiftReportData('po-1', client);

    expect(data.defectsByReason).toEqual([
      { reasonName: 'Перерасход', quantity: 8 },
      { reasonName: 'Брак оборудования', quantity: 2 },
    ]);
  });

  it('groups stops by duration ranges', async () => {
    const lines = [
      makeLine({
        facts: [
          makeFact({ stopsDurationMinutes: 10 }),
          makeFact({ stopsDurationMinutes: 20 }),
          makeFact({ stopsDurationMinutes: 45 }),
          makeFact({ stopsDurationMinutes: 75 }),
          makeFact({ stopsDurationMinutes: 5 }),
        ],
      }),
    ];
    const { client } = makePrismaClient({ order: { lines } });

    const data = await getShiftReportData('po-1', client);

    const zero15 = data.stopsByDuration.find((s) => s.durationRange === '0-15 мин');
    const fifteen30 = data.stopsByDuration.find((s) => s.durationRange === '15-30 мин');
    const thirty60 = data.stopsByDuration.find((s) => s.durationRange === '30-60 мин');
    const sixtyPlus = data.stopsByDuration.find((s) => s.durationRange === '60+ мин');
    expect(zero15?.count).toBe(2);
    expect(fifteen30?.count).toBe(1);
    expect(thirty60?.count).toBe(1);
    expect(sixtyPlus?.count).toBe(1);
    expect(zero15?.totalMinutes).toBe(15);
    expect(sixtyPlus?.totalMinutes).toBe(75);
  });

  it('aggregates consumption by product sorted descending', async () => {
    const summaries = [
      makeSummary({
        consumption: [
          { id: 'c-1', shiftSummaryId: 'summary-1', productId: 'gp-2', product: { id: 'gp-2', name: 'Упаковка', unit: 'шт' }, quantity: new Decimal(10), unit: 'шт' },
          { id: 'c-2', shiftSummaryId: 'summary-1', productId: 'gp-3', product: { id: 'gp-3', name: 'Этикетка', unit: 'шт' }, quantity: new Decimal(25), unit: 'шт' },
        ],
      }),
      makeSummary({
        id: 'summary-2',
        workCenterId: 'wc-02',
        consumption: [
          { id: 'c-3', shiftSummaryId: 'summary-2', productId: 'gp-2', product: { id: 'gp-2', name: 'Упаковка', unit: 'шт' }, quantity: new Decimal(7), unit: 'шт' },
        ],
      }),
    ];
    const { client } = makePrismaClient({ summaries });

    const data = await getShiftReportData('po-1', client);

    expect(data.consumptionByProduct).toHaveLength(2);
    expect(data.consumptionByProduct[0]).toEqual({ productName: 'Этикетка', quantity: 25, unit: 'шт' });
    expect(data.consumptionByProduct[1]).toEqual({ productName: 'Упаковка', quantity: 17, unit: 'шт' });
  });


  it('returns empty metrics for read_own with no assigned work centers', async () => {
    const lines = [
      makeLine({ id: 'line-1', workCenterId: 'wc-01', operatorId: 'emp-1' }),
      makeLine({ id: 'line-2', workCenterId: 'wc-02', operatorId: 'emp-2' }),
    ];
    const summaries = [makeSummary({ workCenterId: 'wc-02' })];
    const { client } = makePrismaClient({ order: { lines }, summaries });

    const data = await getShiftReportData('po-1', client, ['production_order:read_own'], 'emp-3');

    expect(data.planVsFact).toHaveLength(0);
    expect(data.summaries).toHaveLength(0);
    expect(data.outputStructure).toHaveLength(0);
    expect(data.consumptionByProduct).toHaveLength(0);
  });

  it('gives full access when both read and read_own are present', async () => {
    const lines = [
      makeLine({ id: 'line-1', workCenterId: 'wc-01', operatorId: 'emp-1' }),
      makeLine({ id: 'line-2', workCenterId: 'wc-02', operatorId: 'emp-2' }),
    ];
    const summaries = [makeSummary({ workCenterId: 'wc-01' }), makeSummary({ id: 'summary-2', workCenterId: 'wc-02' })];
    const { client } = makePrismaClient({ order: { lines }, summaries });

    const data = await getShiftReportData('po-1', client, ['production_order:read', 'production_order:read_own'], 'emp-1');

    expect(data.planVsFact).toHaveLength(2);
    expect(data.summaries).toHaveLength(2);
  });

  it('filters outputStructure to own work centers', async () => {
    const lines = [
      makeLine({ id: 'line-1', workCenterId: 'wc-01', operatorId: 'emp-1' }),
      makeLine({ id: 'line-2', workCenterId: 'wc-02', operatorId: 'emp-2' }),
    ];
    const summaries = [
      makeSummary({ workCenterId: 'wc-01', massOutput: new Decimal(20), pfOutput: new Decimal(5), gpOutput: new Decimal(0) }),
      makeSummary({ id: 'summary-2', workCenterId: 'wc-02', massOutput: new Decimal(100), pfOutput: new Decimal(0), gpOutput: new Decimal(0) }),
    ];
    const { client } = makePrismaClient({ order: { lines }, summaries });

    const data = await getShiftReportData('po-1', client, ['production_order:read_own'], 'emp-1');

    expect(data.outputStructure).toHaveLength(2);
    const mass = data.outputStructure.find((i) => i.category === 'MASS');
    expect(mass?.quantity).toBe(20);
  });


describe('getShiftReportData ownership filtering', () => {
  it('shows all work centers for users with production_order:read', async () => {
    const lines = [
      makeLine({ id: 'line-1', workCenterId: 'wc-01', operatorId: 'emp-1' }),
      makeLine({ id: 'line-2', workCenterId: 'wc-02', operatorId: 'emp-2' }),
    ];
    const summaries = [
      makeSummary({ workCenterId: 'wc-01' }),
      makeSummary({ id: 'summary-2', workCenterId: 'wc-02' }),
    ];
    const { client } = makePrismaClient({ order: { lines }, summaries });

    const data = await getShiftReportData('po-1', client, ['production_order:read'], 'emp-1');

    expect(data.planVsFact).toHaveLength(2);
    expect(data.summaries).toHaveLength(2);
  });

  it('filters to own work center for production_order:read_own only', async () => {
    const lines = [
      makeLine({ id: 'line-1', workCenterId: 'wc-01', operatorId: 'emp-1' }),
      makeLine({ id: 'line-2', workCenterId: 'wc-02', operatorId: 'emp-2' }),
    ];
    const summaries = [
      makeSummary({ workCenterId: 'wc-01' }),
      makeSummary({ id: 'summary-2', workCenterId: 'wc-02' }),
    ];
    const { client } = makePrismaClient({ order: { lines }, summaries });

    const data = await getShiftReportData('po-1', client, ['production_order:read_own'], 'emp-1');

    expect(data.planVsFact).toHaveLength(1);
    expect(data.planVsFact[0].workCenterCode).toBe('01');
    expect(data.summaries).toHaveLength(1);
    expect(data.summaries[0].workCenterId).toBe('wc-01');
  });

  it('aggregates consumption only from own work centers', async () => {
    const lines = [
      makeLine({ id: 'line-1', workCenterId: 'wc-01', operatorId: 'emp-1' }),
      makeLine({ id: 'line-2', workCenterId: 'wc-02', operatorId: 'emp-2' }),
    ];
    const summaries = [
      makeSummary({
        workCenterId: 'wc-01',
        consumption: [{ id: 'c-1', shiftSummaryId: 'summary-1', productId: 'gp-2', product: { id: 'gp-2', name: 'Упаковка', unit: 'шт' }, quantity: new Decimal(10), unit: 'шт' }],
      }),
      makeSummary({
        id: 'summary-2',
        workCenterId: 'wc-02',
        consumption: [{ id: 'c-2', shiftSummaryId: 'summary-2', productId: 'gp-2', product: { id: 'gp-2', name: 'Упаковка', unit: 'шт' }, quantity: new Decimal(99), unit: 'шт' }],
      }),
    ];
    const { client } = makePrismaClient({ order: { lines }, summaries });

    const data = await getShiftReportData('po-1', client, ['production_order:read_own'], 'emp-1');

    expect(data.consumptionByProduct).toHaveLength(1);
    expect(data.consumptionByProduct[0].quantity).toBe(10);
  });

  it('excludes defects and stops from other operators', async () => {
    const lines = [
      makeLine({
        id: 'line-1',
        workCenterId: 'wc-01',
        operatorId: 'emp-1',
        facts: [makeFact({ stopsDurationMinutes: 10, defectQuantity: 1, defectReason: { id: 'dr-1', name: 'Перерасход', code: 'OVER' } })],
      }),
      makeLine({
        id: 'line-2',
        workCenterId: 'wc-02',
        operatorId: 'emp-2',
        facts: [makeFact({ stopsDurationMinutes: 75, defectQuantity: 5, defectReason: { id: 'dr-2', name: 'Брак', code: 'DEF' } })],
      }),
    ];
    const { client } = makePrismaClient({ order: { lines } });

    const data = await getShiftReportData('po-1', client, ['production_order:read_own'], 'emp-1');

    expect(data.defectsByReason).toHaveLength(1);
    expect(data.defectsByReason[0].reasonName).toBe('Перерасход');
    expect(data.stopsByDuration).toHaveLength(1);
    expect(data.stopsByDuration[0].durationRange).toBe('0-15 мин');
  });
});
});
