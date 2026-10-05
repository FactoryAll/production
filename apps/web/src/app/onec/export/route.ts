import { requireAnyPermission } from '@/lib/auth/access';
import { buildOneCCsv } from '@/lib/onec/csv';

import {
  getOneCTasksForExport,
  parseOneCStatusFilter,
  parseOneCTypeFilter,
} from '../queries';

export const dynamic = 'force-dynamic';

/**
 * CSV-экспорт задач для 1С (T-053, M12 §8, BR-7/BR-10, Р-06/Р-24).
 *
 * Отдаёт единый файл по обоим типам задач с учётом фильтров списка.
 * Доступ — право \`onec:read\` (С1С и АДМ, 00 §4.2).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireAnyPermission(['onec:read']);
  } catch {
    return new Response('Forbidden', { status: 403 });
  }

  const url = new URL(request.url);
  const filter = {
    type: parseOneCTypeFilter(url.searchParams.get('type') ?? undefined),
    status: parseOneCStatusFilter(url.searchParams.get('status') ?? undefined),
  };

  const tasks = await getOneCTasksForExport(filter);
  const csv = buildOneCCsv(tasks);
  const fileName = `onec-tasks-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  });
}
