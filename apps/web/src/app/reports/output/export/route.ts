import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { parseReportPeriodFromSearchParams, reportFileName } from '@/lib/reports/period';
import { getOutputReport } from '@/lib/reports/output-report';
import { csvHeaders, toCsv } from '@/lib/reports/csv';

export const dynamic = 'force-dynamic';

/** Выгрузка отчёта «Выпуск по РЦ» в CSV для Excel (T-095). */
export async function GET(request: Request) {
  await requirePermission('reports:read');

  const params = new URL(request.url).searchParams;
  // Тот же разбор, что на экране: смена приходит с датой, иначе выгрузка «по смене»
  // строила бы период от сегодняшнего дня (найдено при переделке фильтров 29.10.2026).
  const period = parseReportPeriodFromSearchParams(Object.fromEntries(params.entries()));

  const report = await getOutputReport(prisma, period);

  const csv = toCsv(
    ['РЦ', 'План Масса', 'План ГП', 'Факт Масса', 'Факт ПФ', 'Факт ГП', 'Брак', 'Выполнение, %'],
    [
      ...report.rows.map((row) => [
        `${row.code} — ${row.name}`,
        row.plannedMass,
        row.plannedGp,
        row.factMass,
        row.factPf,
        row.factGp,
        row.defect,
        row.completionPercent ?? '',
      ]),
      [
        'Итого',
        report.totals.plannedMass,
        report.totals.plannedGp,
        report.totals.factMass,
        report.totals.factPf,
        report.totals.factGp,
        report.totals.defect,
        report.totals.completionPercent ?? '',
      ],
    ],
  );

  return new Response(csv, { headers: csvHeaders(reportFileName('output', period)) });
}
