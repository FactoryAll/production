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
import { getAvailableReportMonths } from '@/lib/reports/months';
import {
  CLOSURE_OVERDUE_AFTER_DAYS,
  getClosureDisciplineReport,
} from '@/lib/reports/closure-discipline-report';
import { PeriodForm } from '../_components/period-form';

export const dynamic = 'force-dynamic';

const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  CONFIRMED: 'Подтверждено',
  IN_PROGRESS: 'В работе',
};

/**
 * Отчёт «Дисциплина закрытия ПЗ» (T-100, постановка `docs/report_closure_discipline.md`).
 *
 * Строка — ПЗ целиком: вопрос дисциплины задаётся про документ, а какие РЦ не отметились,
 * видно внутри строки. Просрочка берётся **флагом из данных** (`row.overdue`, правило
 * `lib/overdue.ts`), а не сравнением дней в разметке: иначе правило просрочки появилось бы
 * вторым местом — в данных и в цвете строки.
 */
export default async function ClosureDisciplinePage({
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

  const [report, shifts, monthsAvailable] = await Promise.all([
    getClosureDisciplineReport(prisma, period),
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

  const query = reportPeriodQuery(period);
  const weeks = buildWeekOptions(shifts.map((shift) => shift.date));

  return (
    <main className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-graphite">Дисциплина закрытия ПЗ</h1>
        <div className="flex gap-3 text-sm">
          <Link
            href="/reports"
            className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
          >
            К списку отчётов
          </Link>
          <a
            href={`/reports/closure-discipline/export?${query.toString()}`}
            className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
          >
            Выгрузить в Excel
          </a>
        </div>
      </div>

      <PeriodForm
        action="/reports/closure-discipline"
        period={period.mode}
        months={period.months}
        monthsAvailable={monthsAvailable}
        from={toDateInputValue(period.from)}
        to={toDateInputValue(period.to)}
        shifts={shiftsForForm}
        weeks={weeks}
      />

      <p className="text-sm text-steel-graphite">
        Период: {period.label}. Показаны незакрытые ПЗ по дате смены; отменённые не входят.
        Просрочено — если с даты смены прошло {CLOSURE_OVERDUE_AFTER_DAYS} дня и больше
        (то же правило, что в напоминании НП).
      </p>

      <div className="table-scroll rounded-md border border-mist-metal bg-graphite-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-graphite-surface">
            <tr className="border-b border-mist-metal text-machine-gray">
              <th className="px-4 py-3 font-bold">ПЗ</th>
              <th className="px-4 py-3 font-bold">Смена</th>
              <th className="px-4 py-3 font-bold">Статус</th>
              <th className="px-4 py-3 font-bold">РЦ</th>
              <th className="px-4 py-3 font-bold">Строк / отчиталось</th>
              <th className="px-4 py-3 font-bold">Операторы</th>
              <th className="px-4 py-3 font-bold">Висит, дней</th>
              <th className="px-4 py-3 font-bold">Просрочено</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-machine-gray">
                  Незакрытых ПЗ за выбранный период нет.
                </td>
              </tr>
            ) : (
              report.rows.map((row) => (
                <tr
                  key={row.orderId}
                  // Подсветка — по флагу из данных, а не по сравнению дней в разметке.
                  className={
                    row.overdue
                      ? 'border-b border-mist-metal/60 bg-signal-amber/10'
                      : 'border-b border-mist-metal/60'
                  }
                >
                  <td className="px-4 py-3">
                    {/* Ссылка на ПЗ: из отчёта сразу в документ, как в напоминании НП. */}
                    <Link
                      href={`/production-orders/${row.orderId}`}
                      className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
                    >
                      ПЗ {row.orderId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {row.shiftNumber} от {row.shiftDate.toLocaleDateString('ru-RU')}
                  </td>
                  <td className="px-4 py-3">{ORDER_STATUS_LABELS[row.status] ?? row.status}</td>
                  <td className="px-4 py-3">
                    {row.workCenters.map((workCenter, index) => (
                      <span key={workCenter.code}>
                        {index > 0 ? ' · ' : ''}
                        {workCenter.code} — {workCenter.reported ? 'отчитался' : 'не отчитался'}
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-3">
                    {row.linesReported} / {row.linesTotal}
                  </td>
                  <td className="px-4 py-3">{row.operators ?? '—'}</td>
                  <td className="px-4 py-3">{row.daysHanging}</td>
                  <td className="px-4 py-3 font-medium">{row.overdue ? 'да' : 'нет'}</td>
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
              <td className="px-4 py-3">незакрытых: {report.totals.unclosed}</td>
              <td className="px-4 py-3">просрочено: {report.totals.overdue}</td>
              <td className="px-4 py-3">макс. срок: {report.totals.maxDays}</td>
              <td className="px-4 py-3" />
            </tr>
          </tfoot>
        </table>
      </div>
    </main>
  );
}
