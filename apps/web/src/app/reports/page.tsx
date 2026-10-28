import Link from 'next/link';
import { Card } from '@prodtrack/ui';
import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

export const dynamic = 'force-dynamic';

/**
 * Раздел «Отчёты» (решение владельца 26.10.2026).
 *
 * Это не дашборд: дашборд показывает «сейчас», отчёты — срез за выбранный период
 * с фильтрами и выгрузкой в CSV для Excel.
 */
const REPORTS = [
  {
    href: '/reports/output',
    title: 'Выпуск по РЦ: план и факт',
    description:
      'По каждому РЦ за период: план, фактический выпуск Массы, ПФ и ГП, брак и процент выполнения.',
  },
  {
    href: '/reports/products',
    title: 'Выпуск по ГП/ПФ: план и факт',
    description:
      'По каждой номенклатуре за период: план, фактический выпуск ГП и ПФ, брак и процент выполнения.',
  },
  {
    href: '/reports/stock',
    title: 'Движение склада',
    description:
      'Остаток на начало периода, приход и расход по номенклатуре и категориям, остаток на конец.',
  },
  {
    href: '/reports/timesheet',
    title: 'Табель учёта рабочего времени',
    description:
      'Кто в какие смены работал: операторы по назначению и отчёту, работники по фактическому составу, часы по смене и пометки расхождений.',
  },
];

export default async function ReportsPage() {
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

  return (
    <main className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-graphite">Отчёты</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {REPORTS.map((report) => (
          <Card key={report.href} className="space-y-2">
            <h2 className="text-lg font-bold text-graphite">{report.title}</h2>
            <p className="text-sm text-steel-graphite">{report.description}</p>
            <Link
              href={report.href}
              className="inline-block text-sm font-medium text-deep-industry-blue underline decoration-dotted underline-offset-2"
            >
              Открыть отчёт
            </Link>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-sm text-steel-graphite">
        Остальные отчёты (табель, выработка по сотрудникам, потребление, перемещения и расхождения,
        дисциплина закрытия ПЗ, брак и простои) — в бэклоге: задачи T-093, T-097…T-101.
      </p>
    </main>
  );
}
