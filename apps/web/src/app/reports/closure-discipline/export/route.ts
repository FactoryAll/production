import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { parseReportPeriodFromSearchParams, reportFileName } from '@/lib/reports/period';
import { getClosureDisciplineReport } from '@/lib/reports/closure-discipline-report';
import { csvHeaders, toCsv } from '@/lib/reports/csv';

export const dynamic = 'force-dynamic';

/** Выгрузка отчёта «Дисциплина закрытия ПЗ» в CSV для Excel (T-100). */
export async function GET(request: Request) {
  await requirePermission('reports:read');

  const params = new URL(request.url).searchParams;
  // Тот же разбор, что на экране: выгрузка не может показывать другой период (ОПЭ-70).
  const period = parseReportPeriodFromSearchParams(Object.fromEntries(params.entries()));

  const report = await getClosureDisciplineReport(prisma, period);

  const csv = toCsv(
    ['ПЗ', 'Смена', 'Статус', 'РЦ', 'Строк', 'Отчиталось', 'Операторы', 'Висит, дней', 'Просрочено'],
    [
      ...report.rows.map((row) => [
        row.orderId.slice(0, 8),
        `${row.shiftNumber} от ${row.shiftDate.toLocaleDateString('ru-RU')}`,
        row.status,
        row.workCenters
          .map((workCenter) => `${workCenter.code} (${workCenter.reported ? 'отчитался' : 'не отчитался'})`)
          .join(', '),
        row.linesTotal,
        row.linesReported,
        row.operators ?? '',
        row.daysHanging,
        row.overdue ? 'да' : 'нет',
      ]),
      [
        'Итого',
        '',
        '',
        '',
        '',
        `незакрытых: ${report.totals.unclosed}`,
        '',
        `макс. срок: ${report.totals.maxDays}`,
        `просрочено: ${report.totals.overdue}`,
      ],
    ],
  );

  return new Response(csv, { headers: csvHeaders(reportFileName('closure-discipline', period)) });
}
