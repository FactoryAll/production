import { prisma } from '@prodtrack/db';
import { requirePermission } from '@/lib/auth/access';
import { parseReportPeriodFromSearchParams, reportFileName } from '@/lib/reports/period';
import { getEmployeeOutputReport, UNATTRIBUTED_NAME } from '@/lib/reports/employee-output-report';
import { csvHeaders, toCsv } from '@/lib/reports/csv';

export const dynamic = 'force-dynamic';

/**
 * Выгрузка «Выработки по сотрудникам» в CSV для Excel (T-097).
 *
 * Один файл, первая колонка «Блок» — так в Excel можно отфильтровать операторов или работников
 * (решение владельца 31.10.2026). Два файла не делаем.
 */
export async function GET(request: Request) {
  await requirePermission('reports:read');

  const params = new URL(request.url).searchParams;
  const raw = Object.fromEntries(params.entries());
  // Тот же разбор, что на экране, включая фильтр по РЦ (ОПЭ-70 научил не расходиться).
  const period = parseReportPeriodFromSearchParams(raw);

  const report = await getEmployeeOutputReport(prisma, period, {
    workCenterId: raw.workCenterId || undefined,
  });

  const csv = toCsv(
    [
      'Блок',
      'Сотрудник',
      'Табельный',
      'Масса, кг',
      'ГП, шт',
      'ПФ, шт',
      'Брак Масса',
      'Брак ГП',
      'Брак ПФ',
      'Строк',
      'ПЗ',
    ],
    [
      ...report.rows.map((row) => [
        row.block === 'OPERATOR' ? 'Оператор' : 'Работник',
        row.employeeId === null ? UNATTRIBUTED_NAME : row.employeeName,
        row.tabNumber ?? '',
        row.output.mass,
        row.output.gp,
        row.output.pf,
        row.defect.mass,
        row.defect.gp,
        row.defect.pf,
        row.lines,
        row.orders,
      ]),
      [
        'Итого операторы',
        '',
        '',
        report.operatorTotals.output.mass,
        report.operatorTotals.output.gp,
        report.operatorTotals.output.pf,
        report.operatorTotals.defect.mass,
        report.operatorTotals.defect.gp,
        report.operatorTotals.defect.pf,
        report.operatorTotals.lines,
        report.operatorTotals.orders,
      ],
      [
        'Итого работники (весь выпуск)',
        '',
        '',
        report.workerTotals.output.mass,
        report.workerTotals.output.gp,
        report.workerTotals.output.pf,
        report.workerTotals.defect.mass,
        report.workerTotals.defect.gp,
        report.workerTotals.defect.pf,
        report.workerTotals.lines,
        report.workerTotals.orders,
      ],
    ],
  );

  return new Response(csv, { headers: csvHeaders(reportFileName('employee-output', period)) });
}
