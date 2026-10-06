export const dynamic = 'force-dynamic';

import { getProductionOrderCreateData } from '../actions';
import ProductionOrderForm from './_client-form';

export default async function NewProductionOrderPage() {
  const {
    workCenters,
    products,
    workerEmployees,
    operatorEmployees,
    shiftOptions,
    defaultShiftDate,
    defaultShiftNumber,
  } = await getProductionOrderCreateData();
  return (
    <ProductionOrderForm
      workCenters={workCenters}
      products={products}
      workerEmployees={workerEmployees}
      operatorEmployees={operatorEmployees}
      shiftOptions={shiftOptions}
      defaultShiftDate={defaultShiftDate}
      defaultShiftNumber={defaultShiftNumber}
    />
  );
}
