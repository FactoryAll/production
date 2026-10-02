export const dynamic = 'force-dynamic';

import { notFound, redirect } from 'next/navigation';
import { getTransferById } from '../../actions';
import ReconcileForm from './_client-form';
import { requirePermission } from '@/lib/auth/access';

interface ReconcilePageProps {
  params: { id: string };
}

export default async function ReconcilePage({ params }: ReconcilePageProps) {
  await requirePermission('transfer:reconcile');

  const transfer = await getTransferById(params.id);
  if (!transfer) {
    notFound();
  }

  if (transfer.status !== 'DISCREPANCY') {
    redirect(`/transfers/${transfer.id}`);
  }

  return <ReconcileForm transfer={transfer} />;
}
