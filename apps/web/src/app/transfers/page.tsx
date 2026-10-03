export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

import { getTransfers } from './queries';
import TransfersPage from './_client-page';
import { requireSession } from '@/lib/auth/session';

export default async function TransfersServerPage() {
  const access = await checkPageAccess(['transfer:create', 'transfer:update', 'transfer:receive', 'transfer:reconcile']);
  if (!access.allowed) {
    return <AccessDenied action="просмотр перемещений" allowedRoles={['NP', 'KSGP', 'USGP', 'ADM']} requiredPermission='transfer:create / transfer:update / transfer:receive / transfer:reconcile' />;
  }
  const [transfers, session] = await Promise.all([getTransfers(), requireSession()]);
  const userRoles = session.user.roles.map((ur) => ur.role.code);
  return <TransfersPage transfers={transfers} userRoles={userRoles} />;
}
