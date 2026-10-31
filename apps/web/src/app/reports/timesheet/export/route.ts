import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { parseReportPeriodFromSearchParams, reportFileName } from '@/lib/reports/period';
import { getTimesheetReport, roleLabel } from '@/lib/reports/timesheet-report';
import { csvHeaders, toCsv } from '@/lib/reports/csv';

export const dynamic = 'force-dynamic';

/** Выгрузка табеля в CSV для Excel (T-093, §7 постановки). */
export async function GET(request: Request) {
  await requirePermission('reports:read');

  const params = new URL(request.url).searchParams;
  // Тот же разбор, что на экране: смена приходит с датой, иначе выгрузка «по смене»
  // строила бы период от сегодняшнего дня (найдено при переделке фильтров 29.10.2026).
  const period = parseReportPeriodFromSearchParams(Object.fromEntries(params.entries()));

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
