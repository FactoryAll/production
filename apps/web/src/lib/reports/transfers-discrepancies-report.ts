import type { PrismaClient } from '@prisma/client';
import type { ReportPeriod } from './period';

/**
 * Отчёт «Перемещения и расхождения» (T-099, постановка
 * `docs/report_transfers_discrepancies.md`).
 *
 * Сроки берутся из **журнала переходов** `StageTiming` (`documentType = GOODS_TRANSFER`):
 * `SUBMITTED` → `RECEIVED`/`DISCREPANCY` → `RECONCILED`. Это единственный достоверный источник:
 * «даты приёмки» в схеме нет, а `updatedAt` меняется любым изменением документа (комментарий,
 * правка строки) — та самая ловушка, из-за которой правили карточку перемещения (ОПЭ-75).
 *
 * **Пропуски журнала.** Журнал заполнялся не всегда. Если записи `DISCREPANCY` по документу
 * нет, срок согласования показывается «—» (не ноль и не приблизительная дата), а строка
 * считается счётчиком `rowsWithoutTiming` — в подписи и в CSV (решение владельца 01.11.2026).
 *
 * **Количество — фактическое после приёмки**, план отдельной колонкой: урок ОПЭ-75.
 * «Суммы» — это количества по номенклатуре; цен и стоимости в модели нет.
 */

export type TransfersView = 'transfer' | 'discrepancy';

export interface TransferReportRow {
  transferId: string;
  status: string;
  /** Отправка из журнала; null — записи нет. */
  submittedAt: Date | null;
  /** Приёмка (RECEIVED или DISCREPANCY) из журнала; null — записи нет. */
  receivedAt: Date | null;
  sourceWarehouseName: string;
  destinationWarehouseName: string;
  productCode: string;
  productName: string;
  productUnit: string;
  plannedQuantity: number;
  /** Фактическое количество после приёмки; null — приёмки не было. */
  actualQuantity: number | null;
  /** Цикл от отправки до приёмки в часах; null — нет одной из дат журнала. */
  cycleHours: number | null;
  /** Была ли приёмка с расхождением (по записи журнала DISCREPANCY). */
  hasDiscrepancy: boolean;
}

export interface DiscrepancyReportRow {
  transferId: string;
  productCode: string;
  productName: string;
  productUnit: string;
  plannedQuantity: number;
  actualQuantity: number;
  difference: number;
  /** Приёмка с расхождением из журнала; null — записи нет. */
  discrepancyAt: Date | null;
  reconciled: boolean;
  reconciledAt: Date | null;
  /** Срок согласования в часах: от приёмки с расхождением до согласования или до «сейчас». */
  resolutionHours: number | null;
  cancelled: boolean;
}

export interface TransfersDiscrepanciesTotals {
  transfers: number;
  withDiscrepancy: number;
  notReconciled: number;
  /** Самый долгий срок согласования в часах; null — считать не по чему. */
  maxResolutionHours: number | null;
  /** Средний срок по согласованным, в часах; null — согласованных нет. */
  averageResolutionHours: number | null;
  /**
   * Строки разреза по расхождениям, где нет записи журнала (срок «—»). Показываем счётчиком,
   * чтобы пропуск не читался как ноль (решение владельца 01.11.2026).
   */
  rowsWithoutTiming: number;
  /** Перемещения без записи о приёмке: цикл «—». Отдельный счётчик — это другой пропуск. */
  transfersWithoutReceipt: number;
}

export interface TransfersDiscrepanciesReport {
  transfers: TransferReportRow[];
  discrepancies: DiscrepancyReportRow[];
  totals: TransfersDiscrepanciesTotals;
}

interface TransferRow {
  id: string;
  status: string;
  submittedAt: Date | null;
  createdAt: Date;
  sourceWarehouse: { name: string };
  destinationWarehouse: { name: string };
  lines: Array<{
    product: { code: string; name: string; unit: string };
    plannedQuantity: { toString(): string };
    actualQuantity: { toString(): string } | null;
  }>;
  discrepancies: Array<{
    transferLineId: string;
    productId: string;
    plannedQuantity: { toString(): string };
    actualQuantity: { toString(): string };
    difference: { toString(): string };
    reconciled: boolean;
    reconciledAt: Date | null;
    createdAt: Date;
    product: { code: string; name: string; unit: string };
  }>;
}

interface TimingRow {
  documentId: string;
  toStatus: string;
  transitionedAt: Date;
}

function toNumber(value: { toString(): string }): number {
  return Number(value.toString());
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Часы между двумя моментами с одним знаком — как у простоя в T-101. */
export function hoursBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 10) / 10;
}

/** Первая запись журнала по статусу — момент перехода берём самый ранний. */
function firstTiming(timings: TimingRow[], status: string): Date | null {
  const found = timings
    .filter((timing) => timing.toStatus === status)
    .sort((a, b) => a.transitionedAt.getTime() - b.transitionedAt.getTime())[0];
  return found ? found.transitionedAt : null;
}

export async function getTransfersDiscrepanciesReport(
  client: Pick<PrismaClient, 'goodsTransfer' | 'stageTiming'>,
  period: ReportPeriod,
  now: Date = new Date(),
  filter: { workCenterId?: string; productId?: string } = {}
): Promise<TransfersDiscrepanciesReport> {
  const transfers = (await client.goodsTransfer.findMany({
    where: {
      // Черновики не входят: перемещения ещё не было. Отменённые нужны в разрезе расхождений,
      // поэтому берём их тоже и решаем по разрезу.
      status: { in: ['SUBMITTED', 'RECEIVED', 'RECONCILED', 'DISCREPANCY', 'CANCELLED'] },
      // Отбор по периоду — по отправке; для разреза по расхождениям дата приёмки уточняется ниже
      // (см. §5 постановки: два разных отбора на одной странице).
      submittedAt: { gte: period.from, lte: period.to },
      ...(filter.productId ? { lines: { some: { productId: filter.productId } } } : {})
    },
    orderBy: { submittedAt: 'asc' },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      createdAt: true,
      sourceWarehouse: { select: { name: true } },
      destinationWarehouse: { select: { name: true } },
      lines: {
        select: {
          product: { select: { code: true, name: true, unit: true } },
          plannedQuantity: true,
          actualQuantity: true
        }
      },
      discrepancies: {
        select: {
          transferLineId: true,
          productId: true,
          plannedQuantity: true,
          actualQuantity: true,
          difference: true,
          reconciled: true,
          reconciledAt: true,
          createdAt: true,
          product: { select: { code: true, name: true, unit: true } }
        }
      }
    }
  })) as TransferRow[];

  const transferIds = transfers.map((transfer) => transfer.id);
  const timings = transferIds.length
    ? ((await client.stageTiming.findMany({
        where: { documentType: 'GOODS_TRANSFER', documentId: { in: transferIds } },
        select: { documentId: true, toStatus: true, transitionedAt: true }
      })) as TimingRow[])
    : [];

  const timingsByTransfer = new Map<string, TimingRow[]>();
  for (const timing of timings) {
    const list = timingsByTransfer.get(timing.documentId) ?? [];
    list.push(timing);
    timingsByTransfer.set(timing.documentId, list);
  }

  let rowsWithoutTiming = 0;
  let transfersWithoutReceipt = 0;

  const transferRows: TransferReportRow[] = [];
  for (const transfer of transfers) {
    const own = timingsByTransfer.get(transfer.id) ?? [];
    const submittedAt = firstTiming(own, 'SUBMITTED') ?? transfer.submittedAt ?? null;
    const receivedAt = firstTiming(own, 'RECEIVED') ?? firstTiming(own, 'DISCREPANCY');
    const hasDiscrepancy = firstTiming(own, 'DISCREPANCY') !== null;

    if (submittedAt && !receivedAt) {
      transfersWithoutReceipt += 1;
    }

    for (const line of transfer.lines) {
      const plannedQuantity = toNumber(line.plannedQuantity);
      const actualQuantity = line.actualQuantity === null ? null : toNumber(line.actualQuantity);

      transferRows.push({
        transferId: transfer.id,
        status: transfer.status,
        submittedAt,
        receivedAt,
        sourceWarehouseName: transfer.sourceWarehouse.name,
        destinationWarehouseName: transfer.destinationWarehouse.name,
        productCode: line.product.code,
        productName: line.product.name,
        productUnit: line.product.unit,
        plannedQuantity: round(plannedQuantity),
        // Урок ОПЭ-75: показываем фактическое количество, а не план.
        actualQuantity: actualQuantity === null ? null : round(actualQuantity),
        cycleHours: submittedAt && receivedAt ? hoursBetween(submittedAt, receivedAt) : null,
        hasDiscrepancy
      });
    }
  }

  const discrepancyRows: DiscrepancyReportRow[] = [];
  const resolutionValues: number[] = [];

  for (const transfer of transfers) {
    const own = timingsByTransfer.get(transfer.id) ?? [];
    const discrepancyAt = firstTiming(own, 'DISCREPANCY');

    for (const discrepancy of transfer.discrepancies) {
      // Срок согласования: от приёнки с расхождением до согласования (или до сейчас).
      // Нет записи журнала — срок «—» и счётчик, но НЕ дата из updatedAt (ловушка ОПЭ-75).
      const resolutionHours = discrepancyAt
        ? hoursBetween(discrepancyAt, discrepancy.reconciledAt ?? now)
        : null;

      if (resolutionHours === null) {
        rowsWithoutTiming += 1;
      } else if (discrepancy.reconciledAt) {
        resolutionValues.push(resolutionHours);
      }

      discrepancyRows.push({
        transferId: transfer.id,
        productCode: discrepancy.product.code,
        productName: discrepancy.product.name,
        productUnit: discrepancy.product.unit,
        plannedQuantity: round(toNumber(discrepancy.plannedQuantity)),
        actualQuantity: round(toNumber(discrepancy.actualQuantity)),
        difference: round(toNumber(discrepancy.difference)),
        discrepancyAt,
        reconciled: discrepancy.reconciled,
        reconciledAt: discrepancy.reconciledAt,
        resolutionHours,
        cancelled: transfer.status === 'CANCELLED'
      });
    }
  }

  // Сортировка: сначала самые долгие сроки — это и есть вопрос отчёта.
  discrepancyRows.sort((a, b) => (b.resolutionHours ?? -1) - (a.resolutionHours ?? -1));

  const reconciled = discrepancyRows.filter((row) => row.reconciled);
  const maxResolution = reconciled.reduce<number | null>((max, row) => {
    const value = row.resolutionHours;
    if (value === null) {
      return max;
    }
    return max === null ? value : Math.max(max, value);
  }, null);

  return {
    transfers: transferRows,
    discrepancies: discrepancyRows,
    totals: {
      transfers: transfers.length,
      withDiscrepancy: transfers.filter((transfer) => transfer.discrepancies.length > 0).length,
      notReconciled: discrepancyRows.filter((row) => !row.reconciled).length,
      maxResolutionHours: maxResolution,
      averageResolutionHours:
        resolutionValues.length > 0
          ? round(resolutionValues.reduce((sum, value) => sum + value, 0) / resolutionValues.length)
          : null,
      rowsWithoutTiming,
      transfersWithoutReceipt
    }
  };
}

/**
 * Пояснение под таблицей: почему у части строк срок «—».
 * Текст живёт рядом с расчётом (как в T-097/T-098/T-101), экран его не придумывает.
 */
export const MISSING_TIMING_NOTE =
  'Срок «—» означает, что в журнале переходов нет записи о приёмке с расхождением: журнал заполнялся не всегда. Дату приёмки из последнего изменения документа не восстанавливаем — она смещается от любой правки.';
