export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { Pagination } from '@/components/pagination';
import { ViewSwitch } from '@/components/view-switch';
import { checkPageAccess } from '@/lib/auth/page-guard';
import { requireSession } from '@/lib/auth/session';
import { boardViewHref, listViewHref } from '@/lib/kanban/view-links';
import { hasPermission } from '@prodtrack/contracts';
import { prisma } from '@prodtrack/db';
import { toDateInputValue } from '@/lib/reports/period';

import ProductionOrdersPage from './_client-page';
import { getOrdersPage, parseOrderStatusFilter } from './queries';

interface ProductionOrdersServerPageProps {
  searchParams: {
    status?: string;
    /** Фильтр по смене (T-103): общий параметр с доской — при переключении видов не теряется. */
    shiftId?: string;
    page?: string;
  };
}

export default async function ProductionOrdersServerPage({
  searchParams,
}: ProductionOrdersServerPageProps) {
  const access = await checkPageAccess('production_order:read');
  if (!access.allowed) {
    return <AccessDenied action="просмотр производственных заданий" allowedRoles={['NP', 'ADM', 'S1C', 'GUEST', 'OTK']} requiredPermission='production_order:read' />;
  }

  const status = parseOrderStatusFilter(searchParams.status);
  const shiftId = typeof searchParams.shiftId === 'string' ? searchParams.shiftId : undefined;

  const [result, session, shifts] = await Promise.all([
    getOrdersPage({ status, shiftId }, searchParams.page),
    requireSession(),
    // Смены для фильтра — те же последние смены, что в отчётах.
    prisma.shift.findMany({
      orderBy: { date: 'desc' },
      take: 30,
      select: { id: true, number: true, date: true },
    }),
  ]);
  const userRoles = session.user.roles.map((ur) => ur.role.code);

  return (
    <>
      <ProductionOrdersPage
        orders={result.items}
        userRoles={userRoles}
        statusFilter={status}
        shiftId={shiftId ?? ''}
        shifts={shifts.map((shift) => ({
          id: shift.id,
          label: `Смена ${shift.number} от ${toDateInputValue(shift.date)}`,
        }))}
        viewSwitch={
          <ViewSwitch
            current="list"
            listHref={
              hasPermission(userRoles, 'production_order:read')
                ? listViewHref({ status, shiftId })
                : null
            }
            boardHref={hasPermission(userRoles, 'kanban:read') ? boardViewHref({ shiftId }) : null}
          />
        }
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
