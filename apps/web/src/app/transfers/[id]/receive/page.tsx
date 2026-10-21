export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

import { notFound, redirect } from 'next/navigation';
import { getTransferById } from '../../queries';
import { canReceiveTransfer, receivingRolesFor } from '../../receive-rules';
import ReceiveTransferForm from './_client-form';

interface ReceiveTransferPageProps {
  params: { id: string };
}

export default async function ReceiveTransferPage({ params }: ReceiveTransferPageProps) {
  const access = await checkPageAccess('transfer:receive');
  if (!access.allowed) {
    return <AccessDenied action="приёмка перемещения" allowedRoles={['KSGP', 'USGP', 'ADM']} requiredPermission='transfer:receive' />;
  }

  const transfer = await getTransferById(params.id);
  if (!transfer) {
    notFound();
  }

  // Принимает тот, чей склад принимает: склад ГП — КСГП, производственный — УСГП (ОПЭ-28).
  if (!canReceiveTransfer(access.roles, transfer.destinationWarehouse.type)) {
    return (
      <AccessDenied
        action="приёмка перемещения"
        allowedRoles={receivingRolesFor(transfer.destinationWarehouse.type)}
        requiredPermission='transfer:receive'
      />
    );
  }

  if (transfer.status !== 'SUBMITTED') {
    redirect(`/transfers/${transfer.id}`);
  }

  return <ReceiveTransferForm transfer={transfer} />;
}
