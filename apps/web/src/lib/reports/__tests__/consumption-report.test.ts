import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { SECONDARY_CONSUMPTION_NOTE, getConsumptionReport } from '../consumption-report';
import { parseReportPeriod } from '../period';

/**
 * Потребление (T-098).
 *
 * Тесты фиксируют определения, а не цифры: единица — строка потребления с **категорией
 * остатка**; РЦ берётся у строки ПЗ, а не у склада; дубли снимаются правилом, уже принятым
 * для простоев (значение с основного факта, иначе максимум по дублям со счётчиком); количество
 * берётся из данных (`FactConsumption`), планового потребления в модели нет — урок ОПЭ-75.
 */
const PERIOD = parseReportPeriod({
  period: 'months',
  months: '2026-10',
  now: new Date('2026-10-20T10:00:00')
});

const MASS_PRODUCT = { code: 'MASS001', name: 'Масса крем А', unit: 'кг', category: 'MASS' };
const GP_PRODUCT = { code: 'GP002', name: 'Готовая продукция Б', unit: 'шт', category: 'GP' };
const CREAM = { code: 'MAT100', name: 'Крем', unit: 'кг' };

function consumption(
  overrides: {
    productId?: string;
    product?: { code: string; name: string; unit: string };
    quantity?: number;
    stockCategory?: string;
  } = {}
) {
  return {
    productId: overrides.productId ?? 'mat-100',
    product: overrides.product ?? CREAM,
    quantity: { toString: () => String(overrides.quantity ?? 10) },
    stockCategory: overrides.stockCategory ?? 'MASS'
  };
}

function line(
  overrides: {
    id?: string;
    workCenter?: { code: string; name: string };
    product?: { code: string; name: string; unit: string; category: string };
    facts?: Array<{ factCategory: string; consumptions: unknown[] }>;
    status?: string;
  } = {}
) {
  const product = overrides.product ?? MASS_PRODUCT;
  return {
    id: overrides.id ?? 'line-1',
    productId: product.code,
    orderId: 'po-1',
    workCenter: overrides.workCenter ?? { code: '03', name: 'Тубировка крем' },
    product,
    order: { status: overrides.status ?? 'COMPLETED' },
    facts: overrides.facts ?? [{ factCategory: product.category, consumptions: [consumption()] }]
  };
}

function fakeClient(lines: unknown[]) {
  const findMany = vi.fn().mockResolvedValue(lines);
  return { client: { productionOrderLine: { findMany } } as unknown as PrismaClient, findMany };
}

describe('потребление: условие выборки', () => {
  it('период по дате смены, отменённые ПЗ исключены', async () => {
    const { client, findMany } = fakeClient([]);
    await getConsumptionReport(client, PERIOD);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          order: {
            status: { not: 'CANCELLED' },
            shift: { date: { gte: PERIOD.from, lte: PERIOD.to } }
          }
        }
      })
    );
  });

  // Урок ОПЭ-75: отчёт показывает то, что лежит в данных. Здесь это означает, что поле
  // количества берётся из FactConsumption, а не откуда-то из плана (планового потребления
  // в модели нет вовсе) — проверяем саму выборку полей.
  it('количество берётся из строк потребления факта (не из плана)', async () => {
    const { client, findMany } = fakeClient([]);
    await getConsumptionReport(client, PERIOD);

    const args = findMany.mock.calls[0][0] as {
      select: { facts: { select: { consumptions: { select: Record<string, boolean> } } } };
    };
    expect(Object.keys(args.select.facts.select.consumptions.select)).toEqual(
      expect.arrayContaining(['quantity', 'stockCategory', 'productId', 'product'])
    );
    expect(args.select.facts.select.consumptions.select).not.toHaveProperty('plannedQuantity');
  });

  it('фильтры по РЦ и номенклатуре сужают выборку', async () => {
    const { client, findMany } = fakeClient([]);
    await getConsumptionReport(client, PERIOD, { workCenterId: 'wc-03', productId: 'gp-2' });

    const where = (findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ workCenterId: 'wc-03', productId: 'gp-2' });
  });
});

describe('потребление: единица и категория остатка', () => {
  it('категория остатка хранится в строке и не выводится из номенклатуры', async () => {
    // Одна номенклатура ГП списана с двух разных остатков — это разные строки (ОПЭ-34).
    const { client } = fakeClient([
      line({
        facts: [
          {
            factCategory: 'GP',
            consumptions: [
              consumption({
                productId: 'gp-2',
                product: GP_PRODUCT,
                quantity: 5,
                stockCategory: 'GP'
              }),
              consumption({
                productId: 'gp-2',
                product: GP_PRODUCT,
                quantity: 2,
                stockCategory: 'PF'
              })
            ]
          }
        ]
      })
    ]);

    const report = await getConsumptionReport(client, PERIOD);

    // Порядок категорий — Масса → ПФ → ГП, поэтому ПФ идёт раньше ГП.
    expect(
      report.products.map((row) => [row.productCode, row.stockCategory, row.quantity])
    ).toEqual([
      ['GP002', 'PF', 2],
      ['GP002', 'GP', 5]
    ]);
  });

  it('РЦ берётся у строки ПЗ и виден в разрезе по номенклатуре', async () => {
    const { client } = fakeClient([
      line({ id: 'line-1', workCenter: { code: '03', name: 'Тубировка' } }),
      line({ id: 'line-2', workCenter: { code: '05', name: 'Линия' } })
    ]);

    const report = await getConsumptionReport(client, PERIOD);

    expect(report.products[0].workCenterCodes).toEqual(['03', '05']);
    expect(report.workCenters.map((row) => row.workCenterCode)).toEqual(['03', '05']);
  });

  it('строки ПЗ считаются по уникальным строкам, а не по фактам', async () => {
    const { client } = fakeClient([line({ id: 'line-1' }), line({ id: 'line-1' })]);
    const report = await getConsumptionReport(client, PERIOD);
    expect(report.totals.lines).toBe(1);
  });
});

describe('потребление: дубли и старые данные (правило T-101)', () => {
  it('одна номенклатура в двух фактах строки не даёт двойного расхода', async () => {
    // ОПЭ-38 до правки: расход писали в каждый факт строки (ГП и ПФ).
    const { client } = fakeClient([
      line({
        product: GP_PRODUCT,
        facts: [
          { factCategory: 'GP', consumptions: [consumption({ quantity: 10 })] },
          { factCategory: 'PF', consumptions: [consumption({ quantity: 10 })] }
        ]
      })
    ]);

    const report = await getConsumptionReport(client, PERIOD);

    expect(report.totals.byCategory.MASS).toBe(10);
    // Основной факт (категория продукции строки — ГП) нёс значение, поэтому это не «вторичное».
    expect(report.totals.linesWithSecondaryConsumption).toBe(0);
  });

  it('если в основном факте расхода нет, а в другом есть — берём оттуда и считаем счётчиком', async () => {
    const { client } = fakeClient([
      line({
        product: GP_PRODUCT,
        facts: [
          { factCategory: 'GP', consumptions: [] },
          { factCategory: 'PF', consumptions: [consumption({ quantity: 7 })] }
        ]
      })
    ]);

    const report = await getConsumptionReport(client, PERIOD);

    expect(report.totals.byCategory.MASS).toBe(7);
    expect(report.totals.linesWithSecondaryConsumption).toBe(1);
    // Счётчик объясняется текстом рядом с расчётом, а не придумывается в разметке.
    expect(SECONDARY_CONSUMPTION_NOTE).toContain('не в основном факте');
  });

  it('два дубля в одном ключе не складываются: максимум', async () => {
    const { client } = fakeClient([
      line({
        product: GP_PRODUCT,
        facts: [
          { factCategory: 'GP', consumptions: [consumption({ quantity: 10 })] },
          { factCategory: 'PF', consumptions: [consumption({ quantity: 10 })] }
        ]
      })
    ]);

    const report = await getConsumptionReport(client, PERIOD);
    expect(report.products[0].quantity).toBe(10);
  });
});

describe('потребление: порядок и пустой период', () => {
  it('категории идут Масса → ПФ → ГП, внутри — по коду номенклатуры', async () => {
    const { client } = fakeClient([
      line({
        id: 'line-gp',
        product: GP_PRODUCT,
        facts: [{ factCategory: 'GP', consumptions: [consumption({ stockCategory: 'GP' })] }]
      }),
      line({
        id: 'line-pf',
        product: { code: 'PF003', name: 'Полуфабрикат', unit: 'шт', category: 'PF' },
        facts: [{ factCategory: 'PF', consumptions: [consumption({ stockCategory: 'PF' })] }]
      }),
      line({ id: 'line-mass', product: MASS_PRODUCT })
    ]);

    const report = await getConsumptionReport(client, PERIOD);

    expect(report.products.map((row) => row.stockCategory)).toEqual(['MASS', 'PF', 'GP']);
  });

  it('пустой период — пустые разрезы и нулевые итоги', async () => {
    const { client } = fakeClient([]);
    const report = await getConsumptionReport(client, PERIOD);

    expect(report.workCenters).toEqual([]);
    expect(report.products).toEqual([]);
    expect(report.totals).toEqual({
      byCategory: { MASS: 0, PF: 0, GP: 0 },
      lines: 0,
      linesWithSecondaryConsumption: 0
    });
  });
});
