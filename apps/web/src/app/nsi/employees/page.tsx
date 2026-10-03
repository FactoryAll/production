export const dynamic = 'force-dynamic';

import { prisma } from '@prodtrack/db';
import { hasPermission } from '@prodtrack/contracts';
import { requireSession } from '@/lib/auth/session';
import EmployeesPage from './_client-page';

export default async function EmployeesServerPage() {
  const [employees, session] = await Promise.all([
    prisma.employee.findMany({ orderBy: { tabNumber: 'asc' } }),
    requireSession(),
  ]);
  const canManage = hasPermission(
    session.user.roles.map((ur) => ur.role.code),
    'nsi:manage',
  );
  return <EmployeesPage employees={employees} canManage={canManage} />;
}
