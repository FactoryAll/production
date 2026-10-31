import Link from 'next/link';
import { prisma } from '@prodtrack/db';
import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';
import {
  parseReportPeriodFromSearchParams,
  reportPeriodQuery,
  searchParamValue,
  toDateInputValue,
} from '@/lib/reports/period';
import { buildWeekOptions } from '@/lib/reports/weeks';
import { getAvailableReportMonths } from '@/lib/reports/months';
import {
  UNATTRIBUTED_NAME,
  WORKERS_SUM_NOTE,
  defectSharePercent,
  getEmployeeOutputReport,
  type EmployeeOutputRow,
} from '@/lib/reports/employee-output-report';
import { PeriodForm } from '../_components/period-form';

export const dynamic = 'force-dynamic';

/**
 * Отчёт «Выработка по сотрудникам» (T-097, постановка `docs/report_employee_output.md`).
 *
 * Два блока в одной таблице: операторы и работники. Они считаются по-разному (оператор — 1:1
 * по своей строке, работник — весь выпуск строки, где был в составе), поэтому блоки разделены
 * подписями, а под таблицей стоит пояснение из `WORKERS_SUM_NOTE`: сумма по работникам больше
 * общего выпуска — это правило, а не дефект.
 */
const BLOCK_TITLES: Record<EmployeeOutputRow['block'], string> = {
  OPERATOR: 'Операторы',
  WORKER: 'Работники',
};

/** Доля брака в подписи: только там, где брак был, и по своей категории. */
function formatDefectShare(row: EmployeeOutputRow): string {
  const share = defectSharePercent(row.output, row.defect);
  if (!share) {
    return '—';
  }
  const parts: string[] = [];
  if (row.output.mass > 0) parts.push(`Масса ${share.mass}%`);
  if (row.output.gp > 0) parts.push(`ГП ${share.gp}%`);
  if (row.output.pf > 0) parts.push(`ПФ ${share.pf}%`);
  return parts.length > 0 ? parts.join(' · ') : '0%';
}

export default async function EmployeeOutputPage({
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
  const workCenterId = searchParamValue(searchParams, 'workCenterId');

  const [report, shifts, monthsAvailable, workCenters] = await Promise.all([
    getEmployeeOutputReport(prisma, period, { workCenterId }),
    prisma.shift.findMany({
      orderBy: { date: 'desc' },
      take: 30,
      select: { id: true, number: true, date: true },
    }),
    getAvailableReportMonths(prisma),
    prisma.workCenter.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    }),
  ]);

  const shiftsForForm = shifts.map((shift) => ({
    id: shift.id,
    date: toDateInputValue(shift.date),
    label: `Смена ${shift.number} от ${shift.date.toLocaleDateString('ru-RU')}`,
  }));
  const weeks = buildWeekOptions(shifts.map((shift) => shift.date));

  const query = reportPeriodQuery(period);
  if (workCenterId) {
    query.set('workCenterId', workCenterId);
  }

  const blocks: EmployeeOutputRow['block'][] = ['OPERATOR', 'WORKER'];

  return (
    <main className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-graphite">Выработка по сотрудникам</h1>
        <div className="flex gap-3 text-sm">
          <Link
            href="/reports"
            className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
          >
            К списку отчётов
          </Link>
          <a
            href={`/reports/employee-output/export?${query.toString()}`}
            className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
          >
            Выгрузить в Excel
          </a>
        </div>
      </div>

      <PeriodForm
        action="/reports/employee-output"
        period={period.mode}
        months={period.months}
        monthsAvailable={monthsAvailable}
        from={toDateInputValue(period.from)}
        to={toDateInputValue(period.to)}
        shifts={shiftsForForm}
        weeks={weeks}
        workCenters={workCenters.map((item) => ({ id: item.id, label: `${item.code} — ${item.name}` }))}
        workCenter={workCenterId ?? ''}
      />

      <p className="text-sm text-steel-graphite">
        Период: {period.label}. Выпуск по категориям: Масса в кг, ГП и ПФ в штуках — они
        не складываются между собой. Брак показан отдельно и из выпуска не вычитается.
      </p>

      <div className="table-scroll rounded-md border border-mist-metal bg-graphite-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-graphite-surface">
            <tr className="border-b border-mist-metal text-machine-gray">
              <th className="px-4 py-3 font-bold">Сотрудник</th>
              <th className="px-4 py-3 font-bold">Масса, кг</th>
              <th className="px-4 py-3 font-bold">ГП, шт</th>
              <th className="px-4 py-3 font-bold">ПФ, шт</th>
              <th className="px-4 py-3 font-bold">Брак Масса</th>
              <th className="px-4 py-3 font-bold">Брак ГП</th>
              <th className="px-4 py-3 font-bold">Брак ПФ</th>
              <th className="px-4 py-3 font-bold">Доля брака</th>
              <th className="px-4 py-3 font-bold">Строк</th>
              <th className="px-4 py-3 font-bold">ПЗ</th>
            </tr>
          </thead>
          {blocks.map((block) => {
            const blockRows = report.rows.filter((row) => row.block === block);
            const totals = block === 'OPERATOR' ? report.operatorTotals : report.workerTotals;

            return (
              <tbody key={block}>
                <tr className="border-b border-mist-metal bg-neutral-100">
                  <td colSpan={10} className="px-4 py-2 font-bold text-graphite">
                    {BLOCK_TITLES[block]}
                  </td>
                </tr>

                {blockRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-4 text-machine-gray">
                      За выбранный период выпуска нет.
                    </td>
                  </tr>
                ) : (
                  blockRows.map((row) => (
                    <tr
                      key={`${row.block}-${row.employeeId ?? UNATTRIBUTED_NAME}`}
                      className="border-b border-mist-metal/60"
                    >
                      <td className="px-4 py-3 text-graphite">
                        {row.employeeId === null ? (
                          // Строка без привязки: без неё итог по людям «молча не сходится».
                          <span className="text-steel-graphite">{row.employeeName}</span>
                        ) : (
                          <>
                            {row.employeeName}
                            <span className="text-steel-graphite"> · {row.tabNumber}</span>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3">{row.output.mass || '—'}</td>
                      <td className="px-4 py-3">{row.output.gp || '—'}</td>
                      <td className="px-4 py-3">{row.output.pf || '—'}</td>
                      <td className="px-4 py-3">{row.defect.mass || '—'}</td>
                      <td className="px-4 py-3">{row.defect.gp || '—'}</td>
                      <td className="px-4 py-3">{row.defect.pf || '—'}</td>
                      <td className="px-4 py-3">{formatDefectShare(row)}</td>
                      <td className="px-4 py-3">{row.lines}</td>
                      <td className="px-4 py-3">{row.orders}</td>
                    </tr>
                  ))
                )}

                <tr className="border-b-2 border-mist-metal font-bold text-graphite">
                  <td className="px-4 py-3">
                    {block === 'OPERATOR' ? 'Итого операторы' : 'Итого работники (весь выпуск)'}
                  </td>
                  <td className="px-4 py-3">{totals.output.mass || '—'}</td>
                  <td className="px-4 py-3">{totals.output.gp || '—'}</td>
                  <td className="px-4 py-3">{totals.output.pf || '—'}</td>
                  <td className="px-4 py-3">{totals.defect.mass || '—'}</td>
                  <td className="px-4 py-3">{totals.defect.gp || '—'}</td>
                  <td className="px-4 py-3">{totals.defect.pf || '—'}</td>
                  <td className="px-4 py-3">—</td>
                  <td className="px-4 py-3">{totals.lines}</td>
                  <td className="px-4 py-3">{totals.orders}</td>
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>

      {/* Пояснение берётся из расчёта, а не пишется в разметке заново (T-097). */}
      <p className="text-sm text-steel-graphite">{WORKERS_SUM_NOTE}</p>
    </main>
  );
}
