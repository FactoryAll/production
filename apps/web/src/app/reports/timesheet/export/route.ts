import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { parseReportPeriod, reportFileName } from '@/lib/reports/period';
import { getTimesheetReport, roleLabel } from '@/lib/reports/timesheet-report';
import { csvHeaders, toCsv } from '@/lib/reports/csv';

export const dynamic = 'force-dynamic';

/** Выгрузка табеля в CSV для Excel (T-093, §7 постановки). */
export async function GET(request: Request) {
  await requirePermission('reports:read');

  const params = new URL(request.url).searchParams;
  const period = parseReportPeriod({
    period: params.get('period') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    months: params.get('months') ?? undefined,
  });

  const report = await getTimesheetReport(prisma, period);

  const csv = toCsv(
    [
      'Сотрудник',
      'Табельный',
      'Дата',
      'Смена',
      'Роль',
      'Назначен',
      'Факт',
      'Часы',
      'Пометка',
    ],
    [
      ...report.rows.map((row) => [
        row.employeeName,
        row.tabNumber,
        row.shiftDate.toLocaleDateString('ru-RU'),
        row.shiftNumber,
        roleLabel(row.role),
        row.assignmentLabel,
        row.factLabel,
        row.hours ?? '',
        row.markLabel,
      ]),
      [
        'Итого',
        '',
        '',
        '',
        '',
        '',
        `смен: ${report.totals.shifts}`,
        report.totals.hours,
        `расхождений: ${report.totals.discrepancies}`,
      ],
    ],
  );

  return new Response(csv, { headers: csvHeaders(reportFileName('timesheet', period)) });
}
