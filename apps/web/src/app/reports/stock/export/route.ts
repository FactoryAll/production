import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { parseReportPeriod, reportFileName } from '@/lib/reports/period';
import { getStockReport } from '@/lib/reports/stock-report';
import { csvHeaders, toCsv } from '@/lib/reports/csv';

export const dynamic = 'force-dynamic';

/** Выгрузка отчёта «Движение склада» в CSV для Excel (T-096). */
export async function GET(request: Request) {
  await requirePermission('reports:read');

  const params = new URL(request.url).searchParams;
  const period = parseReportPeriod({
    period: params.get('period') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    months: params.get('months') ?? undefined,
  });

  const report = await getStockReport(prisma, period);

  const csv = toCsv(
    ['Склад', 'Код', 'Номенклатура', 'Категория', 'Остаток на начало', 'Приход', 'Расход', 'Остаток на конец', 'Ед.'],
    report.rows.map((row) => [
      row.warehouseName,
      row.productCode,
      row.productName,
      row.category,
      row.opening,
      row.receipt,
      row.issue,
      row.closing,
      row.unit,
    ]),
  );

  return new Response(csv, { headers: csvHeaders(reportFileName('stock', period)) });
}
