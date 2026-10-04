export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

import { getTransfers } from './queries';
import TransfersPage from './_client-page';
import { requireSession } from '@/lib/auth/session';

export default async function TransfersServerPage() {
  const access = await checkPageAccess('transfer:read');
  if (!access.allowed) {
    return <AccessDenied action="просмотр перемещений" allowedRoles={['NP', 'KSGP', 'USGP', 'S1C', 'ADM']} requiredPermission='transfer:read' />;
  }
  const [transfers, session] = await Promise.all([getTransfers(), requireSession()]);
  const userRoles = session.user.roles.map((ur) => ur.role.code);
  return <TransfersPage transfers={transfers} userRoles={userRoles} />;
}
