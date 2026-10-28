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
import { getTimesheetReport, roleLabel } from '@/lib/reports/timesheet-report';
import { PeriodForm } from '../_components/period-form';

export const dynamic = 'force-dynamic';

/**
 * Отчёт «Табель учёта рабочего времени» (T-093).
 *
 * Строка — сотрудник в смене. Пометка в последней колонке нужна ОТК: она отличает
 * «не работал» от «работал, но не отметился», не заставляя сверять столбцы глазами.
 */
export default async function TimesheetPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const access = await checkPageAccess('reports:read');
  if (!access.allowed) {
    return (
      <AccessDenied
        action="просмотр отчётов"
        allowedRoles={['NP', 'ADM', 'S1C', 'OTK']}
        requiredPermission="reports:read"
      />
    );
  }

  const period = parseReportPeriodFromSearchParams(searchParams);

  const [report, shifts] = await Promise.all([
    getTimesheetReport(prisma, period),
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
        <h1 className="text-2xl font-bold text-graphite">Табель учёта рабочего времени</h1>
        <div className="flex gap-3 text-sm">
          <Link
            href="/reports"
            className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
          >
            К списку отчётов
          </Link>
          <a
            href={`/reports/timesheet/export?${query.toString()}`}
            className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
          >
            Выгрузить в Excel
          </a>
        </div>
      </div>

      <PeriodForm
        action="/reports/timesheet"
        period={period.mode}
        months={period.months}
        from={toDateInputValue(period.from)}
        to={toDateInputValue(period.to)}
        shifts={shiftsForForm}
        weeks={weeks}
      />

      <p className="text-sm text-steel-graphite">
        Период: {period.label}. Часы — длительность смены из справочника, они не удваиваются,
        если у сотрудника в смене несколько строк РЦ. Работники считаются по фактическому
        составу факта, а не по назначению; пока ввод итога не подтверждает состав (этап 3
        постановки), у работника будет «не отмечен» или «назначен, не работал» — это и есть
        разница между «не работал» и «работал, но не отметился».
      </p>

      <div className="table-scroll rounded-md border border-mist-metal bg-graphite-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-graphite-surface">
            <tr className="border-b border-mist-metal text-machine-gray">
              <th className="px-4 py-3 font-bold">Сотрудник</th>
              <th className="px-4 py-3 font-bold">Табельный</th>
              <th className="px-4 py-3 font-bold">Дата</th>
              <th className="px-4 py-3 font-bold">Смена</th>
              <th className="px-4 py-3 font-bold">Роль</th>
              <th className="px-4 py-3 font-bold">Назначен</th>
              <th className="px-4 py-3 font-bold">Факт</th>
              <th className="px-4 py-3 font-bold">Часы</th>
              <th className="px-4 py-3 font-bold">Пометка</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-machine-gray">
                  За выбранный период данных нет.
                </td>
              </tr>
            ) : (
              report.rows.map((row) => (
                <tr
                  key={`${row.employeeId}-${row.shiftId}-${row.role}`}
                  className="border-b border-mist-metal/60"
                >
                  <td className="px-4 py-3 text-graphite">{row.employeeName}</td>
                  <td className="px-4 py-3">{row.tabNumber}</td>
                  <td className="px-4 py-3">{row.shiftDate.toLocaleDateString('ru-RU')}</td>
                  <td className="px-4 py-3">{row.shiftNumber}</td>
                  <td className="px-4 py-3">{roleLabel(row.role)}</td>
                  <td className="px-4 py-3">{row.assignmentLabel}</td>
                  <td className="px-4 py-3">{row.factLabel}</td>
                  <td className="px-4 py-3">{row.hours ?? '—'}</td>
                  <td className="px-4 py-3 font-medium">{row.markLabel || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-mist-metal font-bold text-graphite">
              <td className="px-4 py-3">Итого</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-4 py-3">смен: {report.totals.shifts}</td>
              <td className="px-4 py-3">{report.totals.hours}</td>
              <td className="px-4 py-3">расхождений: {report.totals.discrepancies}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h2 className="pt-2 text-lg font-bold text-graphite">Итоги по сотрудникам</h2>
      <div className="table-scroll rounded-md border border-mist-metal bg-graphite-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-graphite-surface">
            <tr className="border-b border-mist-metal text-machine-gray">
              <th className="px-4 py-3 font-bold">Сотрудник</th>
              <th className="px-4 py-3 font-bold">Табельный</th>
              <th className="px-4 py-3 font-bold">Смен отработано</th>
              <th className="px-4 py-3 font-bold">Часов</th>
              <th className="px-4 py-3 font-bold">Расхождений</th>
            </tr>
          </thead>
          <tbody>
            {report.employees.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-machine-gray">
                  За выбранный период данных нет.
                </td>
              </tr>
            ) : (
              report.employees.map((item) => (
                <tr key={item.employeeId} className="border-b border-mist-metal/60">
                  <td className="px-4 py-3 text-graphite">{item.employeeName}</td>
                  <td className="px-4 py-3">{item.tabNumber}</td>
                  <td className="px-4 py-3">{item.shifts}</td>
                  <td className="px-4 py-3">{item.hours}</td>
                  <td className="px-4 py-3">{item.discrepancies}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
