export const dynamic = 'force-dynamic';

import { hasPermission } from '@prodtrack/contracts';
import { requireSession } from '@/lib/auth/session';
import { Pagination } from '@/components/pagination';

import EmployeesPage from './_client-page';
import { getEmployeesPage, parseActiveFilter } from './queries';

interface EmployeesServerPageProps {
  searchParams: {
    q?: string;
    active?: string;
    page?: string;
  };
}

export default async function EmployeesServerPage({ searchParams }: EmployeesServerPageProps) {
  const query = searchParams.q?.trim() ?? '';
  const active = parseActiveFilter(searchParams.active);

  const [result, session] = await Promise.all([
    getEmployeesPage({ q: query, active }, searchParams.page),
    requireSession(),
  ]);

  const canManage = hasPermission(
    session.user.roles.map((ur) => ur.role.code),
    'nsi:manage',
  );

  return (
    <>
      <EmployeesPage
        employees={result.items}
        canManage={canManage}
        query={query}
        activeFilter={active}
      />
      <div className="px-6 pb-6">
        <Pagination
          pathname="/nsi/employees"
          searchParams={searchParams}
          page={result.page}
          hasNextPage={result.hasNextPage}
        />
      </div>
    </>
  );
}
