export const dynamic = 'force-dynamic';

import { prisma } from '@prodtrack/db';
import { hasPermission } from '@prodtrack/contracts';
import { requireSession } from '@/lib/auth/session';
import DefectReasonsPage from './_client-page';

export default async function DefectReasonsServerPage() {
  const [defectReasons, session] = await Promise.all([
    prisma.defectReason.findMany({ orderBy: { code: 'asc' } }),
    requireSession(),
  ]);
  const canManage = hasPermission(
    session.user.roles.map((ur) => ur.role.code),
    'nsi:manage',
  );
  return <DefectReasonsPage defectReasons={defectReasons} canManage={canManage} />;
}
