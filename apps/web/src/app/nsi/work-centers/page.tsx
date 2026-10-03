export const dynamic = 'force-dynamic';
import { prisma } from '@prodtrack/db';
import { hasPermission } from '@prodtrack/contracts';
import { requireSession } from '@/lib/auth/session';
import WorkCentersPage from './_client-page';

export default async function WorkCentersServerPage() {
  const [workCenters, session] = await Promise.all([
    prisma.workCenter.findMany({ orderBy: { code: 'asc' } }),
    requireSession(),
  ]);
  const canManage = hasPermission(
    session.user.roles.map((ur) => ur.role.code),
    'nsi:manage',
  );
  return <WorkCentersPage workCenters={workCenters} canManage={canManage} />;
}