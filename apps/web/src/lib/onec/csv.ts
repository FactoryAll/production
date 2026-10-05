import type { TaskForOneCStatus, TaskForOneCType } from '@prisma/client';
import type { OneCTaskData } from './task-data';
import { factCategoryLabel, oneCStatusLabel, oneCTypeLabel, taskDocumentLabel } from './labels';

/**
 * CSV-экспорт задач для 1С (T-053, M12 §8, BR-7/BR-10, Р-06/Р-24).
 *
 * Один файл по задачам обоих типов (PRODUCTION и TRANSFER): строка CSV — одна позиция
 * документа (выпуск, потребление либо строка Перемещения). Модуль чистый и не обращается к БД.
 */

/** Разделитель — точка с запятой: русская локаль Excel не разбирает запятую как разделитель. */
export const CSV_DELIMITER = ';';

/** BOM нужен, чтобы Excel открыл файл в UTF-8 и не испортил кириллицу. */
export const CSV_BOM = '\uFEFF';

export const ONE_C_CSV_COLUMNS = [
  'Тип',
  'Документ',
  'Статус',
  'Последнее изменение',
  'Смена',
  'Дата смены',
  'Склад-источник',
  'Склад-получатель',
  'РЦ',
  'Код номенклатуры',
  'Номенклатура',
  'Категория',
  'Вид строки',
  'Количество',
  'Ед.',
  'Фактически принято',
] as const;

export interface OneCCsvTask {
  type: TaskForOneCType;
  status: TaskForOneCStatus;
  lastChangedAt: Date | string;
  data: OneCTaskData | null;
}

/** Экранирование значения: кавычки, разделитель и переводы строк оборачиваются в кавычки. */
export function escapeCsvValue(value: string): string {
  if (/[";\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function serializeCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvValue).join(CSV_DELIMITER)).join('\r\n');
}

function isoDateTime(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function emptyRow(task: OneCCsvTask): string[] {
  const document = taskDocumentLabel(task.data);
  return [
    oneCTypeLabel(task.type),
    document,
    oneCStatusLabel(task.status),
    isoDateTime(task.lastChangedAt),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ];
}

/** Строки CSV: заголовок и по одной строке на позицию документа (Р-06, Р-24). */
export function buildOneCCsvRows(tasks: OneCCsvTask[]): string[][] {
  const rows: string[][] = [[...ONE_C_CSV_COLUMNS]];

  for (const task of tasks) {
    const data = task.data;
    const base = (): string[] => [
      oneCTypeLabel(task.type),
      taskDocumentLabel(data),
      oneCStatusLabel(task.status),
      isoDateTime(task.lastChangedAt),
      data?.taskType === 'PRODUCTION' ? String(data.shiftNumber) : '',
      data?.taskType === 'PRODUCTION' ? data.shiftDate : '',
      data?.taskType === 'TRANSFER' ? data.sourceWarehouse : '',
      data?.taskType === 'TRANSFER' ? data.destinationWarehouse : '',
    ];

    if (!data) {
      rows.push(emptyRow(task));
      continue;
    }

    if (data.taskType === 'TRANSFER') {
      if (data.lines.length === 0) {
        rows.push([...base(), '', '', '', 'Перемещение', '', '', '']);
        continue;
      }
      for (const line of data.lines) {
        rows.push([
          ...base(),
          '',
          line.productCode,
          line.productName,
          '',
          'Перемещение',
          line.plannedQuantity,
          line.unit,
          line.actualQuantity ?? '',
        ]);
      }
      continue;
    }

    if (data.output.length === 0 && data.consumption.length === 0) {
      rows.push([...base(), '', '', '', '', '', '', '']);
      continue;
    }

    for (const line of data.output) {
      rows.push([
        ...base(),
        line.workCenterName,
        line.productCode,
        line.productName,
        factCategoryLabel(line.category),
        'Выпуск',
        line.quantity,
        line.unit,
        '',
      ]);
    }

    for (const line of data.consumption) {
      rows.push([
        ...base(),
        line.workCenterName,
        line.productCode,
        line.productName,
        '',
        'Потребление',
        line.quantity,
        line.unit,
        '',
      ]);
    }
  }

  return rows;
}

/** Готовый CSV-файл: BOM + заголовок + строки. */
export function buildOneCCsv(tasks: OneCCsvTask[]): string {
  return CSV_BOM + serializeCsv(buildOneCCsvRows(tasks));
}
