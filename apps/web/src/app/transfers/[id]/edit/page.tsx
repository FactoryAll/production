export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { getTransferById, getTransferCreateData } from '../../actions';
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

  return (
    <TransferEditForm
      transfer={transfer}
      warehouses={createData.warehouses}
      products={createData.products}
    />
  );
}
