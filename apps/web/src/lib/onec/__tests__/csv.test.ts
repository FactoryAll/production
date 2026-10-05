import { describe, it, expect } from 'vitest';
import {
  CSV_BOM,
  CSV_DELIMITER,
  ONE_C_CSV_COLUMNS,
  buildOneCCsv,
  buildOneCCsvRows,
  escapeCsvValue,
  serializeCsv,
} from '../csv';
import type { OneCTaskData } from '../task-data';

const production: OneCTaskData = {
  taskType: 'PRODUCTION',
  productionOrderId: 'po-1',
  shiftNumber: 1,
  shiftDate: '2026-10-06',
  completedAt: '2026-10-06T20:15:00.000Z',
  output: [
    {
      workCenterCode: '01',
      workCenterName: 'РЦ 01',
      productCode: 'GP-001',
      productName: 'Крем; «люкс»',
      category: 'GP',
      quantity: '80.0000',
      unit: 'шт',
    },
  ],
  consumption: [
    {
      workCenterCode: '01',
      workCenterName: 'РЦ 01',
      productCode: 'M-001',
      productName: 'Масса',
      quantity: '70.25',
      unit: 'кг',
    },
  ],
};

const transfer: OneCTaskData = {
  taskType: 'TRANSFER',
  transferId: 'tr-1',
  status: 'RECONCILED',
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
  ],
};

const task = (data: OneCTaskData | null, type: 'PRODUCTION' | 'TRANSFER' = 'PRODUCTION') => ({
  type,
  status: 'PENDING' as const,
  lastChangedAt: new Date('2026-10-06T20:15:00.000Z'),
  data,
});

describe('CSV-экспорт задач для 1С (T-053, BR-7/BR-10, Р-06)', () => {
  it('экранирует кавычки и разделитель', () => {
    expect(escapeCsvValue('Крем')).toBe('Крем');
    expect(escapeCsvValue('Крем; «люкс»')).toBe('"Крем; «люкс»"');
    expect(escapeCsvValue('Кавычка " внутри')).toBe('"Кавычка "" внутри"');
    expect(escapeCsvValue('перенос\nстроки')).toBe('"перенос\nстроки"');
  });

  it('собирает строки с разделителем-точкой с запятой', () => {
    expect(serializeCsv([['a', 'b'], ['c', 'd']])).toBe('a;b\r\nc;d');
    expect(CSV_DELIMITER).toBe(';');
  });

  it('начинает файл с заголовка и BOM', () => {
    const csv = buildOneCCsv([task(production)]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.split('\r\n')[0].replace(CSV_BOM, '')).toBe(ONE_C_CSV_COLUMNS.join(';'));
  });

  it('выгружает выпуск и потребление «Производства» отдельными строками', () => {
    const rows = buildOneCCsvRows([task(production)]);
    expect(rows).toHaveLength(3);

    const output = rows[1];
    expect(output).toContain('Производство');
    expect(output).toContain('Смена 1 от 06.10.2026');
    expect(output).toContain('Выпуск');
    expect(output).toContain('ГП');
    expect(output).toContain('80.0000');

    const consumption = rows[2];
    expect(consumption).toContain('Потребление');
    expect(consumption).toContain('70.25');
  });

  it('выгружает строки Перемещения с планом и фактом', () => {
    const rows = buildOneCCsvRows([task(transfer, 'TRANSFER')]);
    expect(rows).toHaveLength(2);

    const line = rows[1];
    expect(line).toContain('Перемещение');
    expect(line).toContain('Производственный склад');
    expect(line).toContain('Склад ГП');
    expect(line).toContain('100.00');
    expect(line).toContain('98.00');
  });

  it('не теряет задачу без позиций', () => {
    const empty: OneCTaskData = { ...production, output: [], consumption: [] };
    const rows = buildOneCCsvRows([task(empty)]);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe('Производство');
    expect(rows[1][3]).toBe('2026-10-06T20:15:00.000Z');
  });

  it('не падает на нераспознанных данных', () => {
    const rows = buildOneCCsvRows([task(null)]);
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe('—');
  });

  it('отдаёт только заголовок при пустом списке', () => {
    const rows = buildOneCCsvRows([]);
    expect(rows).toHaveLength(1);
    expect(buildOneCCsv([])).toBe(CSV_BOM + ONE_C_CSV_COLUMNS.join(';'));
  });
});
