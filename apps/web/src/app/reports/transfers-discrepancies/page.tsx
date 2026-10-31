import Link from 'next/link';
import { prisma } from '@prodtrack/db';
import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';
import {
  parseReportPeriodFromSearchParams,
  reportPeriodQuery,
  searchParamValue,
  toDateInputValue
} from '@/lib/reports/period';
import { buildWeekOptions } from '@/lib/reports/weeks';
import { getAvailableReportMonths } from '@/lib/reports/months';
import {
  MISSING_TIMING_NOTE,
  getTransfersDiscrepanciesReport,
  type TransfersView
} from '@/lib/reports/transfers-discrepancies-report';
import { PeriodForm } from '../_components/period-form';

export const dynamic = 'force-dynamic';

/**
 * Отчёт «Перемещения и расхождения» (T-099, постановка
 * `docs/report_transfers_discrepancies.md`).
 *
 * Сроки — из журнала переходов (`StageTiming`), «даты приёмки» в схеме нет. Пропуск журнала
 * показывается как «—» и счётчиком: `updatedAt` для восстановления даты не годится (ОПЭ-75).
 */
const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Отправлено',
  RECEIVED: 'Принято складом',
  RECONCILED: 'Расхождение согласовано',
  DISCREPANCY: 'Расхождение',
  CANCELLED: 'Отменено'
};

function formatHours(value: number | null): string {
  return value === null ? '—' : `${value} ч`;
}

function formatDate(value: Date | null): string {
  return value === null ? '—' : value.toLocaleDateString('ru-RU');
}

export default async function TransfersDiscrepanciesPage({
  searchParams
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
  const productId = searchParamValue(searchParams, 'productId');
  const view: TransfersView =
    searchParamValue(searchParams, 'view') === 'discrepancy' ? 'discrepancy' : 'transfer';

  const [report, shifts, monthsAvailable, products] = await Promise.all([
    getTransfersDiscrepanciesReport(prisma, period, new Date(), { productId }),
    prisma.shift.findMany({
      orderBy: { date: 'desc' },
      take: 30,
      select: { id: true, number: true, date: true }
    }),
    getAvailableReportMonths(prisma),
    prisma.product.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true }
    })
  ]);

  const shiftsForForm = shifts.map((shift) => ({
    id: shift.id,
    date: toDateInputValue(shift.date),
    label: `Смена ${shift.number} от ${shift.date.toLocaleDateString('ru-RU')}`
  }));
  const weeks = buildWeekOptions(shifts.map((shift) => shift.date));

  const buildQuery = (nextView: TransfersView) => {
    const params = reportPeriodQuery(period);
    if (productId) params.set('productId', productId);
    if (nextView === 'discrepancy') params.set('view', 'discrepancy');
    return `/reports/transfers-discrepancies?${params.toString()}`;
  };
  const exportQuery = reportPeriodQuery(period);
  if (productId) exportQuery.set('productId', productId);

  return (
    <main className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-graphite">Перемещения и расхождения</h1>
        <div className="flex gap-3 text-sm">
          <Link
            href="/reports"
            className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
          >
            К списку отчётов
          </Link>
          <a
            href={`/reports/transfers-discrepancies/export?${exportQuery.toString()}`}
            className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
          >
            Выгрузить в Excel
          </a>
        </div>
      </div>

      <PeriodForm
        action="/reports/transfers-discrepancies"
        period={period.mode}
        months={period.months}
        monthsAvailable={monthsAvailable}
        from={toDateInputValue(period.from)}
        to={toDateInputValue(period.to)}
        shifts={shiftsForForm}
        weeks={weeks}
        products={products.map((item) => ({ id: item.id, label: `${item.code} — ${item.name}` }))}
        product={productId ?? ''}
      />

      <nav
        aria-label="Разрез отчёта"
        className="inline-flex items-center gap-1 rounded-md border border-mist-metal bg-white p-1"
      >
        {view === 'transfer' ? (
          <span
            aria-current="page"
            className="rounded-md bg-deep-industry-blue px-3 py-1.5 text-sm text-white"
          >
            По перемещениям
          </span>
        ) : (
          <Link
            href={buildQuery('transfer')}
            className="rounded-md px-3 py-1.5 text-sm text-deep-industry-blue hover:bg-graphite-surface"
          >
            По перемещениям
          </Link>
        )}
        {view === 'discrepancy' ? (
          <span
            aria-current="page"
            className="rounded-md bg-deep-industry-blue px-3 py-1.5 text-sm text-white"
          >
            По расхождениям
          </span>
        ) : (
          <Link
            href={buildQuery('discrepancy')}
            className="rounded-md px-3 py-1.5 text-sm text-deep-industry-blue hover:bg-graphite-surface"
          >
            По расхождениям
          </Link>
        )}
      </nav>

      <p className="text-sm text-steel-graphite">
        Период: {period.label}.{' '}
        {view === 'transfer'
          ? 'Отбор — по дате отправки перемещения.'
          : 'Отбор — по дате приёмки с расхождением.'}{' '}
        Сроки считаются по журналу переходов; количество — фактически принятое, план рядом.
      </p>

      {view === 'transfer' ? (
        <div className="table-scroll rounded-md border border-mist-metal bg-graphite-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-graphite-surface">
              <tr className="border-b border-mist-metal text-machine-gray">
                <th className="px-4 py-3 font-bold">Перемещение</th>
                <th className="px-4 py-3 font-bold">Отправлено</th>
                <th className="px-4 py-3 font-bold">Склады</th>
                <th className="px-4 py-3 font-bold">Номенклатура</th>
                <th className="px-4 py-3 font-bold">План</th>
                <th className="px-4 py-3 font-bold">Принято</th>
                <th className="px-4 py-3 font-bold">Статус</th>
                <th className="px-4 py-3 font-bold">Цикл, ч</th>
              </tr>
            </thead>
            <tbody>
              {report.transfers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-machine-gray">
                    За выбранный период перемещений нет.
                  </td>
                </tr>
              ) : (
                report.transfers.map((row, index) => (
                  <tr
                    key={`${row.transferId}-${row.productCode}-${index}`}
                    className="border-b border-mist-metal/60"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/transfers/${row.transferId}`}
                        className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
                      >
                        {row.transferId.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{formatDate(row.submittedAt)}</td>
                    <td className="px-4 py-3">
                      {row.sourceWarehouseName} → {row.destinationWarehouseName}
                    </td>
                    <td className="px-4 py-3">
                      {row.productCode} — {row.productName}
                    </td>
                    <td className="px-4 py-3">
                      {row.plannedQuantity} {row.productUnit}
                    </td>
                    <td className="px-4 py-3">
                      {row.actualQuantity === null
                        ? '—'
                        : `${row.actualQuantity} ${row.productUnit}`}
                    </td>
                    <td className="px-4 py-3">{STATUS_LABELS[row.status] ?? row.status}</td>
                    <td className="px-4 py-3">{formatHours(row.cycleHours)}</td>
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
                <td className="px-4 py-3">перемещений: {report.totals.transfers}</td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="table-scroll rounded-md border border-mist-metal bg-graphite-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-graphite-surface">
              <tr className="border-b border-mist-metal text-machine-gray">
                <th className="px-4 py-3 font-bold">Перемещение</th>
                <th className="px-4 py-3 font-bold">Номенклатура</th>
                <th className="px-4 py-3 font-bold">План</th>
                <th className="px-4 py-3 font-bold">Принято</th>
                <th className="px-4 py-3 font-bold">Разница</th>
                <th className="px-4 py-3 font-bold">Приёмка с расхождением</th>
                <th className="px-4 py-3 font-bold">Согласовано</th>
                <th className="px-4 py-3 font-bold">Срок согласования</th>
              </tr>
            </thead>
            <tbody>
              {report.discrepancies.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-machine-gray">
                    За выбранный период расхождений нет.
                  </td>
                </tr>
              ) : (
                report.discrepancies.map((row, index) => (
                  <tr
                    key={`${row.transferId}-${row.productCode}-${index}`}
                    className="border-b border-mist-metal/60"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/transfers/${row.transferId}`}
                        className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
                      >
                        {row.transferId.slice(0, 8)}
                      </Link>
                      {row.cancelled && <span className="text-steel-graphite"> · отменено</span>}
                    </td>
                    <td className="px-4 py-3">
                      {row.productCode} — {row.productName}
                    </td>
                    <td className="px-4 py-3">
                      {row.plannedQuantity} {row.productUnit}
                    </td>
                    <td className="px-4 py-3">
                      {row.actualQuantity} {row.productUnit}
                    </td>
                    <td className="px-4 py-3">{row.difference}</td>
                    <td className="px-4 py-3">{formatDate(row.discrepancyAt)}</td>
                    <td className="px-4 py-3">
                      {row.reconciled ? formatDate(row.reconciledAt) : 'нет'}
                    </td>
                    <td className="px-4 py-3">{formatHours(row.resolutionHours)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-mist-metal font-bold text-graphite">
                <td className="px-4 py-3">Итого</td>
                <td className="px-4 py-3">с расхождением: {report.totals.withDiscrepancy}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3">не согласовано: {report.totals.notReconciled}</td>
                <td className="px-4 py-3">макс: {formatHours(report.totals.maxResolutionHours)}</td>
                <td className="px-4 py-3">
                  средний: {formatHours(report.totals.averageResolutionHours)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Пропуски журнала объясняются подписью: «—» — это «не знаем», а не «ноль». */}
      {((view === 'discrepancy' && report.totals.rowsWithoutTiming > 0) ||
        (view === 'transfer' && report.totals.transfersWithoutReceipt > 0)) && (
        <p role="note" className="text-sm text-steel-graphite">
          {MISSING_TIMING_NOTE}{' '}
          {view === 'discrepancy'
            ? `Строк без записи журнала: ${report.totals.rowsWithoutTiming}.`
            : `Перемещений без записи о приёмке: ${report.totals.transfersWithoutReceipt}.`}
        </p>
      )}
    </main>
  );
}
