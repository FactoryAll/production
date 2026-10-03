export const dynamic = 'force-dynamic';

import { prisma } from '@prodtrack/db';
import { hasPermission } from '@prodtrack/contracts';
import { requireSession } from '@/lib/auth/session';
import SubstitutionReasonsPage from './_client-page';

export default async function SubstitutionReasonsServerPage() {
  const [substitutionReasons, session] = await Promise.all([
    prisma.substitutionReason.findMany({ orderBy: { code: 'asc' } }),
    requireSession(),
  ]);
  const canManage = hasPermission(
    session.user.roles.map((ur) => ur.role.code),
    'nsi:manage',
  );
  return <SubstitutionReasonsPage substitutionReasons={substitutionReasons} canManage={canManage} />;
}
