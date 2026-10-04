export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { Pagination } from '@/components/pagination';
import { checkPageAccess } from '@/lib/auth/page-guard';
import { requireSession } from '@/lib/auth/session';

import ProductionOrdersPage from './_client-page';
import { getOrdersPage, parseOrderStatusFilter } from './queries';

interface ProductionOrdersServerPageProps {
  searchParams: {
    status?: string;
    page?: string;
  };
}

export default async function ProductionOrdersServerPage({
  searchParams,
}: ProductionOrdersServerPageProps) {
  const access = await checkPageAccess('production_order:read');
  if (!access.allowed) {
    return <AccessDenied action="просмотр производственных заданий" allowedRoles={['NP', 'ADM', 'S1C']} requiredPermission='production_order:read' />;
  }

  const status = parseOrderStatusFilter(searchParams.status);

  const [result, session] = await Promise.all([
    getOrdersPage({ status }, searchParams.page),
    requireSession(),
  ]);
  const userRoles = session.user.roles.map((ur) => ur.role.code);

  return (
    <>
      <ProductionOrdersPage
        orders={result.items}
        userRoles={userRoles}
        statusFilter={status}
      />
      <div className="px-6 pb-6">
        <Pagination
          pathname="/production-orders"
          searchParams={searchParams}
          page={result.page}
          hasNextPage={result.hasNextPage}
        />
      </div>
    </>
  );
}
