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
  defectSharePercent,
  getDefectStopsReport,
  type CategoryValue,
  type DefectStopsView,
} from '@/lib/reports/defect-stops-report';
import { PeriodForm } from '../_components/period-form';

export const dynamic = 'force-dynamic';

/**
 * Отчёт «Брак и простои» (T-101, постановка `docs/report_defect_stops.md`).
 *
 * Одна страница, два разреза: по РЦ и по причинам брака. Простои берутся с основного факта
 * строки (`pickPrimaryFact`) — до ОПЭ-73 они писались в каждый факт, и на ГП-РЦ задваивались
 * в данных. Простой на человека приписан оператору строки: вклад работника не измеряется.
 */
function shareLabel(output: CategoryValue, defect: CategoryValue): string {
  const share = defectSharePercent(output, defect);
  if (!share) {
    return '—';
  }
  const parts: string[] = [];
  if (output.mass > 0) parts.push(`Масса ${share.mass}%`);
  if (output.gp > 0) parts.push(`ГП ${share.gp}%`);
  if (output.pf > 0) parts.push(`ПФ ${share.pf}%`);
  return parts.length > 0 ? parts.join(' · ') : '0%';
}

export default async function DefectStopsPage({
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
  const view: DefectStopsView = searchParamValue(searchParams, 'view') === 'reason' ? 'reason' : 'workCenter';

  const [report, shifts, monthsAvailable] = await Promise.all([
    getDefectStopsReport(prisma, period),
    prisma.shift.findMany({
      orderBy: { date: 'desc' },
      take: 30,
      select: { id: true, number: true, date: true },
    }),
    getAvailableReportMonths(prisma),
  ]);

  const shiftsForForm = shifts.map((shift) => ({
    id: shift.id,
    date: toDateInputValue(shift.date),
    label: `Смена ${shift.number} от ${shift.date.toLocaleDateString('ru-RU')}`,
  }));
  const weeks = buildWeekOptions(shifts.map((shift) => shift.date));

  const query = reportPeriodQuery(period);
  if (view === 'reason') {
    query.set('view', 'reason');
  }
  const exportHref = `/reports/defect-stops/export?${query.toString()}`;
  const rcHref = `/reports/defect-stops?${((): string => {
    const params = reportPeriodQuery(period);
    return params.toString();
  })()}`;
  const reasonParams = reportPeriodQuery(period);
  reasonParams.set('view', 'reason');
  const reasonHref = `/reports/defect-stops?${reasonParams.toString()}`;

  return (
    <main className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-graphite">Брак и простои</h1>
        <div className="flex gap-3 text-sm">
          <Link
            href="/reports"
            className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
          >
            К списку отчётов
          </Link>
          <a
            href={exportHref}
            className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
          >
            Выгрузить в Excel
          </a>
        </div>
      </div>

      <PeriodForm
        action="/reports/defect-stops"
        period={period.mode}
        months={period.months}
        monthsAvailable={monthsAvailable}
        from={toDateInputValue(period.from)}
        to={toDateInputValue(period.to)}
        shifts={shiftsForForm}
        weeks={weeks}
      />

      <nav aria-label="Разрез отчёта" className="inline-flex items-center gap-1 rounded-md border border-mist-metal bg-white p-1">
        {view === 'workCenter' ? (
          <span aria-current="page" className="rounded-md bg-deep-industry-blue px-3 py-1.5 text-sm text-white">
            По РЦ
          </span>
        ) : (
          <Link href={rcHref} className="rounded-md px-3 py-1.5 text-sm text-deep-industry-blue hover:bg-graphite-surface">
            По РЦ
          </Link>
        )}
        {view === 'reason' ? (
          <span aria-current="page" className="rounded-md bg-deep-industry-blue px-3 py-1.5 text-sm text-white">
            По причинам
          </span>
        ) : (
          <Link href={reasonHref} className="rounded-md px-3 py-1.5 text-sm text-deep-industry-blue hover:bg-graphite-surface">
            По причинам
          </Link>
        )}
      </nav>

      <p className="text-sm text-steel-graphite">
        Период: {period.label}. Брак не вычитается из выпуска; доля считается внутри категории.
        Простой берётся один раз на строку — с основного факта (до ОПЭ-73 он писался в каждый
        факт, и на ГП-РЦ задваивался).
        {report.totals.linesWithSecondaryStops > 0 && (
          <>
            {' '}
            У {report.totals.linesWithSecondaryStops} строк(-и) простой записан в неосновной факт
            (следы данных до ОПЭ-73) — минуты учтены из него, ничего не потеряно.
          </>
        )}
      </p>

      {view === 'workCenter' ? (
        <div className="table-scroll rounded-md border border-mist-metal bg-graphite-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-graphite-surface">
              <tr className="border-b border-mist-metal text-machine-gray">
                <th className="px-4 py-3 font-bold">РЦ</th>
                <th className="px-4 py-3 font-bold">Выпуск Масса</th>
                <th className="px-4 py-3 font-bold">Выпуск ГП</th>
                <th className="px-4 py-3 font-bold">Выпуск ПФ</th>
                <th className="px-4 py-3 font-bold">Брак Масса</th>
                <th className="px-4 py-3 font-bold">Брак ГП</th>
                <th className="px-4 py-3 font-bold">Брак ПФ</th>
                <th className="px-4 py-3 font-bold">Доля брака</th>
                <th className="px-4 py-3 font-bold">Остановок</th>
                <th className="px-4 py-3 font-bold">Простой, мин</th>
                <th className="px-4 py-3 font-bold">Простой, ч</th>
                <th className="px-4 py-3 font-bold">Строк с простоем</th>
              </tr>
            </thead>
            <tbody>
              {report.workCenters.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-6 text-machine-gray">
                    За выбранный период данных нет.
                  </td>
                </tr>
              ) : (
                report.workCenters.map((row) => (
                  <tr key={row.code} className="border-b border-mist-metal/60">
                    <td className="px-4 py-3 text-graphite">
                      {row.code} — {row.name}
                    </td>
                    <td className="px-4 py-3">{row.output.mass || '—'}</td>
                    <td className="px-4 py-3">{row.output.gp || '—'}</td>
                    <td className="px-4 py-3">{row.output.pf || '—'}</td>
                    <td className="px-4 py-3">{row.defect.mass || '—'}</td>
                    <td className="px-4 py-3">{row.defect.gp || '—'}</td>
                    <td className="px-4 py-3">{row.defect.pf || '—'}</td>
                    <td className="px-4 py-3">{shareLabel(row.output, row.defect)}</td>
                    <td className="px-4 py-3">{row.stopsCount}</td>
                    <td className="px-4 py-3">{row.stopsMinutes}</td>
                    <td className="px-4 py-3">{row.stopsHours}</td>
                    <td className="px-4 py-3">{row.linesWithStops}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-mist-metal font-bold text-graphite">
                <td className="px-4 py-3">Итого</td>
                <td className="px-4 py-3">{report.totals.output.mass || '—'}</td>
                <td className="px-4 py-3">{report.totals.output.gp || '—'}</td>
                <td className="px-4 py-3">{report.totals.output.pf || '—'}</td>
                <td className="px-4 py-3">{report.totals.defect.mass || '—'}</td>
                <td className="px-4 py-3">{report.totals.defect.gp || '—'}</td>
                <td className="px-4 py-3">{report.totals.defect.pf || '—'}</td>
                <td className="px-4 py-3">{shareLabel(report.totals.output, report.totals.defect)}</td>
                <td className="px-4 py-3">{report.totals.stopsCount}</td>
                <td className="px-4 py-3">{report.totals.stopsMinutes}</td>
                <td className="px-4 py-3">{report.totals.stopsHours}</td>
                <td className="px-4 py-3">{report.totals.linesWithStops}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="table-scroll rounded-md border border-mist-metal bg-graphite-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-graphite-surface">
              <tr className="border-b border-mist-metal text-machine-gray">
                <th className="px-4 py-3 font-bold">Причина брака</th>
                <th className="px-4 py-3 font-bold">Брак Масса</th>
                <th className="px-4 py-3 font-bold">Брак ГП</th>
                <th className="px-4 py-3 font-bold">Брак ПФ</th>
                <th className="px-4 py-3 font-bold">РЦ</th>
              </tr>
            </thead>
            <tbody>
              {report.reasons.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-machine-gray">
                    За выбранный период брака нет.
                  </td>
                </tr>
              ) : (
                report.reasons.map((row) => (
                  <tr key={row.code ?? 'none'} className="border-b border-mist-metal/60">
                    <td className="px-4 py-3 text-graphite">
                      {row.code ? `${row.code} — ${row.name}` : row.name}
                    </td>
                    <td className="px-4 py-3">{row.defect.mass || '—'}</td>
                    <td className="px-4 py-3">{row.defect.gp || '—'}</td>
                    <td className="px-4 py-3">{row.defect.pf || '—'}</td>
                    <td className="px-4 py-3">{row.workCenterCodes.join(', ')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Простой по операторам: приписан оператору строки, работникам не приписывается. */}
      {report.operatorStops.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-bold text-graphite">Простой по операторам</h2>
          <div className="table-scroll rounded-md border border-mist-metal bg-graphite-surface">
            <table className="w-full text-left text-sm">
              <thead className="bg-graphite-surface">
                <tr className="border-b border-mist-metal text-machine-gray">
                  <th className="px-4 py-3 font-bold">Оператор</th>
                  <th className="px-4 py-3 font-bold">Простой, мин</th>
                  <th className="px-4 py-3 font-bold">Простой, ч</th>
                </tr>
              </thead>
              <tbody>
                {report.operatorStops.map((row) => (
                  <tr key={row.employeeId ?? 'none'} className="border-b border-mist-metal/60">
                    <td className="px-4 py-3 text-graphite">{row.employeeName}</td>
                    <td className="px-4 py-3">{row.stopsMinutes}</td>
                    <td className="px-4 py-3">{row.stopsHours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-steel-graphite">
            Простой строки приписан её оператору; работникам не приписывается — вклад отдельного
            человека в строку система не измеряет.
          </p>
        </div>
      )}
    </main>
  );
}
