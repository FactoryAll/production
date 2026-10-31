import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { parseReportPeriodFromSearchParams, reportFileName } from '@/lib/reports/period';
import { getDefectStopsReport } from '@/lib/reports/defect-stops-report';
import { csvHeaders, toCsv } from '@/lib/reports/csv';

export const dynamic = 'force-dynamic';

/**
 * Выгрузка «Брака и простоев» в CSV для Excel (T-101).
 *
 * Один файл с первой колонкой «Разрез» — так в Excel можно отфильтровать разрез по РЦ
 * от разреза по причинам (по образцу T-097, где первой идёт «Блок»).
 */
export async function GET(request: Request) {
  await requirePermission('reports:read');

  const params = new URL(request.url).searchParams;
  const period = parseReportPeriodFromSearchParams(Object.fromEntries(params.entries()));
  const report = await getDefectStopsReport(prisma, period);

  const csv = toCsv(
    [
      'Разрез',
      'РЦ / причина',
      'Выпуск Масса',
      'Выпуск ГП',
      'Выпуск ПФ',
      'Брак Масса',
      'Брак ГП',
      'Брак ПФ',
      'Остановок',
      'Простой, мин',
      'Простой, ч',
      'Строк с простоем',
    ],
    [
      ...report.workCenters.map((row) => [
        'По РЦ',
        `${row.code} — ${row.name}`,
        row.output.mass,
        row.output.gp,
        row.output.pf,
        row.defect.mass,
        row.defect.gp,
        row.defect.pf,
        row.stopsCount,
        row.stopsMinutes,
        row.stopsHours,
        row.linesWithStops,
      ]),
      ...report.reasons.map((row) => [
        'По причинам',
        row.code ? `${row.code} — ${row.name}` : row.name,
        '',
        '',
        '',
        row.defect.mass,
        row.defect.gp,
        row.defect.pf,
        '',
        '',
        '',
        row.workCenterCodes.join(', '),
      ]),
      ...report.operatorStops.map((row) => [
        'Простой по операторам',
        row.employeeName,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        row.stopsMinutes,
        row.stopsHours,
        '',
      ]),
      [
        'Итого',
        '',
        report.totals.output.mass,
        report.totals.output.gp,
        report.totals.output.pf,
        report.totals.defect.mass,
        report.totals.defect.gp,
        report.totals.defect.pf,
        report.totals.stopsCount,
        report.totals.stopsMinutes,
        report.totals.stopsHours,
        report.totals.linesWithStops,
      ],
      [
        'Справка',
        'строк с простоем в неосновном факте (до ОПЭ-73)',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        report.totals.linesWithSecondaryStops,
      ],
    ],
  );

  return new Response(csv, { headers: csvHeaders(reportFileName('defect-stops', period)) });
}
