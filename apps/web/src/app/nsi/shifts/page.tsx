export const dynamic = 'force-dynamic';

import { prisma } from '@prodtrack/db';
import { hasPermission } from '@prodtrack/contracts';
import { requireSession } from '@/lib/auth/session';
import ShiftsPage from './_client-page';

export default async function ShiftsServerPage() {
  const [shifts, session] = await Promise.all([
    prisma.shift.findMany({ orderBy: [{ date: 'desc' }, { number: 'asc' }] }),
    requireSession(),
  ]);
  const canManage = hasPermission(
    session.user.roles.map((ur) => ur.role.code),
    'nsi:manage',
  );
  return <ShiftsPage shifts={shifts} canManage={canManage} />;
}
