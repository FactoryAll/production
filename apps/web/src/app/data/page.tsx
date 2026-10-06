export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { requireSession } from '@/lib/auth/session';
import { prisma } from '@prodtrack/db';
import { countDataGroups } from '@/lib/data-cleanup';

import DataCleanupPage from './_client-page';

/**
 * Экран администратора «Данные» (T-076).
 *
 * Показывает группы операционных данных и число записей в каждой. Справочники, пользователи,
 * роли и журнал аудита сюда не входят: система остаётся рабочей, пустыми становятся документы.
 */
export default async function DataCleanupServerPage() {
  const session = await requireSession();
  const roles = session.user.roles.map((ur) => ur.role.code);

  if (!roles.includes('ADM')) {
    return (
      <AccessDenied
        action="очистка данных"
        allowedRoles={['ADM']}
        requiredPermission="users:manage"
      />
    );
  }

  const groups = await countDataGroups(prisma);

  return <DataCleanupPage groups={groups} />;
}
