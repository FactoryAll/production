export const dynamic = 'force-dynamic';

import { getProductionOrderCreateData } from '../actions';
import ProductionOrderForm from './_client-form';

export default async function NewProductionOrderPage() {
  const { shifts, workCenters, products, employees } = await getProductionOrderCreateData();
  return (
    <ProductionOrderForm
      shifts={shifts}
      workCenters={workCenters}
      products={products}
      employees={employees}
    />
  );
}
