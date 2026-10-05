import { Prisma, type FactCategory, type GoodsTransferStatus } from '@prisma/client';

/**
 * Структурированные данные задачи для 1С (M12 §4.1, §8).
 *
 * Модуль чистый: принимает загруженные записи и возвращает JSON-совместимый набор
 * реквизитов для копирования в 1С. Запись в БД — в \`lib/onec/tasks.ts\`.
 */

/** Значения Decimal приходят из Prisma как Decimal, но тесты и сид могут передать number/string. */
export type DecimalLike = Prisma.Decimal | number | string;

/** Точность количеств берётся из точности колонок-источников в схеме. */
export const QUANTITY_SCALE = {
  /** ProductionFact.quantity — Decimal(18, 4). */
  output: 4,
  /** FactConsumption.quantity — Decimal(10, 2). */
  consumption: 2,
  /** TransferLine.plannedQuantity / actualQuantity — Decimal(10, 2). */
  transfer: 2,
} as const;

export interface OneCOutputLine {
  workCenterCode: string;
  workCenterName: string;
  productCode: string;
  productName: string;
  category: FactCategory;
  quantity: string;
  unit: string;
}

export interface OneCConsumptionLine {
  workCenterCode: string;
  workCenterName: string;
  productCode: string;
  productName: string;
  quantity: string;
  unit: string;
}

/** Данные документа «Производство»: выпуск (Масса и ГП, включая ПФ) и потребление (Р-10). */
export interface OneCProductionTaskData {
  taskType: 'PRODUCTION';
  productionOrderId: string;
  shiftNumber: number;
  /** Дата смены в формате YYYY-MM-DD (Р-05). */
  shiftDate: string;
  /** Момент завершения ПЗ (итог смены сформирован) в ISO-8601 или null. */
  completedAt: string | null;
  output: OneCOutputLine[];
  consumption: OneCConsumptionLine[];
}

export interface OneCTransferLine {
  productCode: string;
  productName: string;
  plannedQuantity: string;
  actualQuantity: string | null;
  unit: string;
}

/** Данные документа «Перемещение» (BR-3). */
export interface OneCTransferTaskData {
  taskType: 'TRANSFER';
  transferId: string;
  /** Актуальный статус Перемещения на момент последней синхронизации (BR-9). */
  status: GoodsTransferStatus;
  sourceWarehouse: string;
  destinationWarehouse: string;
  submittedAt: string | null;
  lines: OneCTransferLine[];
}

export interface OneCProductionSource {
  id: string;
  completedAt: Date | null;
  shift: { number: number; date: Date };
  lines: Array<{
    workCenter: { code: string; name: string };
    product: { code: string; name: string; unit: string };
    facts: Array<{
      factCategory: FactCategory;
      quantity: DecimalLike;
      consumptions: Array<{
        quantity: DecimalLike;
        product: { code: string; name: string; unit: string };
      }>;
    }>;
  }>;
}

export interface OneCTransferSource {
  id: string;
  status: GoodsTransferStatus;
  submittedAt: Date | null;
  sourceWarehouse: { name: string };
  destinationWarehouse: { name: string };
  lines: Array<{
    product: { code: string; name: string; unit: string };
    plannedQuantity: DecimalLike;
    actualQuantity: DecimalLike | null;
  }>;
}

function toDecimal(value: DecimalLike): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function formatQuantity(value: DecimalLike, scale: number): string {
  return toDecimal(value).toFixed(scale);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Порядок строк фиксирован: сначала РЦ, затем номенклатура — данные должны быть стабильны между синхронизациями. */
function compareLines(
  a: { workCenterCode: string; productCode: string },
  b: { workCenterCode: string; productCode: string },
): number {
  return (
    a.workCenterCode.localeCompare(b.workCenterCode) || a.productCode.localeCompare(b.productCode)
  );
}

/**
 * Данные документа «Производство» (BR-2, BR-6, Р-10).
 *
 * Задача формируется на ПЗ (одна смена — один документ 1С). Выпуск — факты по строкам РЦ
 * (Масса, ГП, ПФ), потребление — потреблённые Масса/ПФ (Р-10). Брак и остановки в документ
 * 1С не входят: M12 §8 требует номенклатуру, количество и потребление.
 */
export function buildProductionTaskData(order: OneCProductionSource): OneCProductionTaskData {
  const output = new Map<string, OneCOutputLine>();
  const consumption = new Map<string, OneCConsumptionLine>();

  for (const line of order.lines) {
    const workCenterCode = line.workCenter.code;
    const workCenterName = line.workCenter.name;

    for (const fact of line.facts) {
      const quantity = toDecimal(fact.quantity);
      if (quantity.greaterThan(0)) {
        const key = `${workCenterCode}|${line.product.code}|${fact.factCategory}`;
        const existing = output.get(key);
        if (existing) {
          existing.quantity = formatQuantity(
            toDecimal(existing.quantity).plus(quantity),
            QUANTITY_SCALE.output,
          );
        } else {
          output.set(key, {
            workCenterCode,
            workCenterName,
            productCode: line.product.code,
            productName: line.product.name,
            category: fact.factCategory,
            quantity: formatQuantity(quantity, QUANTITY_SCALE.output),
            unit: line.product.unit,
          });
        }
      }

      for (const item of fact.consumptions) {
        const consumed = toDecimal(item.quantity);
        if (!consumed.greaterThan(0)) continue;
        const key = `${workCenterCode}|${item.product.code}`;
        const existing = consumption.get(key);
        if (existing) {
          existing.quantity = formatQuantity(
            toDecimal(existing.quantity).plus(consumed),
            QUANTITY_SCALE.consumption,
          );
        } else {
          consumption.set(key, {
            workCenterCode,
            workCenterName,
            productCode: item.product.code,
            productName: item.product.name,
            quantity: formatQuantity(consumed, QUANTITY_SCALE.consumption),
            unit: item.product.unit,
          });
        }
      }
    }
  }

  return {
    taskType: 'PRODUCTION',
    productionOrderId: order.id,
    shiftNumber: order.shift.number,
    shiftDate: formatDate(order.shift.date),
    completedAt: order.completedAt ? order.completedAt.toISOString() : null,
    output: Array.from(output.values()).sort(compareLines),
    consumption: Array.from(consumption.values()).sort(compareLines),
  };
}

/** Данные документа «Перемещение» (BR-3): склад-источник, склад-получатель и строки ГП. */
export function buildTransferTaskData(transfer: OneCTransferSource): OneCTransferTaskData {
  const lines = transfer.lines.map((line) => ({
    productCode: line.product.code,
    productName: line.product.name,
    plannedQuantity: formatQuantity(line.plannedQuantity, QUANTITY_SCALE.transfer),
    actualQuantity:
      line.actualQuantity === null
        ? null
        : formatQuantity(line.actualQuantity, QUANTITY_SCALE.transfer),
    unit: line.product.unit,
  }));

  lines.sort((a, b) => a.productCode.localeCompare(b.productCode));

  return {
    taskType: 'TRANSFER',
    transferId: transfer.id,
    status: transfer.status,
    sourceWarehouse: transfer.sourceWarehouse.name,
    destinationWarehouse: transfer.destinationWarehouse.name,
    submittedAt: transfer.submittedAt ? transfer.submittedAt.toISOString() : null,
    lines,
  };
}

/** Объединённый тип данных задачи — используется списком и CSV-экспортом (BR-7, BR-10). */
export type OneCTaskData = OneCProductionTaskData | OneCTransferTaskData;
