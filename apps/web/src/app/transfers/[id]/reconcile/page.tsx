export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

import { notFound, redirect } from 'next/navigation';
import { getTransferById } from '../../queries';
import ReconcileForm from './_client-form';

interface ReconcilePageProps {
  params: { id: string };
}

export default async function ReconcilePage({ params }: ReconcilePageProps) {
  const access = await checkPageAccess('transfer:reconcile');
  if (!access.allowed) {
    return <AccessDenied action="согласование расхождений" allowedRoles={['NP', 'KSGP', 'USGP', 'ADM']} requiredPermission='transfer:reconcile' />;
  }

  const transfer = await getTransferById(params.id);
  if (!transfer) {
    notFound();
  }

  if (transfer.status !== 'DISCREPANCY') {
    redirect(`/transfers/${transfer.id}`);
  }

  return <ReconcileForm transfer={transfer} />;
}
