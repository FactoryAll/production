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
  SECONDARY_CONSUMPTION_NOTE,
  STOCK_CATEGORY_LABELS,
  getConsumptionReport,
  type ConsumptionView
} from '@/lib/reports/consumption-report';
import { PeriodForm } from '../_components/period-form';

export const dynamic = 'force-dynamic';

/**
 * Отчёт «Потребление» (T-098, постановка `docs/report_consumption.md`).
 *
 * Два разреза на одной странице: **по РЦ** и **по номенклатуре**. От «Движения склада» (T-096)
 * отчёт отличается именно РЦ — там видно только номенклатуру и категорию остатка.
 *
 * Количество берётся из записей потребления (`FactConsumption`), а не из плана: планового
 * потребления в модели нет. Дубли снимаются правилом, принятым для простоев (T-101):
 * значение с основного факта строки, счётчик «не в основном факте» — в подпись и в CSV.
 */
export default async function ConsumptionPage({
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
  const workCenterId = searchParamValue(searchParams, 'workCenterId');
  const productId = searchParamValue(searchParams, 'productId');
  const view: ConsumptionView =
    searchParamValue(searchParams, 'view') === 'product' ? 'product' : 'workCenter';

  const [report, shifts, monthsAvailable, workCenters, products] = await Promise.all([
    getConsumptionReport(prisma, period, { workCenterId, productId }),
    prisma.shift.findMany({
      orderBy: { date: 'desc' },
      take: 30,
      select: { id: true, number: true, date: true }
    }),
    getAvailableReportMonths(prisma),
    prisma.workCenter.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true }
    }),
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

  const buildQuery = (nextView: ConsumptionView) => {
    const params = reportPeriodQuery(period);
    if (workCenterId) params.set('workCenterId', workCenterId);
    if (productId) params.set('productId', productId);
    if (nextView === 'product') params.set('view', 'product');
    return `/reports/consumption?${params.toString()}`;
  };
  const exportQuery = reportPeriodQuery(period);
  if (workCenterId) exportQuery.set('workCenterId', workCenterId);
  if (productId) exportQuery.set('productId', productId);

  return (
    <main className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-graphite">Потребление</h1>
        <div className="flex gap-3 text-sm">
          <Link
            href="/reports"
            className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
          >
            К списку отчётов
          </Link>
          <a
            href={`/reports/consumption/export?${exportQuery.toString()}`}
            className="text-deep-industry-blue underline decoration-dotted underline-offset-2"
          >
            Выгрузить в Excel
          </a>
        </div>
      </div>

      <PeriodForm
        action="/reports/consumption"
        period={period.mode}
        months={period.months}
        monthsAvailable={monthsAvailable}
        from={toDateInputValue(period.from)}
        to={toDateInputValue(period.to)}
        shifts={shiftsForForm}
        weeks={weeks}
        workCenters={workCenters.map((item) => ({
          id: item.id,
          label: `${item.code} — ${item.name}`
        }))}
        workCenter={workCenterId ?? ''}
        products={products.map((item) => ({ id: item.id, label: `${item.code} — ${item.name}` }))}
        product={productId ?? ''}
      />

      <nav
        aria-label="Разрез отчёта"
        className="inline-flex items-center gap-1 rounded-md border border-mist-metal bg-white p-1"
      >
        {view === 'workCenter' ? (
          <span
            aria-current="page"
            className="rounded-md bg-deep-industry-blue px-3 py-1.5 text-sm text-white"
          >
            По РЦ
          </span>
        ) : (
          <Link
            href={buildQuery('workCenter')}
            className="rounded-md px-3 py-1.5 text-sm text-deep-industry-blue hover:bg-graphite-surface"
          >
            По РЦ
          </Link>
        )}
        {view === 'product' ? (
          <span
            aria-current="page"
            className="rounded-md bg-deep-industry-blue px-3 py-1.5 text-sm text-white"
          >
            По номенклатуре
          </span>
        ) : (
          <Link
            href={buildQuery('product')}
            className="rounded-md px-3 py-1.5 text-sm text-deep-industry-blue hover:bg-graphite-surface"
          >
            По номенклатуре
          </Link>
        )}
      </nav>

      <p className="text-sm text-steel-graphite">
        Период: {period.label}. Количество — из записей потребления (что фактически списано на
        производство). Категория остатка хранится в строке: Масса и ПФ — разные остатки одной
        номенклатуры.
      </p>

      <div className="table-scroll rounded-md border border-mist-metal bg-graphite-surface">
        <table className="w-full text-left text-sm">
          {view === 'workCenter' ? (
            <>
              <thead className="bg-graphite-surface">
                <tr className="border-b border-mist-metal text-machine-gray">
                  <th className="px-4 py-3 font-bold">РЦ</th>
                  <th className="px-4 py-3 font-bold">Номенклатура</th>
                  <th className="px-4 py-3 font-bold">Категория остатка</th>
                  <th className="px-4 py-3 font-bold">Израсходовано</th>
                  <th className="px-4 py-3 font-bold">Строк ПЗ</th>
                </tr>
              </thead>
              <tbody>
                {report.workCenters.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-machine-gray">
                      За выбранный период потребления нет.
                    </td>
                  </tr>
                ) : (
                  report.workCenters.map((row) => (
                    <tr
                      key={`${row.workCenterCode}-${row.productCode}-${row.stockCategory}`}
                      className="border-b border-mist-metal/60"
                    >
                      <td className="px-4 py-3 text-graphite">
                        {row.workCenterCode} — {row.workCenterName}
                      </td>
                      <td className="px-4 py-3">
                        {row.productCode} — {row.productName}
                      </td>
                      <td className="px-4 py-3">
                        {STOCK_CATEGORY_LABELS[row.stockCategory] ?? row.stockCategory}
                      </td>
                      <td className="px-4 py-3">
                        {row.quantity} {row.productUnit}
                      </td>
                      <td className="px-4 py-3">{row.lines}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </>
          ) : (
            <>
              <thead className="bg-graphite-surface">
                <tr className="border-b border-mist-metal text-machine-gray">
                  <th className="px-4 py-3 font-bold">Номенклатура</th>
                  <th className="px-4 py-3 font-bold">Категория остатка</th>
                  <th className="px-4 py-3 font-bold">Израсходовано</th>
                  <th className="px-4 py-3 font-bold">Строк ПЗ</th>
                  {/* РЦ — то, чего нет в «Движении склада» (T-096). */}
                  <th className="px-4 py-3 font-bold">РЦ</th>
                </tr>
              </thead>
              <tbody>
                {report.products.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-machine-gray">
                      За выбранный период потребления нет.
                    </td>
                  </tr>
                ) : (
                  report.products.map((row) => (
                    <tr
                      key={`${row.productCode}-${row.stockCategory}`}
                      className="border-b border-mist-metal/60"
                    >
                      <td className="px-4 py-3 text-graphite">
                        {row.productCode} — {row.productName}
                      </td>
                      <td className="px-4 py-3">
                        {STOCK_CATEGORY_LABELS[row.stockCategory] ?? row.stockCategory}
                      </td>
                      <td className="px-4 py-3">
                        {row.quantity} {row.productUnit}
                      </td>
                      <td className="px-4 py-3">{row.lines}</td>
                      <td className="px-4 py-3">{row.workCenterCodes.join(', ')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </>
          )}
          <tfoot>
            <tr className="border-t-2 border-mist-metal font-bold text-graphite">
              <td className="px-4 py-3">Итого</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3">
                Масса {report.totals.byCategory.MASS} · ПФ {report.totals.byCategory.PF} · ГП{' '}
                {report.totals.byCategory.GP}
              </td>
              <td className="px-4 py-3">строк: {report.totals.lines}</td>
              <td className="px-4 py-3" />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Счётчик старых дублей — в подписи, как в T-101: цифра объясняет происхождение. */}
      {report.totals.linesWithSecondaryConsumption > 0 && (
        <p role="note" className="text-sm text-steel-graphite">
          {SECONDARY_CONSUMPTION_NOTE} Строк: {report.totals.linesWithSecondaryConsumption}.
        </p>
      )}
    </main>
  );
}
