export const dynamic = 'force-dynamic';

import { getTransferCreateData } from '../actions';
import TransferForm from './_client-form';

export default async function NewTransferPage() {
  const { warehouses, products } = await getTransferCreateData();
  return <TransferForm warehouses={warehouses} products={products} />;
}
