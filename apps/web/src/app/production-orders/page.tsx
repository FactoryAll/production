export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

import { getProductionOrders } from './actions';
import ProductionOrdersPage from './_client-page';
import { requireSession } from '@/lib/auth/session';

export default async function ProductionOrdersServerPage() {
  const access = await checkPageAccess('production_order:read');
  if (!access.allowed) {
    return <AccessDenied action="просмотр производственных заданий" allowedRoles={['NP', 'ADM']} requiredPermission='production_order:read' />;
  }
  const [orders, session] = await Promise.all([getProductionOrders(), requireSession()]);
  const userRoles = session.user.roles.map((ur) => ur.role.code);
  return <ProductionOrdersPage orders={orders} userRoles={userRoles} />;
}
