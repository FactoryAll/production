import { listEmployeesForSelect } from '../data';
import { createUserAction } from '../actions';
import { UserForm } from '../_components/user-form';

export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

export default async function NewUserPage() {
  const access = await checkPageAccess('users:manage');
  if (!access.allowed) {
    return <AccessDenied action="создание пользователя" allowedRoles={['ADM']} requiredPermission='users:manage' />;
  }
  const employees = await listEmployeesForSelect();
  return (
    <main className="p-6">
      <h1 className="mb-6 text-2xl font-bold">Создание пользователя</h1>
      <UserForm mode="create" employees={employees} action={createUserAction} />
    </main>
  );
}