export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

import { notFound } from 'next/navigation';
import { getTransferById } from '../queries';
import TransferCard from './_client-card';
import { ObjectHistory } from '@/components/object-history';
import { requireSession } from '@/lib/auth/session';

interface TransferPageProps {
  params: { id: string };
}

export default async function TransferPage({ params }: TransferPageProps) {
  const access = await checkPageAccess(['transfer:create', 'transfer:update', 'transfer:receive', 'transfer:reconcile']);
  if (!access.allowed) {
    return <AccessDenied action="просмотр перемещений" allowedRoles={['NP', 'KSGP', 'USGP', 'ADM']} requiredPermission='transfer:create / transfer:update / transfer:receive / transfer:reconcile' />;
  }
  const [transfer, session] = await Promise.all([getTransferById(params.id), requireSession()]);
  if (!transfer) {
    notFound();
  }
  const userRoles = session.user.roles.map((ur) => ur.role.code);
  return (
    <>
      <TransferCard transfer={transfer} userRoles={userRoles} />
      {/* Вкладка «История» карточки объекта (M13 §8). */}
      <ObjectHistory
        objectType="GoodsTransfer"
        objectId={transfer.id}
        canShowArchived={userRoles.includes('ADM')}
      />
    </>
  );
}
