export const dynamic = 'force-dynamic';

import { getProductionOrders } from './actions';
import ProductionOrdersPage from './_client-page';

export default async function ProductionOrdersServerPage() {
  const orders = await getProductionOrders();
  return <ProductionOrdersPage orders={orders} />;
}
