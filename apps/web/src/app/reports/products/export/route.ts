import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { parseReportPeriod, reportFileName } from '@/lib/reports/period';
import { getOutputReport } from '@/lib/reports/output-report';
import { csvHeaders, toCsv } from '@/lib/reports/csv';

export const dynamic = 'force-dynamic';

const CATEGORY_LABELS = { MASS: 'Масса', PF: 'ПФ', GP: 'ГП' } as const;

/** Выгрузка отчёта «Выпуск по ГП/ПФ» в CSV для Excel (T-102). */
export async function GET(request: Request) {
  await requirePermission('reports:read');

  const params = new URL(request.url).searchParams;
  const period = parseReportPeriod({
    period: params.get('period') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    months: params.get('months') ?? undefined,
  });

  const rawCategory = params.get('category');
  const category =
    rawCategory === 'MASS' || rawCategory === 'PF' || rawCategory === 'GP' ? rawCategory : undefined;

  const report = await getOutputReport(prisma, period, 'product', { category });

  // При выбранной категории в файл идут только её план и факт — как и на экране.
  const headers = category
    ? ['Номенклатура', `План ${CATEGORY_LABELS[category]}`, `Факт ${CATEGORY_LABELS[category]}`, 'Брак', 'Выполнение, %']
    : ['Номенклатура', 'План Масса', 'План ГП', 'Факт Масса', 'Факт ПФ', 'Факт ГП', 'Брак', 'Выполнение, %'];

  const pick = (row: typeof report.rows[number]) => {
    if (!category) {
      return [row.code + ' — ' + row.name, row.plannedMass, row.plannedGp, row.factMass, row.factPf, row.factGp, row.defect, row.completionPercent ?? ''];
    }
    const planned = category === 'MASS' ? row.plannedMass : category === 'GP' ? row.plannedGp : 0;
    const fact = category === 'MASS' ? row.factMass : category === 'GP' ? row.factGp : row.factPf;
    return [row.code + ' — ' + row.name, planned, fact, row.defect, row.completionPercent ?? ''];
  };

  const csv = toCsv(headers, [
    ...report.rows.map(pick),
    ['Итого', ...pick({ ...report.rows[0], ...report.totals, code: '', name: '' } as never).slice(1)],
  ]);

  return new Response(csv, { headers: csvHeaders(reportFileName('products', period)) });
}
