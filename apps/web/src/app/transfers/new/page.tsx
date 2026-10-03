export const dynamic = 'force-dynamic';

import { getTransferCreateData } from '../queries';
import TransferForm from './_client-form';

export default async function NewTransferPage() {
  const { warehouses, products, stockByWarehouse } = await getTransferCreateData();
  return <TransferForm warehouses={warehouses} products={products} stockByWarehouse={stockByWarehouse} />;
}
