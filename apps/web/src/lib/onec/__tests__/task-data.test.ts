import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  buildProductionTaskData,
  buildTransferTaskData,
  QUANTITY_SCALE,
  type OneCProductionSource,
  type OneCTransferSource,
} from '../task-data';

const Decimal = Prisma.Decimal;

const workCenter = (code: string, name = `РЦ ${code}`) => ({ code, name });
const product = (code: string, name: string, unit = 'кг') => ({ code, name, unit });

const fact = (
  factCategory: 'MASS' | 'GP' | 'PF',
  quantity: number | string,
  consumptions: OneCProductionSource['lines'][number]['facts'][number]['consumptions'] = [],
) => ({ factCategory, quantity: new Decimal(quantity), consumptions });

function makeOrder(overrides: Partial<OneCProductionSource> = {}): OneCProductionSource {
  return {
    id: 'po-1',
    completedAt: new Date('2026-10-06T20:15:00.000Z'),
    shift: { number: 2, date: new Date('2026-10-06T00:00:00.000Z') },
    lines: [
      {
        workCenter: workCenter('03'),
        product: product('M-001', 'Масса'),
        facts: [fact('MASS', '120.5')],
      },
      {
        workCenter: workCenter('01'),
        product: product('GP-001', 'Крем', 'шт'),
        facts: [
          fact('GP', '80', [
            { quantity: new Decimal('70.25'), product: product('M-001', 'Масса') },
          ]),
        ],
      },
    ],
    ...overrides,
  };
}

describe('buildProductionTaskData', () => {
  it('builds output lines for MASS and GP with units and schema scale', () => {
    const data = buildProductionTaskData(makeOrder());

    expect(data.taskType).toBe('PRODUCTION');
    expect(data.productionOrderId).toBe('po-1');
    expect(data.shiftNumber).toBe(2);
    expect(data.shiftDate).toBe('2026-10-06');
    expect(data.completedAt).toBe('2026-10-06T20:15:00.000Z');

    expect(data.output).toEqual([
      {
        workCenterCode: '01',
        workCenterName: 'РЦ 01',
        productCode: 'GP-001',
        productName: 'Крем',
        category: 'GP',
        quantity: '80.0000',
        unit: 'шт',
      },
      {
        workCenterCode: '03',
        workCenterName: 'РЦ 03',
        productCode: 'M-001',
        productName: 'Масса',
        category: 'MASS',
        quantity: '120.5000',
        unit: 'кг',
      },
    ]);
  });

  it('includes consumption (Р-10) with consumption scale', () => {
    const data = buildProductionTaskData(makeOrder());

    expect(data.consumption).toEqual([
      {
        workCenterCode: '01',
        workCenterName: 'РЦ 01',
        productCode: 'M-001',
        productName: 'Масса',
        quantity: '70.25',
        unit: 'кг',
      },
    ]);
  });

  it('aggregates repeated facts of the same category and skips non-positive quantities', () => {
    const data = buildProductionTaskData(
      makeOrder({
        lines: [
          {
            workCenter: workCenter('01'),
            product: product('GP-001', 'Крем'),
            facts: [fact('GP', '10'), fact('GP', '2.5'), fact('MASS', '0')],
          },
        ],
      }),
    );

    expect(data.output).toHaveLength(1);
    expect(data.output[0].quantity).toBe('12.5000');
  });

  it('sorts output deterministically by РЦ and nomenclature', () => {
    const data = buildProductionTaskData(makeOrder());
    const keys = data.output.map((line) => `${line.workCenterCode}|${line.productCode}`);
    expect(keys).toEqual([...keys].sort());
  });

  it('returns null completedAt when the summary is not formed yet', () => {
    const data = buildProductionTaskData(makeOrder({ completedAt: null }));
    expect(data.completedAt).toBeNull();
  });

  it('keeps an empty output when there are no facts', () => {
    const data = buildProductionTaskData(
      makeOrder({ lines: [{ workCenter: workCenter('01'), product: product('GP-001', 'Крем'), facts: [] }] }),
    );
    expect(data.output).toEqual([]);
    expect(data.consumption).toEqual([]);
  });

  it('uses the scale declared for the source columns', () => {
    expect(QUANTITY_SCALE).toEqual({ output: 4, consumption: 2, transfer: 2 });
  });
});

function makeTransfer(overrides: Partial<OneCTransferSource> = {}): OneCTransferSource {
  return {
    id: 'tr-1',
    status: 'SUBMITTED',
    submittedAt: new Date('2026-10-06T09:00:00.000Z'),
    sourceWarehouse: { name: 'Производственный склад' },
    destinationWarehouse: { name: 'Склад ГП' },
    lines: [
      {
        product: product('GP-002', 'Бальзам', 'шт'),
        plannedQuantity: new Decimal('30'),
        actualQuantity: null,
      },
      {
        product: product('GP-001', 'Крем', 'шт'),
        plannedQuantity: new Decimal('100'),
        actualQuantity: new Decimal('98'),
      },
    ],
    ...overrides,
  };
}

describe('buildTransferTaskData', () => {
  it('builds the Перемещение document with warehouses, status and sorted lines', () => {
    const data = buildTransferTaskData(makeTransfer());

    expect(data).toEqual({
      taskType: 'TRANSFER',
      transferId: 'tr-1',
      status: 'SUBMITTED',
      sourceWarehouse: 'Производственный склад',
      destinationWarehouse: 'Склад ГП',
      submittedAt: '2026-10-06T09:00:00.000Z',
      lines: [
        {
          productCode: 'GP-001',
          productName: 'Крем',
          plannedQuantity: '100.00',
          actualQuantity: '98.00',
          unit: 'шт',
        },
        {
          productCode: 'GP-002',
          productName: 'Бальзам',
          plannedQuantity: '30.00',
          actualQuantity: null,
          unit: 'шт',
        },
      ],
    });
  });

  it('reflects the latest source status (BR-9)', () => {
    const data = buildTransferTaskData(makeTransfer({ status: 'RECONCILED', submittedAt: null }));
    expect(data.status).toBe('RECONCILED');
    expect(data.submittedAt).toBeNull();
  });
});
