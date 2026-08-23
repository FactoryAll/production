import Link from 'next/link';
import { listRolesWithPermissionCounts } from '../users/data';
import type { Role } from '@prisma/client';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const roles = await listRolesWithPermissionCounts();

  return (
    <main className="p-6">
      <h1 className="mb-6 text-2xl font-bold">Роли</h1>
      <p className="mb-4 text-sm text-neutral-600">
        Роли фиксированы в системе. Состав прав read-only в MVP.
      </p>
      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className="min-w-full text-sm">
          <thead className="bg-graphite-surface">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-neutral-700">Код</th>
              <th className="px-4 py-3 text-left font-semibold text-neutral-700">Название</th>
              <th className="px-4 py-3 text-left font-semibold text-neutral-700">Пользователей</th>
              <th className="px-4 py-3 text-left font-semibold text-neutral-700">Прав</th>
              <th className="px-4 py-3 text-left font-semibold text-neutral-700">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {roles.map((role: Role & { _count: { users: number; permissions: number } }) => (
              <tr key={role.code} className="hover:bg-neutral-50">
                <td className="px-4 py-3">{role.code}</td>
                <td className="px-4 py-3">{role.name}</td>
                <td className="px-4 py-3">{role._count.users}</td>
                <td className="px-4 py-3">{role._count.permissions}</td>
                <td className="px-4 py-3">
                  <Link href={'/roles/' + role.code} className="text-deep-industry-blue hover:underline">
                    Права
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}