export const dynamic = 'force-dynamic';

import { notFound, redirect } from 'next/navigation';
import { getTransferById, getTransferCreateData } from '../../queries';
import TransferEditForm from './_client-form';

interface EditTransferPageProps {
  params: { id: string };
}

export default async function EditTransferPage({ params }: EditTransferPageProps) {
  const [transfer, createData] = await Promise.all([
    getTransferById(params.id),
    getTransferCreateData(),
  ]);

  if (!transfer) {
    notFound();
  }

  // Корректировка возможна в DRAFT и SUBMITTED (M07 §4.2 / UC-M07-3),
  // после подтверждения КСГП — только просмотр (BR-2).
  if (transfer.status !== 'DRAFT' && transfer.status !== 'SUBMITTED') {
    redirect(`/transfers/${transfer.id}`);
  }

  return (
    <TransferEditForm
      transfer={transfer}
      warehouses={createData.warehouses}
      products={createData.products}
      stockByWarehouse={createData.stockByWarehouse}
    />
  );
}
