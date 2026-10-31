import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  MISSING_TIMING_NOTE,
  getTransfersDiscrepanciesReport,
  hoursBetween
} from '../transfers-discrepancies-report';
import { parseReportPeriod } from '../period';

/**
 * Перемещения и расхождения (T-099).
 *
 * Сроки — из журнала переходов `StageTiming`; `updatedAt` не используется (ловушка ОПЭ-75).
 * Пропуск в журнале даёт срок «—» и счётчик, а не ноль и не приблизительную дату
 * (решение владельца 01.11.2026). Количество — фактическое после приёмки.
 */
const PERIOD = parseReportPeriod({
  period: 'months',
  months: '2026-10',
  now: new Date('2026-10-20T10:00:00')
});
const NOW = new Date('2026-10-20T12:00:00');

function transfer(
  overrides: {
    id?: string;
    status?: string;
    submittedAt?: Date | null;
    lines?: Array<{ planned?: number; actual?: number | null }>;
    discrepancies?: Array<{
      reconciled?: boolean;
      reconciledAt?: Date | null;
      difference?: number;
    }>;
  } = {}
) {
  const lines = overrides.lines ?? [{ planned: 40, actual: null }];
  return {
    id: overrides.id ?? 'tr-1',
    status: overrides.status ?? 'SUBMITTED',
    submittedAt: overrides.submittedAt ?? new Date('2026-10-10T09:00:00'),
    createdAt: new Date('2026-10-09T09:00:00'),
    sourceWarehouse: { name: 'Производственный склад' },
    destinationWarehouse: { name: 'Склад ГП' },
    lines: lines.map((line) => ({
      product: { code: 'GP002', name: 'Готовая продукция Б', unit: 'шт' },
      plannedQuantity: { toString: () => String(line.planned ?? 40) },
      actualQuantity:
        line.actual === null || line.actual === undefined
          ? null
          : { toString: () => String(line.actual) }
    })),
    discrepancies: (overrides.discrepancies ?? []).map((item) => ({
      transferLineId: 'tl-1',
      productId: 'gp-2',
      plannedQuantity: { toString: () => '40' },
      actualQuantity: { toString: () => '37' },
      difference: { toString: () => String(item.difference ?? -3) },
      reconciled: item.reconciled ?? false,
      reconciledAt: item.reconciledAt ?? null,
      createdAt: new Date('2026-10-11T09:00:00'),
      product: { code: 'GP002', name: 'Готовая продукция Б', unit: 'шт' }
    }))
  };
}

function fakeClient(transfers: unknown[], timings: unknown[]) {
  const goodsTransferFindMany = vi.fn().mockResolvedValue(transfers);
  const stageTimingFindMany = vi.fn().mockResolvedValue(timings);
  const client = {
    goodsTransfer: { findMany: goodsTransferFindMany },
    stageTiming: { findMany: stageTimingFindMany }
  } as unknown as PrismaClient;
  return { client, goodsTransferFindMany, stageTimingFindMany };
}

describe('сроки: базовые величины', () => {
  it('часы между моментами — с одним знаком', () => {
    expect(hoursBetween(new Date('2026-10-10T09:00:00'), new Date('2026-10-10T11:30:00'))).toBe(
      2.5
    );
    expect(hoursBetween(new Date('2026-10-10T09:00:00'), new Date('2026-10-11T09:00:00'))).toBe(24);
  });

  it('выборка: без черновиков, период по отправке, журнал — по id документов', async () => {
    const { client, goodsTransferFindMany, stageTimingFindMany } = fakeClient([], []);
    await getTransfersDiscrepanciesReport(client, PERIOD, NOW);

    const where = (goodsTransferFindMany.mock.calls[0][0] as { where: Record<string, unknown> })
      .where;
    expect(where).toMatchObject({ status: { in: expect.not.arrayContaining(['DRAFT']) } });
    expect(where).toMatchObject({ submittedAt: { gte: PERIOD.from, lte: PERIOD.to } });
    // Документов нет — журнал не читаем вовсе (лишний запрос ни к чему).
    expect(stageTimingFindMany).not.toHaveBeenCalled();
  });
});

describe('цикл перемещения', () => {
  it('цикл считается от отправки до приёмки по журналу', async () => {
    const { client } = fakeClient(
      [transfer({ status: 'RECEIVED', lines: [{ planned: 40, actual: 40 }] })],
      [
        {
          documentId: 'tr-1',
          toStatus: 'SUBMITTED',
          transitionedAt: new Date('2026-10-10T09:00:00')
        },
        {
          documentId: 'tr-1',
          toStatus: 'RECEIVED',
          transitionedAt: new Date('2026-10-10T13:00:00')
        }
      ]
    );

    const report = await getTransfersDiscrepanciesReport(client, PERIOD, NOW);
    expect(report.transfers[0]).toMatchObject({ cycleHours: 4, actualQuantity: 40 });
  });

  it('принятое количество — фактическое, план отдельным полем (урок ОПЭ-75)', async () => {
    const { client } = fakeClient(
      [transfer({ status: 'RECEIVED', lines: [{ planned: 40, actual: 37 }] })],
      [
        {
          documentId: 'tr-1',
          toStatus: 'SUBMITTED',
          transitionedAt: new Date('2026-10-10T09:00:00')
        },
        {
          documentId: 'tr-1',
          toStatus: 'RECEIVED',
          transitionedAt: new Date('2026-10-10T13:00:00')
        }
      ]
    );

    const report = await getTransfersDiscrepanciesReport(client, PERIOD, NOW);
    expect(report.transfers[0]).toMatchObject({ actualQuantity: 37, plannedQuantity: 40 });
  });

  it('без записи приёмки в журнале цикла нет — «—», а не ноль', async () => {
    const { client } = fakeClient(
      [transfer({ status: 'SUBMITTED' })],
      [
        {
          documentId: 'tr-1',
          toStatus: 'SUBMITTED',
          transitionedAt: new Date('2026-10-10T09:00:00')
        }
      ]
    );

    const report = await getTransfersDiscrepanciesReport(client, PERIOD, NOW);
    expect(report.transfers[0].cycleHours).toBeNull();
    expect(report.transfers[0].actualQuantity).toBeNull();
  });
});

describe('срок согласования', () => {
  it('считается от приёмки с расхождением до согласования', async () => {
    const { client } = fakeClient(
      [
        transfer({
          status: 'RECONCILED',
          lines: [{ planned: 40, actual: 37 }],
          discrepancies: [{ reconciled: true, reconciledAt: new Date('2026-10-12T09:00:00') }]
        })
      ],
      [
        {
          documentId: 'tr-1',
          toStatus: 'SUBMITTED',
          transitionedAt: new Date('2026-10-10T09:00:00')
        },
        {
          documentId: 'tr-1',
          toStatus: 'DISCREPANCY',
          transitionedAt: new Date('2026-10-11T09:00:00')
        },
        {
          documentId: 'tr-1',
          toStatus: 'RECONCILED',
          transitionedAt: new Date('2026-10-12T09:00:00')
        }
      ]
    );

    const report = await getTransfersDiscrepanciesReport(client, PERIOD, NOW);
    expect(report.discrepancies[0]).toMatchObject({
      resolutionHours: 24,
      reconciled: true,
      difference: -3
    });
    expect(report.totals.maxResolutionHours).toBe(24);
    expect(report.totals.averageResolutionHours).toBe(24);
  });

  it('незакрытое расхождение считает возраст до текущего момента', async () => {
    const { client } = fakeClient(
      [
        transfer({
          status: 'DISCREPANCY',
          lines: [{ planned: 40, actual: 37 }],
          discrepancies: [{}]
        })
      ],
      [
        {
          documentId: 'tr-1',
          toStatus: 'SUBMITTED',
          transitionedAt: new Date('2026-10-10T09:00:00')
        },
        {
          documentId: 'tr-1',
          toStatus: 'DISCREPANCY',
          transitionedAt: new Date('2026-10-19T12:00:00')
        }
      ]
    );

    const report = await getTransfersDiscrepanciesReport(client, PERIOD, NOW);
    expect(report.discrepancies[0].resolutionHours).toBe(24);
    expect(report.discrepancies[0].reconciled).toBe(false);
    expect(report.totals.notReconciled).toBe(1);
    // В максимум/среднее входят только согласованные.
    expect(report.totals.maxResolutionHours).toBeNull();
    expect(report.totals.averageResolutionHours).toBeNull();
  });

  // Дополнение владельца: журнал заполнялся не всегда.
  it('нет записи DISCREPANCY — срок «—» и счётчик, а не ноль и не updatedAt', async () => {
    const { client } = fakeClient(
      [
        transfer({
          status: 'RECONCILED',
          lines: [{ planned: 40, actual: 37 }],
          discrepancies: [{ reconciled: true, reconciledAt: new Date('2026-10-12T09:00:00') }]
        })
      ],
      // В журнале есть только отправка: записи о приёмке с расхождением нет.
      [
        {
          documentId: 'tr-1',
          toStatus: 'SUBMITTED',
          transitionedAt: new Date('2026-10-10T09:00:00')
        }
      ]
    );

    const report = await getTransfersDiscrepanciesReport(client, PERIOD, NOW);

    expect(report.discrepancies[0].resolutionHours).toBeNull();
    expect(report.discrepancies[0].discrepancyAt).toBeNull();
    expect(report.totals.rowsWithoutTiming).toBe(1);
    // Пропуск записи о приёмке — отдельный счётчик (цикл «—»), а не тот же счётчик дважды.
    expect(report.totals.transfersWithoutReceipt).toBe(1);
    expect(MISSING_TIMING_NOTE).toContain('журнале переходов нет записи');
  });
});

describe('итоги и отменённые', () => {
  it('итоги: перемещения, с расхождением, не согласовано', async () => {
    const { client } = fakeClient(
      [
        transfer({ id: 'tr-1', status: 'RECEIVED', lines: [{ planned: 10, actual: 10 }] }),
        transfer({
          id: 'tr-2',
          status: 'DISCREPANCY',
          discrepancies: [{ reconciled: false }]
        })
      ],
      [
        {
          documentId: 'tr-1',
          toStatus: 'SUBMITTED',
          transitionedAt: new Date('2026-10-10T09:00:00')
        },
        {
          documentId: 'tr-1',
          toStatus: 'RECEIVED',
          transitionedAt: new Date('2026-10-10T12:00:00')
        },
        {
          documentId: 'tr-2',
          toStatus: 'SUBMITTED',
          transitionedAt: new Date('2026-10-11T09:00:00')
        },
        {
          documentId: 'tr-2',
          toStatus: 'DISCREPANCY',
          transitionedAt: new Date('2026-10-11T12:00:00')
        }
      ]
    );

    const report = await getTransfersDiscrepanciesReport(client, PERIOD, NOW);
    expect(report.totals).toMatchObject({ transfers: 2, withDiscrepancy: 1, notReconciled: 1 });
  });

  it('отменённое перемещение с расхождением попадает с пометкой отмены', async () => {
    const { client } = fakeClient(
      [transfer({ status: 'CANCELLED', discrepancies: [{ reconciled: false }] })],
      [
        {
          documentId: 'tr-1',
          toStatus: 'SUBMITTED',
          transitionedAt: new Date('2026-10-10T09:00:00')
        },
        {
          documentId: 'tr-1',
          toStatus: 'DISCREPANCY',
          transitionedAt: new Date('2026-10-11T09:00:00')
        },
        {
          documentId: 'tr-1',
          toStatus: 'CANCELLED',
          transitionedAt: new Date('2026-10-12T09:00:00')
        }
      ]
    );

    const report = await getTransfersDiscrepanciesReport(client, PERIOD, NOW);
    expect(report.discrepancies[0]).toMatchObject({ cancelled: true, reconciled: false });
  });

  it('пустой период — пустые разрезы и нулевые итоги', async () => {
    const { client } = fakeClient([], []);
    const report = await getTransfersDiscrepanciesReport(client, PERIOD, NOW);

    expect(report.transfers).toEqual([]);
    expect(report.discrepancies).toEqual([]);
    expect(report.totals).toMatchObject({
      transfers: 0,
      withDiscrepancy: 0,
      notReconciled: 0,
      maxResolutionHours: null,
      averageResolutionHours: null,
      rowsWithoutTiming: 0,
      transfersWithoutReceipt: 0
    });
  });
});
