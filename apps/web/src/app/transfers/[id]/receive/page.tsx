export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

import { notFound, redirect } from 'next/navigation';
import { getTransferById } from '../../queries';
import ReceiveTransferForm from './_client-form';

interface ReceiveTransferPageProps {
  params: { id: string };
}

export default async function ReceiveTransferPage({ params }: ReceiveTransferPageProps) {
  const access = await checkPageAccess('transfer:receive');
  if (!access.allowed) {
    return <AccessDenied action="приёмка перемещения" allowedRoles={['KSGP', 'ADM']} requiredPermission='transfer:receive' />;
  }

  const transfer = await getTransferById(params.id);
  if (!transfer) {
    notFound();
  }

  if (transfer.status !== 'SUBMITTED') {
    redirect(`/transfers/${transfer.id}`);
  }

  return <ReceiveTransferForm transfer={transfer} />;
}
