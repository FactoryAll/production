export const dynamic = 'force-dynamic';

import { getTransfers } from './actions';
import TransfersPage from './_client-page';
import { requireSession } from '@/lib/auth/session';

export default async function TransfersServerPage() {
  const [transfers, session] = await Promise.all([getTransfers(), requireSession()]);
  const userRoles = session.user.roles.map((ur) => ur.role.code);
  return <TransfersPage transfers={transfers} userRoles={userRoles} />;
}
