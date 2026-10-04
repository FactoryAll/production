export const dynamic = 'force-dynamic';

import { hasPermission } from '@prodtrack/contracts';
import { Pagination } from '@/components/pagination';
import { requireSession } from '@/lib/auth/session';
import { parseActiveFilter } from '@/lib/nsi-list';

import WarehousesPage from './_client-page';
import { getWarehousePage } from './queries';

interface ServerPageProps {
  searchParams: {
    q?: string;
    active?: string;
    page?: string;
  };
}

export default async function ServerPage({ searchParams }: ServerPageProps) {
  const query = searchParams.q?.trim() ?? '';
  const active = parseActiveFilter(searchParams.active);

  const [result, session] = await Promise.all([
    getWarehousePage({ q: query, active }, searchParams.page),
    requireSession(),
  ]);

  const canManage = hasPermission(
    session.user.roles.map((ur) => ur.role.code),
    'nsi:manage_warehouses',
  );

  return (
    <>
      <WarehousesPage
        warehouses={result.items}
        canManage={canManage}
        query={query}
        activeFilter={active}
      />
      <div className="px-6 pb-6">
        <Pagination
          pathname="/nsi/warehouses"
          searchParams={searchParams}
          page={result.page}
          hasNextPage={result.hasNextPage}
        />
      </div>
    </>
  );
}
