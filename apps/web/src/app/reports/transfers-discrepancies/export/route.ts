import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { parseReportPeriodFromSearchParams, reportFileName } from '@/lib/reports/period';
import { getTransfersDiscrepanciesReport } from '@/lib/reports/transfers-discrepancies-report';
import { csvHeaders, toCsv } from '@/lib/reports/csv';

export const dynamic = 'force-dynamic';

/**
 * Выгрузка «Перемещений и расхождений» в CSV для Excel (T-099).
 *
 * Один файл с первой колонкой «Разрез» (как в T-097/T-098). Строка «Справка» несёт счётчик
 * пропусков журнала: «—» в сроке означает «нет записи», а не ноль (решение владельца 01.11.2026).
 */
export async function GET(request: Request) {
  await requirePermission('reports:read');

  const params = new URL(request.url).searchParams;
  const raw = Object.fromEntries(params.entries());
  const period = parseReportPeriodFromSearchParams(raw);
  const report = await getTransfersDiscrepanciesReport(prisma, period, new Date(), {
    productId: raw.productId || undefined
  });

  const formatDate = (value: Date | null) => (value === null ? '' : value.toISOString());

  const csv = toCsv(
    [
      'Разрез',
      'Перемещение',
      'Номенклатура',
      'План',
      'Принято',
      'Разница',
      'Статус',
      'Отправлено',
      'Приёмка с расхождением',
      'Согласовано',
      'Цикл, ч',
      'Срок согласования, ч'
    ],
    [
      ...report.transfers.map((row) => [
        'По перемещениям',
        row.transferId,
        `${row.productCode} — ${row.productName} (${row.productUnit})`,
        row.plannedQuantity,
        row.actualQuantity ?? '',
        '',
        row.status,
        formatDate(row.submittedAt),
        formatDate(row.receivedAt),
        '',
        row.cycleHours ?? '',
        ''
      ]),
      ...report.discrepancies.map((row) => [
        'По расхождениям',
        row.transferId,
        `${row.productCode} — ${row.productName} (${row.productUnit})`,
        row.plannedQuantity,
        row.actualQuantity,
        row.difference,
        row.cancelled ? 'CANCELLED' : row.reconciled ? 'RECONCILED' : 'DISCREPANCY',
        '',
        formatDate(row.discrepancyAt),
        formatDate(row.reconciledAt),
        '',
        row.resolutionHours ?? ''
      ]),
      [
        'Итого',
        `перемещений: ${report.totals.transfers}`,
        `с расхождением: ${report.totals.withDiscrepancy}`,
        '',
        '',
        `не согласовано: ${report.totals.notReconciled}`,
        '',
        '',
        '',
        `макс: ${report.totals.maxResolutionHours ?? ''} ч`,
        '',
        `средний: ${report.totals.averageResolutionHours ?? ''} ч`
      ],
      [
        'Справка',
        'без записи журнала о приёмке',
        `расхождений: ${report.totals.rowsWithoutTiming}`,
        `перемещений: ${report.totals.transfersWithoutReceipt}`,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        ''
      ]
    ]
  );

  return new Response(csv, {
    headers: csvHeaders(reportFileName('transfers-discrepancies', period))
  });
}
