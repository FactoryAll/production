export const dynamic = 'force-dynamic';

import { notFound, redirect } from 'next/navigation';
import { getTransferById } from '../../actions';
import ReceiveTransferForm from './_client-form';
import { requirePermission } from '@/lib/auth/access';

interface ReceiveTransferPageProps {
  params: { id: string };
}

export default async function ReceiveTransferPage({ params }: ReceiveTransferPageProps) {
  await requirePermission('transfer:receive');

  const transfer = await getTransferById(params.id);
  if (!transfer) {
    notFound();
  }

  if (transfer.status !== 'SUBMITTED') {
    redirect(`/transfers/${transfer.id}`);
  }

  return <ReceiveTransferForm transfer={transfer} />;
}
