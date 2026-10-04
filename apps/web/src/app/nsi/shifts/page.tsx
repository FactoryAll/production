export const dynamic = 'force-dynamic';

import { hasPermission } from '@prodtrack/contracts';
import { Pagination } from '@/components/pagination';
import { requireSession } from '@/lib/auth/session';
import { parseActiveFilter } from '@/lib/nsi-list';

import ShiftsPage from './_client-page';
import { getShiftsPage } from './queries';

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
    getShiftsPage({ q: query, active }, searchParams.page),
    requireSession(),
  ]);

  const canManage = hasPermission(
    session.user.roles.map((ur) => ur.role.code),
    'nsi:manage',
  );

  return (
    <>
      <ShiftsPage
        shifts={result.items}
        canManage={canManage}
        query={query}
        activeFilter={active}
      />
      <div className="px-6 pb-6">
        <Pagination
          pathname="/nsi/shifts"
          searchParams={searchParams}
          page={result.page}
          hasNextPage={result.hasNextPage}
        />
      </div>
    </>
  );
}
