import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  NO_OPERATOR_LABEL,
  NO_REASON_LABEL,
  defectSharePercent,
  getDefectStopsReport,
  stopsHoursFromMinutes,
} from '../defect-stops-report';
import { parseReportPeriod } from '../period';

/**
 * Брак и простои (T-101).
 *
 * Главное, что здесь закрепляется: простои считаются **по строке один раз**, значение берётся
 * с основного факта через `pickPrimaryFact` (для старых данных, где ОПЭ-73 задвоил их в оба
 * факта), брак без причины идёт отдельной строкой, а простой на человека приписывается
 * только оператору строки.
 */
const PERIOD = parseReportPeriod({ period: 'months', months: '2026-10', now: new Date('2026-10-20T10:00:00') });
const IVANOV = { id: 'emp-1', fullName: 'Иванов И.И.' };

function fact(overrides: {
  lineId?: string;
  workCenter?: { code: string; name: string };
  productCategory?: string;
  category?: string;
  quantity?: number;
  defect?: number;
  reason?: { code: string; name: string } | null;
  stopsCount?: number;
  stopsMinutes?: number;
  operator?: typeof IVANOV | null;
  status?: string;
} = {}) {
  return {
    factCategory: overrides.category ?? 'GP',
    quantity: { toString: () => String(overrides.quantity ?? 0) },
    defectQuantity: { toString: () => String(overrides.defect ?? 0) },
    stopsCount: overrides.stopsCount ?? 0,
    stopsDurationMinutes: overrides.stopsMinutes ?? 0,
    defectReason: overrides.reason ?? null,
    line: {
      id: overrides.lineId ?? 'line-1',
      operator: overrides.operator ?? null,
      workCenter: overrides.workCenter ?? { code: '03', name: 'Тубировка крем' },
      product: { category: overrides.productCategory ?? 'GP' },
      orderId: 'po-1',
      order: { status: overrides.status ?? 'COMPLETED' },
    },
  };
}

function fakeClient(facts: unknown[]) {
  const findMany = vi.fn().mockResolvedValue(facts);
  return { client: { productionFact: { findMany } } as unknown as PrismaClient, findMany };
}

describe('брак и простои: условие выборки', () => {
  it('период по дате смены, отменённые ПЗ исключены', async () => {
    const { client, findMany } = fakeClient([]);
    await getDefectStopsReport(client, PERIOD);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          line: {
            order: {
              status: { not: 'CANCELLED' },
              shift: { date: { gte: PERIOD.from, lte: PERIOD.to } },
            },
          },
        },
      }),
    );
  });
});

describe('брак и простои: простои по строке один раз', () => {
  // ОПЭ-73: в старых данных простой лежит в каждом факте строки (ГП и ПФ).
  it('старые данные с простоем в двух фактах дают простой строки один раз', async () => {
    const { client } = fakeClient([
      fact({ category: 'GP', productCategory: 'GP', quantity: 10, stopsCount: 2, stopsMinutes: 30 }),
      fact({ category: 'PF', productCategory: 'GP', quantity: 4, stopsCount: 2, stopsMinutes: 30 }),
    ]);

    const report = await getDefectStopsReport(client, PERIOD);

    expect(report.workCenters[0].stopsMinutes).toBe(30);
    expect(report.workCenters[0].stopsCount).toBe(2);
    expect(report.workCenters[0].linesWithStops).toBe(1);
    expect(report.totals.stopsMinutes).toBe(30);
    expect(report.totals.stopsHours).toBe(0.5);
  });

  it('основной факт определяется категорией продукции строки, а не порядком в выборке', async () => {
    // ПФ идёт первой в выборке, но основная категория строки — ГП.
    const { client } = fakeClient([
      fact({ category: 'PF', productCategory: 'GP', stopsMinutes: 10 }),
      fact({ category: 'GP', productCategory: 'GP', stopsMinutes: 30 }),
    ]);

    const report = await getDefectStopsReport(client, PERIOD);
    expect(report.totals.stopsMinutes).toBe(30);
  });

  // Предупреждение главной линии: на проде могут найтись старые строки, где основной факт пуст,
  // а второй несёт минуты. Показывать ноль значило бы «потерять» простой — берём из неосновного
  // и помечаем счётчиком.
  it('старые строки, где основной факт без простоя, не теряют минуты', async () => {
    const { client } = fakeClient([
      fact({ category: 'GP', productCategory: 'GP', quantity: 10 }),
      fact({ category: 'PF', productCategory: 'GP', quantity: 4, stopsCount: 1, stopsMinutes: 25 }),
    ]);

    const report = await getDefectStopsReport(client, PERIOD);

    expect(report.totals.stopsMinutes).toBe(25);
    expect(report.totals.linesWithSecondaryStops).toBe(1);
    expect(report.totals.linesWithStops).toBe(1);
  });

  it('два неосновных факта с минутами не складываются: это дубли одного события', async () => {
    const { client } = fakeClient([
      fact({ category: 'MASS', productCategory: 'GP', quantity: 10 }),
      fact({ category: 'GP', productCategory: 'GP', stopsMinutes: 30 }),
      fact({ category: 'PF', productCategory: 'GP', stopsMinutes: 30 }),
    ]);

    const report = await getDefectStopsReport(client, PERIOD);
    // Основной для строки — ГП (категория продукции), он несёт 30; PF-дубль не удваивает.
    expect(report.totals.stopsMinutes).toBe(30);
    expect(report.totals.linesWithSecondaryStops).toBe(0);
  });

  it('когда основной факт с простоем — неосновные не участвуют', async () => {
    const { client } = fakeClient([
      fact({ category: 'GP', productCategory: 'GP', stopsCount: 2, stopsMinutes: 30 }),
      fact({ category: 'PF', productCategory: 'GP', stopsMinutes: 45 }),
    ]);

    const report = await getDefectStopsReport(client, PERIOD);
    expect(report.totals.stopsMinutes).toBe(30);
    expect(report.totals.linesWithSecondaryStops).toBe(0);
  });

  it('часы простоя — минуты / 60 с одним знаком', () => {
    expect(stopsHoursFromMinutes(30)).toBe(0.5);
    expect(stopsHoursFromMinutes(270)).toBe(4.5);
    expect(stopsHoursFromMinutes(100)).toBe(1.7);
    expect(stopsHoursFromMinutes(0)).toBe(0);
  });

  it('строки без простоя не считаются в «строк с простоем»', async () => {
    const { client } = fakeClient([
      fact({ lineId: 'line-1', quantity: 5 }),
      fact({ lineId: 'line-2', quantity: 5, stopsCount: 1, stopsMinutes: 15 }),
    ]);

    const report = await getDefectStopsReport(client, PERIOD);
    expect(report.totals.linesWithStops).toBe(1);
    expect(report.totals.stopsMinutes).toBe(15);
  });
});

describe('брак и простои: брак по причинам и категориям', () => {
  it('причины брака собираются отдельными строками, «без причины» — последней', async () => {
    const { client } = fakeClient([
      fact({ category: 'GP', quantity: 10, defect: 2, reason: { code: 'DEFECT_A', name: 'Брак A' } }),
      fact({ lineId: 'line-2', category: 'MASS', quantity: 100, defect: 5, reason: null }),
    ]);

    const report = await getDefectStopsReport(client, PERIOD);

    expect(report.reasons.map((row) => row.name)).toEqual(['Брак A', NO_REASON_LABEL]);
    expect(report.reasons[1]).toMatchObject({ code: null, defect: { mass: 5, gp: 0, pf: 0 } });
    // Сумма брака по причинам равна общему браку периода.
    const sumGp = report.reasons.reduce((sum, row) => sum + row.defect.gp, 0);
    expect(sumGp).toBe(report.totals.defect.gp);
  });

  it('причина помнит, в каких РЦ встречалась', async () => {
    const { client } = fakeClient([
      fact({ lineId: 'line-1', workCenter: { code: '03', name: 'Тубировка' }, defect: 1, reason: { code: 'A', name: 'A' } }),
      fact({ lineId: 'line-2', workCenter: { code: '05', name: 'Линия' }, defect: 2, reason: { code: 'A', name: 'A' } }),
    ]);

    const report = await getDefectStopsReport(client, PERIOD);
    expect(report.reasons[0].workCenterCodes).toEqual(['03', '05']);
  });

  it('брак не вычитается из выпуска, доля считается внутри категории', async () => {
    const { client } = fakeClient([
      fact({ category: 'GP', quantity: 10, defect: 2 }),
      fact({ lineId: 'line-2', category: 'MASS', quantity: 100, defect: 10 }),
    ]);

    const report = await getDefectStopsReport(client, PERIOD);

    expect(report.totals.output).toEqual({ mass: 100, gp: 10, pf: 0 });
    expect(report.totals.defect).toEqual({ mass: 10, gp: 2, pf: 0 });
    // Доля по категориям: 10% и 20%, а не 12 из 110.
    expect(defectSharePercent(report.totals.output, report.totals.defect)).toEqual({
      mass: 10,
      gp: 20,
      pf: 0,
    });
  });
});

describe('брак и простои: простой по операторам', () => {
  it('простой строки приписан её оператору', async () => {
    const { client } = fakeClient([
      fact({ lineId: 'line-1', operator: IVANOV, stopsCount: 1, stopsMinutes: 90 }),
      fact({ lineId: 'line-2', operator: IVANOV, stopsCount: 1, stopsMinutes: 30 }),
    ]);

    const report = await getDefectStopsReport(client, PERIOD);

    expect(report.operatorStops).toEqual([
      { employeeId: 'emp-1', employeeName: 'Иванов И.И.', stopsMinutes: 120, stopsHours: 2 },
    ]);
  });

  it('строка без оператора идёт в «Без персональной привязки» последней', async () => {
    const { client } = fakeClient([
      fact({ lineId: 'line-1', operator: null, stopsMinutes: 30 }),
      fact({ lineId: 'line-2', operator: IVANOV, stopsMinutes: 60 }),
    ]);

    const report = await getDefectStopsReport(client, PERIOD);

    expect(report.operatorStops.map((row) => row.employeeName)).toEqual([
      'Иванов И.И.',
      NO_OPERATOR_LABEL,
    ]);
    // Итог по людям сходится с общим простоем — для этого строка без привязки и нужна.
    const sum = report.operatorStops.reduce((total, row) => total + row.stopsMinutes, 0);
    expect(sum).toBe(report.totals.stopsMinutes);
  });

  it('работникам простой не приписывается: их нет в блоке операторов', async () => {
    const { client } = fakeClient([
      // У строки есть оператор и простой; работники в отчёте простоев не участвуют.
      fact({ lineId: 'line-1', operator: IVANOV, stopsMinutes: 30 }),
    ]);

    const report = await getDefectStopsReport(client, PERIOD);
    expect(report.operatorStops).toHaveLength(1);
    expect(report.operatorStops[0].employeeId).toBe('emp-1');
  });
});

describe('брак и простои: пустой период', () => {
  it('пустые разрезы и нулевые итоги', async () => {
    const { client } = fakeClient([]);
    const report = await getDefectStopsReport(client, PERIOD);

    expect(report.workCenters).toEqual([]);
    expect(report.reasons).toEqual([]);
    expect(report.operatorStops).toEqual([]);
    expect(report.totals).toMatchObject({ stopsMinutes: 0, stopsHours: 0, linesWithStops: 0 });
  });
});
