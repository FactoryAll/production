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
import { getOutputReport } from '@/lib/reports/output-report';
import { PeriodForm } from '../_components/period-form';

export const dynamic = 'force-dynamic';

/** Отчёт «Выпуск по РЦ: план и факт» (T-095). */
export default async function OutputReportPage({
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
    getOutputReport(prisma, period),
    prisma.shift.findMany({
      orderBy: { date: 'desc' },
      take: 30,
      select: { id: true, number: true, date: true },
    }),
  ]);

  const shiftsForForm = shifts.map((shift) => ({
    id: shift.id,
    date: toDateInputValue(shift.date),
    label: `Смена ${shift.number} от ${shift.date.toLocaleDateString('ru-RU')}`,
  }));

  const query = reportPeriodQuery(period);
  // Недели для фильтра: только те, в которые есть смены (29.10.2026).
  const weeks = buildWeekOptions(shifts.map((shift) => shift.date));

  return (
    <main className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-graphite">Выпуск по РЦ: план и факт</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/reports" className="text-deep-industry-blue underline decoration-dotted underline-offset-2">
            К списку отчётов
          </Link>
          <a
            href={`/reports/output/export?${query.toString()}`}
            className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
          >
            Выгрузить в Excel
          </a>
        </div>
      </div>

      <PeriodForm
        action="/reports/output"
        period={period.mode}
        months={period.months}
        from={toDateInputValue(period.from)}
        to={toDateInputValue(period.to)}
        shifts={shiftsForForm}
        weeks={weeks}
      />

      <p className="text-sm text-steel-graphite">Период: {period.label}</p>

      <div className="table-scroll rounded-md border border-mist-metal bg-graphite-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-graphite-surface">
            <tr className="border-b border-mist-metal text-machine-gray">
              <th className="px-4 py-3 font-bold">РЦ</th>
              <th className="px-4 py-3 font-bold">План Масса</th>
              <th className="px-4 py-3 font-bold">План ГП</th>
              <th className="px-4 py-3 font-bold">Факт Масса</th>
              <th className="px-4 py-3 font-bold">Факт ПФ</th>
              <th className="px-4 py-3 font-bold">Факт ГП</th>
              <th className="px-4 py-3 font-bold">Брак</th>
              <th className="px-4 py-3 font-bold">Выполнение</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-machine-gray">
                  За выбранный период данных нет.
                </td>
              </tr>
            ) : (
              report.rows.map((row) => (
                <tr key={row.code} className="border-b border-mist-metal/60">
                  <td className="px-4 py-3 text-graphite">
                    {row.code} — {row.name}
                  </td>
                  <td className="px-4 py-3">{row.plannedMass || '—'}</td>
                  <td className="px-4 py-3">{row.plannedGp || '—'}</td>
                  <td className="px-4 py-3">{row.factMass || '—'}</td>
                  <td className="px-4 py-3">{row.factPf || '—'}</td>
                  <td className="px-4 py-3">{row.factGp || '—'}</td>
                  <td className="px-4 py-3">{row.defect || '—'}</td>
                  <td className="px-4 py-3 font-medium">
                    {row.completionPercent === null ? '—' : `${row.completionPercent}%`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-mist-metal font-bold text-graphite">
              <td className="px-4 py-3">Итого</td>
              <td className="px-4 py-3">{report.totals.plannedMass}</td>
              <td className="px-4 py-3">{report.totals.plannedGp}</td>
              <td className="px-4 py-3">{report.totals.factMass}</td>
              <td className="px-4 py-3">{report.totals.factPf}</td>
              <td className="px-4 py-3">{report.totals.factGp}</td>
              <td className="px-4 py-3">{report.totals.defect}</td>
              <td className="px-4 py-3">
                {report.totals.completionPercent === null ? '—' : `${report.totals.completionPercent}%`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </main>
  );
}
