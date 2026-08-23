export const dynamic = 'force-dynamic';

import { getProductionOrders } from './actions';
import ProductionOrdersPage from './_client-page';
import { requireSession } from '@/lib/auth/session';

export default async function ProductionOrdersServerPage() {
  const [orders, session] = await Promise.all([getProductionOrders(), requireSession()]);
  const userRoles = session.user.roles.map((ur) => ur.role.code);
  return <ProductionOrdersPage orders={orders} userRoles={userRoles} />;
}
