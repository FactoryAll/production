import { notFound } from 'next/navigation';
import { getUserWithRoles, listEmployeesForSelect } from '../../data';
import { updateUserAction, resetPasswordAction } from '../../actions';
import { UserForm } from '../../_components/user-form';

export const dynamic = 'force-dynamic';

interface EditUserPageProps {
  params: { id: string };
}

export default async function EditUserPage({ params }: EditUserPageProps) {
  const [user, employees] = await Promise.all([
    getUserWithRoles(params.id),
    listEmployeesForSelect(),
  ]);
  if (!user) notFound();

  async function handleUpdate(formData: FormData) {
    'use server';
    return updateUserAction(params.id, formData);
  }

  async function handleReset() {
    'use server';
    return resetPasswordAction(params.id);
  }

  return (
    <main className="p-6">
      <h1 className="mb-6 text-2xl font-bold">Редактирование пользователя</h1>
      <UserForm mode="edit" user={user} employees={employees} action={handleUpdate} onReset={handleReset} />
    </main>
  );
}