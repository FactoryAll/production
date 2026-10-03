export const dynamic = 'force-dynamic';

import { prisma } from '@prodtrack/db';
import { hasPermission } from '@prodtrack/contracts';
import { requireSession } from '@/lib/auth/session';
import WarehousesPage from './_client-page';

export default async function WarehousesServerPage() {
  const [warehouses, session] = await Promise.all([
    prisma.warehouse.findMany({ orderBy: { name: 'asc' } }),
    requireSession(),
  ]);
  const canManage = hasPermission(
    session.user.roles.map((ur) => ur.role.code),
    'nsi:manage_warehouses',
  );
  return <WarehousesPage warehouses={warehouses} canManage={canManage} />;
}
