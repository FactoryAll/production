export const dynamic = 'force-dynamic';

import { prisma } from '@prodtrack/db';
import EmployeesPage from './_client-page';

export default async function EmployeesServerPage() {
  const employees = await prisma.employee.findMany({ orderBy: { tabNumber: 'asc' } });
  return <EmployeesPage employees={employees} />;
}
