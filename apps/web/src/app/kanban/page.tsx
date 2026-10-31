export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { ViewSwitch } from '@/components/view-switch';
import { checkPageAccess } from '@/lib/auth/page-guard';
import { boardViewHref, listViewHref } from '@/lib/kanban/view-links';
import { hasPermission } from '@prodtrack/contracts';

/**
 * Доска производственного контура (T-103, решение владельца 29.10.2026).
 *
 * Отдельный вид, а не вторая страница-дубль: у доски своё право `kanban:read`, поэтому
 * складские роли (КСГП, УСГП) попадают сюда, хотя на `/production-orders` их не пускает
 * `production_order:read`.
 *
 * Этот шаг — маршрут, право, пункт меню и переключатель видов. Карточки и колонки
 * собираются следующим шагом (`docs/kanban_design.md` §13).
 */
export default async function KanbanPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const access = await checkPageAccess('kanban:read');
  if (!access.allowed) {
    return (
      <AccessDenied
        action="просмотр доски производственного контура"
        allowedRoles={['NP', 'ADM', 'S1C', 'OTK', 'KSGP', 'USGP']}
        requiredPermission="kanban:read"
      />
    );
  }

  const roles = access.roles;
  const shiftId = typeof searchParams.shiftId === 'string' ? searchParams.shiftId : undefined;

  return (
    <main className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-graphite">Канбан производственного контура</h1>
        <ViewSwitch
          current="board"
          listHref={
            hasPermission(roles, 'production_order:read') ? listViewHref({ shiftId }) : null
          }
          boardHref={hasPermission(roles, 'kanban:read') ? boardViewHref({ shiftId }) : null}
        />
      </div>

      <p className="text-sm text-steel-graphite">
        Доска показывает, где сейчас каждая строка РЦ: от черновика ПЗ до приёмки на складе.
        Колонки и карточки появятся на следующем шаге — маршрут, право и переключатель видов
        уже работают.
      </p>
    </main>
  );
}
