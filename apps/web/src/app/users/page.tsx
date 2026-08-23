import Link from 'next/link';
import { listUsers } from './data';
import { UsersTable, type UsersSearchParams } from './_components/users-table';

export const dynamic = 'force-dynamic';

export default async function UsersPage({ searchParams }: { searchParams: UsersSearchParams }) {
  const q = typeof searchParams.q === 'string' ? searchParams.q : undefined;
  const activeFilter =
    searchParams.active === 'true' ? true : searchParams.active === 'false' ? false : undefined;
  const users = await listUsers(q, activeFilter);

  return (
    <main className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Пользователи</h1>
        <Link
          href="/users/new"
          className="inline-flex h-12 items-center rounded-md bg-deep-industry-blue px-4 text-sm font-medium text-white hover:bg-opacity-90"
        >
          Создать пользователя
        </Link>
      </div>
      <UsersTable users={users} searchParams={searchParams} />
    </main>
  );
}