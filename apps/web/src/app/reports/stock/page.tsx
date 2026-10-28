import Link from 'next/link';
import { prisma } from '@prodtrack/db';
import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';
import {
  parseReportPeriodFromSearchParams,
  reportPeriodQuery,
  toDateInputValue,
} from '@/lib/reports/period';
import { buildWeekOptions } from '@/lib/reports/weeks';
import { getStockReport } from '@/lib/reports/stock-report';
import { PeriodForm } from '../_components/period-form';

export const dynamic = 'force-dynamic';

/** Отчёт «Движение склада» (T-096). */
export default async function StockReportPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const access = await checkPageAccess('reports:read');
  if (!access.allowed) {
    return (
      <AccessDenied action="просмотр отчётов" allowedRoles={['NP', 'ADM', 'S1C', 'OTK']} requiredPermission="reports:read" />
    );
  }

  const period = parseReportPeriodFromSearchParams(searchParams);

  const [report, shifts] = await Promise.all([
    getStockReport(prisma, period),
    prisma.shift.findMany({
      orderBy: { date: 'desc' },
      take: 30,
      select: { id: true, number: true, date: true },
    }),
  ]);

  const query = reportPeriodQuery(period);
  // Недели для фильтра: только те, в которые есть смены (29.10.2026).
  const weeks = buildWeekOptions(shifts.map((shift) => shift.date));

  return (
    <main className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-graphite">Движение склада</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/reports" className="text-deep-industry-blue underline decoration-dotted underline-offset-2">
            К списку отчётов
          </Link>
          <a
            href={`/reports/stock/export?${query.toString()}`}
            className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
          >
            Выгрузить в Excel
          </a>
        </div>
      </div>

      <PeriodForm
        action="/reports/stock"
        period={period.mode}
        months={period.months}
        from={toDateInputValue(period.from)}
        to={toDateInputValue(period.to)}
        shifts={shifts.map((shift) => ({
          id: shift.id,
          date: toDateInputValue(shift.date),
          label: `Смена ${shift.number} от ${shift.date.toLocaleDateString('ru-RU')}`,
        }))}
        weeks={weeks}
      />

      <p className="text-sm text-steel-graphite">Период: {period.label}</p>

      <div className="table-scroll rounded-md border border-mist-metal bg-graphite-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-mist-metal text-machine-gray">
              <th className="px-4 py-3 font-bold">Склад</th>
              <th className="px-4 py-3 font-bold">Номенклатура</th>
              <th className="px-4 py-3 font-bold">Категория</th>
              <th className="px-4 py-3 font-bold">Остаток на начало</th>
              <th className="px-4 py-3 font-bold">Приход</th>
              <th className="px-4 py-3 font-bold">Расход</th>
              <th className="px-4 py-3 font-bold">Остаток на конец</th>
              <th className="px-4 py-3 font-bold">Ед.</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-machine-gray">
                  За выбранный период движений не было.
                </td>
              </tr>
            ) : (
              report.rows.map((row, index) => (
                <tr key={`${row.warehouseName}|${row.productCode}|${row.category}|${index}`} className="border-b border-mist-metal/60">
                  <td className="px-4 py-3 text-steel-graphite">{row.warehouseName}</td>
                  <td className="px-4 py-3 text-graphite">
                    {row.productCode} — {row.productName}
                  </td>
                  <td className="px-4 py-3 text-steel-graphite">{row.category}</td>
                  <td className="px-4 py-3">{row.opening}</td>
                  <td className="px-4 py-3">{row.receipt || '—'}</td>
                  <td className="px-4 py-3">{row.issue || '—'}</td>
                  <td className="px-4 py-3 font-medium">{row.closing}</td>
                  <td className="px-4 py-3 text-steel-graphite">{row.unit}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
