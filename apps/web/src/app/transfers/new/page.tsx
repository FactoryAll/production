export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

import { getTransferCreateData } from '../queries';
import TransferForm from './_client-form';

export default async function NewTransferPage() {
  const access = await checkPageAccess('transfer:create');
  if (!access.allowed) {
    return <AccessDenied action="создание перемещения" allowedRoles={['NP', 'ADM']} requiredPermission='transfer:create' />;
  }
  const { warehouses, products, stockByWarehouse } = await getTransferCreateData();
  return <TransferForm warehouses={warehouses} products={products} stockByWarehouse={stockByWarehouse} />;
}
