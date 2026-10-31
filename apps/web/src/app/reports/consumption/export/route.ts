import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { parseReportPeriodFromSearchParams, reportFileName } from '@/lib/reports/period';
import { STOCK_CATEGORY_LABELS, getConsumptionReport } from '@/lib/reports/consumption-report';
import { csvHeaders, toCsv } from '@/lib/reports/csv';

export const dynamic = 'force-dynamic';

/**
 * Выгрузка «Потребления» в CSV для Excel (T-098).
 *
 * Один файл с первой колонкой «Разрез» — по образцу T-097 и T-101. Счётчик строк, где
 * потребление нашлось не в основном факте, идёт отдельной строкой «Справка», чтобы цифра
 * не выглядела ни потерей, ни удвоением.
 */
export async function GET(request: Request) {
  await requirePermission('reports:read');

  const params = new URL(request.url).searchParams;
  const raw = Object.fromEntries(params.entries());
  const period = parseReportPeriodFromSearchParams(raw);
  const report = await getConsumptionReport(prisma, period, {
    workCenterId: raw.workCenterId || undefined,
    productId: raw.productId || undefined
  });

  const csv = toCsv(
    ['Разрез', 'РЦ', 'Номенклатура', 'Единица', 'Категория остатка', 'Израсходовано', 'Строк ПЗ'],
    [
      ...report.workCenters.map((row) => [
        'По РЦ',
        `${row.workCenterCode} — ${row.workCenterName}`,
        `${row.productCode} — ${row.productName}`,
        row.productUnit,
        STOCK_CATEGORY_LABELS[row.stockCategory] ?? row.stockCategory,
        row.quantity,
        row.lines
      ]),
      ...report.products.map((row) => [
        'По номенклатуре',
        row.workCenterCodes.join(', '),
        `${row.productCode} — ${row.productName}`,
        row.productUnit,
        STOCK_CATEGORY_LABELS[row.stockCategory] ?? row.stockCategory,
        row.quantity,
        row.lines
      ]),
      [
        'Итого',
        '',
        '',
        '',
        `Масса ${report.totals.byCategory.MASS} · ПФ ${report.totals.byCategory.PF} · ГП ${report.totals.byCategory.GP}`,
        '',
        report.totals.lines
      ],
      [
        'Справка',
        '',
        'строк, где потребление найдено не в основном факте (до ОПЭ-38)',
        '',
        '',
        '',
        report.totals.linesWithSecondaryConsumption
      ]
    ]
  );

  return new Response(csv, { headers: csvHeaders(reportFileName('consumption', period)) });
}
