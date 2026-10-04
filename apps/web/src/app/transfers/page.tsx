export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { Pagination } from '@/components/pagination';
import { checkPageAccess } from '@/lib/auth/page-guard';
import { requireSession } from '@/lib/auth/session';

import TransfersPage from './_client-page';
import { getTransfersPage, parseTransferStatusFilter } from './queries';

interface TransfersServerPageProps {
  searchParams: {
    status?: string;
    page?: string;
  };
}

export default async function TransfersServerPage({
  searchParams,
}: TransfersServerPageProps) {
  const access = await checkPageAccess('transfer:read');
  if (!access.allowed) {
    return (
      <AccessDenied
        action="просмотр перемещений"
        allowedRoles={['NP', 'KSGP', 'USGP', 'S1C', 'ADM']}
        requiredPermission="transfer:read"
      />
    );
  }

  const status = parseTransferStatusFilter(searchParams.status);

  const [result, session] = await Promise.all([
    getTransfersPage({ status }, searchParams.page),
    requireSession(),
  ]);
  const userRoles = session.user.roles.map((ur) => ur.role.code);

  return (
    <>
      <TransfersPage
        transfers={result.items}
        userRoles={userRoles}
        statusFilter={status}
      />
      <div className="px-6 pb-6">
        <Pagination
          pathname="/transfers"
          searchParams={searchParams}
          page={result.page}
          hasNextPage={result.hasNextPage}
        />
      </div>
    </>
  );
}
